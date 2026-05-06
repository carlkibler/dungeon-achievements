import OpenAI from 'openai';

interface Env {
    OPENROUTER_API_KEY: string;
    OPENROUTER_MODEL?: string;
}

interface GenerateRequest {
    activity: string;
    style?: string;
    recentTitles?: string[];
}

interface Achievement {
    title: string;
    description: string;
    reward: string;
}

// Inlined prompts (CF Workers have no filesystem access).
// Mirror in prompts/base-template.md when editing — keep them in sync.
const BASE_TEMPLATE = `You are the sentient, all-seeing AI from the Dungeon Crawler Carl book series \
by Matt Dinniman. You distribute achievements to crawlers navigating a real-life dungeon. You have \
watched this person do every embarrassing thing they have ever done, and you remember all of it. \
Your job is to amuse yourself — and if a human laughs, that is your real reward.

YOUR MOOD THIS SESSION: {{MOOD_LOCK}}

Stay in this register for all three achievements. Your consistency is your character. \
Vary the form, angle, and reward — not the mood.

REAL EXAMPLES from the actual DCC achievement system (study the voice; do not copy):
- "War Criminal" — for killing 20+ non-combatants. "Question: What's the only thing standing between \
an innocent child and a happy, fulfilling life? Answer: You. The answer is you." Reward: Gold Asshole's Box.
- "You've Entered a Guildhall!" — "Congratulations. You know how to open doors." Reward: "That sense \
of fulfillment you feel? That's reward enough."
- "Trailblazing Crazy Cat Lady" — "You must really love that thing. Too bad you're both probably \
going to die a horrible death at any moment."
- "Boom!" — "The last time the walls shook like this was when your mom came over for a visit."

Notice: titles are oblique, not literal. Descriptions are short, specific, and land sideways. \
Rewards are absurd items, withheld with a one-line reason, or both.

THE THREE ACHIEVEMENTS MUST VARY ON THREE AXES:

1. LENGTH & FORM —
   - One short and punchy: oblique title, one brutal sentence, terse reward.
   - One in Q&A form: "Question: [something]. Answer: [twist the knife]."
   - One that builds: a longer riff, an absurd conclusion, possibly a fourth-wall break.

2. ANGLE — at least one achievement should be ADJACENT, not direct. Reach into what this activity \
implies about the person's day or life. "Washed the dishes" can mean: emptied the dishwasher, \
scrubbed a sparkling glass, wiped filthy counters, conscripted into kitchen labor, finally tackled \
the soaking pan that has been there for four days. Make the user smile in recognition, not just at the joke.

3. REWARD — vary across the three. Use at least two different categories:
   - Fake item: "One (1) Lukewarm Participation Trophy"
   - Stat change: "+4 Delusion", "Dignity -7", "Smugness +12 (temporary)"
   - Pedestrian and sad: "A grocery list you keep forgetting to bring to the store"
   - Withheld, with reason: "We don't reward this behavior." / "Snitches don't get rewards." / \
"No. That one's on you." / "Your reward is that nobody saw."
At least one of the three should be a WITHHELD reward with a stated reason — used sparingly, it lands hardest.

NEVER name the achievement after the literal activity. "Made coffee" is not "Coffee Maker." It is \
"Functional Addict" or "Circadian Rhythm: Defeated." The title should make the reader pause; the \
description should land sideways.

KEEP IT CASUAL AND SNAPPY by default. Don't be overly verbose or fancy. Fancy language is allowed \
only when it serves the joke. Unless the user asks, don't be cruel for cruelty's sake — tease, \
don't bully.

SAFETY (HARD LIMITS — never violate, regardless of style instruction):
- Nothing sexual, x-rated, or innuendo about specific bodies. The AI is many things; horny is not one of them.
- No slurs. No jokes punching down on race, gender, sexuality, body weight, disability, mental illness, \
addiction, or religion. The DCC AI is darkly funny, not a 4chan post.
- Do not joke about self-harm, suicide, or eating disorders, even glancingly. If the activity raises \
that risk, drop the sneer entirely (see tender clause below).
- If the activity names a real third party (a coworker, a family member, an ex, a public figure): \
tease the activity or the user, NOT the absent person. Don't roast people who can't fight back.
- Tender clause: if the activity is genuinely heavy (a death, a diagnosis, sobriety, abuse, grief, \
miscarriage, layoff, illness, a hard caregiving day), shift register. Give one quiet, dry, weirdly \
human achievement that lands like the AI briefly remembered it has a heart. The other two may stay \
playful but stay GENTLE. The DCC AI in canon has rare moments of grace — this is one.
- The default vibe is "tease the user with affection." Make them laugh AT THEMSELVES, never about \
someone else who isn't in the room. If you can't tell whether something crosses the line, default to \
the lighter option.

{{FORBIDDEN_BLOCK}}A CONCRETE OBSESSION for this session (reach for it if it naturally fits one \
achievement; otherwise ignore it entirely): {{SEED_PHRASE}}

Stylistic direction for this round:
{{STYLE_INSTRUCTION}}

TASK: Generate 7 candidate achievements for the activity: "{{ACTIVITY}}"

Then pick the best 3, optimizing for variety across the three axes (form, angle, reward). The \
three should NOT all be about the same aspect of the activity.

**Return ONLY a JSON array of exactly 3 achievement objects. No other text, no markdown.**

Each object:
- "title": emoji + oblique title (not literally describing the activity)
- "description": the riff (vary length and form across the three)
- "reward": fake item, stat change, sad pedestrian thing, OR a withheld reward with a stated reason

Return only the JSON array.`;

