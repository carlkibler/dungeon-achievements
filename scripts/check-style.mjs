#!/usr/bin/env node
// Samples real generations and reports the shape of what the model actually writes.
//
// This exists because prompt length rules are unfalsifiable by reading them. Every constraint in
// BASE_TEMPLATE was, at some point, being ignored while looking perfectly reasonable in the file:
// word ranges asking for 5-12 words produced a median of 63. The only way to know is to measure.
//
//   npm run check:style            # 16 activities, one generation each
//   npm run check:style -- -n 24   # more samples, more API cost
//
// Costs real OpenRouter calls, so it is not part of any gate. Run it after touching BASE_TEMPLATE,
// FORM_PROFILES, or the LENGTH block, and paste the summary into the commit message.

import { readFileSync } from 'node:fs';
import { buildPrompt, parseAchievements } from '../src/core.ts';

const ACTIVITIES = [
    'made a really good grilled cheese', 'alphabetized the spice rack at 2am', 'ran 5k in the rain',
    'sat through a 90 minute meeting that should have been an email', 'assembled IKEA furniture without crying',
    'took a nap at 4pm and woke up confused', 'cleaned the entire kitchen', 'finally cancelled a subscription',
    'read three pages of a book before falling asleep', 'parallel parked on the first try',
    'ate cereal for dinner again', 'survived a family dinner', 'went to the gym twice this week',
    'fixed the wobbly table leg', 'watched an entire season in one sitting', 'did my taxes on time',
    'washed the car by hand', 'returned a library book only two weeks late', 'made the bed for once',
    'walked the dog in the dark', 'ordered the same takeaway third time this week', 'changed a lightbulb',
];

// Measured baseline, 2026-08-13, anthropic/claude-haiku-4.5. Before the LENGTH rewrite: median 63,
// p75 70, max 77, and not one pithy card in any set. Thresholds sit below the observed run-to-run
// spread on purpose — a check that fails half the time on an unchanged prompt teaches nobody
// anything. Tighten them only after several clean runs, never off a single lucky one.
const THRESHOLDS = {
    medianWords: 45,        // half the descriptions should be shorter than this
    maxWords: 70,           // nothing should run past this in a sample
    pithySetRatio: 0.5,     // share of sets with a comma-free description of <=15 words (seen 50-81%)
    malformedRatio: 0.1,    // share of responses that do not yield three usable achievements
};

const argN = process.argv.indexOf('-n');
const SAMPLES = argN > -1 ? Math.min(Number(process.argv[argN + 1]) || 16, ACTIVITIES.length) : 16;

const env = Object.fromEntries(
    readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8')
        .split('\n').filter(line => line.includes('=') && !line.trim().startsWith('#'))
        .map(line => { const i = line.indexOf('='); return [line.slice(0, i).trim(), line.slice(i + 1).trim()]; }),
);
if (!env.OPENROUTER_API_KEY) {
    console.error('check:style needs OPENROUTER_API_KEY in .dev.vars');
    process.exit(2);
}
const MODEL = env.OPENROUTER_MODEL ?? 'anthropic/claude-haiku-4.5';

const words = text => text.trim().split(/\s+/).length;

async function generate(activity) {
    const { prompt } = buildPrompt(activity, 'default', [], []);
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENROUTER_API_KEY}` },
        body: JSON.stringify({
            model: MODEL, max_tokens: 2000, temperature: 0.9,
            messages: [{ role: 'user', content: prompt }],
        }),
    });
    if (!response.ok) throw new Error(`openrouter ${response.status}`);
    const body = await response.json();
    return body.choices?.[0]?.message?.content ?? '';
}

const sets = [];
let malformed = 0;
let cursor = 0;   // claimed before the await — six workers sharing an index would double-sample

await Promise.all(Array.from({ length: 6 }, async () => {
    for (let i = cursor++; i < SAMPLES; i = cursor++) {
        const activity = ACTIVITIES[i];
        let achievements = [];
        try {
            achievements = parseAchievements(await generate(activity)).achievements;
        } catch { /* counted as malformed below */ }
        if (achievements.length !== 3) { malformed++; if (achievements.length === 0) continue; }
        sets.push({ activity, achievements });
    }
}));

const lengths = sets.flatMap(s => s.achievements.map(a => words(a.description))).sort((a, b) => a - b);
const at = p => lengths[Math.floor(lengths.length * p)];
const pithy = sets.filter(s => s.achievements.some(a => !a.description.includes(',') && words(a.description) <= 15));
const leaks = sets.flatMap(s => s.achievements).filter(a => /short card|set shape|comma-free/i.test(a.title));

for (const set of sets) {
    const counts = set.achievements.map(a => String(words(a.description)).padStart(3)).join(' ');
    const shortest = set.achievements.reduce((a, b) => (words(a.description) <= words(b.description) ? a : b));
    console.log(`${counts} | ${set.activity}\n      ↳ ${shortest.title} — ${shortest.description}`);
}

const results = [
    ['median description', at(0.5), `<= ${THRESHOLDS.medianWords} words`, at(0.5) <= THRESHOLDS.medianWords],
    ['longest description', lengths.at(-1), `<= ${THRESHOLDS.maxWords} words`, lengths.at(-1) <= THRESHOLDS.maxWords],
    ['sets with a pithy card', `${pithy.length}/${sets.length}`, `>= ${Math.round(THRESHOLDS.pithySetRatio * 100)}%`,
        pithy.length / sets.length >= THRESHOLDS.pithySetRatio],
    ['malformed responses', `${malformed}/${SAMPLES}`, `<= ${Math.round(THRESHOLDS.malformedRatio * 100)}%`,
        malformed / SAMPLES <= THRESHOLDS.malformedRatio],
    ['prompt-machinery titles', leaks.length, '0', leaks.length === 0],
];

console.log(`\nn=${lengths.length} descriptions  min ${lengths[0]}  p25 ${at(0.25)}  median ${at(0.5)}  p75 ${at(0.75)}  max ${lengths.at(-1)}\n`);
for (const [label, value, want, ok] of results) {
    console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(24)} ${String(value).padEnd(10)} want ${want}`);
}
for (const leak of leaks) console.log(`      leaked title: ${leak.title}`);

const failed = results.filter(r => !r[3]);
if (failed.length) {
    console.error(`\n✗ Style check failed on ${failed.length} measure(s). The model drifts — re-tune BASE_TEMPLATE.`);
    process.exit(1);
}
console.log('\n✓ Style check passed — length distribution and set shape are where the prompt claims.');
