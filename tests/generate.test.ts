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

async function generate(result: unknown, key?: string, source?: string, activity = 'folding laundry') {
    const run = vi.fn().mockResolvedValue(result);
    const writeDataPoint = vi.fn();
    const response = await onRequestPost({
        request: new Request('https://example.com/generate', {
            method: 'POST',
            headers: source ? { 'X-DA-Request-Source': source } : {},
            body: JSON.stringify({ activity }),
        }),
        env: { AI: { run }, ANALYTICS: { writeDataPoint }, OPENROUTER_API_KEY: key },
    } as unknown as Parameters<typeof onRequestPost>[0]);
    return { body: await response.json() as Record<string, unknown>, response, run, writeDataPoint };
}

afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

it('rejects activities over 500 characters before calling a provider', async () => {
    const { body, response, run, writeDataPoint } = await generate({}, undefined, undefined, 'x'.repeat(501));
    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Activity too long (max 500 characters)' });
    expect(create).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(writeDataPoint).not.toHaveBeenCalled();
});

it('uses Haiku 5.5 without thinking for both generation and triage', async () => {
    create.mockImplementation(async (options: { max_tokens: number }) => ({
        choices: [{ message: { content: options.max_tokens === 5 ? 'ok' : JSON.stringify(payload) } }],
    }));
    const { body, run, writeDataPoint } = await generate({}, 'test-key');
    expect(create).toHaveBeenCalledTimes(2);
    for (const [options] of create.mock.calls) {
        expect(options.model).toBe('anthropic/claude-haiku-5.5');
        expect(options.reasoning).toEqual({ enabled: false });
    }
    expect(run).not.toHaveBeenCalled();
    expect(body.degraded).toBe(false);
    expect(body.achievements).toEqual(payload.achievements);
    expect(writeDataPoint.mock.calls[0][0].blobs[2]).toBe('anthropic/claude-haiku-5.5');
});

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

it.each([[undefined, 'user'], ['healthcheck', 'healthcheck'], ['manual', 'manual'], ['nonsense', 'user']])('labels analytics source %s as %s', async (marker, expected) => {
    const { writeDataPoint } = await generate({ response: payload }, undefined, marker);
    expect(writeDataPoint.mock.calls[0][0].blobs[7]).toBe(expected);
});