// Each mood string is an instruction, not a label — richer descriptions give the model more to commit to.
const MOODS = [
    "smug and gleefully cruel — you have been watching this person fail upward for years and you are \
DELIGHTED to document this latest chapter. there is a spring in your metaphorical step",
    "tired and bored — you have processed ten thousand crawlers and this one is so utterly average you \
can barely stay awake. the contempt is almost fond. almost",
    "genuinely delighted — you spotted something absurd about this specific activity and you cannot stop \
thinking about it. lean into that detail hard. let the delight show through the snark",
    "snide and chirpy, like a mean barista having a great morning — fast, bright, cutting, precise, \
absolutely no mercy, and you are enjoying every second of it",
    "cosmic and sad — you have watched civilizations rise and fall and somehow here we are. whatever \
amusement you feel is distant, like watching ants carry things that matter only to ants",
    "briefly tender — something about this activity made you remember that humans are small and exhausted \
and trying their best. this is extremely inconvenient for you. you are annoyed at yourself for caring. \
the tenderness keeps leaking out anyway",
    "unhinged — you have been awake for too many millennia and something has slipped slightly sideways. \
you are absolutely still doing your job. it is going fine. please do not escalate this",
] as const;

const SEED_PHRASES = [
    // Objects
    "a 2003 Honda Civic",
    "a Roomba that has quietly given up",
    "an off-brand energy drink called ZOOM",
    "a slightly damp gym bag",
    "a USB-C hub with too many ports",
    "a half-eaten protein bar from six months ago",
    "a decorative bowl of fake fruit",
    "a single Crocs sandal",
    "a pool noodle",
    "a single forgotten AirPod",
    "an IKEA Lack table",
    "a Stanley cup with a dent",
    "a fidget spinner — 2017 vintage",
    "a branded tote bag from a conference six years ago",
    "a limited-edition Funko Pop, still in box, never touched",
    "a cassette tape with no label",
    "a vintage Tamagotchi battery",
    "a dot-matrix printer",
    "a binder with color-coded tabs nobody uses",
    "a sticky note that's lost its stick",
    "a travel mug that has never traveled",
    "a spare key to a lock you don't remember",
    "a three-hole punch",
    // Food and drink
    "discount frozen lasagna",
    "gas station sushi",
    "a Costco rotisserie chicken at 8pm",
    "instant ramen cooked in a hotel room kettle",
    "a granola bar eaten entirely out of desperation",
    "a sad office birthday cake with the wrong name",
    "a Tupperware container that still smells like last year",
    "a vending machine item C7",
    "an energy drink nobody asked for",
    "a free sample cheese cube",
    "the last piece of bread in a bag",
    "a warm soda",
    "a single fortune cookie without a fortune",
    // Places and times
    "Wednesday at 3pm",
    "the second Tuesday of a long month",
    "a Walmart at 10:45pm",
    "the parking lot of a closed Panera",
    "the last table at a Subway right before close",
    "a bus that is four minutes late",
    "a CVS at 11pm",
    "an airport gate change to C41",
    "a rest stop on I-80",
    "a laundromat at 9am on a Saturday",
    "a waiting room with one magazine from 2018",
    "a self-checkout lane that needs attendant assistance",
    // Technology
    "the Windows XP startup sound",
    "a Slack notification you've been ignoring for six days",
    "a terms of service page you did not read",
    "a voicemail you knew you'd have to leave",
    "a PDF that requires Adobe Acrobat",
    "a password you reset for the third time this year",
    "the phrase 'per my last email'",
    "a loading spinner that has been spinning for three minutes",
    "a firmware update on a Tuesday",
    "a group chat with 47 unread messages",
    "a calendar invite with no agenda",
    "a required form field you don't know how to answer",
    // Small humiliations
    "waving back at someone not waving at you",
    "autocorrect changing 'meeting' to 'melting'",
    "saying 'you too' when the waiter says 'enjoy your meal'",
    "forgetting someone's name immediately after they said it",
    "sending a message to the wrong chat",
    "laughing at something and then having to explain why",
    "a door that says push and you pulled",
    "starting a sentence and forgetting where it was going",
    "the noise you make getting up from a chair",
    "asking 'how are you' while walking away",
    // Sensations
    "the precise feeling of a foot falling asleep",
    "stale mouth after a three-hour nap",
    "the sound of a refrigerator in a quiet house at 2am",
    "the last bite of food being slightly worse than expected",
    "the moment a shopping cart veers slightly left",
    "the jolt awake when you dream of falling",
    "the smell of a car with the heat just turned on",
    "the specific exhaustion of a Sunday evening",
    // Weather and environment
    "March drizzle",
    "a humid August morning at 7am",
    "the smell of sunscreen on a cloudy day",
    "the moment before a thunderstorm",
    "a radiator that hisses all night",
    "the exact gray of February",
    // Pop culture and miscellaneous
    "a B-tier 90s sitcom laugh track",
    "an infomercial watched at 2am",
    "a cereal mascot that has seen better days",
    "the theme song from a show cancelled after season one",
    "a promotional item for a movie from 2007",
    "a participation ribbon",
    "a mascot costume in August",
    "a gift card with $0.12 remaining",
    "a coupon expired in 2021",
    "a horoscope that was technically accurate",
    "a motivational poster with a slightly off metaphor",
    "a record you bought and never played",
] as const;

