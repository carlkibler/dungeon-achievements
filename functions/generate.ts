import OpenAI from 'openai';
import {
    buildPrompt, parseAchievements, runWithFallback,
    FALLBACK_ACHIEVEMENTS, FALLBACK_MOOD,
    type Achievement, type GenerateRequest, type Provider,
} from '../src/core';

interface Env {
    // Provider — set one. OPENROUTER_API_KEY takes precedence; AI binding is the zero-config CF fallback.
    OPENROUTER_API_KEY?: string;
    OPENROUTER_MODEL?: string;   // default: anthropic/claude-haiku-4.5
    AI?: Ai;                     // Cloudflare Workers AI binding (wrangler.toml: [ai] binding = "AI")
    CF_AI_MODEL?: string;        // default: @cf/meta/llama-3.1-8b-instruct
    ANALYTICS?: AnalyticsEngineDataset;
}

interface LLMOutput { text: string; model: string }

async function callOpenRouter(prompt: string, env: Env): Promise<LLMOutput> {
    const client = new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: env.OPENROUTER_API_KEY,
        defaultHeaders: {
            'HTTP-Referer': 'https://dungeon-achievements.pages.dev',
            'X-Title': 'Dungeon Achievements Generator',
        },
    });
    const model = env.OPENROUTER_MODEL ?? 'anthropic/claude-haiku-4.5';
    const message = await client.chat.completions.create({
        model,
        max_tokens: 2000,
        temperature: 0.9,
        seed: Math.floor(Math.random() * 2147483647),
        messages: [{ role: 'user', content: prompt }],
    });
    return { text: message.choices[0]?.message?.content ?? '', model };
}

/**
 * Workers AI returns two different shapes depending on the model: classic
 * text-generation models give `{ response }`, OpenAI-compatible ones (gpt-oss,
 * reasoning models) give `{ choices: [{ message: { content } }] }`. Read both —
 * guessing wrong yields empty text, which degrades to canned output silently.
 */
async function callWorkersAI(prompt: string, env: Env): Promise<LLMOutput> {
    const model = env.CF_AI_MODEL ?? '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
    const result = await env.AI!.run(model, {
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2000,
    }) as { response?: string; choices?: Array<{ message?: { content?: string | null } }> };

    const text = result.response ?? result.choices?.[0]?.message?.content ?? '';
    if (!text.trim()) {
        throw new Error(`workers-ai returned empty text for ${model}`);
    }
    return { text, model };
}

async function callLLM(prompt: string, env: Env): Promise<LLMOutput & { degraded: boolean }> {
    const providers: Provider<LLMOutput>[] = [];
    if (env.OPENROUTER_API_KEY) providers.push({ name: 'openrouter', run: () => callOpenRouter(prompt, env) });
    if (env.AI) providers.push({ name: 'workers-ai', run: () => callWorkersAI(prompt, env) });

    const { value, provider, degraded, failures } = await runWithFallback(providers);
    if (failures.length > 0) {
        console.error('AI provider fallback engaged', { served_by: provider, model: value.model, failures });
    }
    return { ...value, degraded };
}

function writeAnalytics(
    env: Env,
    style: string,
    model: string,
    success: boolean,
    framingReturned: boolean,
    hasRecentHistory: boolean,
    durationMs: number,
    activityLength: number,
    achievementsCount: number,
    country: string,
): void {
    try {
        env.ANALYTICS?.writeDataPoint({
            blobs: [style, country, model, success ? 'success' : 'fallback', framingReturned ? '1' : '0', hasRecentHistory ? '1' : '0'],
            doubles: [durationMs, activityLength, achievementsCount],
            indexes: [style],
        });
    } catch {
        // analytics failure must never break /generate
    }
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
    const { request, env } = context;
    const t0 = Date.now();

    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
    };

    const country = (request as Request & { cf?: { country?: string } }).cf?.country ?? 'unknown';

    try {
        const body = await request.json() as GenerateRequest;

        if (!body.activity?.trim()) {
            return Response.json({ error: 'Activity is required' }, { status: 400, headers: corsHeaders });
        }

        const MAX_ACTIVITY = 500;
        if (body.activity.length > MAX_ACTIVITY) {
            return Response.json(
                { error: `Activity too long (max ${MAX_ACTIVITY} characters)` },
                { status: 400, headers: corsHeaders },
            );
        }

        const activityLength = body.activity.trim().length;
        const style = body.style ?? 'default';
        const hasRecentHistory = (body.recentTitles?.length ?? 0) > 0;

        const { prompt, mood } = buildPrompt(
            body.activity.trim(),
            style,
            body.recentTitles ?? [],
            body.recentSnippets ?? [],
        );

        let achievements: Achievement[];
        let framing = body.activity.trim();
        let success = true;
        let framingReturned = false;
        let model = 'unknown';
        let degraded = false;

        try {
            const { text, model: usedModel, degraded: usedFallbackProvider } = await callLLM(prompt, env);
            model = usedModel;
            degraded = usedFallbackProvider;
            const parsed = parseAchievements(text);
            achievements = parsed.achievements;
            if (parsed.framing) { framing = parsed.framing; framingReturned = true; }
            if (achievements.length === 0) { achievements = FALLBACK_ACHIEVEMENTS; success = false; degraded = true; }
        } catch (err) {
            console.error('All AI providers failed; serving canned achievements', { error: String(err) });
            achievements = FALLBACK_ACHIEVEMENTS;
            success = false;
            degraded = true;
        }

        writeAnalytics(env, style, model, success, framingReturned, hasRecentHistory, Date.now() - t0, activityLength, achievements.length, country);

        return Response.json(
            { achievements, mood, framing, degraded, timestamp: new Date().toISOString() },
            { headers: corsHeaders }
        );

    } catch (error) {
        console.error('Error generating achievements:', error);
        writeAnalytics(env, 'unknown', 'unknown', false, false, false, Date.now() - t0, 0, 0, country);
        return Response.json(
            { achievements: FALLBACK_ACHIEVEMENTS, mood: FALLBACK_MOOD, framing: '', degraded: true, timestamp: new Date().toISOString() },
            { headers: corsHeaders }
        );
    }
};

export const onRequestOptions: PagesFunction = async () => {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        },
    });
};
