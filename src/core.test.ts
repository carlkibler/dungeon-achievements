import { describe, it, expect } from 'vitest';
import {
    buildPrompt, FORM_PROFILES, MOODS, runWithFallback, SNARK_LEVELS, type Provider,
} from './core';

const ok = (name: string): Provider<string> => ({ name, run: async () => `from-${name}` });
const boom = (name: string, msg = 'exploded'): Provider<string> => ({
    name,
    run: async () => { throw new Error(msg); },
});

describe('runWithFallback', () => {
    it('uses the first provider and reports healthy when it succeeds', async () => {
        const out = await runWithFallback([ok('primary'), ok('secondary')]);
        expect(out.value).toBe('from-primary');
        expect(out.provider).toBe('primary');
        expect(out.degraded).toBe(false);
        expect(out.failures).toEqual([]);
    });

    it('falls through to the next provider and flags degraded', async () => {
        const out = await runWithFallback([boom('primary', '404 no endpoints'), ok('secondary')]);
        expect(out.value).toBe('from-secondary');
        expect(out.provider).toBe('secondary');
        expect(out.degraded).toBe(true);
        expect(out.failures).toEqual(['primary: 404 no endpoints']);
    });

    it('never calls a later provider once one succeeds', async () => {
        let called = false;
        const spy: Provider<string> = { name: 'spy', run: async () => { called = true; return 'x'; } };
        await runWithFallback([ok('primary'), spy]);
        expect(called).toBe(false);
    });

    it('throws with every failure listed when all providers fail', async () => {
        await expect(runWithFallback([boom('primary', 'a'), boom('secondary', 'b')]))
            .rejects.toThrow('all AI providers failed — primary: a; secondary: b');
    });

    it('throws a configuration error when no provider is configured', async () => {
        await expect(runWithFallback([])).rejects.toThrow('no AI provider configured');
    });

    it('reports non-Error throws rather than swallowing them', async () => {
        const weird: Provider<string> = { name: 'weird', run: async () => { throw 'plain string'; } };
        const out = await runWithFallback([weird, ok('secondary')]);
        expect(out.failures).toEqual(['weird: plain string']);
        expect(out.degraded).toBe(true);
    });
});

describe('achievement prompt', () => {
    it('encodes corpus-derived structure without reusable placeholder jokes', () => {
        const { prompt } = buildPrompt('washed the dishes', 'default', [], []);

        expect(prompt).toContain('149 CANON ACHIEVEMENTS');
        expect(prompt).toContain('Give one or two precisely named loot boxes');
        expect(prompt).toContain('A Q&A is optional and uncommon');
        expect(prompt).not.toContain('Lukewarm Participation Trophy');
        expect(prompt).not.toContain('Dignity -7');
        expect(prompt).not.toContain('{{');
    });

    it('keeps mood, snark, and form as independent variation axes', () => {
        expect(MOODS).toHaveLength(7);
        expect(SNARK_LEVELS).toHaveLength(5);
        expect(FORM_PROFILES).toHaveLength(7);
        expect(FORM_PROFILES.filter(profile => profile.startsWith('one Q&A'))).toHaveLength(1);
        expect(MOODS.some(mood => mood.includes('tender'))).toBe(false);
    });
});