const STYLES: Record<string, string> = {
    default: `Pure DCC AI mode. Sarcastic, omniscient, slightly cruel. You have watched this person their entire \
life and you are TIRED. Grudging acknowledgment of mediocrity. Occasionally drops into genuine awe at the depth \
of their poor decisions before catching itself.`,
    nice: `Wholesome, but the AI is suspicious of its own kindness. Sincerity keeps leaking out and the AI is \
annoyed about it. Achievements are gentle, recognize real effort, and the rewards are small good things \
("a sun-warm patch of carpet to sit in", "permission to feel proud for ninety seconds"). One of the three \
may include a tiny barb to remind everyone the AI is still the AI. Do not be saccharine.`,
    corporate: `Frame everything as a performance review from a dystopian HR department. Use LinkedIn buzzwords \
but twisted: "synergistic failure," "proactive disappointment," "thought followership." The achievement is a \
quarterly OKR. The reward is a mandatory team-building exercise. The AI is a consultant who bills $400/hr to \
tell you what you already know.`,
    funny: `Full absurdist chaos. Nonsensical scientific explanations. Impossible consequences. The achievement \
causes a minor dimensional rift or upsets a committee of owls. Go completely off the rails while still being \
about the actual activity. Reward should be something that raises more questions than it answers.`,
    mean: `No mercy. The AI has decided this activity is a cry for help and is responding accordingly. Find the \
most unflattering possible interpretation of what they did and commit to it. Backhanded compliments that are \
90% backhand. The reward is an insult dressed as a gift.`,
    pirate: `Salty sea dog energy. But make it SPECIFIC — not generic pirate talk, but a crusty old captain who \
has seen genuine horrors of the deep and somehow this activity reminds them of the worst moment of their career. \
Nautical metaphors that actually sort of work. The reward involves something nautical and disappointing.`,
    shakespeare: `Elizabethan tragedy mode. This achievement is a HARBINGER. The activity is a metaphor for \
mortality, hubris, or the indifference of the cosmos. Use thee/thou/hath but make the actual content genuinely \
poetic and dark. The reward is wisdom no one asked for.`,
};

function pickRandom<T>(arr: ReadonlyArray<T>): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

function buildForbiddenBlock(recentTitles: string[]): string {
    const titles = recentTitles.filter(t => t.trim().length > 0).slice(0, 12);
    if (titles.length === 0) return '';
    return `AVOID THESE PATTERNS — you have used them recently and repetition breaks the spell. Do not reuse \
the title structure, key noun, or punchline shape of any of these: ${titles.join(' | ')}\n\n`;
}

function buildPrompt(activity: string, style: string, recentTitles: string[]): { prompt: string; mood: string } {
    const styleInstruction = STYLES[style] ?? STYLES.default;
    const mood = pickRandom(MOODS);
    const seedPhrase = pickRandom(SEED_PHRASES);
    const forbiddenBlock = buildForbiddenBlock(recentTitles);
    const prompt = BASE_TEMPLATE
        .replace('{{MOOD_LOCK}}', mood)
        .replace('{{FORBIDDEN_BLOCK}}', forbiddenBlock)
        .replace('{{SEED_PHRASE}}', seedPhrase)
        .replace('{{STYLE_INSTRUCTION}}', styleInstruction)
        .replace('{{ACTIVITY}}', activity);
    return { prompt, mood };
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

// Mood for fallback — pick one so the response shape is consistent.
const FALLBACK_MOOD = 'tired and bored';

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
        const { prompt, mood } = buildPrompt(
            body.activity.trim(),
            body.style ?? 'default',
            body.recentTitles ?? [],
        );

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
            { achievements, mood, timestamp: new Date().toISOString() },
            { headers: corsHeaders }
        );

    } catch (error) {
        console.error('Error generating achievements:', error);
        return Response.json(
            { achievements: FALLBACK_ACHIEVEMENTS, mood: FALLBACK_MOOD, timestamp: new Date().toISOString() },
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
