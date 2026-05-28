#!/usr/bin/env node
// Refuse packages published less than COOLDOWN_DAYS ago.
// Runs as postinstall hook. Caches publish dates so repeat runs are instant.

'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');

const COOLDOWN_DAYS = 14;
const COOLDOWN_MS = COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
const ROOT = path.resolve(__dirname, '..');
const LOCK_FILE = path.join(ROOT, 'package-lock.json');
const CACHE_FILE = path.join(ROOT, '.deps-age-cache.json');
const BATCH_SIZE = 20;

function loadCache() {
    try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { return {}; }
}

function saveCache(cache) {
    try { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2)); } catch {}
}

function get(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'User-Agent': 'deps-age-check/1.0' } }, res => {
            if (res.statusCode === 404) { resolve(null); return; }
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
        });
        req.setTimeout(10000, () => { req.destroy(new Error('timeout')); });
        req.on('error', reject);
    });
}

async function fetchPublishTime(name, version) {
    // Encode scoped package names: @scope/pkg → @scope%2Fpkg
    const encoded = name.startsWith('@')
        ? name.replace('/', '%2F')
        : name;
    const data = await get(`https://registry.npmjs.org/${encoded}`);
    return data?.time?.[version] ?? null;
}

async function checkBatch(batch, cache) {
    return Promise.allSettled(
        batch.map(async ({ name, version }) => {
            const key = `${name}@${version}`;
            if (cache[key]) return { name, version, time: cache[key] };
            const time = await fetchPublishTime(name, version);
            if (time) cache[key] = time;
            return { name, version, time };
        })
    );
}

async function main() {
    if (!fs.existsSync(LOCK_FILE)) {
        console.log('deps-age: no package-lock.json, skipping.');
        return;
    }

    const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
    const packages = lock.packages ?? {};

    const toCheck = [];
    for (const [pkgPath, info] of Object.entries(packages)) {
        if (!pkgPath || !info.version || info.link) continue;
        const name = pkgPath.replace(/^node_modules\//, '');
        toCheck.push({ name, version: info.version });
    }

    if (toCheck.length === 0) {
        console.log('deps-age: no packages to check.');
        return;
    }

    const cache = loadCache();
    const now = Date.now();
    const cutoff = now - COOLDOWN_MS;
    const violations = [];
    let networkErrors = 0;

    for (let i = 0; i < toCheck.length; i += BATCH_SIZE) {
        const results = await checkBatch(toCheck.slice(i, i + BATCH_SIZE), cache);
        for (const result of results) {
            if (result.status === 'rejected') { networkErrors++; continue; }
            const { name, version, time } = result.value;
            if (!time) continue;
            const publishedMs = new Date(time).getTime();
            if (publishedMs > cutoff) {
                const daysOld = Math.floor((now - publishedMs) / 86400000);
                const safeOn = new Date(publishedMs + COOLDOWN_MS).toISOString().slice(0, 10);
                violations.push({ name, version, daysOld, safeOn });
            }
        }
    }

    saveCache(cache);

    if (networkErrors > 0) {
        console.warn(`deps-age: ${networkErrors} package(s) could not be checked (network). Proceeding.`);
    }

    if (violations.length === 0) {
        console.log(`deps-age: all ${toCheck.length} packages pass the ${COOLDOWN_DAYS}-day cooldown. ✓`);
        return;
    }

    console.error(`\n🚫  Dependency cooldown violation — ${COOLDOWN_DAYS}-day rule\n`);
    for (const { name, version, daysOld, safeOn } of violations) {
        console.error(`  ✗  ${name}@${version}  —  ${daysOld}d old (safe after ${safeOn})`);
    }
    console.error('\nPin to an older version or wait for the cooldown to expire.\n');
    process.exit(1);
}

main().catch(err => {
    // Network down or script error: warn but don't block the install.
    console.warn('deps-age: check failed unexpectedly:', err.message, '— skipping.');
});
