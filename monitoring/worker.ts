const SITE = 'https://achievements.carlkibler.com';
const STATE_KEY = 'health';
export const STALE_MS = 3 * 60 * 60_000;
const PROBE_INTERVAL_MS = 60 * 60_000;
const RECOVERY_PROBE_INTERVAL_MS = 5 * 60_000;
const REMINDER_MS = 2 * 60 * 60_000;

type Status = 'healthy' | 'degraded' | 'down';
export interface Health {
    status: Status;
    checkedAt: number;
    detail: string;
    lastAlertAt?: number;
    notificationError?: boolean;
}
interface Env {
    HEALTH: KVNamespace;
    ALERT_EMAIL_USER: string;
    ALERT_EMAIL_PASSWORD: string;
    ADMIN_TOKEN: string;
}

export function classifyHealth(data: unknown): { status: Status; detail: string } {
    const body = data as { status?: string; detail?: string; check?: string } | null;
    if (body?.check !== 'credentials-only' || !['healthy', 'degraded'].includes(body.status ?? '') || typeof body.detail !== 'string') {
        return { status: 'down', detail: 'Site returned invalid credential-health metadata.' };
    }
    return { status: body.status as Status, detail: body.detail };
}

export function alertKind(previous: Health | null, current: Health, now: number): 'down' | 'degraded' | 'recovered' | null {
    if (current.status === 'healthy') {
        return previous && (previous.status !== 'healthy' || previous.notificationError) ? 'recovered' : null;
    }
    if (!previous || previous.status !== current.status || previous.notificationError ||
        !previous.lastAlertAt || now - previous.lastAlertAt >= REMINDER_MS) return current.status;
    return null;
}

export function isHealthy(state: Health | null, now: number): boolean {
    return !!state && state.status === 'healthy' && !state.notificationError && now - state.checkedAt <= STALE_MS;
}

async function probe(): Promise<{ status: Status; detail: string }> {
    try {
        const response = await fetch(`${SITE}/health`, { headers: { 'X-DA-Request-Source': 'healthcheck' }, signal: AbortSignal.timeout(25_000) });
        if (response.status !== 200 && response.status !== 503) return { status: 'down', detail: `/health returned HTTP ${response.status}.` };
        const result = classifyHealth(await response.json());
        if (!response.ok && result.status === 'healthy') return { status: 'down', detail: 'Site health returned an inconsistent HTTP status.' };
        return result;
    } catch {
        return { status: 'down', detail: 'Site credential-health request failed, timed out, or returned invalid JSON.' };
    }
}

async function sendAlert(env: Env, kind: 'down' | 'degraded' | 'recovered', detail: string, test = false): Promise<string> {
    const subject = kind === 'recovered' ? 'RECOVERED: Dungeon Achievements is working again'
        : kind === 'down' ? 'ACTION REQUIRED: Dungeon Achievements is DOWN'
        : 'ACTION REQUIRED: Dungeon Achievements AI provider is FAILING';
    const text = `${test ? 'THIS IS AN ALERT DELIVERY TEST. Production has not been taken down.\n\n' : ''}${subject}\n\n${detail}\n\nSite: ${SITE}\nChecked: ${new Date().toISOString()}\n\nA Cloudflare Worker checks site availability and OpenRouter credentials hourly without model inference. Unresolved failures repeat every two hours. A recovery email follows when the primary provider is healthy again.`;
    const response = await fetch('https://api.forwardemail.net/v1/emails', {
        method: 'POST',
        headers: {
            Authorization: `Basic ${btoa(`${env.ALERT_EMAIL_USER}:${env.ALERT_EMAIL_PASSWORD}`)}`,
            'Content-Type': 'application/json',
            'User-Agent': 'DA-Monitor/1.0',
        },
        body: JSON.stringify({
            from: `DA Alerts <${env.ALERT_EMAIL_USER}>`,
            to: 'carl@carlkibler.com',
            subject: `${test ? '[TEST] ' : ''}${subject}`,
            text,
            headers: { 'X-Priority': '1', Importance: 'high' },
        }),
        signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Email service returned HTTP ${response.status}`);
    const result = await response.json() as { id?: string };
    if (!result.id) throw new Error('Email service returned no message ID');
    return result.id;
}

async function check(env: Env): Promise<Health> {
    const previous = await env.HEALTH.get<Health>(STATE_KEY, 'json');
    let result = await probe();
    // One fresh retry filters out transient inference failures without trusting HTTP 200 alone.
    if (result.status !== 'healthy') result = await probe();
    const now = Date.now();
    const state: Health = { ...result, checkedAt: now, lastAlertAt: previous?.lastAlertAt };
    const kind = alertKind(previous, state, now);
    if (kind) {
        try {
            const id = await sendAlert(env, kind, state.detail);
            state.lastAlertAt = now;
            console.log('DA alert queued', { kind, id });
        } catch (error) {
            state.notificationError = true;
            console.error('DA email notification failed', { error: String(error) });
        }
    }
    await env.HEALTH.put(STATE_KEY, JSON.stringify(state));
    console.log('DA canary result', state);
    return state;
}

export default {
    async scheduled(event: ScheduledController, env: Env): Promise<void> {
        console.log('DA scheduled probe started', { cron: event.cron, scheduledTime: event.scheduledTime });
        await check(env);
    },
    async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
        const path = new URL(request.url).pathname;
        if (path === '/health' && request.method === 'GET') {
            let state = await env.HEALTH.get<Health>(STATE_KEY, 'json');
            // The external watchdog also drives checks if Cloudflare stops dispatching Cron.
            // Await the real result, so a successful HTTP response still proves credential health.
            const interval = state?.status === 'healthy' && !state.notificationError
                ? PROBE_INTERVAL_MS : RECOVERY_PROBE_INTERVAL_MS;
            if (!state || Date.now() - state.checkedAt >= interval) {
                console.log('DA watchdog-triggered probe started');
                const pending = check(env);
                ctx?.waitUntil(pending);
                state = await pending;
            }
            return Response.json({ ...state, fresh: !!state && Date.now() - state.checkedAt <= STALE_MS }, {
                status: isHealthy(state, Date.now()) ? 200 : 503,
                headers: { 'Cache-Control': 'no-store' },
            });
        }
        if (request.method !== 'POST' || !env.ADMIN_TOKEN || request.headers.get('Authorization') !== `Bearer ${env.ADMIN_TOKEN}`) {
            return new Response('Not found', { status: 404 });
        }
        if (path === '/run') return Response.json(await check(env));
        if (path === '/test-alert') {
            const body = await request.json() as { kind?: string };
            if (body.kind !== 'down' && body.kind !== 'recovered') return new Response('Invalid test kind', { status: 400 });
            try {
                const id = await sendAlert(env, body.kind, 'End-to-end email delivery drill.', true);
                return Response.json({ id, test: true });
            } catch (error) {
                return Response.json({ error: String(error) }, { status: 502 });
            }
        }
        return new Response('Not found', { status: 404 });
    },
} satisfies ExportedHandler<Env>;
