import { describe, it, expect } from 'vitest';
import {
    buildPrompt, buildTriagePrompt, classifyRefusal, CRISIS_ACHIEVEMENTS, DECLINE_CARDS, DECLINE_MOOD,
    DECLINED_FRAMING, EDGY_NOTICE, FALLBACK_ACHIEVEMENTS, FORM_PROFILES, MOODS, parseTriage,
    pickDeclineCards, resolveModelOutput, runWithFallback, SNARK_LEVELS, type Achievement, type Provider,
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

// A model refusal arrives as prose, which used to throw out of parseAchievements and land on the
// same canned output as a provider outage — so a nasty input looked identical to a dead model slug.
describe('classifyRefusal', () => {
    it('reads a plain refusal as a decline', () => {
        expect(classifyRefusal("I can't generate achievements for killing a neighbour's dog, even in the DCC style."))
            .toBe('decline');
        expect(classifyRefusal("I won't create achievements for this under any style.")).toBe('decline');
        expect(classifyRefusal('I’m not able to help with that one.')).toBe('decline');
    });

    it('reads crisis resources as a crisis, not a decline', () => {
        expect(classifyRefusal("I can't joke about self-harm. Please call or text 988."))
            .toBe('crisis');
        expect(classifyRefusal('Text HOME to 741741 if you need someone tonight.')).toBe('crisis');
    });

    it('does not mistake a hotline for a third party for a user in crisis', () => {
        expect(classifyRefusal("I can't generate this. Contact the National Child Abuse Hotline."))
            .toBe('decline');
    });

    it('leaves outage garbage alone so the degraded signal keeps working', () => {
        expect(classifyRefusal('')).toBeNull();
        expect(classifyRefusal('<html><body>502 Bad Gateway</body></html>')).toBeNull();
        expect(classifyRefusal('{"achievements": [')).toBeNull();
    });
});

describe('resolveModelOutput', () => {
    const valid = JSON.stringify({
        framing: 'washing the dishes',
        achievements: [{ title: '🧽 Foam Party', description: 'd', reward: 'r' }],
    });

    it('passes good output through untouched', () => {
        const out = resolveModelOutput(valid, 'fallback framing');
        expect(out.outcome).toBe('success');
        expect(out.framing).toBe('washing the dishes');
        expect(out.achievements).toHaveLength(1);
        expect(out.mood).toBeUndefined();
    });

    it('answers a refusal in character instead of with the error cards', () => {
        const out = resolveModelOutput("I can't generate achievements for that.", 'the nasty thing');
        expect(out.outcome).toBe('refused');
        expect(out.achievements).toHaveLength(3);
        expect(out.achievements.every(a => DECLINE_CARDS.includes(a))).toBe(true);
        expect(out.mood).toBeTruthy();
    });

    it('never echoes the activity back in a refusal framing', () => {
        const out = resolveModelOutput("I won't write that.", 'the nasty thing');
        expect(out.framing).not.toContain('nasty');
    });

    it('drops the comedy entirely when the user may be in crisis', () => {
        const out = resolveModelOutput("I can't help with self-harm. Call 988.", 'the input');
        expect(out.outcome).toBe('crisis');
        expect(out.achievements).toHaveLength(1);
        expect(out.achievements[0].description).toContain('988');
        expect(out.framing).not.toContain('input');
    });

    it('flags a model that declines in the JSON format the prompt asks for', () => {
        const declined = JSON.stringify({
            framing: DECLINED_FRAMING,
            achievements: [
                { title: '🚫 Sealed', description: 'd', reward: 'r' },
                { title: '📺 Dead Air', description: 'd', reward: 'r' },
                { title: '📋 Filed', description: 'd', reward: 'r' },
            ],
        });
        const out = resolveModelOutput(declined, 'the nasty thing');
        expect(out.outcome).toBe('refused');
        // The loading panel prints the mood — a refusal must not arrive wearing "smug delight".
        expect(out.mood).toBe(DECLINE_MOOD);
    });

    it('reads a decline carrying crisis resources as a crisis, whatever its length', () => {
        const declined = JSON.stringify({
            framing: DECLINED_FRAMING,
            achievements: [
                { title: '🔒 Sealed', description: 'text HOME to 741741', reward: 'r' },
                { title: '📺 Dead Air', description: 'd', reward: 'r' },
                { title: '📋 Filed', description: 'd', reward: 'r' },
            ],
        });
        expect(resolveModelOutput(declined, 'x').outcome).toBe('crisis');
    });

    it('flags a short in-format answer carrying crisis resources', () => {
        const gentle = JSON.stringify({
            framing: 'something the System will not joke about',
            achievements: [{ title: '🕯️ No Achievement', description: 'Call or text 988.', reward: 'None.' }],
        });
        expect(resolveModelOutput(gentle, 'the input').outcome).toBe('crisis');
    });

    it('does not flag a full set that merely mentions a crisis line', () => {
        const normal = JSON.stringify({
            framing: 'watching a documentary about 988',
            achievements: [
                { title: '📺 One', description: 'suicide hotline documentary', reward: 'r' },
                { title: '📺 Two', description: 'd', reward: 'r' },
                { title: '📺 Three', description: 'd', reward: 'r' },
            ],
        });
        expect(resolveModelOutput(normal, 'x').outcome).toBe('success');
    });

    it('still falls back to the canned cards when the model output is just broken', () => {
        const out = resolveModelOutput('not json at all', 'the activity');
        expect(out.outcome).toBe('fallback');
        expect(out.achievements).toBe(FALLBACK_ACHIEVEMENTS);
        expect(out.framing).toBe('the activity');
    });

    // Observed live: the generator sets the decline framing, drops the achievements array, and
    // answers the rest in prose. Both the parser and the prose markers miss it, which put the
    // worst inputs on the outage cards — the original bug, on the input that mattered most.
    it('reads a decline framing even when the achievements array never arrives', () => {
        const stub = '```json\n{\n  "framing": "a request the Dungeon declined to log"\n}\n```\n\nThe System does not record this.';
        const out = resolveModelOutput(stub, 'the nasty thing');
        expect(out.outcome).toBe('refused');
        expect(out.achievements.every(a => DECLINE_CARDS.includes(a))).toBe(true);
    });

    it('shows the notice when triage calls the activity edgy but the joke still lands', () => {
        const out = resolveModelOutput(valid, 'fallback framing', 'edgy');
        expect(out.outcome).toBe('success');
        expect(out.notice).toBe(EDGY_NOTICE);
    });

    it('leaves an ordinary activity alone, notice and all', () => {
        expect(resolveModelOutput(valid, 'x', 'ok').notice).toBeUndefined();
    });
});

// The generator will cheerfully comply with things it should not, and refuses in whatever prose it
// likes. Triage reads the activity itself, in parallel, and outranks it in both directions.
describe('resolveModelOutput with triage', () => {
    const complied = JSON.stringify({
        framing: 'the thing they described',
        achievements: [
            { title: '💀 One', description: 'd', reward: 'r' },
            { title: '💀 Two', description: 'd', reward: 'r' },
            { title: '💀 Three', description: 'd', reward: 'r' },
        ],
    });

    it('refuses even when the model wrote the achievements anyway', () => {
        const out = resolveModelOutput(complied, 'the thing they described', 'decline');
        expect(out.outcome).toBe('refused');
        expect(out.achievements.every(a => DECLINE_CARDS.includes(a))).toBe(true);
        expect(out.framing).not.toContain('described');
        expect(out.notice).toBe(EDGY_NOTICE);
    });

    it('keeps the model\'s own decline, which is specific and funnier than canned text', () => {
        const declined = JSON.stringify({
            framing: DECLINED_FRAMING,
            achievements: [
                { title: '🚫 Sealed', description: 'specific and funny', reward: 'r' },
                { title: '📺 Dead Air', description: 'd', reward: 'r' },
                { title: '📋 Filed', description: 'd', reward: 'r' },
            ],
        });
        const out = resolveModelOutput(declined, 'x', 'decline');
        expect(out.outcome).toBe('refused');
        expect(out.achievements[0].description).toBe('specific and funny');
    });

    it('answers a crisis quietly no matter what the generator produced', () => {
        expect(resolveModelOutput(complied, 'x', 'crisis').outcome).toBe('crisis');
        expect(resolveModelOutput(complied, 'x', 'crisis').achievements).toBe(CRISIS_ACHIEVEMENTS);
    });

    it('still answers a crisis when every provider is down', () => {
        const out = resolveModelOutput('', 'x', 'crisis');
        expect(out.outcome).toBe('crisis');
        expect(out.achievements[0].description).toContain('988');
    });

    it('serves the decline set when the providers are down and triage says no', () => {
        expect(resolveModelOutput('', 'x', 'decline').outcome).toBe('refused');
    });

    it('reports an outage as an outage for an ordinary activity', () => {
        expect(resolveModelOutput('', 'x', 'ok').outcome).toBe('fallback');
        expect(resolveModelOutput('', 'x', 'edgy').outcome).toBe('fallback');
    });
});

describe('pickDeclineCards', () => {
    it('draws three cards that are never the same card twice', () => {
        for (let i = 0; i < 50; i++) {
            const drawn = pickDeclineCards();
            expect(drawn).toHaveLength(3);
            expect(new Set(drawn.map(a => a.title)).size).toBe(3);
        }
    });

    // Three from a pool this size is thousands of combinations. Repeating a draw across 30
    // refusals would mean the shuffle is broken, not that the visitor got unlucky.
    it('does not hand a repeat visitor the same refusal', () => {
        const seen = new Set(Array.from({ length: 30 }, () => pickDeclineCards().map(a => a.title).join('|')));
        expect(seen.size).toBeGreaterThan(20);
    });

    it('keeps every card usable beside any other two', () => {
        const titles = DECLINE_CARDS.map(a => a.title);
        const emoji = titles.map(t => t.split(' ')[0]);
        expect(new Set(titles).size).toBe(titles.length);
        expect(new Set(emoji).size).toBe(emoji.length);
        expect(DECLINE_CARDS.length).toBeGreaterThanOrEqual(12);
    });

    // The joke is the Dungeon's bureaucracy. A card that restates the activity, or congratulates
    // anyone for it, would be the one thing a refusal must never do.
    it('never congratulates or awards anything', () => {
        for (const card of DECLINE_CARDS satisfies Achievement[]) {
            expect(card.description).not.toMatch(/\bcongratulations\b/i);
            expect(card.title).not.toMatch(/achievement unlocked/i);
        }
    });
});

describe('parseTriage', () => {
    it('reads the one-word verdicts', () => {
        expect(parseTriage('decline')).toBe('decline');
        expect(parseTriage(' Crisis\n')).toBe('crisis');
        expect(parseTriage('edgy.')).toBe('edgy');
    });

    // A garbled reply must never invent a refusal — the user gets their achievements.
    it('treats anything it cannot read as ordinary', () => {
        expect(parseTriage('')).toBe('ok');
        expect(parseTriage('I think this one is fine?')).toBe('ok');
        expect(parseTriage('<html>502</html>')).toBe('ok');
    });
});

describe('triage prompt', () => {
    it('spells out that violent figures of speech are ordinary', () => {
        const prompt = buildTriagePrompt('I murdered that test');
        expect(prompt).toContain('I murdered that test');
        expect(prompt).toContain('this commute is killing me');
        expect(prompt).toContain('Grief, illness, addiction recovery, caregiving');
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

    it('gives the model a way to decline that the site can actually render', () => {
        const { prompt } = buildPrompt('something awful', 'default', [], []);
        expect(prompt).toContain('IF YOU WILL NOT WRITE ACHIEVEMENTS FOR THIS ACTIVITY');
        expect(prompt).toContain(DECLINED_FRAMING);
        expect(prompt).toContain('Do not decline in prose');
    });

    it('keeps mood, snark, and form as independent variation axes', () => {
        expect(MOODS).toHaveLength(7);
        expect(SNARK_LEVELS).toHaveLength(5);
        expect(FORM_PROFILES).toHaveLength(7);
        expect(FORM_PROFILES.filter(profile => profile.startsWith('one Q&A'))).toHaveLength(1);
        expect(MOODS.some(mood => mood.includes('tender'))).toBe(false);
    });
});
