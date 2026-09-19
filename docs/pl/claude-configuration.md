# Konfiguracja Claude Code

[English](../en/claude-configuration.md) · **Polski** · [← README](../../README.pl.md)

Claude Code w kontenerze ma jeden katalog użytkownika — `~/.claude` w wolumenie `packhorse-config` (logowanie, historia, `/model`). Entrypoint dokłada do niego **symlinki z kolejnych warstw**. Przy konflikcie nazw wygrywa pierwsza warstwa:

| # | warstwa | skąd | co wnosi |
| --- | --- | --- | --- |
| 1 | wolumen | `~/.claude` w kontenerze | to, co utworzysz sam w kontenerze — prawdziwe pliki nigdy nie są nadpisywane |
| 2 | **harness** | [`claude/config/`](../../claude/config/) w tym repo | `agents/`, `skills/`, `commands/`, `output-styles/`, `CLAUDE.md`, `settings.json` |
| 3 | obraz | `/usr/local/share/packhorse` | skill `playwright-cli` zgodny z CLI w obrazie |
| 4 | **host** | `~/.claude` hosta (tylko odczyt) | skille, agenci, komendy, `CLAUDE.md`, reguły uprawnień i `env` — gdy `HARNESS_INHERIT_HOST_CONFIG=1` |

Harness wygrywa z hostem, bo jego wersje są dopasowane do kontenera (ścieżki, Chromium zamiast Chrome). Konfiguracja **projektu** (`.claude/` w `/workspace` i w katalogach nad repozytorium) działa niezależnie od warstw — to zwykły mechanizm Claude Code.

## Własna konfiguracja harnessu — `claude/config/`

Katalog o układzie `~/.claude`, wersjonowany razem z harnessem:

```
claude/config/
├── CLAUDE.md        -> /etc/claude-code/CLAUDE.md (pamięć zarządzana, ładuje się zawsze)
├── settings.json    -> managed settings (przez generator, razem z models.yaml)
├── agents/          -> symlinki w ~/.claude/agents/   (web-fetch.md)
├── commands/        -> symlinki w ~/.claude/commands/
└── skills/          -> symlinki w ~/.claude/skills/   (web-fetch/)
```

- **Agenci, komendy, skille** — wrzuć plik lub katalog i uruchom nową sesję (`./bin/harness claude` startuje nowy kontener); bez przebudowy obrazu.
- **`CLAUDE.md`** trafia do pamięci zarządzanej, więc nie koliduje z `~/.claude/CLAUDE.md` (ani własnym z wolumenu, ani z hosta).
- **`settings.json`** to baza managed settings: generator scala go z `modelPicker`/`env` wyliczonymi z `models.yaml`, więc **po zmianie uruchom `./bin/harness regen`**. Managed settings mają najwyższy priorytet — użytkownik ich nie nadpisze. Harness trzyma tu hook `SessionStart` i regułę `Bash(playwright-cli:*)`.

## Dziedziczenie konfiguracji hosta — `HARNESS_INHERIT_HOST_CONFIG`

```bash
# .env
HARNESS_INHERIT_HOST_CONFIG=1     # domyślnie: kontener dostaje Twoją konfigurację z hosta
HARNESS_INHERIT_HOST_CONFIG=0     # czysty kontener: tylko warstwy harness + obraz
HOST_CLAUDE_DIR=/inna/sciezka     # opcjonalnie; domyślnie ~/.claude (Windows: %USERPROFILE%/.claude)
```

`~/.claude` hosta jest zawsze montowany **tylko do odczytu** w `/harness/host-claude`; flaga decyduje, czy entrypoint z niego korzysta. Co przechodzi:

- **skille, agenci, komendy, output styles** — jako symlinki (poza `skills/synced`: skille synchronizowane z claude.ai kontener pobiera sam, do własnego wolumenu),
- **`CLAUDE.md`** — jako `~/.claude/CLAUDE.md`, jeśli w wolumenie nie ma własnego,
- **z `settings.json` tylko `permissions.allow/deny/ask` i `env`** — jako drop-in `/etc/claude-code/managed-settings.d/05-host-settings.json`. Zmienne `ANTHROPIC_*`, `CLAUDE_*`, `PATH` i `HOME` są odfiltrowane (zepsułyby routing), a drop-in harnessu (`10-…`) ładuje się później, więc przy konflikcie wygrywa harness.

Co **nie** przechodzi i dlaczego:

- `model`, `hooks`, `statusLine`, `autoMode`, `theme` — opisują hosta (ścieżki, modele); w kontenerze `/model` i motyw zapisują się w wolumenie.
- **pluginy** — `installed_plugins.json` trzyma bezwzględne ścieżki hosta (`/home/<user>/.claude/plugins/cache/…`), których w kontenerze nie ma. Pluginy instaluj w kontenerze (`/plugin`); trafiają do wolumenu.
- skille odwołujące się do bezwzględnych ścieżek hosta działają tylko wtedy, gdy te ścieżki istnieją również w kontenerze.

Plik-ślad `~/.claude/.harness-links` zawiera listę symlinków założonych przez harness; każdy start usuwa je i zakłada od nowa. Wyłączenie flagi albo skasowanie skilla na hoście znika więc z kontenera przy następnym starcie, a rzeczy dodane ręcznie w kontenerze zostają nietknięte. Log startu pokazuje bilans:

```
harness: host settings: {"allow":1,"deny":0,"env":[]}
harness: config: 12 items from the harness/image/host layers
```

Przed startem kontenera `./bin/harness` zakłada `~/.claude` na hoście, jeśli go nie ma — inaczej Docker utworzyłby go jako root.
