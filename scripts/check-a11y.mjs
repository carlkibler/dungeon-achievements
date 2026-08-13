#!/usr/bin/env node
// Accessibility + responsive regression guard.
//
// Three layers, because each catches what the others cannot:
//   1. axe-core  — static WCAG rule violations (catches maybe 40% of real problems)
//   2. behaviour — keyboard, focus movement, and live-region announcements, which
//                  are the parts a screen reader user actually depends on
//   3. reflow    — horizontal overflow at every width down to 320px. Browser zoom
//                  shrinks the CSS viewport, so this is also the zoom test:
//                  1280px at 400% zoom IS a 320px layout (WCAG 1.4.10).
//
// Needs a dev server. Start one with `make dev` (port 8788) or pass a URL:
//   node scripts/check-a11y.mjs http://localhost:8799

import { readFileSync } from 'node:fs';

const BASE = process.argv[2] || process.env.A11Y_BASE_URL || 'http://localhost:8788';

let chromium, axeSource;
try {
  ({ chromium } = await import('playwright'));
  axeSource = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');
} catch {
  console.error(
    '✗ Missing tools for this check. Run:\n' +
    '    npm install && npx playwright install chromium\n' +
    '  (playwright and axe-core are devDependencies; the browser binary is a separate download)'
  );
  process.exit(1);
}

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures.push(name);
};

const browser = await chromium.launch();
const newPage = async (width = 1440) => {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto(BASE);
  return page;
};

const generate = async (page, text) => {
  await page.fill('#activityInput', text);
  await page.click('#generateBtn');
  await page.waitForSelector('.achievement-title', { timeout: 45000 });
  await page.waitForTimeout(400);
};

// ── 1. axe-core, across the states the markup actually differs in ───────────
console.log('\naxe-core (WCAG 2.1 A/AA + best practice)');
for (const [label, prep] of [
  ['initial load', null],
  ['with results', (p) => generate(p, 'Ran an accessibility audit')],
  ['empty-input error', async (p) => { await p.click('#generateBtn'); await p.waitForSelector('#inputError:not([hidden])'); }],
]) {
  const page = await newPage();
  if (prep) await prep(page);
  await page.addScriptTag({ content: axeSource });
  const res = await page.evaluate(async () => window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
  }));
  check(`${label}: no violations`, res.violations.length === 0,
    res.violations.map(v => `${v.id} (${v.nodes.length})`).join(', ') || `${res.passes.length} checks passed`);
  await page.close();
}

// ── 2. Keyboard and screen-reader behaviour ─────────────────────────────────
console.log('\nkeyboard & screen reader behaviour');
{
  const page = await newPage();

  await page.keyboard.press('Tab');
  check('skip link is the first tab stop',
    await page.evaluate(() => document.activeElement.getAttribute('href')) === '#activityInput');

  // The style picker must be ONE tab stop, not seven.
  const stops = [];
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    stops.push(await page.evaluate(() => document.activeElement.className.split(' ')[0]));
  }
  check('style picker is a single tab stop', stops.filter(s => s === 'style-pill').length === 1);

  await page.focus('.style-pill[data-style="default"]');
  await page.keyboard.press('ArrowRight');
  const arrowed = await page.evaluate(() => ({
    focused: document.activeElement.dataset.style,
    checked: document.querySelectorAll('.style-pill[aria-checked="true"]').length,
  }));
  check('arrow keys move and select one option', arrowed.focused === 'corporate' && arrowed.checked === 1);

  // Focus rings must be present the instant focus lands — `transition: all` used to
  // fade them in over 200ms, which is a focus indicator you cannot rely on.
  const rings = [];
  await page.evaluate(() => document.activeElement.blur());
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    rings.push(await page.evaluate(() => {
      const s = getComputedStyle(document.activeElement);
      return `${s.outlineStyle}:${s.outlineWidth}`;
    }));
  }
  check('every control shows a focus ring immediately', rings.every(r => r.startsWith('solid') && parseFloat(r.split(':')[1]) >= 2), rings.join(' '));

  let dialog = false;
  page.on('dialog', d => { dialog = true; d.dismiss(); });
  await page.click('#generateBtn');
  await page.waitForSelector('#inputError:not([hidden])', { timeout: 3000 });
  check('empty input uses an inline alert, not alert(), and focuses the field',
    !dialog && await page.evaluate(() => document.activeElement.id) === 'activityInput');

  await generate(page, 'Verified focus lands somewhere useful');
  const after = await page.evaluate(() => ({
    focused: document.activeElement.id,
    busy: document.getElementById('achievementsSection').getAttribute('aria-busy'),
    status: document.getElementById('srStatus').textContent,
    hasEmoji: /\p{Extended_Pictographic}/u.test(document.getElementById('srStatus').textContent),
  }));
  check('focus moves to the results heading', after.focused === 'achievementsHeading', after.focused);
  check('aria-busy cleared after load', after.busy === null);
  check('completion is announced', /achievements ready/i.test(after.status));
  check('announcement has no emoji to read aloud', !after.hasEmoji, after.status.slice(0, 50));

  const names = await page.$$eval('#achievementsList button', bs => bs.map(b => b.getAttribute('aria-label')));
  check('every action button has a unique accessible name',
    names.every(Boolean) && new Set(names).size === names.length, `${names.length} buttons`);

  const headings = await page.$$eval('h1,h2,h3,h4,h5,h6', hs => hs.map(h => +h.tagName[1]));
  const skipped = headings.some((l, i) => i > 0 && l > headings[i - 1] + 1);
  check('heading outline skips no levels', !skipped, headings.map(l => `h${l}`).join(' '));

  await page.click('#achievementsList .achievement:first-child [data-action="copy"]');
  await page.waitForTimeout(250);
  check('copying announces to screen readers',
    /copied/i.test(await page.evaluate(() => document.getElementById('srStatus').textContent)));

  await page.close();
}

