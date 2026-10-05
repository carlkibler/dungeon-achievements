import { afterEach, describe, expect, it, vi } from 'vitest';
import { DECLINED_FRAMING, FALLBACK_ACHIEVEMENTS } from '../src/core';
import { onRequestPost } from '../functions/generate';

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('openai', () => ({
    default: class { chat = { completions: { create } }; },
}));

const payload = {
    framing: 'folding laundry',
    achievements: [1, 2, 3].map(n => ({ title: `Card ${n}`, description: `Fresh joke ${n}`, reward: 'Clean socks' })),
};

async function generate(result: unknown, key?: string) {
    const run = vi.fn().mockResolvedValue(result);
    const writeDataPoint = vi.fn();
    const response = await onRequestPost({
        request: new Request('https://example.com/generate', {
            method: 'POST',
            body: JSON.stringify({ activity: 'folding laundry' }),
        }),
        env: { AI: { run }, ANALYTICS: { writeDataPoint }, OPENROUTER_API_KEY: key },
    } as unknown as Parameters<typeof onRequestPost>[0]);
    return { body: await response.json() as Record<string, unknown>, response, run, writeDataPoint };
}

afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('Pages Workers AI fallback', () => {
    it.each([
        ['text', { response: JSON.stringify(payload) }],
        ['decoded JSON', { response: payload }],
        ['decoded array', { response: payload.achievements }],
        ['OpenAI-compatible text', { choices: [{ message: { content: JSON.stringify(payload) } }] }],
        ['empty response with compatible text', { response: '', choices: [{ message: { content: JSON.stringify(payload) } }] }],
    ])('serves real achievements from %s without OpenRouter', async (_name, result) => {
        const { body, response, run, writeDataPoint } = await generate(result);
        expect(response.status).toBe(200);
        expect(body.achievements).toEqual(payload.achievements);
        expect(body.degraded).toBe(false);
        expect(body.refused).toBe(false);
        expect(run).toHaveBeenCalledOnce();
        expect(writeDataPoint.mock.calls[0][0].blobs[3]).toBe('success');
    });

    it('serves decoded JSON when an expired OpenRouter key fails both calls', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        create.mockRejectedValue(new Error('401 API key expired.'));
        const { body, run } = await generate({ response: payload }, 'expired-test-key');
        expect(create).toHaveBeenCalledTimes(2);
        expect(run).toHaveBeenCalledOnce();
        expect(body.achievements).toEqual(payload.achievements);
        expect(body.degraded).toBe(true);
    });

    it('preserves a decoded refusal even when the model omitted the cards', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { body } = await generate({ response: { framing: DECLINED_FRAMING } });
        expect(body.refused).toBe(true);
        expect(body.degraded).toBe(false);
        expect(body.achievements).not.toEqual(FALLBACK_ACHIEVEMENTS);
    });

    it.each([null, {}, { response: null }, { response: 42 }, { response: { error: 'unavailable' } },
        { choices: [{ message: { content: null } }] }, { response: 'not JSON' }])(
        'keeps unusable output degraded: %j', async result => {
            vi.spyOn(console, 'error').mockImplementation(() => {});
            const { body } = await generate(result);
            expect(body.achievements).toEqual(FALLBACK_ACHIEVEMENTS);
            expect(body.degraded).toBe(true);
        },
    );
});
