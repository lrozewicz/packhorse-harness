# Pierwsze kroki

[English](../en/getting-started.md) · **Polski** · [← README](../../README.pl.md)

## Wymagania

- Docker Engine (Linux) albo Docker Desktop z backendem WSL2 (Windows), Compose v2.
- Bash — na Windows Git Bash (zob. [Windows](windows.md)).
- Klucz API co najmniej jednego dostawcy zgodnego z OpenAI (domyślny przykład to GLM 5.3 Flash z [z.ai](https://z.ai) przez `ZAI_API_KEY`).
- Opcjonalnie: subskrypcja Claude. Bez niej użyj trybu routera `standalone` (zob. [Modele](models.md#tryby-routera)).
- Opcjonalnie: karta NVIDIA z `nvidia-container-toolkit` — wykrywana automatycznie, nic nie trzeba konfigurować.

## Instalacja

```bash
git clone https://github.com/lrozewicz/packhorse-harness.git
cd packhorse-harness
cp .env.example .env
```

Uzupełnij `.env`:

| zmienna | co ustawić |
| --- | --- |
| `WORKSPACE_DIR` | katalog montowany jako `/workspace` (domyślnie `..`, czyli katalog nad tym repo) |
| `LITELLM_MASTER_KEY` | dowolny losowy ciąg; nie opuszcza sieci Compose |
| klucze dostawców | np. `ZAI_API_KEY=...` — nazwy pochodzą z `api_key_env` w `models.yaml` |

Gdy `.env` nie istnieje, `./bin/harness` tworzy go z `.env.example` z losowym kluczem LiteLLM.

### Wykrywanie platformy i GPU

Wszystko, co zależy od maszyny, jest wykrywane przy **każdym** uruchomieniu, więc `.env` skopiowany z innego komputera sam się naprawia:

| co | jak | wynik w `.env` |
| --- | --- | --- |
| platforma | Git Bash na Windows → `windows`, w pozostałych przypadkach `linux` | `COMPOSE_FILE` z `docker-compose.windows.yml` albo `docker-compose.linux.yml` i pasujący `COMPOSE_PATH_SEPARATOR` |
| karta NVIDIA | sterownik NVIDIA na hoście, potem jednorazowe `docker run --gpus all` na lokalnym obrazie (wynik zapamiętany dla danego silnika Dockera w `generated/.gpu-probe`) | `docker-compose.gpu.yml` dodany do `COMPOSE_FILE` tylko wtedy, gdy GPU naprawdę działa w kontenerach |
| tożsamość (Linux) | `id -u`, `id -g`, `getent group docker` | `HOST_UID`, `HOST_GID`, `DOCKER_GID` (zmiana przebudowuje obraz Claude Code) |
| ścieżki (Windows) | forma Git Basha `/c/...` | zamiana na `C:/...` w `WORKSPACE_DIR`, `HOST_DRIVE`, `HOST_CLAUDE_DIR` |

Każda zmiana jest wypisywana (`updated .env: …`). Nadpisania w `.env`: `HARNESS_PLATFORM=linux|windows`, `HARNESS_GPU=on|off` albo `HARNESS_AUTODETECT=0`, żeby plik zostawić w spokoju. `./bin/harness doctor` pokazuje, co wykryto i dlaczego (zawsze ponawia próbę GPU).

## Pierwsza sesja

```bash
./bin/harness claude
```

To wystarczy. Przy pierwszym uruchomieniu komenda buduje obraz Claude Code (ok. 3 GB razem z przeglądarką; `INSTALL_PLAYWRIGHT=0` w `.env` ją pomija), a Docker Compose sam startuje zależności — `harness-init` (generator konfiguracji) → LiteLLM → router — i czeka, aż będą zdrowe. Gdy kończy się ostatnia sesja, usługi, które sama uruchomiła, są z powrotem zatrzymywane — nic nie zostaje w tle.

Komendy opcjonalne:

```bash
./bin/harness up       # stawia usługi osobno i pokazuje ich stan oraz /healthz routera
./bin/harness test     # POST /v1/messages przez router -> LiteLLM -> dostawcę (sprawdza klucz dostawcy)
```

`up` przydaje się przy pierwszym uruchomieniu (zepsuty `models.yaml` albo konfiguracja LiteLLM pokażą czytelny błąd, zanim wystartuje TUI) oraz **po aktualizacji kodu**: przebudowuje obraz routera, a `./bin/harness claude` używa istniejącego. `test` służy wyłącznie diagnostyce.

### Automatyczne zatrzymywanie usług

Jeśli sesja (`claude`, `shell`, `ask`, …) musiała sama uruchomić LiteLLM i router, `./bin/harness` zatrzymuje je po zakończeniu **ostatniej** sesji — także po Ctrl+C albo zamknięciu terminala. Zasady:

- usługi uruchomione jawnie przez `./bin/harness up` albo `restart` działają aż do `./bin/harness down`,
- dopóki otwarta jest inna sesja, usługi zostają; zatrzymuje je ta, która kończy się ostatnia,
- `HARNESS_AUTO_STOP=0` w `.env` (albo w środowisku) wyłącza ten mechanizm.

Ceną jest czas startu: każda nowa sesja po zatrzymaniu czeka, aż LiteLLM znów będzie zdrowy (zwykle 10–20 s). Jeśli często otwierasz sesje, wykonaj raz `./bin/harness up` i zostaw usługi włączone.

W sesji wykonaj `/login` (subskrypcja), potem `/model` — Twoje modele zewnętrzne są na liście obok modeli Claude. Logowanie ląduje w wolumenie Dockera `packhorse-config`, więc przeżywa restarty i nie dotyka `~/.claude` na hoście.

## Komenda `./bin/harness`

`./bin/harness` bez argumentów wypisuje pełną listę. Najczęstsze komendy:

| komenda | co robi |
| --- | --- |
| `./bin/harness claude [args]` | sesja Claude Code w kontenerze (bez argumentów: TUI) |
| `./bin/harness shell` | bash w kontenerze — `ps`, `kill`, `nvidia-smi`, `docker`, `sudo` |
| `./bin/harness hostinfo` | przegląd hosta z wnętrza kontenera (CPU/RAM/VRAM/dyski/temperatury) |
| `./bin/harness regen` | po każdej zmianie `models.yaml`: przeliczenie konfiguracji i restart usług |
| `./bin/harness test [id]` | `POST /v1/messages` przez router do wskazanego modelu |
| `./bin/harness ask <id> "..."` | jednorazowe pytanie przez Claude Code na wybranym modelu |
| `./bin/harness models` | lista aktywnych modeli zewnętrznych |
| `./bin/harness status` / `logs [usługa]` | stan usług, `/healthz` routera, log requestów |
| `./bin/harness up` / `down` / `restart` / `build` | cykl życia usług |
| `./bin/harness doctor` | wykryta platforma, silnik Dockera, GPU, nakładki i wartości `.env` |
| `./bin/harness clean` | `down` + usunięcie wolumenu z logowaniem (uwaga!) |

Wszystko to cienka warstwa na `docker compose`, a `COMPOSE_FILE` w `.env` wybiera nakładkę platformową, więc gołe `docker compose ...` też działa.

## Katalog roboczy

Dwie zmienne w `.env` decydują, gdzie pracuje Claude Code:

```bash
WORKSPACE_DIR=/home/user/repozytoria    # montowany jako /workspace
CONTAINER_WORKDIR=/workspace            # gdzie startuje sesja (np. /workspace/moj-projekt)
```

Zmiana `WORKSPACE_DIR` nie wymaga przebudowy — każde `./bin/harness claude` startuje nowy kontener z nowym montowaniem. `WORKSPACE_DIR` to domyślne miejsce pracy, **nie granica**: cały system plików hosta jest dostępny pod `/host` (zob. [Dostęp do hosta](host-access.md)).

## Dalej

- Dodaj własny model: [Modele](models.md).
- Daj kontenerowi swoich agentów, skille i ustawienia: [Konfiguracja Claude Code](claude-configuration.md).
- Coś nie działa: [Rozwiązywanie problemów](troubleshooting.md).
