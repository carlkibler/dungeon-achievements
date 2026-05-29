#!/usr/bin/env node
// Creates (or rotates) the project-scoped CF API token for analytics queries.
// Requires $CLOUDFLARE_API_MGMT_TOKEN in env (source ~/.secrets first).
//
// Usage: source ~/.secrets && node scripts/provision-token.js
//
// What it does:
//   1. Deletes any existing dungeon-achievements:analytics-read tokens.
//   2. Creates a new token scoped to Account Analytics Read only.
//   3. Writes DA_CF_TOKEN=<value> to .env (gitignored).

'use strict';

const https = require('https');
const fs   = require('fs');
const path = require('path');

const ACCOUNT_ID   = 'c0dd6ffd2dd099b58b892c682e74ad28';
const TOKEN_NAME   = 'dungeon-achievements:analytics-read';
const ANALYTICS_RO = 'b89a480218d04ceb98b4fe57ca29dc1f'; // Account Analytics Read
const ENV_FILE     = path.join(__dirname, '..', '.env');

const MGMT = process.env.CLOUDFLARE_API_MGMT_TOKEN;
if (!MGMT) {
    console.error('CLOUDFLARE_API_MGMT_TOKEN not set — run: source ~/.secrets');
    process.exit(1);
}

function cfRequest(method, path, body) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : undefined;
        const req = https.request({
            hostname: 'api.cloudflare.com',
            path,
            method,
            headers: {
                'Authorization': `Bearer ${MGMT}`,
                'Content-Type': 'application/json',
                ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
            },
        }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch { reject(new Error(data.slice(0, 200))); }
            });
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

async function main() {
    // 1. List existing tokens and delete any matching TOKEN_NAME
    const list = await cfRequest('GET', '/client/v4/user/tokens');
    const existing = (list.result ?? []).filter(t => t.name === TOKEN_NAME);
    for (const t of existing) {
        await cfRequest('DELETE', `/client/v4/user/tokens/${t.id}`);
        console.log(`Deleted old token: ${t.id}`);
    }

    // 2. Create fresh scoped token
    const created = await cfRequest('POST', '/client/v4/user/tokens', {
        name: TOKEN_NAME,
        policies: [{
            effect: 'allow',
            resources: { [`com.cloudflare.api.account.${ACCOUNT_ID}`]: '*' },
            permission_groups: [{ id: ANALYTICS_RO, name: 'Account Analytics Read' }],
        }],
    });

    if (!created.success || !created.result?.value) {
        console.error('Token creation failed:', JSON.stringify(created.errors));
        process.exit(1);
    }

    const tokenValue = created.result.value;

    // 3. Write/update .env — preserve other keys if file exists
    let env = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
    if (/^DA_CF_TOKEN=/m.test(env)) {
        env = env.replace(/^DA_CF_TOKEN=.*$/m, `DA_CF_TOKEN=${tokenValue}`);
    } else {
        env = env.trimEnd() + (env ? '\n' : '') + `DA_CF_TOKEN=${tokenValue}\n`;
    }
    fs.writeFileSync(ENV_FILE, env);

    console.log(`✓ Token created (id: ${created.result.id})`);
    console.log(`✓ Written to .env as DA_CF_TOKEN`);
    console.log(`  Verify: node scripts/analytics-report.js`);
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
