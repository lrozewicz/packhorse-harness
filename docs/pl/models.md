# Modele

[English](../en/models.md) · **Polski** · [← README](../../README.pl.md)

## Dodanie modelu

Jedynym źródłem prawdy jest [`models.yaml`](../../models.yaml). Domyślny przykład (GLM 5.3 Flash z z.ai):

```yaml
models:
  - id: glm-5.3-flash                            # nazwa w /model, w routerze i w LiteLLM
    label: GLM 5.3 Flash (z.ai)
    description: zewnętrzny model przez LiteLLM (poza subskrypcją)
    api: openai                                  # OpenAI Chat Completions
    upstream_model: glm-5.3-flash                # nazwa modelu u dostawcy
    api_base: https://api.z.ai/api/coding/paas/v4
    api_key_env: ZAI_API_KEY                     # nazwa zmiennej z .env, nie sam klucz
    behaves_as: claude-sonnet-5
    context_tokens: 200000
    max_output_tokens: 65536
    thinking: strip
    extra_body:
      temperature: 0.6
      top_p: 0.95
```

```bash
echo 'ZAI_API_KEY=...' >> .env
./bin/harness regen
./bin/harness test glm-5.3-flash
```

Z tego jednego wpisu generator (`router/src/generate.js`) tworzy trzy pliki:

| plik generowany | konsument | zawartość |
| --- | --- | --- |
| `generated/litellm.config.yaml` | LiteLLM | `model_list` + `litellm/config.base.yaml` |
| `generated/managed-settings.json` | Claude Code | pozycja w `/model` (`modelPicker`) + okno kontekstu |
| `generated/registry.json` | `./bin/harness models`, hook sesji | podgląd tego, co aktywne |

Router czyta `models.yaml` bezpośrednio, więc `id` jest **jedną nazwą używaną wszędzie** — w `/model`, w logu routera, jako `model_name` w LiteLLM i w polu `model:` definicji subagenta. Sekret nie trafia do żadnego generowanego pliku: LiteLLM dostaje `api_key: os.environ/ZAI_API_KEY`, a wartość zna wyłącznie kontener LiteLLM (przez `env_file: .env`).

### Pola modelu

| pole | znaczenie |
| --- | --- |
| `api` | `openai` \| `openai-responses` \| `anthropic` \| `gemini` \| dowolny prefiks dostawcy LiteLLM |
| `aliases` | dodatkowe nazwy kierowane do tego modelu |
| `match` | wyrażenie regularne na nazwę żądanego modelu |
| `behaves_as` | obsługi którego znanego modelu Claude ma użyć klient (domyślnie `claude-sonnet-5`) |
| `context_tokens`, `max_output_tokens` | okno i limit wyjścia; router przycina `max_tokens` do tego drugiego |
| `thinking` | `strip` \| `keep` \| `disabled` |
| `effort` | `strip` \| `keep` \| `low` \| `medium` \| `high` |
| `drop_fields` | pola requestu usuwane przed przekazaniem |
| `extra_body` | parametry specyficzne dla dostawcy (temperatura, poziom rozumowania, …) |
| `litellm_params` | wyjście awaryjne — scalane na końcu, wygrywa z wyliczonymi wartościami |

> [!IMPORTANT]
> `id` modelu **nie może zawierać słowa `haiku`** — Claude Code bramkuje auto mode po nazwie modelu, a generator na takie `id` celowo zgłasza błąd.

## Tryby routera

`router.mode` w `models.yaml` (albo `HARNESS_MODE` w `.env`):

- **`hybrid`** (domyślny) — Opus/Sonnet/Haiku idą do `api.anthropic.com` na Twojej **subskrypcji**, bajt w bajt z nagłówkami OAuth; modele z `models` idą do LiteLLM. Model zewnętrzny to **świadomy wybór**: osobna pozycja w `/model`, `model:` w definicji subagenta albo `claude --model glm-5.3-flash`.
- **`standalone`** — **cały** ruch idzie do LiteLLM, subskrypcja nie jest potrzebna. Sloty Claude mapują się na modele zewnętrzne przez `router.standalone.{opus,sonnet,haiku,default}`, więc działa też to, co Claude Code wywołuje sam (tytuły sesji, klasyfikatory). Wymaga `ANTHROPIC_AUTH_TOKEN=cokolwiek` w `.env` (Claude Code musi widzieć jakieś uwierzytelnienie) i nie obsłuży narzędzi serwerowych Anthropic (`WebSearch`, `WebFetch`).

