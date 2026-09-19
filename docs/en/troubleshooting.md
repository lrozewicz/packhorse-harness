# Troubleshooting

**English** · [Polski](../pl/troubleshooting.md) · [← README](../../README.md)

## Diagnostics

```bash
./bin/harness doctor                  # detected platform, Docker engine, GPU, overlays, .env values
./bin/harness status                  # services + router /healthz (mode, models, request counters)
./bin/harness logs router             # one line per request: path, model, target, status, time, auth
./bin/harness logs litellm            # Anthropic -> OpenAI translation errors
HARNESS_LOG_LEVEL=debug ./bin/harness regen   # + request fields and applied rewrites
./bin/harness compose exec router node -e 'fetch("http://127.0.0.1:8787/healthz").then(r=>r.text()).then(console.log)'

# browser not working in a session? check playwright-cli without the model:
./bin/harness shell -c "playwright-cli -s=t open https://example.com && playwright-cli -s=t --raw eval 'document.title'; playwright-cli -s=t close"

# what the harness/image/host layers put into ~/.claude:
./bin/harness shell -c 'cat ~/.claude/.harness-links; cat /etc/claude-code/managed-settings.d/05-host-settings.json'
```

## Common symptoms

| symptom | cause / fix |
| --- | --- |
| `API Error: Connection refused` when `claude` starts | the router is down — `./bin/harness up` (the entrypoint waits up to 30 s for `/healthz`) |
| `404 … /responses` | `use_chat_completions_url_for_anthropic_messages` in `litellm/config.base.yaml` |
| `AuthenticationError` from LiteLLM | the `api_key_env` variable is missing in `.env`; `harness-init` prints a warning with its name |
| model missing from `/model` | `./bin/harness regen` not run, or the `id` contains `haiku` |
| `[claude-code:unrecognized_model]` | missing or wrong `behaves_as` |
| `Chromium distribution 'chrome' is not found` | `playwright-cli` without `browserName: chromium` (see [Container tooling](container-tooling.md)) |
| agent fails with *"would be spawned with zero tools"* | the agent lists MCP tools whose server is not in the session — use `Bash` + `playwright-cli`, or add the server to `claude/mcp.json` |
| `pull access denied for packhorse/router` on the first run | the router image did not exist yet and `compose run` tried to pull it; `./bin/harness` builds both images first — if you call `docker compose run` directly, run `docker compose build` before |
| external models missing from `/model` on a company account, `claude -p --model <id>` prints `[claude-code:unrecognized_model]` | the organization's remote managed settings outrank the harness drop-in; the entrypoint mirrors `modelPicker` into user settings — check with `./bin/harness shell -c 'jq -c .modelPicker ~/.claude/settings.json'` (see [Models](models.md#how-models-appear-in-model)) |
| `nvidia-container-cli: initialization error: WSL environment detected but no adapters were found` (or another GPU prestart error) | the GPU overlay is on although no GPU works in containers — it is added automatically only after a successful probe, so check `HARNESS_GPU` in `.env` (`on` forces it) or set `HARNESS_GPU=off` |
| GPU not visible in the container | `./bin/harness doctor` shows why: no NVIDIA driver on the host, or the driver is there but `docker run --gpus all` fails (install `nvidia-container-toolkit`, then run `doctor` again) |
| changes to `.env` or `models.yaml` ignored | LiteLLM reads its config only at start — use `./bin/harness regen`, not `docker compose restart` |

## Known pitfalls (already handled)

- **`404 /v4/responses` from LiteLLM.** For the `openai` provider LiteLLM maps `/v1/messages` to the **Responses API** by default, while "coding" endpoints (z.ai, DeepSeek, Moonshot, vLLM, sglang) only have `/chat/completions`. Fixed in `litellm/config.base.yaml` with `use_chat_completions_url_for_anthropic_messages: true`. For a provider that has *only* the Responses API, set it to `false` and use `api: openai-responses`.
- **`reasoning effort high` → 400.** LiteLLM converts `thinking.budget_tokens` into `reasoning_effort`; a large budget becomes `high`, which a backend may not know. Hence `thinking: strip` by default (set the reasoning level through `extra_body`).
- **`max_tokens` above the model's real output.** The router caps it to `max_output_tokens` from `models.yaml` — only for LiteLLM traffic, so Opus/Sonnet keep their full window.
- **`WebSearch`/`WebFetch` must go to Anthropic.** These tools run on Anthropic's side; in `hybrid` mode the router detects server-side tool types and routes such requests to Anthropic with `anthropic_fallback_model`.
- **Client disconnect mid-SSE** does not leave an unhandled `AbortError` — the stream goes through `stream/promises.pipeline` with its own `catch`, and uncaught errors are logged without killing the process.
- **`docker compose restart` does not reload configuration or rebuild the router** — `./bin/harness regen` uses `run --build` and `up -d --force-recreate --wait`.
- **Named volumes mount as `root:root`**, so Claude Code could not save the login — the entrypoint fixes the owner of `~/.claude` before dropping root (`gosu`).
- **`tini` with `pid: host`** is not PID 1; it runs with `-s` (child subreaper) to avoid a warning on every start.
- **An empty `ANTHROPIC_AUTH_TOKEN`** would be treated as a provided key — the entrypoint unsets it when empty.
- **Managed settings cannot start a local MCP server** — hence registration through `claude mcp add-json --scope user` (see [Container tooling](container-tooling.md#mcp-servers)).
- **`pip install` on Debian hits PEP 668** — the image sets `PIP_BREAK_SYSTEM_PACKAGES=1`.
- **Provider keys stay out of generated files and images** — `.env` is git-ignored, LiteLLM gets `os.environ/<VAR>` references, and only the LiteLLM container sees the values.
