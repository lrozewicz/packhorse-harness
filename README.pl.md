<div align="center">

<img src="docs/assets/banner.png" alt="Packhorse Harness — harness kontenerowy dla Claude Code z pełnym dostępem do hosta i własnymi modelami przez LiteLLM" width="100%">

*Harness kontenerowy dla Claude Code z pełnym dostępem do hosta i własnymi modelami przez LiteLLM.*

[English 🇬🇧](README.md) · **Polski**

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE) ![Docker Compose](https://img.shields.io/badge/runs%20on-Docker%20Compose-2496ED) ![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20Windows%20(WSL2)-lightgrey)

</div>

---

Packhorse uruchamia [Claude Code](https://code.claude.com/docs/en/overview) w kontenerze Dockera, który **nie odcina Cię od maszyny** — procesy, dyski, CPU/RAM/VRAM i Docker hosta są w zasięgu — i pozwala dołożyć **własne modele** (GLM, Qwen, cokolwiek zgodnego z OpenAI) jako osobne pozycje w `/model`, obok Opusa i Sonneta. Ruch do tych modeli idzie przez [LiteLLM](https://github.com/BerriAI/litellm), który tłumaczy Anthropic Messages API na API dostawcy.

```
                          ┌─ model z models.yaml ──► litellm:4000 ──► dostawca (np. api.z.ai)
 claude ──► router:8787 ──┤                          (Anthropic → OpenAI)
 (kontener)               └─ Opus / Sonnet / Haiku ──► api.anthropic.com  (Twoja subskrypcja, 1:1)
      │
      └─ pid: host · privileged · / hosta w /host · /dev · /sys · GPU · docker.sock
```

## Możliwości

- **Modele zewnętrzne na równych prawach** — jeden wpis w [`models.yaml`](models.yaml) to pozycja w `/model`, trasa w LiteLLM i nazwa do użycia w subagentach (`model: glm-5.3-flash`).
- **Subskrypcja pozostaje nietknięta** — mały router wysyła modele Claude do Anthropic bajt w bajt, a do LiteLLM tylko Twoje modele; token OAuth nigdy nie trafia do proxy. Tryb `standalone` puszcza wszystko przez LiteLLM, bez konta Anthropic.
- **Pełny wgląd w hosta** — `ps`/`kill` na procesach hosta, `nvidia-smi`, `smartctl`, `sensors`, system plików hosta pod `/host` i Docker hosta.
- **Wszystko, czego agent potrzebuje** — Python z `pip` i `uv`, narzędzia diagnostyczne przeglądarka headless przez [`playwright-cli`](https://github.com/microsoft/playwright-cli) (bez serwera MCP) oraz wbudowany subagent `web-fetch`, który zamienia dowolną stronę WWW w czysty Markdown.
- **Warstwowa konfiguracja Claude Code** — harness ma własnych agentów, skille i ustawienia, a opcjonalnie dziedziczy Twoje `~/.claude` z hosta (tylko do odczytu).
- **Linux i Windows** — Docker Engine na Linuksie albo Docker Desktop (WSL2) z Git Bashem.

> [!WARNING]
> **To nie jest piaskownica.** Kontener `claude` jest celowo uprzywilejowany (`privileged`, `pid: host`, system plików hosta, `docker.sock`, `sudo` bez hasła), co w praktyce oznacza uprawnienia roota na hoście. Używaj go na własnych maszynach i przed uruchomieniem przeczytaj [Dostęp do hosta](docs/pl/host-access.md).

## Szybki start

Wymagania: Docker z Compose v2, Bash (na Windows: Git Bash), klucz API co najmniej jednego dostawcy modeli zewnętrznych, opcjonalnie subskrypcja Claude.

```bash
git clone https://github.com/lrozewicz/packhorse-harness.git
cd packhorse-harness
cp .env.example .env         # uzupełnij DOCKER_GID, WORKSPACE_DIR i klucze dostawców (np. ZAI_API_KEY)
./bin/harness claude         # startuje wszystko, czego potrzebuje, potem sesję (w niej /login, potem /model)
```

Pierwsze uruchomienie samo buduje obrazy i startuje generator konfiguracji, LiteLLM i router. Opcjonalnie: `./bin/harness up` stawia usługi osobno i pokazuje ich stan (przydaje się też po aktualizacji, bo przebudowuje router), a `./bin/harness test` wysyła jedno zapytanie do modelu zewnętrznego, żeby sprawdzić klucz dostawcy. `./bin/harness` bez argumentów wypisuje wszystkie komendy. Pełny opis: [Pierwsze kroki](docs/pl/getting-started.md).

## Dokumentacja

| Temat | Co znajdziesz |
| --- | --- |
| [Pierwsze kroki](docs/pl/getting-started.md) | instalacja, `.env`, komenda `./bin/harness`, logowanie, katalog roboczy |
| [Modele](docs/pl/models.md) | dodawanie modelu w `models.yaml`, tryby routera, pozycje w `/model`, subagenci na modelach zewnętrznych |
| [Architektura](docs/pl/architecture.md) | ścieżka requestu, po co router, rola poszczególnych plików |
| [Dostęp do hosta](docs/pl/host-access.md) | uprawnienia, montowania, sieć, jak ograniczyć dostęp |
| [Narzędzia w kontenerze](docs/pl/container-tooling.md) | Python, przeglądarka (`playwright-cli`), serwery MCP |
| [Konfiguracja Claude Code](docs/pl/claude-configuration.md) | warstwy konfiguracji, `claude/config/`, dziedziczenie `~/.claude` z hosta |
| [Windows](docs/pl/windows.md) | Docker Desktop + Git Bash, ograniczenia, końce linii |
| [Rozwiązywanie problemów](docs/pl/troubleshooting.md) | diagnostyka, typowe objawy, znane pułapki |
| [Weryfikacja](docs/pl/verification.md) | co zostało sprawdzone end-to-end, a co nie |

## Licencja i znaki towarowe

Projekt jest udostępniony na licencji [Apache License 2.0](LICENSE) (zob. też [NOTICE](NOTICE)). Obrazy budowane przez harness pobierają zależności (Claude Code, LiteLLM, Playwright, Docker CLI, …) z oficjalnych źródeł; każda z nich ma własną licencję i warunki użytkowania.

Packhorse Harness jest niezależnym projektem, niezwiązanym z Anthropic ani przez nią niepopieranym czy sponsorowanym. „Claude” i „Claude Code” są znakami towarowymi Anthropic, PBC. Docker, Playwright, LiteLLM, GLM i inne nazwy są znakami towarowymi ich właścicieli i służą tu wyłącznie do opisu zgodności.
