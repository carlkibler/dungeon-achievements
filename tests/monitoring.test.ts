import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { alertKind, classifyHealth, isHealthy, STALE_MS, type Health } from '../monitoring/worker';

const now = 100_000_000;
const healthy: Health = { status: 'healthy', checkedAt: now, detail: 'ok' };
const metadata = { status: 'healthy', detail: 'Valid key', check: 'credentials-only' };
afterEach(() => vi.restoreAllMocks());

describe('credential-health monitor', () => {
    it('accepts only credential-health metadata', () => {
        expect(classifyHealth(metadata).status).toBe('healthy');
        expect(classifyHealth({ ...metadata, status: 'degraded' }).status).toBe('degraded');
        expect(classifyHealth({ achievements: [] }).status).toBe('down');
    });
    it('alerts on a failure, an escalation, and recovery', () => {
        const degraded: Health = { ...healthy, status: 'degraded', lastAlertAt: now };
        expect(alertKind(healthy, degraded, now)).toBe('degraded');
        expect(alertKind(degraded, { ...healthy, status: 'down' }, now)).toBe('down');
        expect(alertKind(degraded, healthy, now)).toBe('recovered');
        expect(alertKind(healthy, healthy, now)).toBeNull();
    });
    it('deduplicates until a reminder is due and retries failed delivery', () => {
        const down: Health = { ...healthy, status: 'down', lastAlertAt: now };
        expect(alertKind(down, down, now + 15 * 60_000)).toBeNull();
        expect(alertKind(down, down, now + 2 * 60 * 60_000)).toBe('down');
        expect(alertKind({ ...down, notificationError: true }, down, now)).toBe('down');
    });
    it('external monitoring fails closed for missing, stale, degraded, and undelivered state', () => {
        expect(isHealthy(healthy, now)).toBe(true);
        expect(isHealthy(null, now)).toBe(false);
        expect(isHealthy(healthy, now + STALE_MS + 1)).toBe(false);
        expect(isHealthy({ ...healthy, status: 'degraded' }, now)).toBe(false);
        expect(isHealthy({ ...healthy, notificationError: true }, now)).toBe(false);
    });
    it.each(['/run', '/test-alert'])('rejects unauthenticated control requests to %s before any side effects', async path => {
        const fetch = vi.spyOn(globalThis, 'fetch');
        const response = await worker.fetch(new Request(`https://example.com${path}`, { method: 'POST' }),
            { ADMIN_TOKEN: 'test-secret' } as Parameters<typeof worker.fetch>[1]);
        expect(response.status).toBe(404);
        expect(fetch).not.toHaveBeenCalled();
    });
    it('watchdog polling refreshes an overdue probe without Cron dispatch', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(metadata));
        let state = { ...healthy, checkedAt: Date.now() - 61 * 60_000 };
        const put = vi.fn(async (_key: string, value: string) => { state = JSON.parse(value); });
        const env = { HEALTH: { get: vi.fn(async () => state), put } } as unknown as Parameters<typeof worker.fetch>[1];
        const request = new Request('https://example.com/health');
        const first = await worker.fetch(request, env);
        expect(first.status).toBe(200);
        expect((await first.json() as { fresh: boolean }).fresh).toBe(true);
        expect(put).toHaveBeenCalledOnce();
        await worker.fetch(request, env);
        expect(fetch).toHaveBeenCalledOnce();
        expect(fetch.mock.calls[0][0]).toBe('https://achievements.carlkibler.com/health');
        expect(fetch.mock.calls[0][1]?.headers).toEqual({ 'X-DA-Request-Source': 'healthcheck' });
    });
    it.each([
        { status: 'degraded' as const },
        { status: 'down' as const },
        { status: 'healthy' as const, notificationError: true },
    ])('watchdog checks recovery after five minutes for %j without generation', async failure => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const fetch = vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(Response.json(metadata))
            .mockResolvedValueOnce(Response.json({ id: 'recovery-message' }));
        let state: Health = { ...healthy, ...failure, checkedAt: Date.now() - 6 * 60_000 };
        const put = vi.fn(async (_key: string, value: string) => { state = JSON.parse(value); });
        const env = { HEALTH: { get: vi.fn(async () => state), put }, ALERT_EMAIL_USER: 'test@example.com', ALERT_EMAIL_PASSWORD: 'test' } as unknown as Parameters<typeof worker.fetch>[1];
        const response = await worker.fetch(new Request('https://example.com/health'), env);
        expect(response.status).toBe(200);
        expect(state.status).toBe('healthy');
        expect(fetch.mock.calls[0][0]).toBe('https://achievements.carlkibler.com/health');
        expect(fetch.mock.calls[1][0]).toBe('https://api.forwardemail.net/v1/emails');
        await worker.fetch(new Request('https://example.com/health'), env);
        expect(fetch).toHaveBeenCalledTimes(2);
    });
    it('persists failed email delivery so the independent watchdog sees an unhealthy monitor', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const fetch = vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(Response.json({ status: 'down', check: 'invalid' }))
            .mockResolvedValueOnce(Response.json({ status: 'down', check: 'invalid' }))
            .mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
        const put = vi.fn();
        const env = { HEALTH: { get: vi.fn().mockResolvedValue(healthy), put }, ALERT_EMAIL_USER: 'test@example.com', ALERT_EMAIL_PASSWORD: 'test' } as unknown as Parameters<typeof worker.scheduled>[1];
        await worker.scheduled({} as ScheduledController, env);
        expect(fetch).toHaveBeenCalledTimes(3);
        const state = JSON.parse(put.mock.calls[0][1]);
        expect(state.notificationError).toBe(true);
        expect(state.status).toBe('down');
        expect(isHealthy(state, Date.now())).toBe(false);
    });
});
