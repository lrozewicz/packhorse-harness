# Architektura

[English](../en/architecture.md) · **Polski** · [← README](../../README.pl.md)

## Usługi

`docker-compose.yml` definiuje cztery usługi w jednej sieci (`packhorse`):

| usługa | rola |
| --- | --- |
| `harness-init` | jednorazowy generator: `models.yaml` → `generated/*`; startuje przed resztą i kończy pracę |
| `litellm` | proxy tłumaczące Anthropic Messages na API zgodne z OpenAI; port 4000 zostaje w sieci |
| `router` | jedyny endpoint, z którym rozmawia Claude Code (`router:8787`); dzieli ruch między LiteLLM i Anthropic |
| `claude` | sam Claude Code, uruchamiany na żądanie przez `./bin/harness claude` (profil Compose `cli`) |

## Ścieżka requestu

```
claude --ANTHROPIC_BASE_URL--> router:8787 --+-- model z models.yaml --> litellm:4000 --> dostawca
                                             +-- Opus/Sonnet/Haiku -----> api.anthropic.com (subskrypcja)
```

Router decyduje dla każdego requestu na podstawie pola `model` (id, `aliases`, `match`), trybu routera i obecności narzędzi serwerowych Anthropic. Zob. [Modele](models.md).

## Dlaczego router, a nie `ANTHROPIC_BASE_URL` wprost na LiteLLM

- **Endpoint jest jeden na sesję.** `ANTHROPIC_BASE_URL` jest globalne, a zmienne per model (`ANTHROPIC_DEFAULT_HAIKU_MODEL`, `CLAUDE_CODE_SUBAGENT_MODEL`, …) ustawiają tylko *nazwę* modelu, nie adres dostawcy.
- **Hooki tego nie zrobią** — dokumentacja mówi wprost: *„No hook can modify environment variables or model/API routing for the session”*.
- Gdyby `ANTHROPIC_BASE_URL` wskazywało wprost na LiteLLM, przez proxy szedłby też ruch subskrypcyjny (z tokenem OAuth). Router dzieli ruch na dwa upstreamy i **token subskrypcji nigdy nie trafia w stronę LiteLLM** — `authorization`, `cookie` i `anthropic-beta` są zdejmowane, a w ich miejsce idzie klucz LiteLLM.
- Druga połowa układu to flaga **`_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL=1`**: bez niej własny base URL jest traktowany jak obcy endpoint i część funkcji first-party się wyłącza. Z nią Claude Code traktuje `router:8787` jak `api.anthropic.com` — czym ten adres w praktyce jest, bo ruch do Anthropic idzie 1:1.

## Układ projektu

| ścieżka | rola |
| --- | --- |
| `models.yaml` | **jedyne źródło prawdy**: tryb routera + definicje modeli zewnętrznych |
| `docker-compose.yml` | cztery usługi |
| `docker-compose.linux.yml` | nakładka Linux: `/` hosta, `/dev`, `/sys`, `/run/udev`, `/etc/localtime`, `~/.claude` hosta (tylko odczyt) |
| `docker-compose.windows.yml` | nakładka Windows: Docker Desktop + Git Bash, dysk Windows pod `/host` |
| `docker-compose.gpu.yml` | nakładka GPU (`gpus: all`), dodawana przez `./bin/harness` tylko wtedy, gdy GPU działa w kontenerach |
| `.env.example` | szablon `.env` (UID/GID, katalog roboczy, flagi, klucze dostawców) |
| `.gitattributes` | wymusza LF w skryptach (CRLF psuje entrypoint) |
| `bin/harness` | interfejs wiersza poleceń (`up`, `claude`, `shell`, `regen`, `test`, …) |
| `router/src/config.js` | wczytanie i walidacja `models.yaml` (+ nadpisania ze środowiska) |
| `router/src/routing.js` | LiteLLM czy Anthropic: aliasy, `match`, sloty, narzędzia serwerowe |
| `router/src/transform.js` | kształtowanie requestu i nagłówków, w tym zdjęcie tokenu subskrypcji |
| `router/src/server.js` | serwer HTTP: proxy, SSE, `/healthz`, `POST /__router/reload` |
| `router/src/generate.js` | `models.yaml` → konfiguracja LiteLLM + managed settings + rejestr |
| `litellm/config.base.yaml` | globalne ustawienia LiteLLM (bez definicji modeli) |
| `claude/Dockerfile` | obraz Claude Code: narzędzia diagnostyczne hosta, klient Dockera, Python, `playwright-cli` |
| `claude/entrypoint.sh` | managed settings + `CLAUDE.md` → czekanie na router → zrzucenie roota → warstwy konfiguracji → MCP |
| `claude/config/` | własna konfiguracja Claude Code harnessu, w tym agent i skill `web-fetch` (zob. [Konfiguracja Claude Code](claude-configuration.md)) |
| `claude/mcp.json` | serwery MCP dokładane do każdej sesji w kontenerze |
| `claude/bin/harness-context` | hook `SessionStart`: mówi modelowi, jakie modele są dostępne |
| `claude/bin/hostinfo` | przegląd hosta z kontenera jedną komendą |
| `generated/` | pliki generowane (w `.gitignore`) — nie edytuj ręcznie |
| `examples/` | przykłady, np. subagent na modelu zewnętrznym |
