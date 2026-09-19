# Container tooling

**English** · [Polski](../pl/container-tooling.md) · [← README](../../README.md)

The image exists so that the model does not have to fight the environment mid-task.

## Python

`python3`, **`pip`**, `venv`, `python3-dev`, `pipx`, `build-essential`, the `html2text` module (HTML → Markdown, also as `python3 -m html2text`) and **`uv`/`uvx`**. `~/.local/bin` is on `PATH`, so scripts installed with `pip install` are callable right away.

Debian bookworm blocks system-wide `pip install` (PEP 668, *externally-managed-environment*), which only gets in an agent's way — the image sets `PIP_BREAK_SYSTEM_PACKAGES=1`, so `pip install <pkg>` just works. When you want isolation: `uvx <tool>` (one-off, nothing installed) or `python3 -m venv .venv`.

## Browser: `playwright-cli`

The image contains two tools and **no MCP server**:

- **`playwright-cli`** ([`@playwright/cli`](https://github.com/microsoft/playwright-cli)) — Playwright's command line built for coding agents: `open`, `goto`, `snapshot`, `click`, `eval`, `close`, named sessions `-s=<name>`. Compared with Playwright MCP it does not load ~26 tool schemas or accessibility trees into the context; the model calls it with plain `Bash`. The matching `playwright-cli` skill is shipped by the image (see [config layers](claude-configuration.md)).
- **`playwright`** — the classic CLI (`playwright screenshot`, `playwright codegen`, `playwright install`).

The harness settings pre-allow `Bash(playwright-cli:*)`, so agents and subagents can drive the browser without permission prompts.

Global CLI config baked into the image at `~/.playwright/cli.config.json`:

```json
{
  "browser": { "browserName": "chromium", "isolated": true,
               "launchOptions": { "chromiumSandbox": false } },
  "outputDir": "/tmp/playwright-cli"
}
```

- **`browserName: chromium` is required.** Without it `playwright-cli` looks for the Google Chrome channel (`/opt/google/chrome/chrome`), which is not in the image, and fails with *"Chromium distribution 'chrome' is not found"*. On a host machine the same file does the same job.
- **`outputDir`** sends automatic snapshots to `/tmp`. Without it every `open` leaves a `.playwright-cli/` directory in the working directory, i.e. in your repository. Files with an explicit `--filename` (e.g. `screenshot --filename=x.png`) still land in the working directory.

**The CLI and browser versions must match.** Playwright ties the browser build to the library version (`chromium-<revision>`), and `@playwright/cli` pins its own — often an alpha. The Dockerfile therefore **derives the `playwright` version from `@playwright/cli`'s own dependency** and uses it to install the browser:

```dockerfile
npm install -g @playwright/cli@latest
PW_VERSION="$(node -p "require('/usr/local/lib/node_modules/@playwright/cli/package.json').dependencies.playwright")"
npm install -g "playwright@${PW_VERSION}"
playwright install --with-deps chromium
```

The browser lives in `/opt/ms-playwright`, readable by the non-root user. Quick check:

```bash
./bin/harness shell -c "playwright-cli -s=t open https://example.com && playwright-cli -s=t --raw eval 'document.title'; playwright-cli -s=t close"
```

Playwright adds ~700 MB to the image — `INSTALL_PLAYWRIGHT=0` in `.env` builds without it. `PLAYWRIGHT_BROWSER=firefox` switches the browser (the image and `browserName` in the CLI config follow the same variable).

### Built-in `web-fetch` agent

The harness ships a subagent and a skill that turn any web page into clean Markdown — active in every session in the container:

- [`claude/config/agents/web-fetch.md`](../../claude/config/agents/web-fetch.md) — a Haiku subagent with a single tool, `Bash`. It fetches a page in **one** call (`playwright-cli open` → `eval` → `close`), in a uniquely named browser session so several fetches can run in parallel. The cleaning runs inside the browser: it removes scripts, navigation, cookie banners, ads, link-heavy menus and empty elements, strips attributes except `href`/`src`/`alt`, caps the result at 40 000 characters, and the model converts it to Markdown (`[TYPE: ARTICLE]` or `[TYPE: LINKS]`). Ask for "full HTML" to get the raw rendered page instead.
- [`claude/config/skills/web-fetch/`](../../claude/config/skills/web-fetch/SKILL.md) — tells the main session to delegate page reading to that agent instead of the built-in `WebFetch`, and not to repeat the page content in its own reply, which keeps the main context lean.
- a short rule in [`claude/config/CLAUDE.md`](../../claude/config/CLAUDE.md) (managed memory, loaded in every session) — without it models tend to reach for `WebFetch` or `curl` straight away, even with the skill loaded.

Just ask in a session, e.g. *"read https://example.com/article and summarise it"*. JavaScript-rendered pages work, since the page is loaded by a real browser. The JavaScript in the command contains no single quotes, so the whole call matches the `Bash(playwright-cli:*)` rule and runs without permission prompts.

A variant running on an external model is in [`examples/agents/web-fetch-glm.md`](../../examples/agents/web-fetch-glm.md) (it needs `glm-5.3-flash` in `models.yaml`).

**Turning it off or replacing it:** delete `claude/config/agents/web-fetch.md`, `claude/config/skills/web-fetch/` and the "Reading web pages" section of `claude/config/CLAUDE.md`, or put your own `web-fetch` in `~/.claude/` inside the container — real files in the volume win over the harness layer (see [Claude Code configuration](claude-configuration.md)). A project-level agent (`.claude/agents/web-fetch.md` in your repository) also takes precedence over the harness one.

## MCP servers

Servers listed in [`claude/mcp.json`](../../claude/mcp.json) are registered for every session in the container (`claude mcp add-json --scope user`, once per definition). The list is empty by default — the browser is handled by `playwright-cli`.

- A marker file in the volume (`~/.claude/.harness-mcp-installed`) remembers what the harness added, so `claude mcp remove <name>` is permanent.
- Changing a definition re-registers it; **removing an entry from `mcp.json` unregisters the server** on the next container start.
- Why not managed settings: `managedMcpServers` accepts only http/sse servers (*"command is not allowed in managed settings"*), and `managed-mcp.json` takes **exclusive** control over MCP, silencing every server a user adds later.
