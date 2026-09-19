---
name: web-fetch
version: 2.0.0
description: "Fetch and parse web pages into Markdown using playwright-cli and Haiku. Use when user wants to fetch, read, scrape, or analyze a web page URL. Triggers include: 'fetch page', 'read page', 'get page', 'open url', 'scrape', 'pobierz stronę', 'przeczytaj stronę', 'otwórz stronę'."
metadata:
  short-description: Fetch web pages as clean Markdown
  compatibility: claude-code
---

# Web Fetch — playwright-cli + Haiku Page Fetcher

Fetches web pages using `playwright-cli` (headless Chromium, no MCP), cleans the HTML, and converts to Markdown using the `web-fetch` Haiku subagent.

## When to use

Use the **web-fetch** agent whenever you need to:
- Fetch / read / scrape a web page
- Get article content from a URL
- Extract links from a page
- Read documentation from a URL
- Analyze page content

**Instead of** using `WebFetch` or `WebSearch` tools for page content, prefer spawning the `web-fetch` agent — it returns clean Markdown and saves tokens in the main session.

## How to use

Spawn the `web-fetch` subagent using the Agent tool:

```
Agent(
  subagent_type: "web-fetch",
  description: "Fetch <url>",
  prompt: "URL: <the-url>\n\nInstruction: <what-to-do>"
)
```

### CRITICAL: Do NOT repeat subagent output

The whole point of this skill is to offload token consumption to the cheap Haiku subagent. After the subagent returns, **DO NOT** copy or repeat the page content in your response.

Instead:
1. Read the subagent result to understand what was fetched
2. Reply with a **brief 1-2 sentence summary** (e.g., "Fetched the BBC News World front page — 35 links in 5 sections.")
3. Tell the user: the full content is available in the subagent result above (ctrl+o to expand)
4. If the user asks follow-up questions about the content, answer from what you read — but still don't dump the full text

This saves the main session's output tokens and keeps its context lean.

### Example prompts for the agent

**Fetch an article:**
```
URL: https://example.com/blog/my-article
Instruction: Fetch the article content
```

**Get links from a page:**
```
URL: https://example.com
Instruction: Get all links from this page
```

**Get full raw HTML (rare):**
```
URL: https://example.com
Instruction: Get the full raw HTML of this page
```

## Prerequisites

In the Packhorse Harness container everything is already in place: `playwright-cli` and a matching Chromium are baked into the image, the global CLI config is set, and the harness settings allow `Bash(playwright-cli:*)`.

To use this skill and the `web-fetch` agent outside the container, you need:

- `playwright-cli` on PATH: `npm install -g @playwright/cli@latest` (https://github.com/microsoft/playwright-cli). Playwright MCP is NOT used.
- A Chromium build matching the CLI's Playwright version: `playwright-cli install-browser chromium`
- Global config `~/.playwright/cli.config.json` with `"browser": {"browserName": "chromium"}` (without it the CLI looks for Google Chrome at `/opt/google/chrome/chrome`) and `"outputDir": "/tmp/playwright-cli"` (keeps auto-snapshots out of the working directory).
- The permission `Bash(playwright-cli:*)` allowed, so the subagent runs without prompts.

## How it works

1. The `web-fetch` agent (running on **Haiku** model) makes ONE Bash call: `playwright-cli open <url>` → `playwright-cli --raw eval '<cleaner>'` → `playwright-cli close`, in a uniquely named browser session (`-s=wf-NNNNNN`), so parallel fetches don't collide
2. **Default mode**: the cleaner runs in the browser and strips non-content tags, junk classes/ids, link-heavy blocks, empty elements and all attributes except `href`/`src`/`alt`; returns `{title, url, truncated, html}` capped at 40 000 chars
3. **Full HTML mode**: returns raw rendered HTML (only when explicitly requested)
4. The Haiku model classifies the page (article vs. links) and converts to structured Markdown
5. Returns `[TYPE: ARTICLE]` or `[TYPE: LINKS]` header followed by Markdown content
