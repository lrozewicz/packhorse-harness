# Getting started

**English** · [Polski](../pl/getting-started.md) · [← README](../../README.md)

## Requirements

- Docker Engine (Linux) or Docker Desktop with the WSL2 backend (Windows), Compose v2.
- Bash — on Windows, Git Bash (see [Windows](windows.md)).
- An API key for at least one OpenAI-compatible provider (the default example uses [z.ai](https://z.ai) GLM 5.3 Flash via `ZAI_API_KEY`).
- Optional: a Claude subscription. Without one, use the `standalone` router mode (see [Models](models.md#router-modes)).
- Optional: an NVIDIA GPU with `nvidia-container-toolkit` (otherwise comment out `gpus: all` in `docker-compose.yml`).

## Installation

```bash
git clone https://github.com/lrozewicz/packhorse-harness.git
cd packhorse-harness
cp .env.example .env
```

Edit `.env`:

| variable | what to set |
| --- | --- |
| `HOST_UID`, `HOST_GID` | your `id -u` / `id -g` — files written in the container get the right owner |
| `DOCKER_GID` | `getent group docker \| cut -d: -f3` |
| `WORKSPACE_DIR` | the directory mounted as `/workspace` (default `..`, the parent of this repo) |
| `LITELLM_MASTER_KEY` | any random string; it never leaves the Compose network |
| provider keys | e.g. `ZAI_API_KEY=...` — names come from `api_key_env` in `models.yaml` |

If `.env` does not exist, `./bin/harness` creates it from `.env.example`, fills in the UID/GID, the Docker group and a random LiteLLM key, and picks the platform overlay (Linux or Windows).

## First session

```bash
./bin/harness claude
```

That is all you need. On the first run it builds the Claude Code image (about 3 GB with the browser; set `INSTALL_PLAYWRIGHT=0` in `.env` to skip it), and Docker Compose starts the dependencies on its own — `harness-init` (config generator) → LiteLLM → router — and waits until they are healthy. When the last session ends, the services it started are stopped again, so nothing keeps running in the background.

Optional commands:

```bash
./bin/harness up       # start the services separately and show their status and router /healthz
./bin/harness test     # POST /v1/messages through router -> LiteLLM -> provider (checks the provider key)
```

`up` is handy on the first run (a broken `models.yaml` or LiteLLM config shows up as a clear error before the TUI starts) and **after updating the code**: it rebuilds the router image, while `./bin/harness claude` reuses the existing one. `test` is purely diagnostic.

### Stopping the services automatically

When a session (`claude`, `shell`, `ask`, …) had to start LiteLLM and the router itself, `./bin/harness` stops them again after the **last** session ends — also when you press Ctrl+C or close the terminal. The rules:

- services started explicitly with `./bin/harness up` or `restart` keep running until `./bin/harness down`,
- while another session is still open, the services stay up; the one that ends last stops them,
- `HARNESS_AUTO_STOP=0` in `.env` (or in the environment) turns this off.

The trade-off is start-up time: each new session after a stop waits for LiteLLM to become healthy again (usually 10-20 s). If you open sessions often, run `./bin/harness up` once and leave the services running.

Inside the session run `/login` (subscription), then `/model` — your external models are listed next to the Claude models. The login is stored in the Docker volume `packhorse-config`, so it survives restarts and never touches `~/.claude` on the host.

## The `./bin/harness` command

`./bin/harness` without arguments prints the full list. The most common commands:

| command | what it does |
| --- | --- |
| `./bin/harness claude [args]` | Claude Code session in the container (no args: the TUI) |
| `./bin/harness shell` | bash in the container — `ps`, `kill`, `nvidia-smi`, `docker`, `sudo` |
| `./bin/harness hostinfo` | host overview from inside the container (CPU/RAM/VRAM/disks/temperatures) |
| `./bin/harness regen` | after every change to `models.yaml`: regenerate config and restart services |
| `./bin/harness test [id]` | `POST /v1/messages` through the router to the given model |
| `./bin/harness ask <id> "..."` | one-off question through Claude Code on the chosen model |
| `./bin/harness models` | list active external models |
| `./bin/harness status` / `logs [svc]` | service state, router `/healthz`, request log |
| `./bin/harness up` / `down` / `restart` / `build` | service lifecycle |
| `./bin/harness clean` | `down` + remove the login volume (careful!) |

Everything is a thin wrapper around `docker compose`, and `COMPOSE_FILE` in `.env` selects the platform overlay, so plain `docker compose ...` works as well.

## Workspace

Two variables in `.env` control where Claude Code works:

```bash
WORKSPACE_DIR=/home/user/repositories   # mounted as /workspace
CONTAINER_WORKDIR=/workspace            # where the session starts (e.g. /workspace/my-project)
```

Changing `WORKSPACE_DIR` needs no rebuild — each `./bin/harness claude` starts a fresh container with the new mount. `WORKSPACE_DIR` is the default place to work, **not a boundary**: the whole host filesystem is available under `/host` (see [Host access](host-access.md)).

## Next steps

- Add your own model: [Models](models.md).
- Give the container your agents, skills and settings: [Claude Code configuration](claude-configuration.md).
- Something does not work: [Troubleshooting](troubleshooting.md).
