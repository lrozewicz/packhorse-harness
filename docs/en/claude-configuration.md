# Claude Code configuration

**English** · [Polski](../pl/claude-configuration.md) · [← README](../../README.md)

Claude Code in the container has a single user directory — `~/.claude` in the `packhorse-config` volume (login, history, `/model`). The entrypoint adds **symlinks from further layers** to it. On a name conflict, the first layer wins:

| # | layer | source | what it brings |
| --- | --- | --- | --- |
| 1 | volume | `~/.claude` in the container | whatever you create in the container — real files are never overwritten |
| 2 | **harness** | [`claude/config/`](../../claude/config/) in this repo | `agents/`, `skills/`, `commands/`, `output-styles/`, `CLAUDE.md`, `settings.json` |
| 3 | image | `/usr/local/share/packhorse` | the `playwright-cli` skill matching the CLI in the image |
| 4 | **host** | host `~/.claude` (read-only) | skills, agents, commands, `CLAUDE.md`, permission rules and `env` — when `HARNESS_INHERIT_HOST_CONFIG=1` |

The harness wins over the host because its versions are adapted to the container (paths, Chromium instead of Chrome). **Project** configuration (`.claude/` inside `/workspace` and in directories above a repository) works independently of the layers — that is the regular Claude Code mechanism.

## The harness's own configuration — `claude/config/`

A directory laid out like `~/.claude`, versioned with the harness:

```
claude/config/
├── CLAUDE.md        -> /etc/claude-code/CLAUDE.md (managed memory, always loaded)
├── settings.json    -> managed settings (through the generator, together with models.yaml)
├── agents/          -> symlinked into ~/.claude/agents/   (web-fetch.md)
├── commands/        -> symlinked into ~/.claude/commands/
└── skills/          -> symlinked into ~/.claude/skills/   (web-fetch/)
```

- **Agents, commands, skills** — drop in a file or directory and start a new session (`./bin/harness claude` starts a fresh container); no image rebuild.
- **`CLAUDE.md`** goes to managed memory, so it does not collide with `~/.claude/CLAUDE.md` (neither the volume's own nor the host's).
- **`settings.json`** is the base of the managed settings: the generator merges it with `modelPicker`/`env` computed from `models.yaml`, so **run `./bin/harness regen` after changing it**. Managed settings have the highest precedence — users cannot override them. The harness keeps the `SessionStart` hook and the `Bash(playwright-cli:*)` rule here.

## Inheriting the host configuration — `HARNESS_INHERIT_HOST_CONFIG`

```bash
# .env
HARNESS_INHERIT_HOST_CONFIG=1     # default: the container gets your host configuration
HARNESS_INHERIT_HOST_CONFIG=0     # clean container: only the harness + image layers
HOST_CLAUDE_DIR=/other/path       # optional; default ~/.claude (Windows: %USERPROFILE%/.claude)
```

The host `~/.claude` is always mounted **read-only** at `/harness/host-claude`; the flag decides whether the entrypoint uses it. What is carried over:

- **skills, agents, commands, output styles** — as symlinks (except `skills/synced`: skills synced from claude.ai are downloaded by the container into its own volume),
- **`CLAUDE.md`** — as `~/.claude/CLAUDE.md`, unless the volume has its own,
- **from `settings.json`, only `permissions.allow/deny/ask` and `env`** — as the drop-in `/etc/claude-code/managed-settings.d/05-host-settings.json`. `ANTHROPIC_*`, `CLAUDE_*`, `PATH` and `HOME` are filtered out (they would break routing), and the harness drop-in (`10-…`) loads later, so the harness wins on conflicts.

What is **not** carried over, and why:

- `model`, `hooks`, `statusLine`, `autoMode`, `theme` — they describe the host (paths, models); in the container `/model` and the theme are saved in the volume.
- **plugins** — `installed_plugins.json` stores absolute host paths (`/home/<user>/.claude/plugins/cache/…`) that do not exist in the container. Install plugins inside the container (`/plugin`); they land in the volume.
- skills that reference absolute host paths work only if those paths also exist in the container.

A marker file, `~/.claude/.harness-links`, lists the symlinks created by the harness; every start removes them and creates them again. Turning the flag off or deleting a skill on the host therefore disappears from the container on the next start, while things you added manually in the container stay untouched. The start log shows the result:

```
harness: host settings: {"allow":1,"deny":0,"env":[]}
harness: config: 12 items from the harness/image/host layers
```

Before starting the container, `./bin/harness` creates `~/.claude` on the host if it is missing — otherwise Docker would create it owned by root.