// ── 3. Reduced motion ───────────────────────────────────────────────────────
console.log('\nreduced motion');
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await page.goto(BASE);
  await page.fill('#activityInput', 'Asked the page to stop moving');
  await page.click('#generateBtn');
  await page.waitForTimeout(900);
  check('loading effects are skipped entirely',
    await page.evaluate(() => document.getElementById('loadingFx')?.childElementCount) === 0);
  await page.waitForSelector('.achievement-title', { timeout: 45000 });
  check('cards are still visible without their reveal animation',
    await page.evaluate(() => getComputedStyle(document.querySelector('.achievement')).opacity) === '1');
  await page.close();
}

// ── 4. Reflow / zoom ────────────────────────────────────────────────────────
console.log('\nreflow — no horizontal overflow (also the browser-zoom test)');
{
  const WIDTHS = [1600, 1280, 1024, 900, 820, 768, 700, 640, 600, 560, 480, 414, 390, 360, 320];
  const states = {
    'initial load': async (p) => { await p.evaluate(() => localStorage.clear()); await p.reload(); },
    'results + history': async (p) => generate(p, 'Resized the window to 320 pixels'),
    'loading state': async (p) => {
      await p.fill('#activityInput', 'Checking the loading panel');
      await p.click('#generateBtn');
      await p.waitForSelector('#loadingPanel');
    },
  };
  for (const [label, prep] of Object.entries(states)) {
    const page = await newPage();
    await prep(page);
    const bad = [];
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(100);
      const r = await page.evaluate(() => {
        const de = document.documentElement, vw = de.clientWidth;
        const off = [...document.querySelectorAll('body *')]
          .map(el => ({ el, rect: el.getBoundingClientRect() }))
          .filter(({ rect }) => rect.width > 0 && rect.right > vw + 1)
          .map(({ el }) => `${el.tagName.toLowerCase()}.${(el.className || '').toString().trim().split(/\s+/)[0] || '-'}`);
        return { over: de.scrollWidth - vw, off: [...new Set(off)].slice(0, 3) };
      });
      if (r.over > 0) bad.push(`${w}px +${r.over}px [${r.off.join(', ')}]`);
    }
    check(`${label}: 1600px → 320px`, bad.length === 0, bad.join('; '));
    await page.close();
  }
}

await browser.close();

if (failures.length) {
  console.error(`\n✗ ${failures.length} accessibility check(s) failed`);
  process.exit(1);
}
console.log('\n✓ Accessibility checks passed — axe clean, keyboard/focus/announcements correct, reflows to 320px');
