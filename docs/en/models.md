# Models

**English** · [Polski](../pl/models.md) · [← README](../../README.md)

## Adding a model

[`models.yaml`](../../models.yaml) is the single source of truth. The default example (GLM 5.3 Flash from z.ai):

```yaml
models:
  - id: glm-5.3-flash                            # name in /model, in the router and in LiteLLM
    label: GLM 5.3 Flash (z.ai)
    description: external model via LiteLLM (outside the subscription)
    api: openai                                  # OpenAI Chat Completions
    upstream_model: glm-5.3-flash                # model name at the provider
    api_base: https://api.z.ai/api/coding/paas/v4
    api_key_env: ZAI_API_KEY                     # name of the variable in .env, not the key
    behaves_as: claude-sonnet-5
    context_tokens: 200000
    max_output_tokens: 65536
    thinking: strip
    extra_body:
      temperature: 0.6
      top_p: 0.95
```

```bash
echo 'ZAI_API_KEY=...' >> .env
./bin/harness regen
./bin/harness test glm-5.3-flash
```

From this one entry the generator (`router/src/generate.js`) produces three files:

| generated file | consumer | content |
| --- | --- | --- |
| `generated/litellm.config.yaml` | LiteLLM | `model_list` + `litellm/config.base.yaml` |
| `generated/managed-settings.json` | Claude Code | the `/model` row (`modelPicker`) + context window |
| `generated/registry.json` | `./bin/harness models`, session hook | overview of what is active |

The router reads `models.yaml` directly, so `id` is **one name used everywhere** — in `/model`, in the router log, as the LiteLLM `model_name` and in the `model:` field of a subagent definition. The secret never lands in a generated file: LiteLLM receives `api_key: os.environ/ZAI_API_KEY`, and only the LiteLLM container knows the value (through `env_file: .env`).

### Per-model fields

| field | meaning |
| --- | --- |
| `api` | `openai` \| `openai-responses` \| `anthropic` \| `gemini` \| any LiteLLM provider prefix |
| `aliases` | extra names routed to this model |
| `match` | regular expression on the requested model name |
| `behaves_as` | which known Claude model's client-side handling to use (default `claude-sonnet-5`) |
| `context_tokens`, `max_output_tokens` | window and output limit; the router caps `max_tokens` to the latter |
| `thinking` | `strip` \| `keep` \| `disabled` |
| `effort` | `strip` \| `keep` \| `low` \| `medium` \| `high` |
| `drop_fields` | request fields removed before forwarding |
| `extra_body` | provider-specific parameters (temperature, reasoning level, …) |
| `litellm_params` | escape hatch — merged last and wins over computed values |

> [!IMPORTANT]
> A model `id` **must not contain the word `haiku`** — Claude Code gates auto mode by model name, and the generator deliberately fails on such an `id`.

## Router modes

`router.mode` in `models.yaml` (or `HARNESS_MODE` in `.env`):

- **`hybrid`** (default) — Opus/Sonnet/Haiku go to `api.anthropic.com` on your **subscription**, byte-for-byte with the OAuth headers; models from `models` go to LiteLLM. Using an external model is an **explicit choice**: its own `/model` row, `model:` in a subagent definition, or `claude --model glm-5.3-flash`.
- **`standalone`** — **all** traffic goes to LiteLLM, no subscription needed. Claude slots are mapped to external models through `router.standalone.{opus,sonnet,haiku,default}`, so requests Claude Code makes on its own (session titles, classifiers) also work. Requires `ANTHROPIC_AUTH_TOKEN=anything` in `.env` (Claude Code has to see some credentials) and cannot serve Anthropic server-side tools (`WebSearch`, `WebFetch`).

In `hybrid` mode, requests that carry Anthropic server-side tools (`web_search`, `web_fetch`, `code_execution`, …) are sent to Anthropic even when a small external model is selected, using `anthropic_fallback_model`. Disable with `router.server_tools_to_anthropic: false`.

## How models appear in `/model`

Claude Code reads `modelPicker` **only** from managed settings, `--settings`/SDK and user settings — not from a project checkout. The container entrypoint therefore installs the generated file as a **managed-settings drop-in**:

```
/etc/claude-code/managed-settings.d/10-harness-models.json   (root:root 0644)
```

Nothing touches `~/.claude/settings.json` in the volume, where your login and own settings live; the drop-in is simply recreated from `generated/managed-settings.json` on every start.

**Accounts with an organization policy.** `modelPicker` is honored only from the *highest* settings source that defines it, with no merging. On a company/Team subscription the organization's remote managed settings (`claude doctor` shows *"Organization policy: Loaded from api.anthropic.com"*) sit above the local drop-in, so the drop-in's rows are silently dropped and `/model` shows only the built-in lineup — even if the organization does not restrict models at all. The entrypoint therefore also mirrors `modelPicker` into the container's **user settings** (`~/.claude/settings.json` in the `packhorse-config` volume; the login lives in `.credentials.json`, so this never touches it). The mirror is refreshed on every start and removed when `models.yaml` defines no models. Limitation: if the organization ever ships its own `modelPicker`, it outranks user settings and the external rows disappear again; the remaining route would be passing `--settings <file>` to `claude`.

It also sets `CLAUDE_CODE_MAX_CONTEXT_TOKENS` (the smallest window among external models). Claude Code reads that variable **only for non-`claude-*` models**, so Opus and Sonnet keep their windows. `behaves_as` removes the `[claude-code:unrecognized_model]` warning and gives sensible default capabilities for an unknown model ID.

## Model awareness in the session

The list of models the assistant "knows" comes from Claude Code's system prompt and cannot be replaced — `/model` rows are UI only. So that the model can answer *"which models are available?"* correctly, a **`SessionStart` hook** ([`claude/bin/harness-context`](../../claude/bin/harness-context)) reads `generated/registry.json` and injects the router mode, the external models with their windows and the current session's model as `additionalContext`. It only adds context — hooks cannot change routing or environment variables.

## Subagents on external models

The `model:` field of a subagent accepts a full model `id` from `models.yaml`, so a subagent can run on a different model than the main session. A ready-made example is [`examples/agents/glm.md`](../../examples/agents/glm.md):

```bash
# for one project (a directory visible as /workspace)
cp examples/agents/glm.md <project>/.claude/agents/

# for every session in the container
cp examples/agents/glm.md claude/config/agents/
```

Resolution order of a subagent's model: `CLAUDE_CODE_SUBAGENT_MODEL` → the call parameter → `model:` from the definition → the session model. If you set `CLAUDE_CODE_SUBAGENT_MODEL`, it overrides `model:` in agent files.

## Notes

- **`/model` saves the choice as the default for new sessions.** After testing an external model, switch back with `/model opus`, otherwise every new session starts on it.
- **No prompt caching for external models** — LiteLLM accepts `cache_control`, but OpenAI-style backends do not implement it, so long contexts are slower than on Anthropic.
