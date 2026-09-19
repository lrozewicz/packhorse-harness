# Verification

**English** · [Polski](../pl/verification.md) · [← README](../../README.md)

End-to-end checks run in September 2026 on Pop!\_OS 24.04 with Docker 29.8.0, Compose v5.1.4, Claude Code 2.1.277–2.1.278, LiteLLM 1.101.0 and an NVIDIA RTX 4070 Ti SUPER.

| test | result |
| --- | --- |
| `POST /v1/messages` through the router to GLM (non-stream) | `HTTP 200`, `usage {input 24, output 195}` |
| SSE streaming | `HTTP 200 text/event-stream`, 105 events: `message_start … message_stop` |
| `POST /v1/messages/count_tokens` | `HTTP 200 {"input_tokens":13}` |
| provider `reasoning_content` as `thinking` blocks | visible in the Anthropic-shaped response (mapped by LiteLLM) |
| `claude -p --model glm-5.3-flash` | answer from the model: *"I am a Claude Code agent based on GLM, trained by Z.ai"* (translated from Polish) |
| `tool_use` (Bash + Read, several rounds) on GLM | 3 consecutive `POST /v1/messages … 200`, task completed correctly |
| `standalone` mode | `model=claude-opus-5 slot:opus -> LITELLM(glm-5.3-flash) 200` |
| subscription traffic through the router | Claude Code logged in (`authMethod: claude.ai`); Haiku subagents answered through the router |
| `nvidia-smi` in the container | GPU, driver, VRAM usage and temperature reported |
| CPU / RAM / sensors / disks | CPU model, RAM, `k10temp`, `df /host` reported |
| host processes | `ps` shows `systemd` as PID 1; `kill -9 <host pid>` from the container stopped the process |
| `sudo` and the Docker group | `sudo -n whoami` → `root`; `docker ps` lists host containers |
| managed settings | `harness: managed settings: ["glm-5.3-flash"]` on every start, `~/.claude/settings.json` untouched |
| `SessionStart` hook (model awareness) | asked *"list the models available in this session"*, GLM listed the Claude family **and** `glm-5.3-flash` with its 200 000 / 65 536 window |
| `playwright-cli` in the image | `@playwright/cli 0.1.21` → `playwright 1.64.0-alpha`, browser `chromium-1246` installed by the same version |
| `playwright-cli` open/eval/close | `"Example Domain"`, snapshot in `/tmp/playwright-cli`, no files left in `/workspace` |
| built-in `web-fetch` agent + skill + `CLAUDE.md` rule | prompt *"read https://en.wikipedia.org/wiki/Pack_animal and answer in one sentence"* (agent not named) on Sonnet → Agent(`web-fetch`) → **one** `playwright-cli` call, `permission_denials: 0`, correct list of pack animals; with the skill alone (no `CLAUDE.md` rule) the model went for `WebFetch`/`curl` instead |
| page-fetching subagent (`Bash` only) | `claude -p` → Agent → **one** `playwright-cli … open … --raw eval …` call, `permission_denials: 0`, correct first sentence of a Wikipedia article |
| unregistering a removed MCP server | after deleting the entry from `claude/mcp.json`, the server disappears from `claude mcp list` |
| config layers, flag `1` | `config: 12 items from the harness/image/host layers`; `skills/playwright-cli` → image (wins over host), other skills → `/harness/host-claude`; `05-host-settings.json` created |
| config layers, flag `0` | only the image layer + `synced`, no `05-host-settings.json`; switching back to `1` restores the links |
| own file in the volume | a real `~/.claude/skills/<name>/` is neither overwritten nor removed during cleanup |
| Python / pip | `Python 3.11.2`, `pip 23.0.1`, `uv`, `pipx`; `pip install requests` without a venv works |
| `./bin/harness regen` after a mode change | generator + service recreation, the router reports the new mode in `/healthz` |

## Not verified yet

- The Windows path (`docker-compose.windows.yml`, Git Bash workarounds, `.gitattributes`) — designed from Docker Desktop's architecture; only the overlay syntax, `HOST_DRIVE` substitution and `COMPOSE_FILE` parsing with `;` were checked.
- Anthropic server-side tools (`WebSearch`) while an external model is selected.
- Auto mode in the TUI on an external model.
- A provider that exposes only the Responses API.
