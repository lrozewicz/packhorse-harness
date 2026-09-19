# Windows (Docker Desktop + Git Bash)

**English** · [Polski](../pl/windows.md) · [← README](../../README.md)

> [!NOTE]
> Run on Windows 11 + Docker Desktop 29.3 (WSL2 backend, Compose v5.1) + Git Bash. Remaining gaps are listed in [Verification](verification.md#not-verified-yet); reports and fixes are welcome.

Supported setup: **Docker Desktop with the WSL2 backend, the harness run from Git Bash, files on a Windows drive.** Installation is the same; `.env` just selects the second overlay (`./bin/harness` does that itself when it creates `.env`):

```bash
COMPOSE_FILE=docker-compose.yml;docker-compose.windows.yml
COMPOSE_PATH_SEPARATOR=;
WORKSPACE_DIR=C:/work/repositories     # FORWARD slashes
# HOST_DRIVE=C:/                       # what appears under /host (default: the whole C: drive)
# HOST_CLAUDE_DIR=C:/Users/<user>/.claude
# TZ=Europe/Warsaw                     # no /etc/localtime bind on Windows
```

`WORKSPACE_DIR` format: `C:/work/repositories`. **Not** `/c/work/...` (Git Bash form, Compose does not understand it) and **not** `C:\work\...` (backslashes break interpolation). A relative `..` works too — it is resolved from the compose file's directory. Avoid spaces in the path.

**What works the same:** `/workspace` on the Windows drive, the router + LiteLLM + external models, `/model`, subagents, `docker ps` on Docker Desktop containers, GPU through CUDA on WSL (`nvidia-smi` responds, but temperature and power show `N/A`).

**What no configuration can change:** the containers are Linux containers, so "the host" is the WSL2 virtual machine, not Windows.

| element | on Windows |
| --- | --- |
| `pid: host`, `kill` | processes of the VM, not of Windows |
| `/host` | the Windows drive (`HOST_DRIVE`), but without Windows `/proc` and `/sys` |
| `/dev`, `/sys`, `/run/udev` | **not mounted** (these paths do not exist on Windows) |
| `sensors`, `smartctl`, `nvme`, `lsblk` | no access to physical hardware |
| `free`, `lscpu` | WSL2 VM limits (by default ~50% of RAM), not host values |
| `/etc/localtime` | not mounted — set the time zone with `TZ` in `.env` |

**No NVIDIA GPU?** Comment out `gpus: all` in `docker-compose.yml`, otherwise the `claude` container fails to start with *"nvidia-container-cli: initialization error: WSL environment detected but no adapters were found"*.

**Copied `.env` from a Linux machine?** Switch `COMPOSE_FILE`/`COMPOSE_PATH_SEPARATOR` to the Windows overlay (above). With the Linux overlay on Docker Desktop, `/host` binds the WSL2 VM's root instead of the Windows drive.

## Git Bash pitfalls handled by `./bin/harness`

- **MSYS rewrites arguments that look like paths** (`/v1/messages` → `C:/Program Files/Git/v1/messages`). The script exports `MSYS_NO_PATHCONV=1` and `MSYS2_ARG_CONV_EXCL='*'`.
- **MinTTY is not a TTY for Docker** (`the input device is not a TTY`) — interactive runs go through `winpty` (bundled with Git for Windows); piped runs get `-T`.
- **`id -u` in Git Bash returns a Windows identifier** (e.g. `197609`) — `HOST_UID`/`HOST_GID` stay `1000`, since POSIX permissions on `C:` binds are emulated anyway.

## Line endings

**CRLF kills scripts in the container** (`bad interpreter: /usr/bin/env bash^M`). [`.gitattributes`](../../.gitattributes) enforces LF (`* text=auto eol=lf` plus explicit entries for `bin/harness`, `entrypoint.sh` and the scripts in `claude/bin/`). If you already have a clone with CRLF: `git rm --cached -r . && git reset --hard`.

## Full host access on Windows

If you want full host access rather than just files, keep the code **in the WSL2 filesystem** and use the Linux overlay (`WORKSPACE_DIR=/home/<user>/...`, `COMPOSE_FILE=docker-compose.yml:docker-compose.linux.yml`). Then `pid: host`, `/host`, `sudo` and sensors refer to one consistent Linux host (the WSL distro), and `/workspace` runs at full speed instead of through virtiofs.
