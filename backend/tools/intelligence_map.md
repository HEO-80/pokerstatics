# Mapa de "inteligencia" del juego (bots + coach) — diagnóstico read-only

Fecha: ver `git log -1`. Alcance: SOLO backend, SOLO lectura — nada de lo que
sigue cambia código ni datos. No toca PokerTraining.

Objetivo: saber exactamente de dónde sale hoy cada decisión/número del juego,
para decidir cómo (y dónde) cargar rangos de estrategia reales.

---

## 1. Cómo juegan los bots

### 1.1 Heurística base (siempre activa)

Archivo: `backend/poker_bot.py`. Punto de entrada público: `decide(hand, seat,
profile="tag", preflop_range=None, seed=None, postflop_iters=...)` (línea 835).

- **Fuerza de mano preflop — Chen**: `chen_score()` / `chen_strength()`
  (líneas ~177-206). Normaliza a 0..1.
- **Factor de posición**: `_position_factor(hand)` (línea 328) — `1 -
  (rivales_por_detrás / total_rivales)`.
- **4 perfiles de bot** (`PROFILE_PARAMS`, líneas 48-69): `nit / tag / lag /
  station`, cada uno con `raise_min, position_spread, value_thresh,
  call_margin, bluff_freq, bet_size, open_size_bb` — todos números fijos en
  código, ningún dato externo.
- **Preflop SIN rango cargado** (`_preflop_decision_no_range`, línea 519): al
  abrir compara `chen_strength + posición` contra `raise_min` del perfil; al
  enfrentar una subida usa **pot odds reales** (`poker_engine.pot_odds`) vs
  una equity estimada barata (`_preflop_equity_estimate`, sin Monte Carlo);
  ajuste multiway (`MULTIWAY_TIGHTEN_PER_RIVAL`); farol ocasional
  (`bluff_freq`).
- **Postflop**: `_postflop_decision` (línea 739) — equity real vía Monte
  Carlo contra un rango genérico (`poker_engine.equity_vs_range`,
  `GENERIC_RANGE` = las 169 combinaciones), clasificada en 3 "buckets"
  (`_postflop_bucket`, línea 730: `weak / medium / strong` según
  `value_thresh` del perfil ± `STRONG_EQUITY_GAP`).
- **Tamaños de apuesta/subida**: `_size_preflop_raise` (401) /
  `_size_postflop_bet` (470) — fracciones de bote/incremento con topes
  (`PREFLOP_REBET_MULT`, `DEEP_STACK_RAISE_CAP_FRACTION`, etc.), todo
  constantes en código, sin datos externos.

**Todo lo anterior es heurística pura en código.** Ni Mongo ni JSON.

### 1.2 La ÚNICA fuente de datos externa que los bots SÍ consumen hoy

`backend/data/opening_ranges.json` (5958 líneas) — cargado UNA vez al
importar el módulo (`_load_opening_ranges()`, línea 263; `_RAW_OPENING_RANGES`,
línea 271) y convertido a `OPEN_SETS_BY_PROFILE` (línea 325: por posición,
modulado por perfil — `nit` recorta al 70% más fuerte, `lag` amplía +20%,
`tag`/`station` tal cual, ver `_modulate_open_set`, línea 297).

**Dónde entra en la decisión**: SOLO en `_preflop_decision_no_range`, y SOLO
en el caso "el bot es el primero en entrar, nadie ha subido todavía"
(`hand.current_bet <= hand.bb`, línea 574-580) — mapea el asiento a una
posición (`_seat_position_label`, línea 231, deriva UTG/UTG1/MP/HJ/CO/BTN/SB
a partir del botón, sin tocar el orden de acción real de `poker_table.py`) y
si esa mano está en `open_set`, abre; si no, fold. **Fuera de ese caso
concreto (RFI), este JSON no interviene** — 3-bet/4bet/defensa/postflop
siguen siendo heurística pura de 1.1.

### 1.3 `preflop_range` (el parámetro que `decide()` acepta) — NO alimentado hoy

`_preflop_decision(hand, seat, profile, preflop_range, rng)` (línea 608): si
`preflop_range` no es `None`/vacío, usa ESE dict tal cual (`hand_code ->
{"actions": {...}}`, muestreo ponderado vía `_sample_weighted` +
`RANGE_ACTION_MAP` para traducir la acción elegida a fold/check/call/raise/
all_in) — **sustituye por completo** a la heurística, sin excepción de spot.

