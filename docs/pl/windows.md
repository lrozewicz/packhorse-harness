# Windows (Docker Desktop + Git Bash)

[English](../en/windows.md) · **Polski** · [← README](../../README.pl.md)

> [!NOTE]
> Uruchomione na Windows 11 + Docker Desktop 29.3 (backend WSL2, Compose v5.1) + Git Bash. Pozostałe luki są w [Weryfikacji](verification.md#jeszcze-niesprawdzone); zgłoszenia i poprawki są mile widziane.

Obsługiwany wariant: **Docker Desktop z backendem WSL2, harness uruchamiany z Git Basha, pliki na dysku Windows.** Instalacja jest taka sama. `./bin/harness` wykrywa Git Basha i sam przestawia `.env` na nakładkę windowsową (`COMPOSE_FILE=docker-compose.yml;docker-compose.windows.yml`, `COMPOSE_PATH_SEPARATOR=;`) — także w `.env` skopiowanym z Linuksa. Co możesz chcieć ustawić:

```bash
WORKSPACE_DIR=C:/praca/repozytoria     # ukośniki w PRZÓD
# HOST_DRIVE=C:/                       # co wyląduje pod /host (domyślnie cały dysk C:)
# HOST_CLAUDE_DIR=C:/Users/<user>/.claude
# TZ=Europe/Warsaw                     # na Windows nie ma bindu /etc/localtime
```

Format `WORKSPACE_DIR`: `C:/praca/repozytoria`. Forma Git Basha `/c/praca/...` jest zamieniana automatycznie; **nie** `C:\praca\...` (backslash psuje interpolację). Ścieżka względna `..` też działa — liczona jest od katalogu pliku compose. Unikaj spacji w ścieżce.

**Co działa tak samo:** `/workspace` na dysku Windows, router + LiteLLM + modele zewnętrzne, `/model`, subagenci, `docker ps` na kontenerach Docker Desktop, GPU przez CUDA on WSL (`nvidia-smi` odpowiada, ale temperatura i pobór mocy pokazują `N/A`).

**Czego nie zmieni żadna konfiguracja:** kontenery są linuksowe, więc „host” to maszyna wirtualna WSL2, a nie Windows.

| element | pod Windows |
| --- | --- |
| `pid: host`, `kill` | procesy maszyny wirtualnej, nie Windows |
| `/host` | dysk Windows (`HOST_DRIVE`), ale bez `/proc` i `/sys` Windows |
| `/dev`, `/sys`, `/run/udev` | **nie są montowane** (te ścieżki nie istnieją na Windows) |
| `sensors`, `smartctl`, `nvme`, `lsblk` | brak dostępu do fizycznego sprzętu |
| `free`, `lscpu` | limity maszyny WSL2 (domyślnie ok. 50% RAM), nie wartości hosta |
| `/etc/localtime` | nie montowane — strefę czasową ustaw przez `TZ` w `.env` |

**GPU:** nakładka GPU jest dodawana tylko wtedy, gdy działa `docker run --gpus all`, więc komputer bez karty NVIDIA startuje normalnie (wcześniej kończyło się to błędem *„nvidia-container-cli: initialization error: WSL environment detected but no adapters were found”*).

**`.env` skopiowany z Linuksa** zostanie poprawiony przy następnym uruchomieniu (z nakładką linuksową na Docker Desktop `/host` montowałby korzeń maszyny WSL2 zamiast dysku Windows). `./bin/harness doctor` pokazuje wynik.

## Pułapki Git Basha, które obchodzi `./bin/harness`

- **MSYS przepisuje argumenty wyglądające na ścieżki** (`/v1/messages` → `C:/Program Files/Git/v1/messages`). Skrypt eksportuje `MSYS_NO_PATHCONV=1` i `MSYS2_ARG_CONV_EXCL='*'`.
- **MinTTY nie jest dla Dockera terminalem** (`the input device is not a TTY`) — uruchomienia interaktywne idą przez `winpty` (jest w Git for Windows), a potokowe dostają `-T`.
- **`id -u` w Git Bashu zwraca identyfikator Windows** (np. `197609`) — `HOST_UID`/`HOST_GID` zostają `1000`, bo na montowaniach z dysku `C:` uprawnienia POSIX i tak są emulowane.

## Końce linii

**CRLF psuje skrypty w kontenerze** (`bad interpreter: /usr/bin/env bash^M`). [`.gitattributes`](../../.gitattributes) wymusza LF (`* text=auto eol=lf` plus jawne wpisy dla `bin/harness`, `entrypoint.sh` i skryptów w `claude/bin/`). Jeśli masz już klon z CRLF-ami: `git rm --cached -r . && git reset --hard`.

## Pełny dostęp do hosta pod Windows

Jeśli zależy Ci na pełnym dostępie do hosta, a nie tylko na plikach, trzymaj kod **w systemie plików WSL2** i używaj nakładki linuksowej (`WORKSPACE_DIR=/home/<user>/...`, `COMPOSE_FILE=docker-compose.yml:docker-compose.linux.yml`). Wtedy `pid: host`, `/host`, `sudo` i czujniki odnoszą się do jednego spójnego hosta linuksowego (dystrybucji WSL), a `/workspace` działa z pełną szybkością zamiast przez virtiofs.
