# Weryfikacja

[English](../en/verification.md) · **Polski** · [← README](../../README.pl.md)

Testy end-to-end z września 2026 na Pop!\_OS 24.04 z Dockerem 29.8.0, Compose v5.1.4, Claude Code 2.1.277–2.1.278, LiteLLM 1.101.0 i kartą NVIDIA RTX 4070 Ti SUPER.

| test | wynik |
| --- | --- |
| `POST /v1/messages` przez router do GLM (bez streamingu) | `HTTP 200`, `usage {input 24, output 195}` |
| streaming SSE | `HTTP 200 text/event-stream`, 105 zdarzeń: `message_start … message_stop` |
| `POST /v1/messages/count_tokens` | `HTTP 200 {"input_tokens":13}` |
| `reasoning_content` dostawcy jako bloki `thinking` | widoczne w odpowiedzi w formacie Anthropic (mapuje LiteLLM) |
| `claude -p --model glm-5.3-flash` | odpowiedź modelu: *„Jestem agentem Claude Code opartym na modelu GLM, wytrenowanym przez Z.ai”* |
| `tool_use` (Bash + Read, wiele rund) na GLM | 3 kolejne `POST /v1/messages … 200`, zadanie wykonane poprawnie |
| tryb `standalone` | `model=claude-opus-5 slot:opus -> LITELLM(glm-5.3-flash) 200` |
| ruch subskrypcyjny przez router | Claude Code zalogowany (`authMethod: claude.ai`); subagenci na Haiku odpowiadali przez router |
| `nvidia-smi` w kontenerze | GPU, sterownik, zajętość VRAM i temperatura raportowane |
| CPU / RAM / czujniki / dyski | model CPU, RAM, `k10temp`, `df /host` raportowane |
| procesy hosta | `ps` pokazuje `systemd` jako PID 1; `kill -9 <pid hosta>` z kontenera zatrzymał proces |
| `sudo` i grupa Dockera | `sudo -n whoami` → `root`; `docker ps` listuje kontenery hosta |
| managed settings | `harness: managed settings: ["glm-5.3-flash"]` przy każdym starcie, `~/.claude/settings.json` nietknięty |
| hook `SessionStart` (świadomość modeli) | zapytany *„wymień modele dostępne w tej sesji”* GLM wymienił rodzinę Claude **oraz** `glm-5.3-flash` z oknem 200 000 / 65 536 |
| `playwright-cli` w obrazie | `@playwright/cli 0.1.21` → `playwright 1.64.0-alpha`, przeglądarka `chromium-1246` zainstalowana tą samą wersją |
| `playwright-cli` open/eval/close | `"Example Domain"`, snapshot w `/tmp/playwright-cli`, zero plików w `/workspace` |
| wbudowany agent `web-fetch` + skill + reguła w `CLAUDE.md` | prompt *„przeczytaj https://en.wikipedia.org/wiki/Pack_animal i odpowiedz jednym zdaniem”* (bez wymieniania agenta) na Sonnecie → Agent(`web-fetch`) → **jedno** wywołanie `playwright-cli`, `permission_denials: 0`, poprawna lista zwierząt jucznych; z samym skillem (bez reguły w `CLAUDE.md`) model sięgał po `WebFetch`/`curl` |
| subagent pobierający strony (tylko `Bash`) | `claude -p` → Agent → **jedno** wywołanie `playwright-cli … open … --raw eval …`, `permission_denials: 0`, poprawne pierwsze zdanie artykułu z Wikipedii |
| wyrejestrowanie usuniętego serwera MCP | po usunięciu wpisu z `claude/mcp.json` serwer znika z `claude mcp list` |
| warstwy konfiguracji, flaga `1` | `config: 12 items from the harness/image/host layers`; `skills/playwright-cli` → obraz (wygrywa z hostem), pozostałe skille → `/harness/host-claude`; `05-host-settings.json` utworzony |
| warstwy konfiguracji, flaga `0` | tylko warstwa obrazu + `synced`, brak `05-host-settings.json`; powrót do `1` przywraca linki |
| własny plik w wolumenie | prawdziwy `~/.claude/skills/<nazwa>/` nie jest nadpisany ani usunięty przy sprzątaniu |
| Python / pip | `Python 3.11.2`, `pip 23.0.1`, `uv`, `pipx`; `pip install requests` bez venva działa |
| `./bin/harness regen` po zmianie trybu | generator + odtworzenie usług, router raportuje nowy tryb w `/healthz` |

## Jeszcze niesprawdzone

- Ścieżka windowsowa (`docker-compose.windows.yml`, obejścia Git Basha, `.gitattributes`) — zaprojektowana na podstawie architektury Docker Desktop; sprawdzono tylko składnię nakładki, podstawienie `HOST_DRIVE` i parsowanie `COMPOSE_FILE` z `;`.
- Narzędzia serwerowe Anthropic (`WebSearch`) przy wybranym modelu zewnętrznym.
- Auto mode w TUI na modelu zewnętrznym.
- Dostawca udostępniający wyłącznie Responses API.