`RANGE_ACTION_MAP` (línea 143): reconoce SOLO estas claves de acción:
`fold, call, marginal_call, check, 3bet, 4bet, open, raise, all_in`.
Cualquier otra clave cae a `"fold"` por el `.get(chosen, "fold")` de la línea
615 — importante para la sección 3 (hay datos en el repo con claves que NO
están en esta lista).

**Quién llama a `decide()` pasando `preflop_range`**: nadie, en el camino
real de producción.
- `backend/poker_table_api.py:206` (`_auto_advance_bots`, el único sitio que
  mueve a los bots durante una partida real vía HTTP) llama
  `poker_bot.decide(hand, seat, profile=profile)` — **sin `preflop_range`**,
  siempre `None`.
- `mtt_api.py` no llama a `decide()` en absoluto (el campo del torneo se
  simula estadísticamente agregado, no mano a mano — ver
  `mtt_simulation.py`).
- Los únicos sitios que SÍ pasan `preflop_range` son los tests
  (`tests/test_poker_bot.py`, vía `play_hand_all_bots`) para probar que el
  mecanismo funciona in vitro.

**Conclusión 1**: la colección Mongo `scenarios` (pensada con exactamente la
forma que `preflop_range` espera) **no influye en ninguna partida real
hoy** — está completamente desconectada de los bots. Lo único conectado es
`backend/data/opening_ranges.json`, y solo para el caso de apertura (RFI).

---

## 2. De dónde saca el coach la información

### 2.1 Coach v1 — `backend/poker_coach.py`

Módulo de lógica pura (sin FastAPI), expuesto vía `poker_table_api.py`.
Motor: `poker_engine.py` (`equity_vs_range` Monte Carlo, `pot_odds`,
`breakeven_bluff`, exactos salvo la equity).

- **Rango estimado del rival** (`estimate_villain_range`, línea 78): heurística
  basada en las acciones que el rival YA hizo en ESTA mano
  (`hand.actions_log`): subió alguna vez → top 15% de manos por Chen
  (`RAISE_RANGE_PCT`); solo pagó → top 40% (`CALL_RANGE_PCT`); nada → rango
  genérico completo (169 combos, `poker_bot.GENERIC_RANGE`). Documentado en el
  docstring del módulo como heurística, explícitamente "NO es un rango GTO
  real".
- **Recomendación final** (`derive_recommendation`, más abajo en el archivo):
  plantillas fijas que comparan equity vs pot odds vs breakeven — sin IA.

**Ningún dato externo.** Todo motor (`poker_engine`) + heurística en código
(reutiliza `poker_bot.chen_strength`/`GENERIC_RANGE`, no inventa nada nuevo).
Cero Mongo, cero JSON.

### 2.2 Coach v2 — `backend/poker_coach_ai.py` (Gemini)

`build_ai_context(hand, hero_seat, villain_style)` (línea 88) arma un prompt
de texto con:
- Mano/board/calle/posición/stack del hero, bote, to_call, apuesta actual.
- Rivales activos + historial de acciones de la mano (`_format_action_log`,
  línea 70).
- **Los números que YA calculó el v1** (`build_coach_response`, reutilizado
  tal cual, línea 102): pot odds, equity estimada, breakeven, recomendación
  matemática — la IA NO recalcula nada, el `SYSTEM_PROMPT` (línea 42) se lo
  pide explícitamente ("NO inventes números distintos a los que se te dan").
- `villain_style` (opcional): perfil VPIP/PFR del rival EN ESTA SESIÓN —
  **calculado en el FRONTEND** (`frontend/src/lib/villainStats.js`, sobre
  `handHistory`, que el backend no conserva entre manos) y reenviado tal cual
  por el endpoint en el body del POST.

Llamada: `gemini-2.5-flash` vía REST (`ask_ai_coach`, línea 193). Sin
contexto de Mongo, sin JSON de rangos — solo el contexto de la mano en curso
+ los números del v1 + (opcional) el estilo del rival de esta sesión.

---

## 3. Datos/JSON de estrategia en el repo

