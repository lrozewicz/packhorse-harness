# Rozwiązywanie problemów

[English](../en/troubleshooting.md) · **Polski** · [← README](../../README.pl.md)

## Diagnostyka

```bash
./bin/harness status                  # usługi + /healthz routera (tryb, modele, liczniki requestów)
./bin/harness logs router             # linia na request: ścieżka, model, cel, status, czas, auth
./bin/harness logs litellm            # błędy tłumaczenia Anthropic -> OpenAI
HARNESS_LOG_LEVEL=debug ./bin/harness regen   # + pola requestu i wykonane podmiany
./bin/harness compose exec router node -e 'fetch("http://127.0.0.1:8787/healthz").then(r=>r.text()).then(console.log)'

# przeglądarka nie działa w sesji? sprawdź playwright-cli bez udziału modelu:
./bin/harness shell -c "playwright-cli -s=t open https://example.com && playwright-cli -s=t --raw eval 'document.title'; playwright-cli -s=t close"

# co warstwy harness/obraz/host włożyły do ~/.claude:
./bin/harness shell -c 'cat ~/.claude/.harness-links; cat /etc/claude-code/managed-settings.d/05-host-settings.json'
```

## Typowe objawy

| objaw | przyczyna / rozwiązanie |
| --- | --- |
| `API Error: Connection refused` przy starcie `claude` | router nie działa — `./bin/harness up` (entrypoint czeka na `/healthz` do 30 s) |
| `404 … /responses` | `use_chat_completions_url_for_anthropic_messages` w `litellm/config.base.yaml` |
| `AuthenticationError` z LiteLLM | brak zmiennej z `api_key_env` w `.env`; `harness-init` wypisuje ostrzeżenie z jej nazwą |
| modelu nie ma w `/model` | nie wykonano `./bin/harness regen` albo `id` zawiera `haiku` |
| `[claude-code:unrecognized_model]` | brak lub zły `behaves_as` |
| `Chromium distribution 'chrome' is not found` | `playwright-cli` bez `browserName: chromium` (zob. [Narzędzia w kontenerze](container-tooling.md)) |
| agent pada z *„would be spawned with zero tools”* | agent wymienia narzędzia MCP, których serwera nie ma w sesji — użyj `Bash` + `playwright-cli` albo dodaj serwer do `claude/mcp.json` |
| `pull access denied for packhorse/router` przy pierwszym uruchomieniu | obrazu routera jeszcze nie było, a `compose run` próbował go pobrać; `./bin/harness` najpierw buduje oba obrazy — jeśli wołasz `docker compose run` bezpośrednio, wykonaj wcześniej `docker compose build` |
| brak modeli zewnętrznych w `/model` na koncie firmowym, `claude -p --model <id>` wypisuje `[claude-code:unrecognized_model]` | zdalne managed settings organizacji przykrywają drop-in harnessu; entrypoint kopiuje `modelPicker` do ustawień użytkownika — sprawdź: `./bin/harness shell -c 'jq -c .modelPicker ~/.claude/settings.json'` (zob. [Modele](models.md#skąd-modele-w-model)) |
| `nvidia-container-cli: initialization error: WSL environment detected but no adapters were found` (albo inny błąd GPU przy starcie) | host nie ma karty NVIDIA albo `nvidia-container-toolkit` — zakomentuj `gpus: all` w `docker-compose.yml` |
| GPU niewidoczne | brak `nvidia-container-toolkit` — zakomentuj `gpus: all` w `docker-compose.yml` |
| zmiany w `.env` lub `models.yaml` ignorowane | LiteLLM czyta konfigurację tylko przy starcie — użyj `./bin/harness regen`, nie `docker compose restart` |

## Znane pułapki (już obsłużone)

- **`404 /v4/responses` z LiteLLM.** Dla dostawcy `openai` LiteLLM domyślnie mapuje `/v1/messages` na **Responses API**, a endpointy „coding” (z.ai, DeepSeek, Moonshot, vLLM, sglang) mają tylko `/chat/completions`. Naprawione w `litellm/config.base.yaml` przez `use_chat_completions_url_for_anthropic_messages: true`. Dla dostawcy, który ma *wyłącznie* Responses API, ustaw tam `false` i daj modelowi `api: openai-responses`.
- **`reasoning effort high` → 400.** LiteLLM przelicza `thinking.budget_tokens` na `reasoning_effort`; przy dużym budżecie wychodzi `high`, którego backend może nie znać. Dlatego domyślnie `thinking: strip` (poziom rozumowania ustawiasz przez `extra_body`).
- **`max_tokens` powyżej realnego wyjścia modelu.** Router przycina go do `max_output_tokens` z `models.yaml` — tylko dla ruchu do LiteLLM, więc Opus/Sonnet mają pełne okno.
- **`WebSearch`/`WebFetch` muszą iść do Anthropic.** Te narzędzia działają po stronie Anthropic; w trybie `hybrid` router rozpoznaje typy narzędzi serwerowych i kieruje takie requesty do Anthropic z `anthropic_fallback_model`.
- **Rozłączenie klienta w połowie SSE** nie zostawia nieobsłużonego `AbortError` — strumień idzie przez `stream/promises.pipeline` z własnym `catch`, a nieprzechwycone błędy są logowane bez zabijania procesu.
- **`docker compose restart` nie przeładowuje konfiguracji ani nie przebudowuje routera** — `./bin/harness regen` używa `run --build` oraz `up -d --force-recreate --wait`.
- **Nazwane wolumeny montują się jako `root:root`**, więc Claude Code nie zapisałby logowania — entrypoint poprawia właściciela `~/.claude` przed zrzuceniem roota (`gosu`).
- **`tini` przy `pid: host`** nie jest PID 1; działa z `-s` (child subreaper), żeby nie sypać ostrzeżeniem przy każdym starcie.
- **Pusty `ANTHROPIC_AUTH_TOKEN`** zostałby potraktowany jak podany klucz — entrypoint usuwa pustą zmienną.
- **Managed settings nie uruchomią lokalnego serwera MCP** — stąd rejestracja przez `claude mcp add-json --scope user` (zob. [Narzędzia w kontenerze](container-tooling.md#serwery-mcp)).
- **`pip install` na Debianie odbija się od PEP 668** — obraz ustawia `PIP_BREAK_SYSTEM_PACKAGES=1`.
- **Klucze dostawców nie trafiają do generowanych plików ani obrazów** — `.env` jest w `.gitignore`, LiteLLM dostaje odwołania `os.environ/<ZMIENNA>`, a wartości widzi tylko kontener LiteLLM.
