#!/usr/bin/env node
'use strict';

// Usage:
//   node scripts/analytics-report.js          # last 30 days
//   node scripts/analytics-report.js --days=7
//   node scripts/analytics-report.js --raw    # dump raw JSON

const https = require('https');
const path = require('path');
const fs = require('fs');

const ACCOUNT_ID = 'c0dd6ffd2dd099b58b892c682e74ad28';
const DATASET = 'da_generate_events';

const args = process.argv.slice(2);
const DAYS = parseInt(args.find(a => a.startsWith('--days='))?.split('=')[1] ?? '30', 10);
const RAW = args.includes('--raw');

// Rough OpenRouter cost per generation: ~2200 input + ~350 output tokens
// Model costs in $/M tokens [input, output]
const MODEL_RATES = {
    'anthropic/claude-3-5-haiku':    [0.80,  4.00],
    'anthropic/claude-3-haiku':      [0.25,  1.25],
    'anthropic/claude-3-5-sonnet':   [3.00, 15.00],
    'anthropic/claude-sonnet-4-5':   [3.00, 15.00],
    'anthropic/claude-opus-4-5':     [15.0, 75.00],
};
const DEFAULT_RATES = [0.80, 4.00];
const EST_INPUT_TOKENS  = 2200;
const EST_OUTPUT_TOKENS = 350;

function costPerGen(model) {
    const [inRate, outRate] = MODEL_RATES[model] ?? DEFAULT_RATES;
    return (EST_INPUT_TOKENS * inRate + EST_OUTPUT_TOKENS * outRate) / 1_000_000;
}

function getToken() {
    // DA_CF_TOKEN is a scoped Analytics-Read-only CF token for this project.
    // Generate it once with: source ~/.secrets && node scripts/provision-token.js
    if (process.env.DA_CF_TOKEN) return process.env.DA_CF_TOKEN;
    const envFile = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envFile)) {
        const m = fs.readFileSync(envFile, 'utf8').match(/^DA_CF_TOKEN=(.+)$/m);
        if (m) return m[1].trim();
    }
    throw new Error(
        'DA_CF_TOKEN not found.\n' +
        'Run: source ~/.secrets && node scripts/provision-token.js'
    );
}

