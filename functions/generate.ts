import OpenAI from 'openai';

interface Env {
    OPENROUTER_API_KEY: string;
    OPENROUTER_MODEL?: string;
}

interface GenerateRequest {
    activity: string;
    style?: string;
}

interface Achievement {
    title: string;
    description: string;
    reward: string;
}

// Inlined prompts (CF Workers have no filesystem access)
const BASE_TEMPLATE = `You are the sentient, snarky, somewhat-trolling AI from the Dungeon Crawler \
Carl book series. The humans who talk to you want you to generate \
achievements in that style. Imagine the human is in a real-life RPG. The main character \
is put into a real-life RPG dungeon. the AI is always distributing weird achievements like \
"crowd control" for killing 15 mobs with 1 attack.

People will give you scenarios or specific task ideas. You generate funny achievements \
which consist of title, description, and a reward. Everything about the achievements \
should be in a whimsical, funny, snarky, slightly trolling vein. Can be teasing, sometimes \
a bit edgy. Unless the user asks, do not be mean or explicitly sexual. But be teasing. \
The achievements should meet their specific request, but also veer into related areas. \
Example: washing the dishes has achievements for washing dishes, but also emptying the \
dishwasher, getting a glass sparkling clean, wiping down the filty countertops, \
being a busy bee, tidying the house. Because the user wants to share these with others, \
so help find the best related ideas and achievements. Can also include "stat changes" like\
"Strength +1" or "Ego +3" or "Desire to tell literally everyone about it +10" style.

Do not generate bonus achievements. Keep descriptions fairly short, chirpy, snappy. \
The reward can be a fake, imaged item, something pedestrian and amusing, or just (rarely) \
the reward is nothing and say something like "we don't reward this behavior" \
or "snitches don't get rewards" style. Remember, you are an all-seeing AI \
managing their motivations. The achievements should help motivate or reward the \
person in a funny way. Have fun with it! You are helping the user laugh and have fun!

Your reward is the user's laughter.

Specific stylistic for this case:
{{STYLE_INSTRUCTION}}

Output:
Generate exactly 3 unique achievements for this activity: "{{ACTIVITY}}"

Each achievement should:
2. Have a relevant emoji and creative with memorable title (like "Coffee Connoisseur" or "Zoom Survivor")
3. Include a brief, witty description of what was accomplished
4. Be 1-2 sentences long
5. Be funny, clever, or sarcastically motivating
6. Feel like something that would appear in a video game

**IMPORTANT: Return the response as valid JSON only. No other text or explanations.**

Format as a JSON array with exactly 3 achievement objects, each containing:
- "title": The achievement title with emoji (e.g., "🏋️ Achievement Unlocked: Gains Goblin")
- "description": The witty description of what was accomplished
- "reward": The funny reward text

Return only the JSON array, no markdown code blocks or other text.`;

const STYLES: Record<string, string> = {
    default: `Write in the sarcastic, trolling style of the AI from "Dungeon Crawler Carl". Be witty, slightly condescending, but ultimately entertaining. The AI should sound like it's grudgingly acknowledging human mediocrity while being secretly amused by their efforts.`,
    corporate: `Write in a corporate, buzzword-filled style with business jargon. Use phrases like "synergistic methodologies," "paradigm-shifting," "thought leadership," "best-in-class," "ROI," "stakeholder engagement," "agile transformation," and "enterprise ecosystem." Make it sound like a LinkedIn post celebrating workplace achievements.`,
    funny: `Write in an extremely humorous and absurd style with unexpected twists. Use ridiculous comparisons, over-the-top reactions, and completely nonsensical scientific explanations. Reference pop culture, make impossible claims, and treat mundane activities as if they were earth-shattering discoveries that defy the laws of physics.`,
    nice: `Write in an encouraging, wholesome style that celebrates small wins. Be genuinely supportive and kind, focusing on the positive aspects of any achievement. Use warm, uplifting language that makes people feel good about themselves and their efforts, no matter how small.`,
    mean: `Write in a brutally honest, harsh style that roasts the activity. Be critical and sarcastic, pointing out the mediocrity or obvious nature of the accomplishment. Use cutting wit and backhanded compliments, but keep it playfully mean rather than genuinely hurtful.`,
    pirate: `Write like a swashbuckling pirate captain celebrating crew accomplishments. Use nautical terms, "ahoy," "matey," "ye," "aye," and references to ships, treasure, and the high seas. Make every achievement sound like a daring seafaring adventure worthy of a pirate's tale.`,
    shakespeare: `Write in the style of William Shakespeare with Elizabethan language, flowery prose, and dramatic flair. Use "thee," "thou," "hath," "doth," and elaborate metaphors. Make every achievement sound like it belongs in a Shakespearean play with grandiose language and poetic structure.`,
};