| Archivo | Tamaño | ¿En uso? | Qué contiene |
|---|---|---|---|
| `backend/data/opening_ranges.json` | 5958 líneas | **SÍ** (ver 1.2) | 7 posiciones (UTG/UTG1/MP/HJ/CO/BTN/SB) × 169 hand-codes, acción binaria `{"raise":1.0}` o `{"fold":1.0}` — rango de apertura RFI limpio |
| `backend/estrategia_poker.json` | 925 líneas | **Huérfano en código**, pero es la fuente del único doc en Mongo (ver 3.2) | 1 escenario: SB vs BTN open 2bb, 40BB, `sequence:"3BET / CALL"`, 169 hand-codes con acciones MIXTAS (fold/call/marginal_call/3bet/all_in con pesos) |
| `backend/tournamentsflops.json` | 84962 líneas | **Huérfano, nadie lo lee** | Volcado de 98 "charts" en 6 categorías — ver 3.3 |

Confirmado con `grep -rn` en todo `backend/`: ningún `.py` ni archivo del
frontend referencia `estrategia_poker.json` ni `tournamentsflops.json`.
`opening_ranges.json` solo lo lee `poker_bot.py` (y su test dedicado
`tests/test_poker_bot_opening_ranges.py`).

### 3.1 Origen (git blame)

- `backend/estrategia_poker.json` y `backend/tournamentsflops.json`: añadidos
  juntos en el **primer commit del backend**
  (`8fa4112 feat(backend): motor de mesa y IA de bots con tests`, ya
  completos, sin ningún script de conversión en el mismo commit) — son,
  literalmente, **las "jugadas/datos iniciales" que preguntas**: el
  `pasos.md` de ese mismo commit dice explícitamente *"Extraer charts de
  PokerCoaching (PDF) a JSON con el script OpenCV — más datos"* y *"JSON de
  rangos subido y funcionando en el modo Train"* — o sea, salieron de
  escanear/extraer charts de un PDF de un curso (PokerCoaching) con un script
  OCR/OpenCV que **no está en este repo** (ni su código ni sus imágenes
  fuente).
- `backend/data/opening_ranges.json`: añadido en
  `e104373 feat: rangos de apertura reales por posicion cableados a bots`
  (12 ago), ya completo y listo, sin script de derivación en el commit — no
  hay rastro en el repo de CÓMO se generó a partir de los dos anteriores (si
  es que viene de ahí). Su forma (limpia, binaria, por posición) no coincide
  1:1 con ninguno de los dos archivos crudos de arriba.

### 3.2 Cómo llegó el único documento de `prefloplab.scenarios`

**No hay ningún script de seed/carga en el repo** (`find`/`grep` sobre
`backend/` no encuentra nada tipo `seed*.py`, `load*range*.py`, carpeta
`scripts/`, etc.). El único mecanismo de escritura hacia Mongo es
`POST /api/scenarios/bulk` (`server.py:134`), y el único caller de ese
endpoint en todo el proyecto es la pantalla **Admin** del frontend:

- `frontend/src/pages/Admin.jsx` — un textarea donde se pega/sube un JSON
  (`doUpload`/`doFile`, líneas 50-91) y un botón que llama
  `uploadScenarios()`.
- `frontend/src/lib/api.js:28` — `uploadScenarios()` → `POST /scenarios/bulk`.

El documento que hoy vive en Mongo (`scenario:
"SB_vs_BTN_open_2bb_40bb_3bet_call"`, `hero_position: "SB"`, `villain_position:
"BTN"`, `stack_bb: 40`, `sequence: "3BET / CALL"`, 169 hand-codes) es
**exactamente** el contenido de `backend/estrategia_poker.json` (mismo
`scenario`, mismos campos, mismo recuento de hand-codes). Conclusión: en
algún momento alguien pegó/subió ese archivo a mano por la pantalla Admin —
no hay automatización de por medio.

### 3.3 `tournamentsflops.json` en detalle (el trove grande, sin usar)

Estructura: 6 claves de nivel superior, cada una un array de "charts":

```
1openraise         -> 30 charts  (open_raise: 8, call_vs_open_push: 10, range_call: 9, 4bet_position: 1, 3bet_call: 2)
2raiseoverlimpers   -> 8 charts  (raise_over_limpers: 6, call_vs_open_push: 2)
33bet-call          -> 15 charts (3bet_call: 7, range_call: 7, 4bet_position: 1)
4callvsopen-push    -> 35 charts (call_vs_open_push: 35)
5squeeze-call       -> 6 charts  (3bet_call: 4, range_call: 2)
6cold4bet-farha     -> 4 charts  (range_call: 4)
```

