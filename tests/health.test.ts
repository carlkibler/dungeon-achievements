import { afterEach, expect, it, vi } from 'vitest';
import { onRequestGet } from '../functions/health';
afterEach(() => vi.restoreAllMocks());
const check = (key?: string) => onRequestGet({ request: new Request('https://example.com/health', { headers: { 'X-DA-Request-Source': 'healthcheck' } }), env: { OPENROUTER_API_KEY: key } } as Parameters<typeof onRequestGet>[0]);
it('checks only metadata using the production key and never exposes it', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ data: { limit_remaining: 5 } }));
    const response = await check('secret');
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/key');
    expect(fetch.mock.calls[0][1]?.headers).toEqual({ Authorization: 'Bearer secret' });
    const body = await response.json() as { source: string };
    expect(body.source).toBe('healthcheck');
    expect(JSON.stringify(body)).not.toContain('secret');
});
it('fails missing credentials without making a request', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect((await check()).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
});
it.each([{ data: { limit_remaining: 0 } }, { data: { expires_at: '2020-01-01' } }, {}, { data: { is_management_key: true } }])('rejects unusable key metadata', async body => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(body));
    expect((await check('secret')).status).toBe(503);
});
it('fails expired/revoked authentication', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 401 }));
    expect((await check('secret')).status).toBe(503);
});
