# Host access

**English** · [Polski](../pl/host-access.md) · [← README](../../README.md)

> [!WARNING]
> **This is not a sandbox.** The container isolates tool versions and the Claude Code configuration, but it does not isolate the host: `privileged` + `pid: host` + `/host` + `docker.sock` + `sudo` add up to root-equivalent access to the machine. That is the point of the project — use it only where that is acceptable.

## What the `claude` service gets

The service in [`docker-compose.yml`](../../docker-compose.yml) is privileged on purpose. Platform-specific binds (`/host`, `/dev`, `/sys`, `/run/udev`, `/etc/localtime`) live in the overlay `docker-compose.linux.yml`, enabled through `COMPOSE_FILE` in `.env`.

| setting | what it gives |
| --- | --- |
| `privileged: true` + `cap_add: ALL` + `seccomp/apparmor=unconfined` | all capabilities, unmasked `/dev`, `strace`, `hdparm`, `smartctl` |
| `pid: host` | `ps` sees host processes and `kill` stops them (PID 1 in the container is the host's `systemd`) |
| `ipc: host`, `cgroup: host`, `userns_mode: host` | shared memory (X11/CUDA IPC), cgroup statistics, UIDs 1:1 with the host |
| `gpus: all` (overlay `docker-compose.gpu.yml`, added automatically when a GPU works) + `NVIDIA_DRIVER_CAPABILITIES=all` | `nvidia-smi` in the container: VRAM, utilisation, temperature |
| `/:/host` (`rslave`) | the whole host filesystem under `/host` (`df -h /host`, `ncdu /host`) |
| `/dev`, `/sys`, `/run/udev` | disks (`lsblk`, `nvme`, `smartctl`), sensors (`sensors`), PCI (`lspci`) |
| `/var/run/docker.sock` | `docker ps`, `docker logs`, restarting host containers (client in the image) |
| user `claude` = host UID/GID + passwordless `sudo` | files in `/workspace` get the right owner, and root is one `sudo` away |

The image also contains diagnostic tools: `procps psmisc htop lsof strace sysstat lm-sensors dmidecode smartmontools nvme-cli hdparm ncdu parted pciutils usbutils iproute2 dnsutils ripgrep fd-find jq docker`. `./bin/harness hostinfo` prints a one-screen summary.

## Mounts

All entries below are **bind mounts** — the same files, not copies. Writing to `/workspace/foo` writes to the host disk immediately, as the host UID.

| in the container | on the host | mode |
| --- | --- | --- |
| `/workspace` (session start directory) | `WORKSPACE_DIR` from `.env` (default `..`) | read-write |
| `/host` | Linux: the **whole** `/` (`rslave`) · Windows: `HOST_DRIVE`, default `C:/` | read-write |
| `/harness/models.yaml`, `/harness/generated`, `/harness/examples`, `/harness/claude/*` | harness files from this repo | read-only |
| `/harness/host-claude` | host `~/.claude` (see [Claude Code configuration](claude-configuration.md)) | read-only |
| `/var/run/docker.sock` | host Docker socket | read-write |
| `~/.claude` (login, history, settings) | Docker volume `packhorse-config` — **not** a host directory | read-write |

Login and history live in a Docker volume rather than in your host `~/.claude`, so the session in the container does not mix with a Claude Code installed on the machine.

`WORKSPACE_DIR` is the default place to work, **not a boundary**: through `/host` (plus `sudo` and `pid: host`) the container reaches the whole host filesystem, including `/host/home/<user>/.ssh` and `/host/etc`.

## Networking

The container sits on the Compose network (`packhorse`) so it can reach `router` and `litellm` by name. Services on the host's loopback are reachable as `host.docker.internal`. When you need **exactly** the host network namespace:

```bash
sudo nsenter -t 1 -n -- ss -tlnp        # run inside the host's network namespace
```

The LiteLLM port is not published on the host; uncomment `ports` in `docker-compose.yml` only while debugging.

## Scaling access down

From the cheapest change to the most restrictive:

1. remove `privileged` and `cap_add` from `docker-compose.yml`,
2. remove `pid: host`,
3. remove the `/:/host` bind from `docker-compose.linux.yml`,
4. remove the `docker.sock` mount.

Compose overlays can only add or replace entries (the mount key is `target`), never remove them — which is why platform-specific binds live in separate overlay files.
