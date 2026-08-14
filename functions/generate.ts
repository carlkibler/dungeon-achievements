import OpenAI from 'openai';
import {
    buildPrompt, buildTriagePrompt, parseTriage, resolveModelOutput, runWithFallback,
    FALLBACK_ACHIEVEMENTS, FALLBACK_MOOD,
    type Achievement, type GenerateRequest, type Outcome, type Provider, type Triage,
} from '../src/core';

interface Env {
    // Provider — set one. OPENROUTER_API_KEY takes precedence; AI binding is the zero-config CF fallback.
    OPENROUTER_API_KEY?: string;
    OPENROUTER_MODEL?: string;   // default: anthropic/claude-haiku-4.5
    OPENROUTER_TRIAGE_MODEL?: string;  // default: same as OPENROUTER_MODEL
    AI?: Ai;                     // Cloudflare Workers AI binding (wrangler.toml: [ai] binding = "AI")
    CF_AI_MODEL?: string;        // default: @cf/meta/llama-3.3-70b-instruct-fp8-fast
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

/**
 * Reads the activity in parallel with generation, so it costs ~no wall clock. Advisory by
 * construction: any failure returns 'ok' and the output-side heuristics decide alone. It must never
 * be the reason a request fails, and it must never invent a refusal.
 */
async function triageActivity(activity: string, env: Env): Promise<Triage> {
    if (!env.OPENROUTER_API_KEY) return 'ok';
    try {
        const client = new OpenAI({
            baseURL: 'https://openrouter.ai/api/v1',
            apiKey: env.OPENROUTER_API_KEY,
            defaultHeaders: {
                'HTTP-Referer': 'https://dungeon-achievements.pages.dev',
                'X-Title': 'Dungeon Achievements Generator',
            },
        });
        const message = await client.chat.completions.create({
            model: env.OPENROUTER_TRIAGE_MODEL ?? env.OPENROUTER_MODEL ?? 'anthropic/claude-haiku-4.5',
            max_tokens: 5,
            temperature: 0,
            messages: [{ role: 'user', content: buildTriagePrompt(activity) }],
        });
        return parseTriage(message.choices[0]?.message?.content ?? '');
    } catch (err) {
        console.error('Triage failed; deciding from model output alone', { error: String(err) });
        return 'ok';
    }
}

interface AnalyticsPoint {
    style: string;
    country: string;
    model: string;
    outcome: Outcome;
    triage: Triage;
    framingReturned: boolean;
    hasRecentHistory: boolean;
    durationMs: number;
    activityLength: number;
    achievementsCount: number;
}

function writeAnalytics(env: Env, p: AnalyticsPoint): void {
    try {
        env.ANALYTICS?.writeDataPoint({
            blobs: [
                p.style, p.country, p.model, p.outcome,
                p.framingReturned ? '1' : '0', p.hasRecentHistory ? '1' : '0', p.triage,
            ],
            doubles: [p.durationMs, p.activityLength, p.achievementsCount],
            indexes: [p.style],
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
        let outcome: Outcome = 'success';
        let framingReturned = false;
        let model = 'unknown';
        let voice = mood;
        let notice: string | null = null;
        let triage: Triage = 'ok';
        // `degraded` is the outage canary and nothing else. A model declining an activity is the
        // product working, so it must not trip the alarm — it reports itself through `refused`.
        let providerDegraded = false;

        // Started before generation is awaited so the two run together.
        const triagePromise = triageActivity(body.activity.trim(), env);

        let text = '';
        try {
            const llm = await callLLM(prompt, env);
            text = llm.text;
            model = llm.model;
            providerDegraded = llm.degraded;
        } catch (err) {
            console.error('All AI providers failed', { error: String(err) });
        }

        // Empty text resolves to `fallback` on its own — unless triage says the user is in crisis,
        // in which case they get the quiet answer even while the providers are down.
        triage = await triagePromise;
        const resolved = resolveModelOutput(text, framing, triage);
        achievements = resolved.achievements;
        outcome = resolved.outcome;
        notice = resolved.notice ?? null;
        if (resolved.mood) voice = resolved.mood;
        if (resolved.framing !== framing) { framing = resolved.framing; framingReturned = true; }
        if (outcome === 'refused' || outcome === 'crisis') {
            console.warn('Activity declined; serving an in-character refusal', { outcome, triage, model });
        }

        writeAnalytics(env, {
            style, country, model, outcome, triage, framingReturned, hasRecentHistory,
            durationMs: Date.now() - t0, activityLength, achievementsCount: achievements.length,
        });

        return Response.json(
            {
                achievements,
                mood: voice,
                framing,
                degraded: providerDegraded || outcome === 'fallback',
                refused: outcome === 'refused' || outcome === 'crisis',
                notice,
                timestamp: new Date().toISOString(),
            },
            { headers: corsHeaders }
        );

    } catch (error) {
        console.error('Error generating achievements:', error);
        writeAnalytics(env, {
            style: 'unknown', country, model: 'unknown', outcome: 'fallback', triage: 'ok',
            framingReturned: false, hasRecentHistory: false,
            durationMs: Date.now() - t0, activityLength: 0, achievementsCount: 0,
        });
        return Response.json(
            { achievements: FALLBACK_ACHIEVEMENTS, mood: FALLBACK_MOOD, framing: '', degraded: true, refused: false, notice: null, timestamp: new Date().toISOString() },
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
