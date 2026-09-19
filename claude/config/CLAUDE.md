# Environment: Packhorse Harness container

You are working inside a Docker container, not directly on the host.

- `/workspace` - working directory (the user's repositories, bind-mounted from the host).
- `/host` - the host filesystem; passwordless `sudo`, `pid: host`, `docker` controls the host's Docker.
- Python: `python3`, `pip` (works without a venv), `uv`/`uvx`, the `html2text` module.
- Browser: `playwright-cli` (headless Chromium, skill `playwright-cli`). There is no Playwright MCP server (`mcp__playwright__*`) here - do not try to install it or run `npx @playwright/mcp`. Automatic snapshots go to `/tmp/playwright-cli`.

## Reading web pages

To read, fetch, scrape or summarise a web page, use the `web-fetch` subagent (Agent tool, `subagent_type: "web-fetch"`, prompt `URL: <url>\n\nInstruction: <what to extract>`) instead of the built-in `WebFetch` tool or `curl`. It loads the page in a real browser (JavaScript-rendered pages work), returns clean Markdown and runs without permission prompts. Do not repeat the fetched content in full in your reply - summarise it and answer from it. Use `WebFetch` only if the user explicitly asks for it.
