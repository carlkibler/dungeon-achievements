# DCC achievement style corpus

`dcc-achievements-derived.jsonl` contains 149 source-linked records: every named achievement page
in the Dungeon Crawler Carl Fandom wiki's achievement category retrieved on August 12, 2026. The
category had 159 entries: 149 named achievements, eight floor indexes, one system overview, and one
mis-categorized loot-box page. It is meant for prompt design and style analysis, not as a replacement
for the books.

Each record contains:

- `title`: achievement title
- `floor`: dungeon floor, when known
- `what_happened`: the compact trigger or surrounding event
- `reward`: reward or denial of one
- `ai_text_excerpt`: a source excerpt capped below 90 characters
- `book_locations`: book/chapter references found on the page
- `style_tags`: simple deterministic tags useful for sampling and prompt evaluation
- `source`: direct page URL

The short excerpts preserve useful voice signals without reproducing full passages. The titles,
triggers, rewards, and source links are more useful for learning the pattern anyway: observe an
event, interpret it maliciously, escalate through a tangent, then use the reward as another punchline.

## Rebuild

```bash
python3 scripts/build-dcc-achievement-corpus.py
```

The script uses only Python's standard library. It reads the public MediaWiki API and does not save
the full page text.

## Sources, rights, and reliability

The records were retrieved from the community-maintained
[Dungeon Crawler Carl Fandom wiki](https://dungeon-crawler-carl.fandom.com/wiki/Category:Achievements).
Fandom states that community wiki text is generally available under
[CC BY-SA 3.0](https://www.fandom.com/licensing). The achievement wording itself originates in Matt
Dinniman's copyrighted books and remains his. This derived file therefore keeps only very short
excerpts and links back to each page. Do not treat it as permission to redistribute the full text.

Wiki records can contain transcription mistakes, missing rewards, or incomplete citations. Use the
`book_locations` field to verify anything that matters against a licensed copy of the books.

## What the corpus says about the voice

The useful invariant is not “be rude.” The AI converts a measurable event into a hostile theory of
the crawler's character, then makes the reward part of the joke.

Common moves in the retrieved records:

1. **Literal trigger.** Start with the plain thing that happened. The specificity sells the system.
2. **Malicious interpretation.** Recast competence as depravity, cowardice, stupidity, or fetish.
3. **Escalating tangent.** Add a historical fact, cultural reference, fake statistic, or vivid analogy.
4. **Personal turn.** Aim the tangent back at the crawler, their family, or their likely death.
5. **Reward reversal.** Give a precisely named box, deny a reward, or declare the insult itself the reward.

Useful corpus counts:

- 84 rewards explicitly contain “Box.”
- 20 rewards explicitly deny or negate a prize.
- 32 titles use an exclamation mark; five use a question mark.
- Deterministic tags identify at least 47 combat, 21 reward-denial, 19 authority, 17 death-risk,
  12 crafting, 12 body-humor, and 12 sexual-taunt examples. Tags can overlap and are intentionally
  conservative.

The progression is also useful. Early-floor achievements explain mechanics while mocking ordinary
mistakes. Later ones assume shared history, target institutions, interrupt themselves, and reveal the
AI's preferences. Sampling only the loudest late examples produces generic shock comedy; mixing floors
keeps the deadpan system voice underneath it.
