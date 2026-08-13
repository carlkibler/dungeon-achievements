#!/usr/bin/env node
// Guards the discovery surface: the "Dungeon Crawler Carl" / "DCC" keywords, the head metadata,
// and the rule that every FAQPage answer must actually appear in the visible page copy.
// Google discards structured data whose answers aren't on the page, and that failure is silent.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'public/index.html'), 'utf8');
const failures = [];
const fail = (msg) => failures.push(msg);

/** Strip tags and entities, then close the gaps tag removal leaves before punctuation. */
const visibleText = (fragment) =>
  fragment
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&(nbsp|#160);/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();

const body = visibleText(html.slice(html.indexOf('<body>')));

// 1. Required head metadata.
const requiredTags = [
  [/<link rel="canonical"/, 'canonical link'],
  [/<meta name="description" content="[^"]{80,300}"/, 'meta description (80-300 chars)'],
  [/<meta property="og:image" content="[^"]+"/, 'og:image'],
  [/<meta property="og:title"/, 'og:title'],
  [/<meta name="twitter:card" content="summary_large_image"/, 'twitter:card'],
];
for (const [re, label] of requiredTags) if (!re.test(html)) fail(`missing ${label}`);

// 2. The keywords the whole site is discovered by must be in crawlable text, not just prompts.
for (const kw of ['Dungeon Crawler Carl', 'DCC']) {
  if (!body.includes(kw)) fail(`"${kw}" missing from visible page copy`);
  if (!/<title>[^<]*Dungeon Crawler Carl[^<]*<\/title>/.test(html) && kw === 'Dungeon Crawler Carl') {
    fail('"Dungeon Crawler Carl" missing from <title>');
  }
}

// 3. JSON-LD parses, and FAQ answers are mirrored in visible copy.
const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
if (!ldMatch) {
  fail('no JSON-LD block found');
} else {
  let graph;
  try {
    graph = JSON.parse(ldMatch[1])['@graph'] ?? [];
  } catch (err) {
    fail(`JSON-LD does not parse: ${err.message}`);
    graph = [];
  }

  const types = graph.map((n) => n['@type']);
  for (const t of ['WebApplication', 'FAQPage']) {
    if (!types.includes(t)) fail(`JSON-LD missing a ${t} node`);
  }

  const questions = graph.filter((n) => n['@type'] === 'FAQPage').flatMap((n) => n.mainEntity ?? []);
  if (questions.length === 0) fail('FAQPage has no questions');

  for (const q of questions) {
    const answer = visibleText(q.acceptedAnswer?.text ?? '');
    // Compare sentence by sentence so the error names the exact drifted clause.
    const sentences = answer.split(/(?<=\.)\s+/).filter((s) => s.length > 25);
    for (const s of sentences) {
      if (!body.includes(s)) fail(`FAQ "${q.name}" answer not on page: "${s.slice(0, 70)}..."`);
    }
  }
}

// 4. Social card exists and is exactly 1200x630 (scrapers crop or reject other ratios).
try {
  const png = readFileSync(join(root, 'public/og.png'));
  const [w, h] = [png.readUInt32BE(16), png.readUInt32BE(20)];
  if (w !== 1200 || h !== 630) fail(`og.png is ${w}x${h}, expected 1200x630`);
} catch {
  fail('public/og.png is missing or unreadable');
}

// 5. Crawl plumbing.
for (const [file, needle] of [
  ['public/robots.txt', 'Sitemap: https://achievements.carlkibler.com/sitemap.xml'],
  ['public/sitemap.xml', 'https://achievements.carlkibler.com/'],
]) {
  try {
    if (!readFileSync(join(root, file), 'utf8').includes(needle)) fail(`${file} missing "${needle}"`);
  } catch {
    fail(`${file} is missing`);
  }
}

if (failures.length) {
  console.error('✗ SEO check failed:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('✓ SEO check passed — metadata, DCC keywords, FAQ/JSON-LD sync, og.png, robots, sitemap');
