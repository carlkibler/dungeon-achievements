import { requestSource } from '../src/request-source';
interface Env { OPENROUTER_API_KEY?: string }

// Metadata only: never invokes a model or returns credentials/account details.
export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
    const headers = { 'Cache-Control': 'no-store' };
    const reply = (status: 'healthy' | 'degraded', detail: string) =>
        Response.json({ status, detail, check: 'credentials-only', source: requestSource(request) }, { status: status === 'healthy' ? 200 : 503, headers });
    if (!env.OPENROUTER_API_KEY) return reply('degraded', 'Production OpenRouter key is missing.');
    try {
        const auth = { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` };
        const keyResponse = await fetch('https://openrouter.ai/api/v1/key', { headers: auth, signal: AbortSignal.timeout(10_000) });
        if (!keyResponse.ok) return reply('degraded', `OpenRouter key validation returned HTTP ${keyResponse.status}.`);
        const key = (await keyResponse.json() as { data?: { limit_remaining?: number | null; expires_at?: string | null; is_management_key?: boolean } }).data;
        if (!key || (key.expires_at && Date.parse(key.expires_at) <= Date.now()) || key.is_management_key ||
            (typeof key.limit_remaining === 'number' && key.limit_remaining <= 0)) {
            return reply('degraded', 'OpenRouter key is expired, unsuitable for generation, or has exhausted its spending limit.');
        }
        return reply('healthy', 'Production OpenRouter key is valid and its spending limit is not exhausted. No model inference was performed.');
    } catch {
        return reply('degraded', 'OpenRouter metadata check failed or timed out.');
    }
};
