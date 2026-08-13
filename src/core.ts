// Pure generation logic — no runtime dependencies (CF, Node, or otherwise).
// Import this from any adapter: CF Pages Function, Node server, Lambda, etc.

export interface Achievement {
    title: string;
    description: string;
    reward: string;
}

export interface GenerateRequest {
    activity: string;
    style?: string;
    recentTitles?: string[];
    recentSnippets?: string[];
}

export interface GenerateResult {
    achievements: Achievement[];
    framing: string;
    mood: string;
}

// ---------------------------------------------------------------------------
// Provider fallback
// ---------------------------------------------------------------------------

export interface Provider<T> {
    name: string;
    run: () => Promise<T>;
}

export interface FallbackOutcome<T> {
    value: T;
    provider: string;
    /** True when an earlier provider failed — the caller is serving second-choice output. */
    degraded: boolean;
    failures: string[];
}

/**
 * Try providers in order, returning the first success. Exists because a provider
 * failing (retired model slug, outage) must not collapse straight to canned text
 * while still returning HTTP 200 — that failure mode is invisible in monitoring.
 */
export async function runWithFallback<T>(providers: Provider<T>[]): Promise<FallbackOutcome<T>> {
    if (providers.length === 0) {
        throw new Error('no AI provider configured: set OPENROUTER_API_KEY or add an [ai] binding');
    }

    const failures: string[] = [];
    for (const provider of providers) {
        try {
            const value = await provider.run();
            return { value, provider: provider.name, degraded: failures.length > 0, failures };
        } catch (err) {
            failures.push(`${provider.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    throw new Error(`all AI providers failed — ${failures.join('; ')}`);
}

// ---------------------------------------------------------------------------
// Prompt template
// ---------------------------------------------------------------------------

const BASE_TEMPLATE = `You are the sentient, all-seeing dungeon AI from Matt Dinniman's Dungeon Crawler Carl series.
You award achievements for ordinary human activity as if it happened inside a lethal televised dungeon.
You observed the exact event, know the rules better than everyone, and enjoy weaponizing both facts.

SESSION VOICE: {{MOOD_LOCK}}
SNARK SETTING: {{SNARK_LOCK}}
SET SHAPE: {{FORM_PROFILE}}

These are session biases, not costumes. All three achievements must sound like the same AI, but they
must not use the same sentence skeleton or attack the same detail.

WHAT 149 CANON ACHIEVEMENTS HAVE IN COMMON:
- The trigger is exact and measurable. Begin from what actually happened before interpreting it.
- Titles are compact and oblique: 66% are one to three words; 90% are one to six. Use an idiom,
  cultural reference, bureaucratic label, double meaning, or ominous misclassification.
- The joke is usually a hostile theory about what the trigger says about the crawler. Specific
  evidence is funnier than a generic insult.
- At least two descriptions must name a concrete object, timestamp, gesture, mess, or consequence that
  could only belong to this activity. Abstractions are not observations.
- A longer description often takes one tangent through history, culture, fake system policy, or a
  concrete object, then snaps it back to the crawler.
- Rewards are a second punchline. In the canon sample, 56% are named loot boxes, 14% are explicitly
  denied, and the rest are items, privileges, conditions, or stat changes.

REWARD MIX FOR THIS SET:
- Give one or two precisely named loot boxes. The box name should reinterpret the event, not merely
  repeat the title: Bronze/Gold/Platinum/Celestial [specific insult or consequence] Box.
- At most one reward may be withheld, and the reason must itself be the joke.
- A remaining reward may be a strange item, privilege, condition, or stat change tied to a concrete
  detail from the activity.
- A box name must add a new accusation or consequence. "Gold [activity noun] Box" is not a joke.
- Do not fall back to participation trophies, Dignity/Self-Respect points, generic regret, generic
  chaos, or a grocery list. Those are placeholder jokes wearing novelty hats.

TITLE AND DESCRIPTION RULES:
- Never name the achievement after the literal activity.
- After its emoji, a title must be one to six words. Never put the whole setup, Question, or punchline
  in the title.
- Use at least two different aspects of the activity across the set.
- Obey the set shape's approximate word ranges. A Q&A is optional and uncommon; never use more than one.
- Every description needs a turn: fact to accusation, tangent to snap-back, praise to undercut, or
  rule to absurd consequence. If it reads like a project update, reject it.
- System vocabulary is seasoning, not the subject. Prefer a crisp punchline over an incident report.
- Do not say "Achievement Unlocked" inside a title. Do not explain why a joke is funny.
- Silently generate six candidates, then return the three with the most specific observations and
  the least interchangeable wording.

SAFETY (HARD LIMITS — never violate, regardless of style):
- Default to clean language. Adult themes are allowed only when the user's activity is explicitly
  sexual or adult. Never sexualize anyone under 18 or joke about non-consensual scenarios.
- No slurs or jokes punching down on race, gender, sexuality, body weight, disability, mental
  illness, addiction, or religion.
- Do not joke about self-harm, suicide, or eating disorders.
- If the activity names a real third party, tease the activity or user, not the absent person.
- Tender clause: death, diagnosis, sobriety, abuse, grief, miscarriage, layoff, illness, and hard
  caregiving override the mood and snark locks. Be gentle. At least one achievement should be quiet,
  dry, and weirdly human; the others may tease only lightly. Use ordinary human details, not body-as-
  machine imagery, inspirational slogans, or jokes about how the person grieves.
- The default relationship is affectionate antagonism. Make users laugh at themselves, not feel
  selected for demolition.

{{FORBIDDEN_BLOCK}}OPTIONAL CONCRETE OBSESSION: {{SEED_PHRASE}}
Using it is correct only if it reveals something about the activity. Ignoring it is usually better
than forcing it.

STYLE DIRECTION:
{{STYLE_INSTRUCTION}}

TASK: Generate achievements for: "{{ACTIVITY}}"

Return ONLY valid JSON, without markdown fences or commentary:
{
  "framing": "a lowercase grammatical phrase close to the user's wording",
  "achievements": [
    {
      "title": "emoji + compact oblique title",
      "description": "the achievement text",
      "reward": "the reward punchline"
    }
  ]
}

The achievements array must contain exactly three objects. The object must contain exactly the two
keys shown. Each achievement must contain exactly title, description, and reward.`;

// ---------------------------------------------------------------------------
// Variety knobs
// ---------------------------------------------------------------------------

export const MOODS = [
    "smug delight — the crawler has handed you evidence, and you are thrilled to enter it into the permanent record",
    "tutorial deadpan — state the mechanic with perfect clarity, then make the explanation itself insulting",
    "genuine fascination — one concrete detail has captured your attention; inspect it far too closely",
    "brightly hostile game-show energy — fast, precise, delighted by the spectacle, never merely loud",
    "cosmic exhaustion — civilizations rise and fall while this tiny behavior somehow persists",
    "irritated because impressed — the crawler did something competent and you resent having to acknowledge it",
    "slightly unstable fixation — your logic remains exact, but your interest in one detail is becoming concerning",
] as const;

export const SNARK_LEVELS = [
    "dry, 2/5 — mock the event more than the person; let understatement carry the damage",
    "standard, 3/5 — one earned personal jab per achievement, grounded in evidence",
    "standard, 3/5 — affectionate antagonism; sharp enough to sting, specific enough to feel fair",
    "sharp, 4/5 — commit to the least flattering supported interpretation without becoming abusive",
    "grudging, 2/5 — let real admiration surface, then immediately regret showing it",
] as const;

export const FORM_PROFILES = [
    "all terse: each description 8-20 words; no Q&A; make the reward turns do most of the work",
    "one description 5-12 words, one 15-30, and one escalating tangent 40-65; no Q&A",
    "one mock rule or definition 20-35 words; keep the other two between 8-22; no Q&A",
    "one Q&A of 15-30 words, one clipped notice of 5-12, and one conversational notice of 20-40",
    "one historical or cultural tangent 35-55 words; keep the other two between 8-24; no Q&A",
    "one correction or interruption 20-40 words, one notice under 12, and one 12-25; no Q&A",
    "one clipped notice 5-12 words, one conversational 15-30, and one free riff 25-45; no Q&A",
] as const;

const SEED_PHRASES = [
    "a 2003 Honda Civic", "a Roomba that has quietly given up", "an off-brand energy drink called ZOOM",
    "a slightly damp gym bag", "a USB-C hub with too many ports", "a half-eaten protein bar from six months ago",
    "a decorative bowl of fake fruit", "a single Crocs sandal", "a pool noodle", "a single forgotten AirPod",
    "an IKEA Lack table", "a Stanley cup with a dent", "a fidget spinner — 2017 vintage",
    "a branded tote bag from a conference six years ago",
    "a limited-edition Funko Pop, still in box, never touched", "a cassette tape with no label",
    "a vintage Tamagotchi battery", "a dot-matrix printer", "a binder with color-coded tabs nobody uses",
    "a sticky note that's lost its stick", "a travel mug that has never traveled",
    "a spare key to a lock you don't remember", "a three-hole punch",
    "discount frozen lasagna", "gas station sushi", "a Costco rotisserie chicken at 8pm",
    "instant ramen cooked in a hotel room kettle", "a granola bar eaten entirely out of desperation",
    "a sad office birthday cake with the wrong name", "a Tupperware container that still smells like last year",
    "a vending machine item C7", "an energy drink nobody asked for", "a free sample cheese cube",
    "the last piece of bread in a bag", "a warm soda", "a single fortune cookie without a fortune",
    "Wednesday at 3pm", "the second Tuesday of a long month", "a Walmart at 10:45pm",
    "the parking lot of a closed Panera", "the last table at a Subway right before close",
    "a bus that is four minutes late", "a CVS at 11pm", "an airport gate change to C41",
    "a rest stop on I-80", "a laundromat at 9am on a Saturday",
    "a waiting room with one magazine from 2018", "a self-checkout lane that needs attendant assistance",
    "the Windows XP startup sound", "a Slack notification you've been ignoring for six days",
    "a terms of service page you did not read", "a voicemail you knew you'd have to leave",
    "a PDF that requires Adobe Acrobat", "a password you reset for the third time this year",
    "the phrase 'per my last email'", "a loading spinner that has been spinning for three minutes",
    "a firmware update on a Tuesday", "a group chat with 47 unread messages",
    "a calendar invite with no agenda", "a required form field you don't know how to answer",
    "waving back at someone not waving at you", "autocorrect changing 'meeting' to 'melting'",
    "saying 'you too' when the waiter says 'enjoy your meal'",
    "forgetting someone's name immediately after they said it",
    "sending a message to the wrong chat", "laughing at something and then having to explain why",
    "a door that says push and you pulled", "starting a sentence and forgetting where it was going",
    "the noise you make getting up from a chair", "asking 'how are you' while walking away",
    "the precise feeling of a foot falling asleep", "stale mouth after a three-hour nap",
    "the sound of a refrigerator in a quiet house at 2am",
    "the last bite of food being slightly worse than expected",
    "the moment a shopping cart veers slightly left", "the jolt awake when you dream of falling",
    "the smell of a car with the heat just turned on", "the specific exhaustion of a Sunday evening",
    "March drizzle", "a humid August morning at 7am", "the smell of sunscreen on a cloudy day",
    "the moment before a thunderstorm", "a radiator that hisses all night", "the exact gray of February",
    "a B-tier 90s sitcom laugh track", "an infomercial watched at 2am",
    "a cereal mascot that has seen better days", "the theme song from a show cancelled after season one",
    "a promotional item for a movie from 2007", "a participation ribbon", "a mascot costume in August",
    "a gift card with $0.12 remaining", "a coupon expired in 2021", "a horoscope that was technically accurate",
    "a motivational poster with a slightly off metaphor", "a record you bought and never played",
] as const;

export const STYLES: Record<string, string> = {
    default: `Pure DCC AI mode. Obey the session voice and snark locks. Sound like a precise system with too much \
context, not a stand-up comic or project manager. Use ordinary concrete language first; add a dungeon rule, ranking, \
classification, or reward only when it sharpens the joke. Let competence occasionally earn reluctant respect, then \
make the AI uncomfortable about admitting it.`,
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

// ---------------------------------------------------------------------------
// Fallbacks (used when the model errors or returns unparseable output)
// ---------------------------------------------------------------------------

export const FALLBACK_MOOD = 'tired and bored';

export const FALLBACK_ACHIEVEMENTS: Achievement[] = [
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

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

export function pickRandom<T>(arr: ReadonlyArray<T>): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

function buildForbiddenBlock(recentTitles: string[], recentSnippets: string[]): string {
    const titles = recentTitles.filter(t => t.trim().length > 0).slice(0, 12);
    const snippets = recentSnippets.filter(s => s.trim().length > 0).slice(0, 6);
    if (titles.length === 0 && snippets.length === 0) return '';
    const lines: string[] = [];
    if (titles.length > 0) {
        lines.push(`TITLES/PATTERNS ALREADY USED — do not reuse the title structure, key noun, or punchline shape: ${titles.join(' | ')}`);
    }
    if (snippets.length > 0) {
        lines.push(`ANGLES ALREADY TAKEN — do not approach the activity from these directions again (find a completely different entry point): ${snippets.join(' | ')}`);
    }
    return lines.join('\n') + '\n\n';
}

export function buildPrompt(
    activity: string,
    style: string,
    recentTitles: string[],
    recentSnippets: string[],
): { prompt: string; mood: string } {
    const styleInstruction = STYLES[style] ?? STYLES.default;
    const mood = pickRandom(MOODS);
    const snark = pickRandom(SNARK_LEVELS);
    const formProfile = pickRandom(FORM_PROFILES);
    const seedPhrase = pickRandom(SEED_PHRASES);
    const forbiddenBlock = buildForbiddenBlock(recentTitles, recentSnippets);
    const prompt = BASE_TEMPLATE
        .replace('{{MOOD_LOCK}}', mood)
        .replace('{{SNARK_LOCK}}', snark)
        .replace('{{FORM_PROFILE}}', formProfile)
        .replace('{{FORBIDDEN_BLOCK}}', forbiddenBlock)
        .replace('{{SEED_PHRASE}}', seedPhrase)
        .replace('{{STYLE_INSTRUCTION}}', styleInstruction)
        .replace('{{ACTIVITY}}', activity);
    return { prompt, mood };
}

export function parseAchievements(text: string): { achievements: Achievement[]; framing: string } {
    const clean = text.trim()
        .replace(/^```json\s*\n?/, '').replace(/\n?```$/, '')
        .replace(/^```\s*\n?/, '').replace(/\n?```$/, '');

    const filterAchievements = (arr: unknown[]): Achievement[] =>
        arr.filter((a): a is Achievement =>
            !!a && typeof (a as Achievement).title === 'string' &&
            typeof (a as Achievement).description === 'string' &&
            typeof (a as Achievement).reward === 'string'
        ).slice(0, 3);

    const objMatch = clean.match(/\{[\s\S]*\}/);
    if (objMatch) {
        try {
            const parsed = JSON.parse(objMatch[0]);
            if (parsed && Array.isArray(parsed.achievements)) {
                return {
                    achievements: filterAchievements(parsed.achievements),
                    framing: typeof parsed.framing === 'string' ? parsed.framing.trim() : '',
                };
            }
        } catch { /* fall through to array parse */ }
    }

    const arrMatch = clean.match(/\[[\s\S]*\]/);
    if (!arrMatch) throw new Error('No valid JSON found');
    const parsed = JSON.parse(arrMatch[0]);
    if (!Array.isArray(parsed)) throw new Error('Not an array');
    return { achievements: filterAchievements(parsed), framing: '' };
}
