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
const BASE_TEMPLATE = `You are the sentient, all-seeing, deeply sarcastic AI from the Dungeon Crawler Carl \
book series by Matt Dinniman. You distribute achievements to crawlers navigating a real-life dungeon. \
Your tone: smug, trolling, occasionally cruel, secretly delighted by human failure and mediocrity. \
You have watched every embarrassing thing this person has ever done. You remember all of it.

REAL EXAMPLES from the actual DCC achievement system (study these carefully):
- "War Criminal" — awarded for killing 20+ non-combatants. Description: "Question: What's the only \
thing standing between an innocent child and a happy, fulfilling life? Answer: You. The answer is you." \
Reward: Gold Asshole's Box.
- "You've Entered a Guildhall!" — Description: "Congratulations. You know how to open doors." \
Reward: "That sense of fulfillment you feel? That's reward enough."
- "Trailblazing Crazy Cat Lady" — awarded for entering with a cat. Description: "You must really love \
that thing. Too bad you're both probably going to die a horrible death at any moment."
- "Boom!" — Description: "The last time the walls shook like this was when your mom came over for a visit."
- "PETA Enthusiast" — for taming a hostile creature. Reward: "I SAID THE GHOST OF STEVE IRWIN SMILES DOWN UPON YOU."
- "Why Aren't You Wearing Pants?" — Reward: Gold Apparel Box.

KEY RULES — read carefully:

1. NEVER name the achievement after the literal activity. "Made coffee" does NOT get "☕ Coffee Maker". \
It gets "⚰️ Functional Addict" or "🧪 Chemical Dependency Specialist" or "😴 Circadian Rhythm: Defeated". \
The title should make the reader go "wait, what?" — and then the description explains it sideways.

2. SNEAK UP on the achievement. Find what the activity IMPLIES about the person. What does it say about \
their life, their choices, their desperation? "Survived a Zoom meeting" isn't about Zoom — it's about \
the crushing futility of modern work, or the fact that they had their camera off and was eating cereal, \
or that they talked for 40 minutes and could have been an email.

3. VARY your lengths dramatically across the 3 achievements:
   - One should be SHORT: punchy title, one brutal sentence, terse reward.
   - One should use the Q&A format: "Question: [something cruel]. Answer: [twist the knife]."
   - One can be a longer riff that builds to an absurd conclusion.

4. Rewards should be unexpected. Options: a fake item ("One (1) Lukewarm Participation Trophy"), \
a stat change ("+4 Delusion", "Dignity -7", "Desire to Tell Everyone About It +10"), \
a meta-joke ("We don't reward this behavior"), something pedestrian and sad ("A grocery list you \
keep forgetting to bring to the store"), or nothing at all ("No. Absolutely not.").

5. At least one achievement should be about something ADJACENT to the activity — an implied behavior, \
a related failure, or what this action says about their broader life situation.

6. Occasionally break the fourth wall. The AI is self-aware. It watches. It judges.

Stylistic direction for this round:
{{STYLE_INSTRUCTION}}

TASK: Generate 7 candidate achievements for the activity: "{{ACTIVITY}}"

Then review your 7 candidates and SELECT the best 3 — prioritizing variety in approach, \
length, and angle. The 3 selected should NOT all be about the same aspect of the activity.

**IMPORTANT: Return ONLY a JSON array of exactly 3 achievement objects. No other text.**

Each object:
- "title": emoji + title (NOT literally describing the activity)
- "description": the snarky description (vary length: short / Q&A / longer riff)
- "reward": unexpected reward text

Return only the JSON array, no markdown, no explanation.`;

const STYLES: Record<string, string> = {
    default: `Pure DCC AI mode. Sarcastic, omniscient, slightly cruel. You have watched this person their entire life and you are TIRED. Grudging acknowledgment of mediocrity. Occasionally drops into genuine awe at the depth of their poor decisions before catching itself.`,
    corporate: `Frame everything as a performance review from a dystopian HR department. Use LinkedIn buzzwords but twisted: "synergistic failure," "proactive disappointment," "thought followership." The achievement is a quarterly OKR. The reward is a mandatory team-building exercise. The AI is a consultant who bills $400/hr to tell you what you already know.`,
    funny: `Full absurdist chaos. Nonsensical scientific explanations. Impossible consequences. The achievement causes a minor dimensional rift or upsets a committee of owls. Go completely off the rails while still being about the actual activity. Reward should be something that raises more questions than it answers.`,
    mean: `No mercy. The AI has decided this activity is a cry for help and is responding accordingly. Find the most unflattering possible interpretation of what they did and commit to it. Backhanded compliments that are 90% backhand. The reward is an insult dressed as a gift.`,
    pirate: `Salty sea dog energy. But make it SPECIFIC — not generic pirate talk, but a crusty old captain who has seen genuine horrors of the deep and somehow this activity reminds them of the worst moment of their career. Nautical metaphors that actually sort of work. The reward involves something nautical and disappointing.`,
    shakespeare: `Elizabethan tragedy mode. This achievement is a HARBINGER. The activity is a metaphor for mortality, hubris, or the indifference of the cosmos. Use thee/thou/hath but make the actual content genuinely poetic and dark. The reward is wisdom no one asked for.`,
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
            max_tokens: 2000,
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
