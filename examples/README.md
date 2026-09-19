# Examples

## `agents/glm.md` — a subagent on an external model

The `model:` field of an agent definition accepts a full model `id` from `models.yaml`, so a subagent can run on a different model than the main session.

```bash
# for one project (a directory visible as /workspace)
cp examples/agents/glm.md <project>/.claude/agents/

# for every session in the container (harness config layer)
cp examples/agents/glm.md claude/config/agents/
```

## `agents/web-fetch-glm.md` — the page fetcher on an external model

The same agent as the built-in [`web-fetch`](../claude/config/agents/web-fetch.md) (fetch a page with `playwright-cli`, return clean Markdown), but running on `glm-5.3-flash` instead of Haiku. It works only if that model is defined in `models.yaml`; install it the same way as `glm.md` above.

More: [Models → Subagents on external models](../docs/en/models.md#subagents-on-external-models) · [po polsku](../docs/pl/models.md#subagenci-na-modelach-zewnętrznych)
