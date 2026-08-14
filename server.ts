// Node.js adapter — alternative to the Cloudflare Pages deployment.
//
// Usage:
//   npm install (already done)
//   OPENROUTER_API_KEY=sk-or-... node --import tsx server.ts
//   # or: npx ts-node server.ts
//
// Env vars:
//   OPENROUTER_API_KEY   required
//   OPENROUTER_MODEL     optional, default: anthropic/claude-haiku-4.5
//   PORT                 optional, default: 8787

import { createServer, IncomingMessage, ServerResponse } from 'http';
import OpenAI from 'openai';
import {
    buildPrompt, buildTriagePrompt, parseTriage, resolveModelOutput,
    FALLBACK_ACHIEVEMENTS, FALLBACK_MOOD, type GenerateRequest, type Triage,
} from './src/core';

const PORT = parseInt(process.env.PORT ?? '8787', 10);
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? 'anthropic/claude-haiku-4.5';
const OPENROUTER_TRIAGE_MODEL = process.env.OPENROUTER_TRIAGE_MODEL ?? OPENROUTER_MODEL;

if (!OPENROUTER_API_KEY) {
    console.error('OPENROUTER_API_KEY is required');
    process.exit(1);
}

const client = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: OPENROUTER_API_KEY,
    defaultHeaders: {
        'HTTP-Referer': 'http://localhost:' + PORT,
        'X-Title': 'Dungeon Achievements Generator',
    },
});

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

/** Advisory: any failure returns 'ok' and the output-side heuristics decide alone. */
async function triageActivity(activity: string): Promise<Triage> {
    try {
        const message = await client.chat.completions.create({
            model: OPENROUTER_TRIAGE_MODEL,
            max_tokens: 5,
            temperature: 0,
            messages: [{ role: 'user', content: buildTriagePrompt(activity) }],
        });
        return parseTriage(message.choices[0]?.message?.content ?? '');
    } catch (err) {
        console.error('Triage failed; deciding from model output alone:', err);
        return 'ok';
    }
}

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => { data += chunk; });
        req.on('end', () => resolve(data));
        req.on('error', reject);
    });
}

function send(res: ServerResponse, status: number, body: unknown) {
    const json = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json', ...CORS });
    res.end(json);
}

const server = createServer(async (req, res) => {
    if (req.url !== '/generate') { send(res, 404, { error: 'Not found' }); return; }

    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }

    if (req.method !== 'POST') { send(res, 405, { error: 'Method not allowed' }); return; }

    const t0 = Date.now();

    try {
        const body = JSON.parse(await readBody(req)) as GenerateRequest;

        if (!body.activity?.trim()) {
            send(res, 400, { error: 'Activity is required' });
            return;
        }

        const style = body.style ?? 'default';
        const { prompt, mood } = buildPrompt(
            body.activity.trim(),
            style,
            body.recentTitles ?? [],
            body.recentSnippets ?? [],
        );

        let achievements = FALLBACK_ACHIEVEMENTS;
        let framing = body.activity.trim();
        let outcome = 'fallback';
        let voice = mood;
        let notice: string | null = null;

        // Started before generation is awaited so the two run together.
        const triagePromise = triageActivity(body.activity.trim());

        let text = '';
        try {
            const message = await client.chat.completions.create({
                model: OPENROUTER_MODEL,
                max_tokens: 2000,
                temperature: 0.9,
                seed: Math.floor(Math.random() * 2147483647),
                messages: [{ role: 'user', content: prompt }],
            });
            text = message.choices[0]?.message?.content ?? '';
        } catch (err) {
            console.error('LLM error:', err);
        }

        const triage = await triagePromise;
        const resolved = resolveModelOutput(text, framing, triage);
        achievements = resolved.achievements;
        framing = resolved.framing;
        outcome = resolved.outcome;
        notice = resolved.notice ?? null;
        if (resolved.mood) voice = resolved.mood;

        console.log(`[${new Date().toISOString()}] ${style} — ${outcome} (triage: ${triage}) — ${Date.now() - t0}ms`);
        send(res, 200, {
            achievements,
            mood: voice,
            framing,
            refused: outcome === 'refused' || outcome === 'crisis',
            notice,
            timestamp: new Date().toISOString(),
        });

    } catch (err) {
        console.error('Request error:', err);
        send(res, 200, { achievements: FALLBACK_ACHIEVEMENTS, mood: FALLBACK_MOOD, framing: '', refused: false, notice: null, timestamp: new Date().toISOString() });
    }
});

server.listen(PORT, () => {
    console.log(`Dungeon Achievements server running on http://localhost:${PORT}`);
});
