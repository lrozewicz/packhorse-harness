# Architecture

**English** · [Polski](../pl/architecture.md) · [← README](../../README.md)

## Services

`docker-compose.yml` defines four services on one bridge network (`packhorse`):

| service | role |
| --- | --- |
| `harness-init` | one-shot generator: `models.yaml` → `generated/*`; runs before the others and exits |
| `litellm` | proxy translating Anthropic Messages into OpenAI-compatible APIs; port 4000 stays inside the network |
| `router` | the only endpoint Claude Code talks to (`router:8787`); splits traffic between LiteLLM and Anthropic |
| `claude` | Claude Code itself, started on demand by `./bin/harness claude` (Compose profile `cli`) |

## Request path

```
claude --ANTHROPIC_BASE_URL--> router:8787 --+-- model from models.yaml --> litellm:4000 --> provider
                                             +-- Opus/Sonnet/Haiku --------> api.anthropic.com (subscription)
```

The router decides per request, based on the `model` field (ids, `aliases`, `match`), the router mode and the presence of Anthropic server-side tools. See [Models](models.md).

## Why a router instead of pointing `ANTHROPIC_BASE_URL` at LiteLLM

- **There is one endpoint per session.** `ANTHROPIC_BASE_URL` is global; per-model variables (`ANTHROPIC_DEFAULT_HAIKU_MODEL`, `CLAUDE_CODE_SUBAGENT_MODEL`, …) only set the model *name*, not the provider address.
- **Hooks cannot do it** — the documentation says it explicitly: *"No hook can modify environment variables or model/API routing for the session"*.
- If `ANTHROPIC_BASE_URL` pointed straight at LiteLLM, subscription traffic (with the OAuth token) would also go through the proxy. The router splits traffic into two upstreams and **the subscription token never travels towards LiteLLM** — `authorization`, `cookie` and `anthropic-beta` are stripped and replaced with the LiteLLM key.
- The other half is **`_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL=1`**: without it a custom base URL is treated as a third-party endpoint and some first-party features switch off. With it, Claude Code treats `router:8787` like `api.anthropic.com` — which it effectively is, since Anthropic traffic is forwarded 1:1.

## Project layout

| path | role |
| --- | --- |
| `models.yaml` | **single source of truth**: router mode + external model definitions |
| `docker-compose.yml` | the four services |
| `docker-compose.linux.yml` | Linux overlay: host `/`, `/dev`, `/sys`, `/run/udev`, `/etc/localtime`, host `~/.claude` (read-only) |
| `docker-compose.windows.yml` | Windows overlay: Docker Desktop + Git Bash, Windows drive under `/host` |
| `.env.example` | template for `.env` (UID/GID, workspace, flags, provider keys) |
| `.gitattributes` | forces LF on scripts (CRLF breaks the entrypoint) |
| `bin/harness` | the command-line front end (`up`, `claude`, `shell`, `regen`, `test`, …) |
| `router/src/config.js` | loading and validating `models.yaml` (+ environment overrides) |
| `router/src/routing.js` | LiteLLM or Anthropic: aliases, `match`, slots, server-side tools |
| `router/src/transform.js` | request and header shaping, including stripping the subscription token |
| `router/src/server.js` | HTTP server: proxy, SSE, `/healthz`, `POST /__router/reload` |
| `router/src/generate.js` | `models.yaml` → LiteLLM config + managed settings + registry |
| `litellm/config.base.yaml` | global LiteLLM settings (no model definitions) |
| `claude/Dockerfile` | Claude Code image: host diagnostic tools, Docker CLI, Python, `playwright-cli` |
| `claude/entrypoint.sh` | managed settings + `CLAUDE.md` → wait for router → drop root → config layers → MCP |
| `claude/config/` | the harness's own Claude Code config, including the `web-fetch` agent and skill (see [Claude Code configuration](claude-configuration.md)) |
| `claude/mcp.json` | MCP servers added to every session in the container |
| `claude/bin/harness-context` | `SessionStart` hook: tells the model which models are available |
| `claude/bin/hostinfo` | one-command host overview from the container |
| `generated/` | generated files (git-ignored) — do not edit by hand |
| `examples/` | examples, e.g. a subagent on an external model |
