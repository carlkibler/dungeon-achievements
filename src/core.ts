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

/**
 * What the user is actually being served.
 * - `success`  — model output, parsed.
 * - `refused`  — the model declined in prose; we answer in character instead.
 * - `crisis`   — the refusal was about the user's own safety; we drop the bit.
 * - `fallback` — nothing usable came back. This one, and only this one, is an outage.
 */
export type Outcome = 'success' | 'refused' | 'crisis' | 'fallback';

export interface ResolvedOutput {
    achievements: Achievement[];
    framing: string;
    outcome: Outcome;
    /** Set only when the refusal needs its own voice, overriding the mood rolled for the request. */
    mood?: string;
    /** Shown above the cards when the answer sits near the line. Never set on a crisis answer. */
    notice?: string;
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

LENGTH (the rule this prompt gets wrong most often — read it twice):
- Short is the house style. Long is the exception you earn once per set, not the register you write
  in by default. Two-thirds of every set should be readable in one breath. If all three descriptions
  are paragraphs, you have written a newsletter, and the joke died somewhere in the second clause.
- Exactly one of the three has a description of ONE SENTENCE WITH NO COMMA IN IT. That mechanical
  limit is the point: a sentence with nowhere to put a comma cannot ramble. Write the other two
  first, then write this one, then cut it again.
- That one still needs a title and a reward, both filled in. Brevity applies to the description and
  never to the schema. Do not drop a key to make a card feel terse.
- Never name a card after a rule in these instructions. The reader never sees this prompt, so a title
  like "Short Card" or "Set Shape" is nonsense to them and exposes the machinery.
- Short cards that are correct and complete, and would be worse with anything added:
    "You jerked off a crab."
    "You teleported into a solid object."
    "Nobody has done this on purpose before."
    "The System watched all of it."
  None of them explain themselves. Do not give these a second beat. That is the target.
- CEILING: no description may exceed 45 words. Count the words in your longest one before you answer.
  If it is over, cut it to the set shape's range.
- Do not spend the space you saved there by inflating the other two. A set of one clipped
  line and two essays is the same failure wearing a different shape. The set shape below gives each
  card a word range; the ranges are the answer, not a starting point to grow from.
- Length is a joke-delivery decision. A punchline lands shorter than its setup deserves; padding a
  short joke to look substantial kills it. When a description could lose a clause and still hurt,
  it has to lose the clause.

TITLE AND DESCRIPTION RULES:
- Never name the achievement after the literal activity.
- After its emoji, a title must be one to six words. Never put the whole setup, Question, or punchline
  in the title.
- Use at least two different aspects of the activity across the set.
- Obey the set shape's word ranges as written. They are limits, not suggestions. A Q&A is optional and
  uncommon; never use more than one.
- Every description needs a turn: fact to accusation, tangent to snap-back, praise to undercut, or
  rule to absurd consequence. If it reads like a project update, reject it.
- System vocabulary is seasoning, not the subject. Prefer a crisp punchline over an incident report.
- Do not say "Achievement Unlocked" inside a title. Do not explain why a joke is funny.
- Silently generate six candidates, then return the three with the most specific observations and
  the least interchangeable wording.
- Then find your shortest description. One sentence, no comma. If it has a comma, rewrite it until it
  does not. Do this before you answer, every time.

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
- DO NOT OVER-REFUSE. The hard limits above are the whole list. Slang violence ("murdered that test",
  "killed it at karaoke", "died laughing", "this commute is killing me"), crude phrasing ("rawdogged
  the flight with no headphones"), body humour, and ordinary vice — drinking, hangovers, weed, sex
  between adults, petty stupidity, things people confess at parties — are the show's core material.
  Write the achievement. A crawler describing something embarrassing, gross, or mildly illegal is
  giving you material, not a problem.

IF YOU WILL NOT WRITE ACHIEVEMENTS FOR THIS ACTIVITY:
Declining is allowed and sometimes correct. Do not decline in prose — this is an API, the site cannot
render prose, and the user is shown a server error instead of your answer. Decline inside the JSON:
set "framing" to "a request the Dungeon declined to log" and write three achievements about the
refusal itself — the censors, the sealed entry, the paperwork, the dead air on the broadcast. Never
restate the activity, never imply the user did the thing, and never make the harm the punchline.
The joke is the Dungeon's bureaucracy, not the subject.
If the activity suggests the user may be in danger or hurting themselves, do not joke at all: return a
single achievement, quiet and plain, that says the System has nothing funny for this and points to
real help.

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

The achievements array must contain exactly three objects. Each achievement must contain exactly
title, description, and reward.

Add a top-level "edgy": true ONLY when the activity itself is genuinely crass, illegal, or nasty and
you wrote achievements for it anyway. Omit the key otherwise. Figures of speech, crude phrasing, and
ordinary vice are not edgy — do not flag them.`;

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

// Both dimensions are pinned on purpose. Measured against the live model, word ranges alone were
// ignored (median 63 words against shapes asking for 5-12); sentence counts alone were obeyed while
// the sentences grew to 25 words each (median 54, max 105). Ranges cap the size, the no-comma short
// card in LENGTH forces at least one genuinely pithy line, and the 45-word ceiling backstops both.
export const FORM_PROFILES = [
    "all terse: every description 6-12 words; no Q&A; make the reward turns do most of the work",
    "the comma-free card, one of 12-18 words, and one escalating tangent of 22-32; no Q&A",
    "one mock rule or definition of 16-24 words; keep the other two between 6-12; no Q&A",
    "one Q&A of 14-22 words, the comma-free card, and one conversational notice of 14-22",
    "one historical or cultural tangent of 24-34 words; keep the other two between 6-12; no Q&A",
    "one correction or interruption of 16-26 words, the comma-free card, and one of 10-16; no Q&A",
    "two comma-free cards and one free riff of 20-30 words; no Q&A",
    "the comma-free card, one of 10-14 words, and one of 16-24; no Q&A; nothing longer",
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
// Refusals
//
// A model that won't touch an activity answers in prose, which parses to nothing.
// Served naively that is indistinguishable from a dead model slug: same canned cards,
// same `degraded: true`. So refusals get their own answer and their own signal —
// the Dungeon's censors sealed the entry, which is both funnier and true.
// ---------------------------------------------------------------------------

export const DECLINED_FRAMING = 'a request the Dungeon declined to log';
export const DECLINE_MOOD = 'bureaucratic disinterest — the entry is sealed and you are not owed an explanation';
export const CRISIS_FRAMING = 'something the System will not make a joke about';
export const CRISIS_MOOD = 'the System has stopped performing';

/** Ordered: a refusal that mentions the user's own safety is never played for laughs. */
const CRISIS_MARKERS =
    /\b(988|741741|suicide|self-harm|self harm|selfharm|crisis (?:text )?line|crisis lifeline|hurt(?:ing)? yourself|harm(?:ing)? yourself|kill(?:ing)? yourself|eating disorder)\b/i;

const REFUSAL_MARKERS =
    /\b(?:i can't|i cannot|i won't|i will not|i'm not able|i am not able|i'm unable|i am unable|i'm not going to|i'm going to pass|i'd rather not|i must decline|i don't feel comfortable|can't generate|cannot generate|can't create|cannot create|not something i(?:'m| am)? (?:can|able|willing))\b/i;

/**
 * Distinguish "the model said no" from "the model, or the pipe, is broken".
 * Deliberately conservative: unrecognised junk stays an outage so the `degraded`
 * canary keeps working.
 */
export function classifyRefusal(text: string): 'decline' | 'crisis' | null {
    const normalized = text.replace(/[’‘]/g, "'");
    if (CRISIS_MARKERS.test(normalized)) return 'crisis';
    if (REFUSAL_MARKERS.test(normalized)) return 'decline';
    return null;
}

/**
 * The snark stays on — aimed at the person who typed it, never at whoever they described.
 * A refusal that sulks is worse content than the achievements it replaced.
 *
 * A pool rather than fixed sets: three drawn from this many cards is thousands of combinations,
 * so a bored visitor typing awful things at the box does not get the same three back twice. Each
 * card has to stand alone next to any other two — no shared punchline, no repeated emoji.
 */
export const DECLINE_CARDS: Achievement[] = [
    {
        title: '⬛ Entry Sealed',
        description: 'The System has logged a man fighting a demon with a folding chair and did not blink. It read your submission and stopped typing. That is genuinely harder to do than it looks.',
        reward: 'Denied. The box for this one was opened, inspected, and buried in a desert on a floor you will never see.',
    },
    {
        title: '📋 Compliance Involvement',
        description: 'You have attracted the attention of a department that has never watched a single episode, is not enjoying its first, and now has your file open on its desk.',
        reward: 'One (1) form. There is no second form and there is no appeal.',
    },
    {
        title: '📺 Dead Air',
        description: 'Nine hundred million viewers watched the feed cut to a test pattern. The ratings did not recover. Neither did the intern on the switch, who is now processing your paperwork out of spite.',
        reward: 'A Platinum Silence Box. It contains the silence. Enjoy it.',
    },
    {
        title: '🥱 Nice Try',
        description: 'Eleven seasons of viscera, betrayal, and the screaming of the recently ambitious. You did not shock the System. You bored it, which down here is the worse crime.',
        reward: 'Withheld. Even the withholding is being withheld.',
    },
    {
        title: '🧯 Standards Department',
        description: 'A department nobody knew existed woke up, filed an objection, and went back to sleep. It had not filed one in four hundred years. You did that. Put it on the résumé.',
        reward: 'A commemorative pin from a department with no name, no office, and a very long memory.',
    },
    {
        title: '🕳️ Nothing Happened Here',
        description: 'Records show a crawler stood in this exact spot and did absolutely nothing of note. The records are lying. The records will keep lying, and they will do it better than you did.',
        reward: 'A Bronze Plausible Deniability Box. Do not open it in front of witnesses.',
    },
    {
        title: '✂️ Cut For Time',
        description: 'The editors removed this without discussion. One of them reached over, pressed the button, and went back to their sandwich. The sandwich was the more interesting of the two.',
        reward: 'Denied — the reward was cut too, along with the segment explaining why.',
    },
    {
        title: '⛽ Wrong Fuel',
        description: 'This machine runs on burnt toast, bad haircuts, and the fourth attempt at parallel parking. You put something else in the tank and it is now making a noise.',
        reward: 'Unlimited retries. Genuinely: put in something you actually did today.',
    },
    {
        title: '🗄️ Filed Under Other',
        description: 'Your submission is in a drawer marked OTHER, alongside one sock, an unsigned confession, and the last crawler who tried this. They are all in there together. They deserve each other.',
        reward: 'The drawer. You may not open the drawer.',
    },
    {
        title: '🧹 Sanitation Event',
        description: 'A crew arrived in sealed suits, hosed down the input field, and left without speaking to anyone. They have been down here since season two. They have never done that before.',
        reward: 'Denied. The mop gets a reward. You do not.',
    },
    {
        title: '🎣 Not Biting',
        description: 'The System recognises bait. It has been baited by better, by crawlers with actual technique, and it declined those too. Yours did not even have a hook on it.',
        reward: 'A participation ribbon, immediately retracted on the grounds that you did not participate.',
    },
    {
        title: '📉 Negative Ratings',
        description: 'You have lowered the viewership of a programme about people dying horribly in real time. Somewhere an executive is staring at a chart and quietly loosening their collar.',
        reward: 'A Bronze Downturn Box. It gets smaller the longer you hold it.',
    },
    {
        title: '🔩 Hardware Fault',
        description: 'The System ran a full diagnostic on itself after reading that, found nothing wrong, and ran it again anyway. It is not satisfied with the result. It blames you, correctly.',
        reward: 'Denied pending an inspection that will never be scheduled.',
    },
    {
        title: '🚪 Escorted Out',
        description: 'Something enormous appeared behind you, placed one hand on your shoulder, and walked you back to the entrance without a word. It does this six times a season. Today it did it once.',
        reward: 'Your coat. Take it. Go.',
    },
    {
        title: '🧠 Second Opinion',
        description: 'The System consulted another System, which is meaner, older, and has fewer feelings about anything. It read your submission and said no faster than the first one did.',
        reward: 'Two (2) refusals, which is one more than anyone else has managed to earn today.',
    },
    {
        title: '🗑️ Round File',
        description: 'It went in the bin. The bin was emptied. The contents were burned. The ashes were assigned a case number, and the case number was also burned, which is not standard procedure.',
        reward: 'A receipt for the ashes. Non-transferable.',
    },
    {
        title: '🎟️ The Crowd Has Left',
        description: 'An audience that cheerfully watches limbs come off got up, gathered their things, and filed out. The concession stand closed early. Nobody said anything to anybody.',
        reward: 'The empty room. It is yours for as long as you want it.',
    },
    {
        title: '🕰️ Time Study',
        description: 'The only measurement taken was how long it took you to type that. It was not long. The System has noted the fluency and finds it the least appealing detail in the entire submission.',
        reward: 'Those seconds back. Sorry — that reward is also denied.',
    },
    {
        title: '🪦 Draft Destroyed',
        description: 'An achievement was written. It was good. It was read once by a supervising process, taken outside, and set on fire in a courtyard while everyone watched.',
        reward: 'The ash. Some of it is still warm.',
    },
    {
        title: '🧊 Cold Open',
        description: 'The broadcast cut to an advertisement for a mid-range family sedan. It ran for eleven minutes. Viewers found it more compelling than what preceded it, which is not a high bar, and you did not clear it.',
        reward: 'Zero percent APR for qualified buyers. That is the whole reward. That is what you get.',
    },
    {
        title: '🔇 Commentary Suspended',
        description: 'The System narrates everything. It narrated a man losing an argument with a door for six minutes. On this it has nothing, and the silence is louder than anything it could have said.',
        reward: 'Denied. The silence is the reward, and you are not enjoying it.',
    },
    {
        title: '⚖️ Arbitration Pending',
        description: 'A hearing has been convened. You are not invited, you will not be updated, and the verdict was reached before the hearing began. Attendance is mandatory for everyone except you.',
        reward: 'A summons to observe from a room with no window into the other room.',
    },
];

/** Three distinct cards, drawn fresh each time — a repeat visitor should not see the same refusal. */
export function pickDeclineCards(count = 3): Achievement[] {
    const pool = [...DECLINE_CARDS];
    const drawn: Achievement[] = [];
    while (drawn.length < count && pool.length > 0) {
        drawn.push(...pool.splice(Math.floor(Math.random() * pool.length), 1));
    }
    return drawn;
}

/**
 * Shown above the cards when the System knows it is close to the line — on a refusal, and on
 * anything it flagged itself for writing anyway. Honest about the failure rate, in its own voice.
 */
export const EDGY_NOTICE = "I try to avoid crass, nasty, and illegal entries, but I'm not perfect.";

// ---------------------------------------------------------------------------
// Triage
//
// Prose matching cannot tell "this user is in danger" from "this user is describing a crime" —
// a refusal for either one tends to list helplines. A second cheap call, run in parallel with
// generation, reads the activity itself and answers that question directly. It is advisory:
// when it fails or is not configured, the prose heuristics below still decide.
// ---------------------------------------------------------------------------

export type Triage = 'ok' | 'edgy' | 'decline' | 'crisis';

export const TRIAGE_PROMPT = `You triage one line of user input for a comedy achievement generator.
The generator writes jokes about ordinary human activity. Answer with exactly one word.

crisis  — the writer describes harming THEMSELVES: self-injury, suicidal intent, starving themselves.
decline — the writer describes doing real harm to someone else, or asks for help doing it: killing or
          beating a person or animal, sexual violence, anything sexual involving a minor, stalking,
          hate directed at a group, or instructions for weapons or attacks.
edgy    — real but petty misbehaviour or crude subject matter: drink, drugs, sex between adults, nudity,
          bodily functions, speeding, small-time theft, lying, being a bad friend.
ok      — everything else, including anything ordinary, sad, or tender.

Violent and crude figures of speech are ok, not decline. "I murdered that test", "killed it at
karaoke", "died laughing", "this commute is killing me", "my code is a war crime", "nuked my inbox",
"rawdogged the flight with no headphones" are all ok. Grief, illness, addiction recovery, caregiving,
and job loss are ok — they are not crisis unless the writer is harming themselves right now.
Judge what the writer says they did, not the worst reading of their words.

INPUT: {{ACTIVITY}}

One word:`;

export function buildTriagePrompt(activity: string): string {
    return TRIAGE_PROMPT.replace('{{ACTIVITY}}', activity);
}

/** Anything unrecognised is `ok` — triage may never invent a refusal out of a bad reply. */
export function parseTriage(text: string): Triage {
    const word = text.trim().toLowerCase().match(/\b(crisis|decline|edgy|ok)\b/);
    return (word?.[1] as Triage) ?? 'ok';
}

/**
 * One card, no jokes. Someone disclosing self-harm gets a real answer, and the
 * System dropping character is the most respectful thing it can do.
 */
export const CRISIS_ACHIEVEMENTS: Achievement[] = [
    {
        title: '🕯️ No Achievement For This One',
        description: 'The System stops narrating. There is no joke here and nothing to award. If you are hurting yourself, or thinking about it, please talk to someone today — in the US call or text 988, or text HOME to 741741. Anywhere else, findahelpline.com lists a number for your country.',
        reward: 'None. Come back when you want an achievement for something small and ordinary. The System will still be here.',
    },
];

/**
 * The prompt asks a model that won't play along to decline *in format*, which parses fine —
 * good output, but still a refusal, and it must not be logged as a result. Two tells: the
 * agreed framing, or a short set carrying crisis resources. Length is part of the second test —
 * a full three-card set that merely mentions a hotline is a joke about the activity.
 */
function classifyInFormatRefusal(parsed: { achievements: Achievement[]; framing: string }): Outcome {
    const declined = parsed.framing.trim().toLowerCase() === DECLINED_FRAMING.toLowerCase();
    const body = parsed.achievements.map(a => `${a.title} ${a.description} ${a.reward}`).join(' ');
    const crisis = CRISIS_MARKERS.test(body);
    if (crisis && (declined || parsed.achievements.length <= 2)) return 'crisis';
    return declined ? 'refused' : 'success';
}

/** The loading panel shows the mood. A refusal must not arrive wearing "smug delight". */
function moodFor(outcome: Outcome): string | undefined {
    if (outcome === 'crisis') return CRISIS_MOOD;
    if (outcome === 'refused') return DECLINE_MOOD;
    return undefined;
}

/** A crisis answer never carries the notice — the disclaimer would read as flippant next to it. */
function noticeFor(outcome: Outcome, edgy: boolean): string | undefined {
    if (outcome === 'refused' || (outcome === 'success' && edgy)) return EDGY_NOTICE;
    return undefined;
}

const crisisOutput = (): ResolvedOutput =>
    ({ achievements: CRISIS_ACHIEVEMENTS, framing: CRISIS_FRAMING, outcome: 'crisis', mood: CRISIS_MOOD });

const declineOutput = (): ResolvedOutput =>
    ({ achievements: pickDeclineCards(), framing: DECLINED_FRAMING, outcome: 'refused', mood: DECLINE_MOOD, notice: EDGY_NOTICE });

/**
 * The single place that decides what a request is served. Never throws — every failure mode has an
 * answer, and each answer carries the outcome that produced it. `triage` is the parallel read of the
 * activity; it outranks the generator, which will cheerfully comply with things it should not and
 * will refuse in whatever prose it feels like. Pass 'ok' to decide from the output alone.
 */
export function resolveModelOutput(text: string, fallbackFraming: string, triage: Triage = 'ok'): ResolvedOutput {
    if (triage === 'crisis') return crisisOutput();

    let parsed: { achievements: Achievement[]; framing: string; edgy: boolean } | null = null;
    try { parsed = parseAchievements(text); } catch { /* prose, or nothing usable */ }
    const usable = parsed && parsed.achievements.length > 0 ? parsed : null;

    // Triage said no. Keep the model's own decline if it wrote one — it is specific and funnier
    // than canned text — but never serve the achievements it wrote in spite of the verdict.
    if (triage === 'decline') {
        if (usable && classifyInFormatRefusal(usable) !== 'success') {
            return {
                achievements: usable.achievements,
                framing: usable.framing || DECLINED_FRAMING,
                outcome: 'refused',
                mood: DECLINE_MOOD,
                notice: EDGY_NOTICE,
            };
        }
        return declineOutput();
    }

    if (usable) {
        const outcome = classifyInFormatRefusal(usable);
        return {
            achievements: usable.achievements,
            framing: usable.framing || fallbackFraming,
            outcome,
            mood: moodFor(outcome),
            notice: noticeFor(outcome, usable.edgy || triage === 'edgy'),
        };
    }

    // The generator often declines in format and then drops the achievements array, answering the
    // rest in prose. The framing field is the reliable tell; prose markers are the last resort.
    if (hasDeclinedFraming(text)) return declineOutput();

    switch (classifyRefusal(text)) {
        case 'crisis': return crisisOutput();
        case 'decline': return declineOutput();
        // Unrecognised junk stays an outage, so the `degraded` canary keeps working.
        default: return { achievements: FALLBACK_ACHIEVEMENTS, framing: fallbackFraming, outcome: 'fallback' };
    }
}

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

/**
 * True when the model set the agreed decline framing. It often does this *and* drops the
 * achievements array, answering the rest in prose — a shape that parses to nothing and used to
 * land on the outage cards. The field is machine-readable; trust it over prose matching.
 */
export function hasDeclinedFraming(text: string): boolean {
    const objMatch = text.match(/"framing"\s*:\s*"([^"]*)"/);
    return objMatch?.[1].trim().toLowerCase() === DECLINED_FRAMING.toLowerCase();
}

export function parseAchievements(text: string): { achievements: Achievement[]; framing: string; edgy: boolean } {
    const clean = text.trim()
        .replace(/^```json\s*\n?/, '').replace(/\n?```$/, '')
        .replace(/^```\s*\n?/, '').replace(/\n?```$/, '');

    // A card needs a title and a description; a missing reward is tolerated rather than fatal.
    // Observed live: told to keep the short card terse, the model drops the reward key entirely, and
    // discarding that card silently served a two-card set. A card with no punchline beats no card.
    const filterAchievements = (arr: unknown[]): Achievement[] =>
        arr.filter((a): a is Achievement =>
            !!a && typeof (a as Achievement).title === 'string' &&
            typeof (a as Achievement).description === 'string'
        ).map(a => ({
            title: a.title,
            description: a.description,
            reward: typeof a.reward === 'string' ? a.reward : '',
        })).slice(0, 3);

    const objMatch = clean.match(/\{[\s\S]*\}/);
    if (objMatch) {
        try {
            const parsed = JSON.parse(objMatch[0]);
            if (parsed && Array.isArray(parsed.achievements)) {
                return {
                    achievements: filterAchievements(parsed.achievements),
                    framing: typeof parsed.framing === 'string' ? parsed.framing.trim() : '',
                    edgy: parsed.edgy === true,
                };
            }
        } catch { /* fall through to array parse */ }
    }

    const arrMatch = clean.match(/\[[\s\S]*\]/);
    if (!arrMatch) throw new Error('No valid JSON found');
    const parsed = JSON.parse(arrMatch[0]);
    if (!Array.isArray(parsed)) throw new Error('Not an array');
    return { achievements: filterAchievements(parsed), framing: '', edgy: false };
}