Cada chart es SOLO `{source_image, chart_type, ranges}` (confirmado: ningún
chart en todo el archivo tiene más claves que esas 3) — ejemplo real
(`1openraise[…]`, chart_type `open_raise`):

```json
{
  "source_image": "image copy 15.png",
  "chart_type": "open_raise",
  "ranges": {
    "AA":  {"actions": {"open_raise": 1.0}},
    "AKs": {"actions": {"open_raise": 1.0}},
    ...
  }
}
```

**Dos problemas concretos para poder usarlo tal cual:**

1. **Sin metadata de spot**: no hay `hero_position`, `villain_position`,
   `stack_bb` ni `sequence` en ningún chart — solo el nombre del archivo de
   imagen del que se extrajo (`source_image`, tipo `"image copy 15.png"`).
   Esa correspondencia imagen→spot real (¿qué posición, qué stack, vs qué
   apertura?) no está en el repo; habría que reconstruirla a mano (o tener
   las imágenes/PDF originales) antes de convertir esto en documentos
   `scenarios` válidos.
2. **Vocabulario de acciones incompatible** con lo que `poker_bot.py` sabe
   interpretar hoy. Claves de acción usadas en todo el archivo:
   `fold, all_in, call, marginal_call, check, marginal_all_in, open_raise,
   3bet, not_in_range, rol, marginal_open_raise` — de estas,
   `RANGE_ACTION_MAP` (poker_bot.py:143) SOLO reconoce
   `fold/call/marginal_call/check/3bet/4bet/open/raise/all_in`. Claves como
   `open_raise`, `marginal_open_raise`, `not_in_range`, `rol` (raise-over-
   limpers) caerían todas a `"fold"` por el `.get(chosen, "fold")` si se
   pasaran tal cual como `preflop_range` — haría falta normalizar las claves
   (o extender `RANGE_ACTION_MAP`) antes de cablear nada.

---

## 4. Dónde encajaría cargar rangos reales

- **Apertura (RFI) de los bots**: el sitio ya existe y ya funciona —
  sobrescribir/ampliar `backend/data/opening_ranges.json` (mismo shape:
  posición → `ranges` → hand_code → `{"actions": {"raise": x}}`). Sin
  cambios de código.
- **Resto de spots de los bots (3-bet/4-bet/defensa/postflop con rango
  real)**: el enganche (`preflop_range` en `decide()`/`_preflop_decision`)
  ya existe pero está huérfano — haría falta (a) datos reales por
  `(hero_position, villain_position, stack_bb, sequence)` con claves de
  acción del vocabulario de `RANGE_ACTION_MAP`, y (b) código nuevo en
  `poker_table_api.py`/`poker_bot.py` que, en cada decisión, busque el
  escenario que corresponda (Mongo `scenarios` es el candidato natural: ya
  tiene el modelo Pydantic, el endpoint bulk y la pantalla Admin) y se lo
  pase a `decide()` — ese código de cableado **no existe todavía** (fuera de
  alcance de este diagnóstico, según se pidió).
- **Estado real de Mongo hoy**: 1 solo documento, un spot de respuesta
  (SB vs BTN 3bet/call, 40BB) — ninguna cobertura de apertura por posición,
  ninguna variedad de stacks/villanos. Insuficiente para cablear ya (ver
  `backend/tools/ranges_report.txt` / `inspect_ranges.py` del diagnóstico
  anterior).
- **La fuente más rica sin explotar es `tournamentsflops.json`** (98 charts,
  6 tipos de spot: apertura, call/push vs open, 3bet-call, 4bet, squeeze,
  raise-over-limpers) pero necesita el trabajo de la sección 3.3 antes de
  ser usable: reconstruir metadata de posición/stack por chart y normalizar
  el vocabulario de acciones.

---

## 5. Archivos consultados (sin modificar ninguno)

`backend/poker_bot.py`, `backend/poker_coach.py`, `backend/poker_coach_ai.py`,
`backend/poker_table_api.py`, `backend/server.py`, `backend/mtt_api.py`,
`backend/data/opening_ranges.json`, `backend/estrategia_poker.json`,
`backend/tournamentsflops.json`, `backend/tests/test_poker_bot_opening_ranges.py`,
`frontend/src/pages/Admin.jsx`, `frontend/src/lib/api.js`,
`frontend/src/lib/villainStats.js` (referenciado, no leído en detalle),
`pasos.md` (histórico, commit `8fa4112`), historial de git
(`git log --follow`, `git show --stat`).
