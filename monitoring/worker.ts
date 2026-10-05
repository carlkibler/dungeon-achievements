const SITE = 'https://achievements.carlkibler.com';
const STATE_KEY = 'health';
export const STALE_MS = 40 * 60_000;
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

export function classifyGeneration(data: unknown): { status: Status; detail: string } {
    const body = data as { achievements?: Array<{ title?: string; description?: string }>; degraded?: unknown; refused?: unknown } | null;
    if (!Array.isArray(body?.achievements) || body.achievements.length !== 3 ||
        !body.achievements.every(a => typeof a?.title === 'string' && a.title.trim() && typeof a.description === 'string' && a.description.trim()) ||
        body.refused !== false || typeof body.degraded !== 'boolean') {
        return { status: 'down', detail: 'Generation returned an invalid or refused achievement set.' };
    }
    if (body.achievements.every(a => [
        '💥 Achievement Unlocked: Error Handler Extraordinaire',
        '🔥 Achievement Unlocked: System Whisperer',
        '🌀 Achievement Unlocked: Chaos Creator',
    ].includes(a.title!))) {
        return { status: 'down', detail: 'Visitors are receiving canned error cards. All generation providers failed or returned unusable output.' };
    }
    return body.degraded
        ? { status: 'degraded', detail: 'The primary AI provider is failing. Visitors are getting generated fallback cards.' }
        : { status: 'healthy', detail: 'Primary provider returned three genuine achievements.' };
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
        const response = await fetch(`${SITE}/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ activity: 'I finished folding my laundry' }),
            signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok) return { status: 'down', detail: `/generate returned HTTP ${response.status}.` };
        return classifyGeneration(await response.json());
    } catch {
        return { status: 'down', detail: 'Generation request failed, timed out, or returned invalid JSON.' };
    }
}

async function sendAlert(env: Env, kind: 'down' | 'degraded' | 'recovered', detail: string, test = false): Promise<string> {
    const subject = kind === 'recovered' ? 'RECOVERED: Dungeon Achievements is working again'
        : kind === 'down' ? 'ACTION REQUIRED: Dungeon Achievements is DOWN'
        : 'ACTION REQUIRED: Dungeon Achievements AI provider is FAILING';
    const text = `${test ? 'THIS IS AN ALERT DELIVERY TEST. Production has not been taken down.\n\n' : ''}${subject}\n\n${detail}\n\nSite: ${SITE}\nChecked: ${new Date().toISOString()}\n\nA Cloudflare Worker tests real generation every 15 minutes. Unresolved failures repeat every two hours. A recovery email follows when the primary provider is healthy again.`;
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
    async scheduled(_event: ScheduledController, env: Env): Promise<void> {
        await check(env);
    },
    async fetch(request: Request, env: Env): Promise<Response> {
        const path = new URL(request.url).pathname;
        if (path === '/health' && request.method === 'GET') {
            const state = await env.HEALTH.get<Health>(STATE_KEY, 'json');
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
                const id = await sendAlert(env, body.kind, 'End-to-end email delivery drill. The live generation probe is healthy.', true);
                return Response.json({ id, test: true });
            } catch (error) {
                return Response.json({ error: String(error) }, { status: 502 });
            }
        }
        return new Response('Not found', { status: 404 });
    },
} satisfies ExportedHandler<Env>;