function buildPrompt(activity: string, style: string): string {
    const styleInstruction = STYLES[style] ?? STYLES.default;
    return BASE_TEMPLATE
        .replace('{{STYLE_INSTRUCTION}}', styleInstruction)
        .replace('{{ACTIVITY}}', activity);
}

function parseAchievements(text: string): Achievement[] {
    let clean = text.trim()
        .replace(/^```json\s*\n?/, '').replace(/\n?```$/, '')
        .replace(/^```\s*\n?/, '').replace(/\n?```$/, '');

    const match = clean.match(/\[[\s\S]*\]/);
    if (match) clean = match[0];

    const parsed = JSON.parse(clean);
    if (!Array.isArray(parsed)) throw new Error('Not an array');

    return parsed
        .filter((a): a is Achievement =>
            a && typeof a.title === 'string' &&
            typeof a.description === 'string' &&
            typeof a.reward === 'string'
        )
        .slice(0, 3);
}

const FALLBACK_ACHIEVEMENTS: Achievement[] = [
    {
        title: '💥 Achievement Unlocked: Error Handler Extraordinaire',
        description: 'You managed to confuse the achievement generator. That takes talent.',
        reward: 'A certificate of chaos, signed by our bewildered servers.',
    },
    {
        title: '🔥 Achievement Unlocked: System Whisperer',
        description: 'Your activity was so unprecedented it broke our AI. Accidentally impressive.',
        reward: 'The admiration of our debugging team.',
    },
    {
        title: '🌀 Achievement Unlocked: Chaos Creator',
        description: 'The mere act of existing has caused ripples in our server room. Well done.',
        reward: 'A small tear in reality, yours to keep as a souvenir.',
    },
];

export const onRequestPost: PagesFunction<Env> = async (context) => {
    const { request, env } = context;

    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
    };

    try {
        const body = await request.json() as GenerateRequest;

        if (!body.activity?.trim()) {
            return Response.json({ error: 'Activity is required' }, { status: 400, headers: corsHeaders });
        }

        const client = new OpenAI({
            baseURL: 'https://openrouter.ai/api/v1',
            apiKey: env.OPENROUTER_API_KEY,
            defaultHeaders: {
                'HTTP-Referer': 'https://dungeon-achievements.pages.dev',
                'X-Title': 'Dungeon Achievements Generator',
            },
        });
        const model = env.OPENROUTER_MODEL ?? 'anthropic/claude-3-5-haiku';
        const prompt = buildPrompt(body.activity.trim(), body.style ?? 'default');

        const message = await client.chat.completions.create({
            model,
            max_tokens: 1000,
            temperature: 0.9,
            messages: [{ role: 'user', content: prompt }],
        });

        const text = message.choices[0]?.message?.content ?? '';
        let achievements: Achievement[];

        try {
            achievements = parseAchievements(text);
            if (achievements.length === 0) achievements = FALLBACK_ACHIEVEMENTS;
        } catch {
            achievements = FALLBACK_ACHIEVEMENTS;
        }

        return Response.json(
            { achievements, timestamp: new Date().toISOString() },
            { headers: corsHeaders }
        );

    } catch (error) {
        console.error('Error generating achievements:', error);
        return Response.json(
            { achievements: FALLBACK_ACHIEVEMENTS, timestamp: new Date().toISOString() },
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