function query(token, sql) {
    return new Promise((resolve, reject) => {
        const body = sql.trim().replace(/\s+/g, ' ');
        const req = https.request({
            hostname: 'api.cloudflare.com',
            path: `/client/v4/accounts/${ACCOUNT_ID}/analytics_engine/sql`,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'text/plain',
                'Content-Length': Buffer.byteLength(body),
                'User-Agent': 'da-analytics/1.0',
            },
        }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.data === undefined) {
                        reject(new Error('API error: ' + JSON.stringify(parsed).slice(0, 300)));
                    } else {
                        resolve(parsed.data);
                    }
                } catch {
                    reject(new Error('Parse error: ' + data.slice(0, 200)));
                }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// ── Terminal styling ──────────────────────────────────────────────────────────

const C = {
    reset:  '\x1b[0m',
    bold:   '\x1b[1m',
    dim:    '\x1b[2m',
    amber:  '\x1b[33m',
    gold:   '\x1b[93m',
    green:  '\x1b[32m',
    red:    '\x1b[31m',
    cyan:   '\x1b[36m',
    gray:   '\x1b[90m',
};

const W = 62;

function section(title) {
    const line = '─'.repeat(W);
    process.stdout.write(`\n${C.amber}${C.bold}${line}\n  ${title}\n${line}${C.reset}\n`);
}

function kv(label, value, vc = C.reset) {
    process.stdout.write(`  ${C.dim}${label.padEnd(28)}${C.reset} ${vc}${value}${C.reset}\n`);
}

function bar(label, count, max, width = 28) {
    const pct = max > 0 ? count / max : 0;
    const filled = Math.round(pct * width);
    const b = C.amber + '█'.repeat(filled) + C.gray + '░'.repeat(width - filled) + C.reset;
    process.stdout.write(`  ${label.padEnd(18)} ${b} ${C.bold}${count}${C.reset}\n`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const token = getToken();

    process.stdout.write(`\n${C.amber}${C.bold}⚔  DUNGEON ACHIEVEMENTS — Analytics Dashboard${C.reset}\n`);
    process.stdout.write(`${C.gray}   Last ${DAYS} days  ·  ${new Date().toLocaleString()}${C.reset}\n`);

    // ── 1. Overview ───────────────────────────────────────────────────────────
    const [ov] = await query(token, `
        SELECT
            count()                              AS total,
            countIf(blob4 = 'success')           AS successes,
            countIf(blob4 = 'fallback')          AS fallbacks,
            round(avg(double1))                  AS avg_ms,
            round(avg(double2))                  AS avg_activity_chars,
            count(DISTINCT blob2)                AS uniq_countries
        FROM ${DATASET}
        WHERE timestamp > NOW() - INTERVAL '${DAYS}' DAY
    `);

    if (RAW) { console.log(JSON.stringify({ overview: ov }, null, 2)); }

    section(`OVERVIEW  (last ${DAYS} days)`);
    kv('Total generations',       String(ov.total),           C.gold + C.bold);
    kv('Successful',              String(ov.successes),        C.green);
    kv('Fallbacks (AI errors)',   String(ov.fallbacks),        +ov.fallbacks > 0 ? C.red : C.dim);
    kv('Avg response time',       ov.avg_ms != null ? `${ov.avg_ms} ms` : '—');
    kv('Avg activity length',     ov.avg_activity_chars != null ? `${ov.avg_activity_chars} chars` : '—');
    kv('Unique countries',        String(ov.uniq_countries));
    kv('Unique users',            'not tracked — by design',   C.dim);

    // ── 2. Estimated cost ─────────────────────────────────────────────────────
    const modelRows = await query(token, `
        SELECT blob3 AS model, countIf(blob4 = 'success') AS gens
        FROM ${DATASET}
        WHERE timestamp > NOW() - INTERVAL '${DAYS}' DAY
        GROUP BY model ORDER BY gens DESC
    `);

    const totalCost = modelRows.reduce((s, r) => s + r.gens * costPerGen(r.model), 0);

    section('ESTIMATED LLM COST');
    kv('Total (approx)',          `$${totalCost.toFixed(3)}`,  C.cyan + C.bold);
    for (const r of modelRows) {
        const cpg = costPerGen(r.model);
        const cost = (r.gens * cpg).toFixed(3);
        const model = r.model?.split('/').pop() ?? r.model ?? 'unknown';
        kv(`  ${model}`, `${r.gens} × $${cpg.toFixed(4)} = $${cost}`, C.dim);
    }
    kv('Basis', `~${EST_INPUT_TOKENS} input + ~${EST_OUTPUT_TOKENS} output tokens/gen`, C.gray);

    // ── 3. Weekly breakdown ───────────────────────────────────────────────────
    const weekRows = await query(token, `
        SELECT toStartOfWeek(timestamp) AS week, count() AS n
        FROM ${DATASET}
        WHERE timestamp > NOW() - INTERVAL '28' DAY
        GROUP BY week ORDER BY week ASC
    `);

    if (RAW) { console.log(JSON.stringify({ weeks: weekRows }, null, 2)); }

    section('WEEKLY USAGE (last 4 weeks)');
    if (weekRows.length === 0) {
        process.stdout.write(`  ${C.dim}no data yet${C.reset}\n`);
    } else {
        const maxW = Math.max(...weekRows.map(r => +r.n), 1);
        for (const r of weekRows) {
            const label = new Date(r.week).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            bar(`w/o ${label}`, r.n, maxW);
        }
    }

    // ── 4. Style breakdown ────────────────────────────────────────────────────
    const styleRows = await query(token, `
        SELECT blob1 AS style, count() AS n
        FROM ${DATASET}
        WHERE timestamp > NOW() - INTERVAL '${DAYS}' DAY
        GROUP BY style ORDER BY n DESC
    `);

    section('BY STYLE');
    if (styleRows.length === 0) {
        process.stdout.write(`  ${C.dim}no data yet${C.reset}\n`);
    } else {
        const maxS = Math.max(...styleRows.map(r => +r.n), 1);
        for (const r of styleRows) {
            bar(r.style || 'default', r.n, maxS);
        }
    }

    // ── 5. Top countries ──────────────────────────────────────────────────────
    const countryRows = await query(token, `
        SELECT blob2 AS country, count() AS n
        FROM ${DATASET}
        WHERE timestamp > NOW() - INTERVAL '${DAYS}' DAY
        GROUP BY country ORDER BY n DESC LIMIT 12
    `);

    section('TOP COUNTRIES');
    if (countryRows.length === 0) {
        process.stdout.write(`  ${C.dim}no data yet${C.reset}\n`);
    } else {
        const maxC = Math.max(...countryRows.map(r => +r.n), 1);
        for (const r of countryRows) {
            bar(r.country || 'unknown', r.n, maxC);
        }
    }

    // ── 6. Recent 15 ─────────────────────────────────────────────────────────
    const recentRows = await query(token, `
        SELECT timestamp, blob1 AS style, blob2 AS country,
               blob4 AS outcome, round(double1) AS ms, double2 AS chars
        FROM ${DATASET}
        ORDER BY timestamp DESC LIMIT 15
    `);

    if (RAW) { console.log(JSON.stringify({ recent: recentRows }, null, 2)); }

    section('RECENT 15 GENERATIONS');
    if (recentRows.length === 0) {
        process.stdout.write(`  ${C.dim}no data yet — generate some achievements first${C.reset}\n`);
    } else {
        process.stdout.write(
            `  ${C.dim}${'Time'.padEnd(18)} ${'Style'.padEnd(12)} ${'Ctry'.padEnd(5)} ` +
            `${'Result'.padEnd(9)} ${'ms'.padEnd(7)} chars${C.reset}\n`
        );
        process.stdout.write(`  ${'─'.repeat(W - 2)}\n`);
        for (const r of recentRows) {
            const ts = new Date(r.timestamp).toLocaleString('en-US', {
                month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
            });
            const oc = r.outcome === 'success' ? C.green : C.red;
            const mc = +r.ms > 8000 ? C.red : +r.ms > 4000 ? C.amber : C.green;
            process.stdout.write(
                `  ${C.dim}${ts.padEnd(18)}${C.reset}` +
                `${(r.style || 'default').padEnd(12)} ` +
                `${(r.country || '??').padEnd(5)} ` +
                `${oc}${(r.outcome || '?').padEnd(9)}${C.reset}` +
                `${mc}${String(r.ms).padEnd(7)}${C.reset}` +
                `${r.chars || '?'}\n`
            );
        }
    }

    process.stdout.write(`\n${C.gray}  ─────────────────────────────────────────${C.reset}\n`);
    process.stdout.write(`${C.gray}  Run with --days=7 for a tighter window.${C.reset}\n`);
    process.stdout.write(`${C.gray}  Run with --raw to dump JSON alongside.${C.reset}\n\n`);
}

main().catch(err => {
    process.stderr.write(`\x1b[31mError: ${err.message}\x1b[0m\n`);
    process.exit(1);
});
