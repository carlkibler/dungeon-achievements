#!/usr/bin/env python3
"""Build a compact, source-linked DCC achievement style corpus from Fandom."""

from __future__ import annotations

import argparse
import html
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path


API = "https://dungeon-crawler-carl.fandom.com/api.php?"
USER_AGENT = "dungeon-achievements-corpus/1.0 (research; carl@carlkibler.com)"


def api(params: dict[str, str]) -> dict:
    url = API + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def clean_wikitext(value: str) -> str:
    value = re.sub(r"<!--.*?-->", "", value, flags=re.S)
    value = re.sub(r"<ref[^>]*>.*?</ref>", "", value, flags=re.I | re.S)
    value = re.sub(r"<[^>]+>", " ", value)
    value = re.sub(r"\{\{(?:cite|ref)\|[^{}]*\}\}", "", value, flags=re.I)
    value = re.sub(r"\[\[(?:[^\]|]+\|)?([^\]]+)\]\]", r"\1", value)
    value = re.sub(r"'{2,5}", "", value)
    value = html.unescape(value)
    return re.sub(r"\s+", " ", value).strip(" \n:;-")


def achievement_template(wikitext: str) -> tuple[str, int] | None:
    start_match = re.search(r"\{\{Achievement\b", wikitext, flags=re.I)
    if not start_match:
        return None
    start = start_match.end()
    depth = 1
    cursor = start
    while depth and cursor < len(wikitext):
        opening = wikitext.find("{{", cursor)
        closing = wikitext.find("}}", cursor)
        if closing < 0:
            return None
        if 0 <= opening < closing:
            depth += 1
            cursor = opening + 2
        else:
            depth -= 1
            cursor = closing + 2
    return wikitext[start : cursor - 2], cursor


def template_field(wikitext: str, name: str) -> str:
    result = achievement_template(wikitext)
    if not result:
        return ""
    template, _ = result
    match = re.search(
        rf"\|[ \t]*{re.escape(name)}[ \t]*=[ \t]*(.*?)(?=\|[ \t]*\w+[ \t]*=|\Z)",
        template,
        flags=re.I | re.S,
    )
    return clean_wikitext(match.group(1)) if match else ""


def lead_context(wikitext: str, title: str, limit: int = 220) -> str:
    result = achievement_template(wikitext)
    if not result:
        return ""
    _, end = result
    lead = wikitext[end:].split("==", 1)[0]
    lead = re.sub(r"\{\{PAGENAME\}\}", title, lead, flags=re.I)
    lead = re.sub(r"\{\{[^{}]*\}\}", "", lead)
    lead = clean_wikitext(lead)
    lead = re.sub(
        rf"^(?:The\s+)?{re.escape(title)}\s+is an achievement awarded to\s+",
        "",
        lead,
        flags=re.I,
    )
    if len(lead) <= limit:
        return lead
    return lead[: limit - 1].rsplit(" ", 1)[0] + "…"


def section(wikitext: str, name: str) -> str:
    match = re.search(
        rf"^==\s*{name}\s*==\s*$(.*?)(?=^==[^=]|\Z)",
        wikitext,
        flags=re.I | re.M | re.S,
    )
    return match.group(1).strip() if match else ""


def excerpt_ai_text(wikitext: str, limit: int = 89) -> str:
    value = section(wikitext, r"AI Description")
    if not value:
        return ""
    value = re.sub(r"(?i)new\s+achievement[.!:]?\s*", "", value)
    value = re.split(r"(?i)\breward\s*:", value)[0]
    value = clean_wikitext(value)
    if len(value) <= limit:
        return value
    return value[: limit - 1].rsplit(" ", 1)[0] + "…"


def reward_from_ai(wikitext: str, limit: int = 120) -> str:
    value = section(wikitext, r"AI Description")
    match = re.search(r"(?i)\breward\s*:\s*(.*)", value, flags=re.S)
    if not match:
        return ""
    reward = clean_wikitext(match.group(1))
    if len(reward) <= limit:
        return reward
    return reward[: limit - 1].rsplit(" ", 1)[0] + "…"


