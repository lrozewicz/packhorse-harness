# Narzędzia w kontenerze

[English](../en/container-tooling.md) · **Polski** · [← README](../../README.pl.md)

Obraz jest po to, żeby model nie musiał w trakcie zadania walczyć ze środowiskiem.

## Python

`python3`, **`pip`**, `venv`, `python3-dev`, `pipx`, `build-essential`, moduł `html2text` (HTML → Markdown, także jako `python3 -m html2text`) oraz **`uv`/`uvx`**. `~/.local/bin` jest w `PATH`, więc skrypty z `pip install` są od razu wywoływalne.

Debian bookworm blokuje systemowe `pip install` (PEP 668, *externally-managed-environment*), co dla agenta jest tylko przeszkodą — obraz ustawia `PIP_BREAK_SYSTEM_PACKAGES=1`, więc `pip install <pakiet>` po prostu działa. Gdy zależy Ci na izolacji: `uvx <narzędzie>` (jednorazowo, bez instalacji) albo `python3 -m venv .venv`.

## Przeglądarka: `playwright-cli`

W obrazie są dwa narzędzia i **żadnego serwera MCP**:

- **`playwright-cli`** ([`@playwright/cli`](https://github.com/microsoft/playwright-cli)) — wiersz poleceń Playwrighta pisany pod agentów: `open`, `goto`, `snapshot`, `click`, `eval`, `close`, nazwane sesje `-s=<nazwa>`. W porównaniu z Playwright MCP nie ładuje do kontekstu schematów ~26 narzędzi ani drzew dostępności; model woła go zwykłym `Bash`. Pasujący skill `playwright-cli` dostarcza obraz (zob. [warstwy konfiguracji](claude-configuration.md)).
- **`playwright`** — klasyczne CLI (`playwright screenshot`, `playwright codegen`, `playwright install`).

Ustawienia harnessu z góry zezwalają na `Bash(playwright-cli:*)`, więc agenci i subagenci sterują przeglądarką bez pytania o zgodę.

Globalna konfiguracja CLI jest w obrazie w `~/.playwright/cli.config.json`:

```json
{
  "browser": { "browserName": "chromium", "isolated": true,
               "launchOptions": { "chromiumSandbox": false } },
  "outputDir": "/tmp/playwright-cli"
}
```

- **`browserName: chromium` jest konieczne.** Bez niego `playwright-cli` szuka kanału Google Chrome (`/opt/google/chrome/chrome`), którego w obrazie nie ma, i kończy się błędem *„Chromium distribution 'chrome' is not found”*. Na hoście ten sam plik robi to samo.
- **`outputDir`** kieruje automatyczne snapshoty do `/tmp`. Bez tego każde `open` zostawia katalog `.playwright-cli/` w katalogu roboczym, czyli w Twoim repo. Pliki z jawnym `--filename` (np. `screenshot --filename=x.png`) dalej lądują w katalogu roboczym.

**Wersje CLI i przeglądarki muszą się zgadzać.** Playwright wiąże build przeglądarki z wersją biblioteki (`chromium-<revision>`), a `@playwright/cli` ciągnie własną — często alfę. Dlatego Dockerfile **wylicza wersję `playwright` z zależności samego `@playwright/cli`** i to ona instaluje przeglądarkę:

```dockerfile
npm install -g @playwright/cli@latest
PW_VERSION="$(node -p "require('/usr/local/lib/node_modules/@playwright/cli/package.json').dependencies.playwright")"
npm install -g "playwright@${PW_VERSION}"
playwright install --with-deps chromium
```

Przeglądarka leży w `/opt/ms-playwright` z prawem odczytu dla użytkownika bez roota. Szybki test:

```bash
./bin/harness shell -c "playwright-cli -s=t open https://example.com && playwright-cli -s=t --raw eval 'document.title'; playwright-cli -s=t close"
```

Playwright to ok. 700 MB obrazu — `INSTALL_PLAYWRIGHT=0` w `.env` buduje bez niego. `PLAYWRIGHT_BROWSER=firefox` zmienia przeglądarkę (obraz i `browserName` w konfiguracji CLI biorą się z tej samej zmiennej).

### Wbudowany agent `web-fetch`

Harness zawiera subagenta i skill, które zamieniają dowolną stronę WWW w czysty Markdown — aktywne w każdej sesji w kontenerze:

- [`claude/config/agents/web-fetch.md`](../../claude/config/agents/web-fetch.md) — subagent na Haiku z jednym narzędziem, `Bash`. Pobiera stronę w **jednym** wywołaniu (`playwright-cli open` → `eval` → `close`), w sesji przeglądarki o unikalnej nazwie, więc kilka pobrań może działać równolegle. Czyszczenie odbywa się w przeglądarce: usuwa skrypty, nawigację, banery cookies, reklamy, menu złożone z samych linków i puste elementy, zdejmuje atrybuty poza `href`/`src`/`alt`, przycina wynik do 40 000 znaków, a model zamienia go na Markdown (`[TYPE: ARTICLE]` albo `[TYPE: LINKS]`). Prośba o „pełny HTML” zwraca surową, wyrenderowaną stronę.
- [`claude/config/skills/web-fetch/`](../../claude/config/skills/web-fetch/SKILL.md) — każe głównej sesji oddawać czytanie stron temu agentowi zamiast wbudowanego `WebFetch` i nie powtarzać treści strony we własnej odpowiedzi, dzięki czemu główny kontekst pozostaje lekki.
- krótka reguła w [`claude/config/CLAUDE.md`](../../claude/config/CLAUDE.md) (pamięć zarządzana, ładowana w każdej sesji) — bez niej modele i tak sięgają od razu po `WebFetch` albo `curl`, nawet z załadowanym skillem.

Wystarczy poprosić w sesji, np. *„przeczytaj https://example.com/artykul i streść go”*. Strony renderowane JavaScriptem też działają, bo ładuje je prawdziwa przeglądarka. JavaScript w poleceniu nie zawiera apostrofów, więc całe wywołanie pasuje do reguły `Bash(playwright-cli:*)` i działa bez pytania o zgodę.

Wariant działający na modelu zewnętrznym jest w [`examples/agents/web-fetch-glm.md`](../../examples/agents/web-fetch-glm.md) (wymaga `glm-5.3-flash` w `models.yaml`).

**Wyłączenie albo podmiana:** usuń `claude/config/agents/web-fetch.md`, `claude/config/skills/web-fetch/` i sekcję „Reading web pages” z `claude/config/CLAUDE.md` albo połóż własny `web-fetch` w `~/.claude/` w kontenerze — prawdziwe pliki w wolumenie wygrywają z warstwą harnessu (zob. [Konfiguracja Claude Code](claude-configuration.md)). Agent na poziomie projektu (`.claude/agents/web-fetch.md` w Twoim repozytorium) również ma pierwszeństwo przed wersją harnessu.

## Serwery MCP

Serwery z [`claude/mcp.json`](../../claude/mcp.json) są rejestrowane dla każdej sesji w kontenerze (`claude mcp add-json --scope user`, raz na definicję). Domyślnie lista jest pusta — przeglądarkę obsługuje `playwright-cli`.

- Plik-ślad w wolumenie (`~/.claude/.harness-mcp-installed`) pamięta, co dodał harness, więc `claude mcp remove <nazwa>` jest trwałe.
- Zmiana definicji rejestruje serwer ponownie; **usunięcie wpisu z `mcp.json` wyrejestrowuje serwer** przy następnym starcie kontenera.
- Dlaczego nie managed settings: `managedMcpServers` przyjmuje tylko serwery http/sse (*„command is not allowed in managed settings”*), a `managed-mcp.json` przejmuje **wyłączną** kontrolę nad MCP i wycisza każdy serwer dodany później przez użytkownika.
