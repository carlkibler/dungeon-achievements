#!/usr/bin/env node
// The site loads public/vendor/justif/auto.js, not node_modules. Bumping the pinned
// version without re-copying would leave the old file serving forever, silently.
// This fails the build instead. Fix with `npm run vendor:justif`.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const CHECKS = [
    {
        name: 'justif',
        source: 'node_modules/justif/dist/auto.js',
        vendored: 'public/vendor/justif/auto.js',
        version: 'public/vendor/justif/VERSION',
        packageJson: 'node_modules/justif/package.json',
    },
];

const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

let failed = false;

const fail = (message) => {
    console.error(`✗ ${message}`);
    failed = true;
};

for (const check of CHECKS) {
    let installed;
    try {
        installed = JSON.parse(readFileSync(check.packageJson, 'utf8')).version;
    } catch {
        fail(`${check.name}: not installed. Run \`npm install\`.`);
        continue;
    }

    let vendoredVersion;
    try {
        vendoredVersion = readFileSync(check.version, 'utf8').trim();
    } catch {
        fail(`${check.name}: ${check.version} is missing. Run \`npm run vendor:${check.name}\`.`);
        continue;
    }

    if (vendoredVersion !== installed) {
        fail(`${check.name}: vendored ${vendoredVersion}, installed ${installed}. Run \`npm run vendor:${check.name}\`.`);
        continue;
    }

    try {
        if (sha(check.source) !== sha(check.vendored)) {
            fail(`${check.name}: ${check.vendored} differs from ${check.source}. Run \`npm run vendor:${check.name}\`.`);
            continue;
        }
    } catch (error) {
        fail(`${check.name}: could not compare files — ${error.message}`);
        continue;
    }

    console.log(`✓ ${check.name}@${installed} vendored and in sync`);
}

process.exit(failed ? 1 : 0);