def cited_locations(wikitext: str) -> list[str]:
    locations = []
    pattern = r"\{\{(?:cite|ref)\|\s*(\d+)\s*\|\s*([^}|]+)"
    for book, chapter in re.findall(pattern, wikitext, flags=re.I):
        location = f"book {book}, chapter {clean_wikitext(chapter)}"
        if location not in locations:
            locations.append(location)
    return locations


def page_title(page: dict, wikitext: str) -> str:
    title = template_field(wikitext, "title1")
    if not title or "PAGENAME" in title:
        title = page["title"].removesuffix(" Achievement")
    return title


def source_url(page_title_value: str) -> str:
    slug = page_title_value.replace(" ", "_")
    quoted = urllib.parse.quote(slug, safe="'()!,-")
    return "https://dungeon-crawler-carl.fandom.com/wiki/" + quoted


def normalize_floor(value: str) -> str:
    names = {
        "1": "First Floor",
        "2": "Second Floor",
        "3": "Third Floor",
        "4": "Fourth Floor",
        "5": "Fifth Floor",
        "6": "Sixth Floor",
        "7": "Seventh Floor",
        "8": "Eighth Floor",
        "9": "Ninth Floor",
        "10": "Tenth Floor",
    }
    return names.get(value, value)


def infer_tags(title: str, trigger: str, reward: str, excerpt: str) -> list[str]:
    text = " ".join((title, trigger, reward, excerpt)).lower()
    tags = []
    checks = {
        "combat": r"kill|combat|attack|damage|boss|weapon|blood|slaughter",
        "death-risk": r"death|die|dead|surviv|danger|risk",
        "body-humor": r"body|pee|poop|meat|nipple|vore|smush|feet|foot|toe",
        "sexual-taunt": r"sex|daddy|pervert|orgy|vore|nipple|cock|cuck",
        "authority": r"god|government|official|power|insurgent|assassin",
        "crafting": r"craft|build|construction|trap|explosion|bomb",
        "cowardice": r"coward|flee|chicken|pacifist|failure|fumble",
        "pop-culture-title": r"janet jackson|martha stewart|johnny quest|columbia house|light brigade|locomotive",
        "reward-denial": r"nothing|none|no reward",
    }
    for tag, pattern in checks.items():
        if re.search(pattern, text):
            tags.append(tag)
    return tags


def fetch_records() -> list[dict]:
    category = api(
        {
            "action": "query",
            "list": "categorymembers",
            "cmtitle": "Category:Achievements",
            "cmlimit": "500",
            "format": "json",
        }
    )["query"]["categorymembers"]
    titles = [
        item["title"]
        for item in category
        if item["title"].endswith("Achievement")
        and item["title"] != "Achievement"
        and not item["title"].startswith("Floor ")
    ]

    records = []
    for offset in range(0, len(titles), 20):
        result = api(
            {
                "action": "query",
                "prop": "revisions",
                "rvprop": "content",
                "rvslots": "main",
                "titles": "|".join(titles[offset : offset + 20]),
                "formatversion": "2",
                "format": "json",
            }
        )
        for page in result["query"]["pages"]:
            revisions = page.get("revisions", [])
            if not revisions:
                continue
            wikitext = revisions[0]["slots"]["main"].get("content", "")
            title = page_title(page, wikitext)
            trigger = template_field(wikitext, "for") or lead_context(wikitext, title)
            reward = template_field(wikitext, "reward") or reward_from_ai(wikitext)
            excerpt = excerpt_ai_text(wikitext)
            records.append(
                {
                    "title": title,
                    "floor": normalize_floor(template_field(wikitext, "floor")),
                    "what_happened": trigger,
                    "reward": reward,
                    "ai_text_excerpt": excerpt,
                    "book_locations": cited_locations(wikitext),
                    "style_tags": infer_tags(title, trigger, reward, excerpt),
                    "source": source_url(page["title"]),
                }
            )

    return sorted(records, key=lambda record: record["title"].casefold())


def write_jsonl(records: list[dict], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8", newline="\n") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("corpus/dcc-achievements-derived.jsonl"),
    )
    args = parser.parse_args()
    records = fetch_records()
    write_jsonl(records, args.output)
    print(f"Wrote {len(records)} records to {args.output}")


if __name__ == "__main__":
    main()
