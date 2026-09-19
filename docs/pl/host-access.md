# Dostęp do hosta

[English](../en/host-access.md) · **Polski** · [← README](../../README.pl.md)

> [!WARNING]
> **To nie jest piaskownica.** Kontener izoluje wersje narzędzi i konfigurację Claude Code, ale nie izoluje hosta: `privileged` + `pid: host` + `/host` + `docker.sock` + `sudo` to w praktyce dostęp równoważny rootowi. Taki jest cel projektu — używaj go tylko tam, gdzie jest to akceptowalne.

## Co dostaje usługa `claude`

Usługa w [`docker-compose.yml`](../../docker-compose.yml) jest celowo uprzywilejowana. Montowania zależne od platformy (`/host`, `/dev`, `/sys`, `/run/udev`, `/etc/localtime`) siedzą w nakładce `docker-compose.linux.yml`, włączanej przez `COMPOSE_FILE` w `.env`.

| ustawienie | co daje |
| --- | --- |
| `privileged: true` + `cap_add: ALL` + `seccomp/apparmor=unconfined` | wszystkie capabilities, `/dev` bez maskowania, `strace`, `hdparm`, `smartctl` |
| `pid: host` | `ps` widzi procesy hosta, a `kill` je zatrzymuje (PID 1 w kontenerze to `systemd` hosta) |
| `ipc: host`, `cgroup: host`, `userns_mode: host` | współdzielona pamięć (X11/CUDA IPC), statystyki cgroup, UID-y 1:1 z hostem |
| `gpus: all` + `NVIDIA_DRIVER_CAPABILITIES=all` | `nvidia-smi` w kontenerze: VRAM, wykorzystanie, temperatura |
| `/:/host` (`rslave`) | cały system plików hosta pod `/host` (`df -h /host`, `ncdu /host`) |
| `/dev`, `/sys`, `/run/udev` | dyski (`lsblk`, `nvme`, `smartctl`), czujniki (`sensors`), PCI (`lspci`) |
| `/var/run/docker.sock` | `docker ps`, `docker logs`, restart kontenerów hosta (klient jest w obrazie) |
| użytkownik `claude` = UID/GID hosta + `sudo` bez hasła | pliki w `/workspace` mają właściwego właściciela, a root jest o jedno `sudo` dalej |

W obrazie są też narzędzia diagnostyczne: `procps psmisc htop lsof strace sysstat lm-sensors dmidecode smartmontools nvme-cli hdparm ncdu parted pciutils usbutils iproute2 dnsutils ripgrep fd-find jq docker`. `./bin/harness hostinfo` wypisuje podsumowanie na jednym ekranie.

## Montowania

Wszystkie pozycje poniżej to **bind mounty** — te same pliki, nie kopie. Zapis w `/workspace/foo` to natychmiastowy zapis na dysku hosta, wykonany z UID-em hosta.

| w kontenerze | na hoście | tryb |
| --- | --- | --- |
| `/workspace` (katalog startowy sesji) | `WORKSPACE_DIR` z `.env` (domyślnie `..`) | zapis |
| `/host` | Linux: **całe** `/` (`rslave`) · Windows: `HOST_DRIVE`, domyślnie `C:/` | zapis |
| `/harness/models.yaml`, `/harness/generated`, `/harness/examples`, `/harness/claude/*` | pliki harnessu z tego repo | tylko odczyt |
| `/harness/host-claude` | `~/.claude` hosta (zob. [Konfiguracja Claude Code](claude-configuration.md)) | tylko odczyt |
| `/var/run/docker.sock` | socket Dockera hosta | zapis |
| `~/.claude` (logowanie, historia, ustawienia) | wolumen Dockera `packhorse-config` — **nie** katalog hosta | zapis |

Logowanie i historia są w wolumenie Dockera, a nie w Twoim `~/.claude` na hoście, więc sesja w kontenerze nie miesza się z Claude Code zainstalowanym na maszynie.

`WORKSPACE_DIR` to domyślne miejsce pracy, **nie granica**: przez `/host` (plus `sudo` i `pid: host`) kontener sięga całego systemu plików hosta, łącznie z `/host/home/<user>/.ssh` i `/host/etc`.

## Sieć

Kontener stoi w sieci Compose (`packhorse`), żeby widzieć `router` i `litellm` po nazwie. Usługi na loopbacku hosta są dostępne jako `host.docker.internal`. Gdy potrzebna jest **dokładnie** przestrzeń sieciowa hosta:

```bash
sudo nsenter -t 1 -n -- ss -tlnp        # w przestrzeni sieciowej hosta
```

Port LiteLLM nie jest publikowany na hosta; `ports` w `docker-compose.yml` odkomentuj tylko na czas debugowania.

## Jak ograniczyć dostęp

Od najtańszej zmiany do najbardziej restrykcyjnej:

1. usuń `privileged` i `cap_add` z `docker-compose.yml`,
2. usuń `pid: host`,
3. usuń bind `/:/host` z `docker-compose.linux.yml`,
4. usuń montowanie `docker.sock`.

Nakładki Compose potrafią tylko dodawać i podmieniać wpisy (kluczem montowania jest `target`), niczego nie usuwają — dlatego montowania platformowe są w osobnych plikach.