W trybie `hybrid` requesty z narzędziami serwerowymi Anthropic (`web_search`, `web_fetch`, `code_execution`, …) trafiają do Anthropic nawet wtedy, gdy wybrany jest mały model zewnętrzny — z podstawionym `anthropic_fallback_model`. Wyłącznik: `router.server_tools_to_anthropic: false`.

## Skąd modele w `/model`

Claude Code czyta `modelPicker` **wyłącznie** z managed settings, `--settings`/SDK i ustawień użytkownika — nie z repozytorium projektu. Dlatego entrypoint kontenera wkłada wygenerowany plik jako **drop-in managed settings**:

```
/etc/claude-code/managed-settings.d/10-harness-models.json   (root:root 0644)
```

Nic nie dotyka `~/.claude/settings.json` w wolumenie, gdzie jest logowanie i Twoje ustawienia; drop-in jest po prostu odtwarzany z `generated/managed-settings.json` przy każdym starcie.

**Konta z polityką organizacji.** `modelPicker` jest brany wyłącznie z *najwyższego* źródła ustawień, które go definiuje, bez scalania. Na subskrypcji firmowej/Team zdalne managed settings organizacji (`claude doctor` pokazuje *„Organization policy: Loaded from api.anthropic.com”*) stoją wyżej niż lokalny drop-in, więc jego pozycje są po cichu pomijane i `/model` pokazuje tylko wbudowane modele — nawet jeśli organizacja w ogóle nie ogranicza modeli. Dlatego entrypoint kopiuje też `modelPicker` do **ustawień użytkownika** w kontenerze (`~/.claude/settings.json` w wolumenie `packhorse-config`; logowanie jest w `.credentials.json`, więc nie jest naruszane). Kopia jest odświeżana przy każdym starcie i usuwana, gdy `models.yaml` nie definiuje modeli. Ograniczenie: jeśli organizacja kiedyś wyśle własny `modelPicker`, przykryje ustawienia użytkownika i pozycje znów znikną; pozostałaby wtedy droga przez `--settings <plik>` przy wywołaniu `claude`.

Przy okazji ustawiany jest `CLAUDE_CODE_MAX_CONTEXT_TOKENS` (najmniejsze okno wśród modeli zewnętrznych). Claude Code czyta tę zmienną **tylko dla modeli spoza `claude-*`**, więc Opus i Sonnet zachowują swoje okna. `behaves_as` usuwa ostrzeżenie `[claude-code:unrecognized_model]` i daje sensowne domyślne możliwości dla nieznanego ID.

## Świadomość modeli w sesji

Lista modeli, które asystent „zna”, pochodzi z promptu systemowego Claude Code i nie da się jej podmienić — pozycje w `/model` są tylko w UI. Żeby model poprawnie odpowiadał na pytanie *„jakie modele są dostępne?”*, hook **`SessionStart`** ([`claude/bin/harness-context`](../../claude/bin/harness-context)) czyta `generated/registry.json` i wstrzykuje jako `additionalContext` tryb routera, modele zewnętrzne z ich oknami i model bieżącej sesji. Hook dodaje wyłącznie kontekst — nie może zmienić routingu ani zmiennych środowiskowych.

## Subagenci na modelach zewnętrznych

Pole `model:` subagenta przyjmuje pełne `id` modelu z `models.yaml`, więc subagent może działać na innym modelu niż główna sesja. Gotowy przykład: [`examples/agents/glm.md`](../../examples/agents/glm.md):

```bash
# dla jednego projektu (katalog widoczny jako /workspace)
cp examples/agents/glm.md <projekt>/.claude/agents/

# dla każdej sesji w kontenerze
cp examples/agents/glm.md claude/config/agents/
```

Kolejność rozstrzygania modelu subagenta: `CLAUDE_CODE_SUBAGENT_MODEL` → parametr wywołania → `model:` z definicji → model sesji. Ustawiony `CLAUDE_CODE_SUBAGENT_MODEL` przykrywa `model:` z plików agentów.

## Uwagi

- **`/model` zapisuje wybór jako domyślny dla nowych sesji.** Po testach modelu zewnętrznego wróć na `/model opus`, inaczej każda nowa sesja wystartuje na nim.
- **Brak prompt cachingu dla modeli zewnętrznych** — LiteLLM przyjmie `cache_control`, ale backendy w stylu OpenAI tego nie realizują, więc długie konteksty są wolniejsze niż na Anthropic.
