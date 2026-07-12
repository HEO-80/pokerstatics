# PROYECTO_RESUMEN — pokerstatics

> Generado a partir de una lectura directa del código fuente (no de documentación aspiracional). Fecha del análisis: 2026-07-11.

---

## 1. IDENTIDAD

**Nombre:** El repo se llama `pokerstatics`, pero el producto se identifica en el propio código como **"PreflopLab"** (`NavBar.jsx`) / **"PokerPreflop Trainer"** (título del PRD y de la API FastAPI: `"Preflop Poker Trainer API"`).

**Qué hace, en una frase:** Es una app web de **entrenamiento de decisiones preflop** en Texas Hold'em: te muestra una mano y una situación (posición, stack, fase de torneo), tú eliges una acción (fold/call/3bet/all-in...), y te dice si esa acción está dentro de un rango GTO precargado, dentro de una simulación *cosmética* de torneo MTT de 500 jugadores.

**Importante:** esto **no es un motor de poker**. No hay reparto real de cartas a múltiples jugadores, no hay mesa jugándose mano a mano, no hay flop/turn/river, no hay bots que decidan con lógica de juego, y no hay cálculo de equity. Es un *quiz* de rangos preflop con una simulación de progreso de torneo (número de jugadores restantes) que avanza de forma aleatoria, no jugada.

---

## 2. STACK TÉCNICO

### Backend
- **Python 3 + FastAPI 0.110.1** (`backend/server.py`, único archivo — 241 líneas)
- **Uvicorn 0.25.0** como servidor ASGI
- **MongoDB** vía **Motor 3.3.1** (driver async) — una única colección: `scenarios`
- **Pydantic ≥2.6.4** para modelos/validación
- Tests: **pytest** + **pytest-xdist** (`backend/tests/test_scenarios_api.py`, `backend/pytest.ini`)
- `backend/requirements.txt` incluye una cantidad grande de dependencias **no usadas en el código actual**: `boto3`, `requests-oauthlib`, `cryptography`, `pyjwt`, `bcrypt`, `passlib`, `python-jose`, `pandas`, `numpy`, `jq`, `typer`, `emergentintegrations`. Son residuos de la plantilla base ("fastapi_react_mongo_shadcn" — ver `.emergent/emergent.yml`), no funcionalidad implementada (no hay auth, ni JWT, ni procesamiento de datos con pandas/numpy en ningún archivo).

### Frontend
- **React 19** + **react-router-dom 7.15** (rutas en `frontend/src/App.js`)
- **CRACO 7.1** como wrapper de build sobre Create React App
- **Tailwind CSS 3.4** + **shadcn/ui** (colección completa de primitivas Radix UI en `frontend/src/components/ui/` — la mayoría de esos ~40 componentes shadcn **no se usan** en ninguna página; solo se usan `sonner` (toasts) y `recharts` (gráficas en Stats)
- **axios 1.16** para llamadas HTTP (`frontend/src/lib/api.js`)
- **recharts 3.6** para las gráficas de precisión en `Stats.jsx`
- `framer-motion` está en `package.json` pero **no se importa en ningún archivo** — dependencia muerta
- No hay gestor de estado global (Redux/Zustand/Context) — todo es `useState`/`useEffect` local por página

### Base de datos
- **MongoDB**, usada exclusivamente para almacenar los "scenarios" (rangos preflop en JSON) que se suben desde el panel Admin. No guarda usuarios, no guarda historial de manos del jugador (eso vive en `localStorage`, ver sección 4).

### Cómo se ejecuta en local
- **No hay `.env` en el repo** (ni `backend/.env` ni `frontend/.env`), así que la app **no arranca out-of-the-box**. Hacen falta como mínimo:
  - `backend/.env`: `MONGO_URL`, `DB_NAME`, opcionalmente `CORS_ORIGINS`
  - `frontend/.env`: `REACT_APP_BACKEND_URL` (usado en `frontend/src/lib/api.js:3`; también hardcodeado como ruta de fallback en `backend/tests/test_scenarios_api.py:11`, apuntando a `/app/frontend/.env`, ruta propia del contenedor de Emergent, no de este entorno Windows)
- No hay `Dockerfile`, `docker-compose.yml`, `Procfile` ni configuración de supervisor en el repo — el proyecto fue generado/ejecutado originalmente en la plataforma **Emergent.sh** (`.emergent/emergent.yml` referencia una imagen base `fastapi_react_mongo_shadcn`), y esa infraestructura de arranque no está versionada aquí.
- Scripts existentes:
  - Backend: no hay script de arranque explícito; se infiere `uvicorn server:app` desde `backend/` (puerto no fijado en código, por defecto 8000)
  - Frontend: `yarn start` → `craco start` (puerto por defecto 3000 de CRA)
  - Tests backend: `pytest` (usa `-n 2 --dist loadscope`, requiere un backend ya corriendo y accesible vía `REACT_APP_BACKEND_URL`, son tests de integración HTTP, no unitarios)

---

## 3. ESTRUCTURA DE CARPETAS

```
pokerstatics/
├── backend/
│   ├── server.py            # TODO el backend: modelos + endpoints REST (241 líneas, 1 archivo)
│   ├── requirements.txt
│   ├── pytest.ini
│   └── tests/
│       └── test_scenarios_api.py   # tests de integración HTTP contra la API real
│
├── frontend/
│   ├── src/
│   │   ├── App.js           # define las 5 rutas de la app
│   │   ├── pages/           # Home, Train, Stats, Review, Admin (una página = una feature)
│   │   ├── components/      # PokerTable, ActionButtons, FeedbackOverlay, TournamentHUD,
│   │   │                     PlayingCard, ChipStack, NavBar
│   │   ├── components/ui/   # ~40 componentes shadcn/Radix genéricos, mayoría sin usar
│   │   ├── lib/              # poker.js (utils de cartas/rangos), tournament.js (sim MTT),
│   │   │                     api.js (cliente axios), storage.js (localStorage), utils.js
│   │   ├── hooks/            # use-toast.js
│   │   └── constants/        # testIds.js — IDs para tests E2E (data-testid)
│   ├── plugins/health-check/ # plugin custom de craco (health check del dev server)
│   ├── package.json
│   └── craco.config.js
│
├── memory/
│   └── PRD.md                # documento de producto/roadmap, no código
│
├── test_result.md             # protocolo/bitácora de testing (formato interno de Emergent)
├── test_reports/               # resultados de una corrida de pytest guardados
├── design_guidelines.json
└── .emergent/emergent.yml      # metadata de la plataforma Emergent (imagen base, job_id)
```

No hay carpeta `models/`, `services/`, `db/` etc. en el backend — todo vive en el único archivo `server.py`.

---

## 4. FUNCIONALIDADES IMPLEMENTADAS (estado real)

| Funcionalidad | Estado | Detalle |
|---|---|---|
| Reparto de cartas | ⚠️ a medias | Se generan 2 cartas de héroe a partir de un "hand code" (ej. `AKs`) elegido al azar (`handCodeToCards` en `poker.js:44`), con palos aleatorios coherentes con suited/offsuit. **No hay cartas de rivales visibles, ni board (flop/turn/river), ni mazo compartido real** — es puramente cosmético para mostrar la mano de héroe. |
| Gestión de turnos / orden de acción | ❌ inexistente | No hay concepto de turno. Solo hay "héroe decide una vez" por mano, contra un "villano" que ya hizo una acción implícita (el escenario ya asume que el villano abrió, ej. `"sequence": "OPEN RAISE"`). |
| Lógica de decisión de bots/rivales | ❌ inexistente | No hay ningún bot que "decida". El "villano" es solo una etiqueta de posición (`villain_position`) dibujada en la mesa; su acción ya viene fija en el nombre del escenario (ej. "CO facing UTG open 2.5x"). No hay IA, ni random, ni motor de reglas jugando contra el usuario. |
| Estructura de ciegas / niveles / torneo | ⚠️ a medias | Existe una tabla estática de 10 niveles de ciegas (`BLIND_LEVELS` en `tournament.js:6-17`) agrupados por fase (early/mid/bubble/final_table). El nivel mostrado se **elige al azar dentro de la fase** (`blindForPlayers`, `tournament.js:57-62`), no progresa de forma secuencial ni está ligado a manos jugadas. |
| Sistema de fichas / stacks / apuestas | ❌ solo visual | `ChipStack.jsx` dibuja un número de BB estático que viene del escenario (`stack_bb`). No hay pozo, no hay apuestas incrementales, no hay stack que suba o baje con el resultado de la mano. |
| Detección de ganador / showdown | ❌ inexistente | No existe showdown. "Ganar" o "perder" la mano se reduce a: ¿tu acción coincide con alguna acción de probabilidad > 0 en el rango del JSON? (`evaluateAction`, `poker.js:118-124`). No hay resolución de manos entre jugadores. |
| "Progreso" del torneo | ⚠️ simulado, no jugado | `advanceTournament` (`tournament.js:35-55`) elimina un número aleatorio de jugadores (más si acertaste, menos si fallaste) hasta llegar a 1. Es un contador narrativo, no una simulación real de eliminaciones. |
| Interfaz de mesa (asientos, botón dealer, etc.) | ✅ funciona (visual) | `PokerTable.jsx` dibuja una mesa ovalada de 9 posiciones con coordenadas trigonométricas fijas (`SEAT_POSITIONS`, `seatCoords`), resalta el asiento de héroe (verde) y villano (rojo). No hay botón de dealer explícito ni animación de reparto real, solo un estado "Dealing…" mientras carga. |
| Feedback / breakdown de acciones | ✅ funciona | `FeedbackOverlay.jsx` muestra el desglose de frecuencias del rango (ej. 3bet 93% / all-in 7%) tras cada decisión, marcando la "acción principal". |
| Stats / dashboard | ✅ funciona | `Stats.jsx` calcula precisión global, por posición, por fase y por acción, racha actual y mejor racha, todo derivado client-side de `computeStats()` (`storage.js:54-113`) sobre el historial en `localStorage`. Usa gráficas de barras con `recharts`. |
| Modo repaso de errores (Review) | ✅ funciona | `Review.jsx` filtra el historial de `localStorage` por manos falladas, muestra detalle completo (cartas, breakdown, acción tomada vs. óptima) y permite "limpiar" errores. |
| Panel Admin (subida de rangos) | ✅ funciona | `Admin.jsx` permite pegar/subir JSON de escenarios (uno o array), listarlos, borrarlos individualmente o todos, contra los endpoints REST del backend. |
| Autenticación | ❌ no existe | Confirmado por el propio PRD ("Sin autenticación en MVP"). No hay usuarios, sesiones ni login en ningún punto del código, pese a que `requirements.txt` trae `pyjwt`, `bcrypt`, `passlib` sin usar. |
| Persistencia de datos del jugador | ⚠️ solo local | El historial de manos, streaks y stats viven **únicamente en `localStorage`** del navegador (`storage.js`), claves `poker_trainer_history_v1` / `poker_trainer_session_v1`. Se pierde al cambiar de navegador/dispositivo o limpiar el storage. Solo los *escenarios/rangos* (no el progreso del usuario) están en MongoDB. |

---

## 5. LÓGICA DE JUEGO — DETALLE

No existe un "motor de poker" en sentido tradicional (deck, deal, evaluación de manos de 5 cartas, side pots, etc.). Lo que hay es una capa delgada de utilidades:

- **Dónde vive la "lógica de una mano":** en `frontend/src/lib/poker.js`, concretamente:
  - `pickRandomHand(rangesMap)` (línea 98) elige un hand-code del escenario, con sesgo del 75% hacia manos que tienen alguna acción distinta de fold con probabilidad > 0 (para que el entrenamiento no sea "todo fold").
  - `handCodeToCards(code)` (línea 44) convierte el hand-code (`"AKs"`, `"77"`, `"72o"`) en dos objetos `{rank, suit}` con palos aleatorios válidos.
  - `getActionsForHand(rangesMap, handCode)` (línea 88) recupera el mapa de acciones→probabilidad para esa mano; si la mano no está en el rango, se asume 100% fold.
  - `evaluateAction(actionsMap, userAction)` (línea 118) es la "regla de victoria": cualquier acción con probabilidad > 0 en el JSON cuenta como correcta (regla explícita documentada también en el PRD).
- **Representación de cartas/manos:** cartas = `{rank: string, suit: 's'|'h'|'d'|'c'}`. Manos = "hand codes" estilo notación estándar de rangos (`AA`, `AKs`, `AKo`, `72o` — 169 combinaciones posibles, generadas por `allHandCodes()`, línea 28). No hay representación de manos completas post-flop (5 cartas) ni evaluador de rankings de poker (flush, straight, etc.) en ningún lugar del código.
- **¿Los rivales tienen lógica de decisión?** No. El "villano" no decide nada en tiempo real; su acción (ej. "abre 2.5x desde UTG") es parte fija del texto/metadata del escenario subido por el admin. No hay IA, red neuronal, motor de reglas ni randomización de jugadas del rival.
- **¿Hay cálculo de equity, pot odds o evaluación de manos?** No, en ningún archivo del repo. Toda la "corrección" de una decisión es un lookup directo contra el JSON de rangos cargado por el usuario/admin — es decir, el sistema **confía ciegamente en los datos que se le suben**, no calcula GTO ni EV por sí mismo.

---

## 6. DATOS

**Formato de un "scenario" (rango preflop), tal como lo valida el backend (`ScenarioIn` en `backend/server.py:47-59`) y lo documenta el propio Admin (`frontend/src/pages/Admin.jsx:14-28`):**

```json
{
  "id": "co_vs_utg_open_100bb_v1",
  "scenario": "CO facing UTG open 2.5x, 100BB deep",
  "hero_position": "CO",
  "villain_position": "UTG",
  "stack_bb": 100,
  "open_size_bb": 2.5,
  "sequence": "OPEN RAISE",
  "ranges": {
    "AA": { "actions": { "all_in": 0.07, "3bet": 0.93 } },
    "AKs": { "actions": { "3bet": 1.0 } },
    "AKo": { "actions": { "3bet": 0.85, "call": 0.15 } },
    "72o": { "actions": { "fold": 1.0 } }
  }
}
```

- `phase` (early/mid/bubble/final_table) es **opcional en el input**: si no se manda, el backend la deriva automáticamente del `stack_bb` vía `derive_phase()` (`backend/server.py:31-39`): ≥80BB → early, ≥30BB → mid, ≥15BB → bubble, si no → final_table.
- Las claves de acción reconocidas conceptualmente son `fold`, `call`, `marginal_call`, `3bet`, `raise`, `all_in` (`ACTION_KEYS` en el backend y `ACTION_META` en el frontend), pero el modelo Pydantic (`HandActions`) usa `extra="allow"`, así que en la práctica **no valida que las claves sean exactamente esas** — cualquier string de acción se acepta y se guarda tal cual.

**¿De dónde salen los datos?**
- Los rangos (`scenarios`) son **100% subidos manualmente** vía el panel Admin (pegando JSON o subiendo un archivo `.json`) y quedan persistidos en MongoDB. No hay ningún generador automático de rangos, ni integración con solvers (PioSolver, GTOWizard, etc.), ni datasets precargados en el repo — si la base de datos está vacía, `Train.jsx` muestra el estado vacío "No scenarios uploaded yet" (`Train.jsx:53`).
- El historial de manos jugadas por el usuario, sus stats y streaks salen enteramente de `localStorage` del navegador (no hay endpoint backend para guardarlos).

---

## 7. LO QUE FALTA / PROBLEMAS CONOCIDOS

- **No hay `.env` versionado** para backend ni frontend — el proyecto no levanta en un entorno nuevo sin configurarlos manualmente (`MONGO_URL`, `DB_NAME`, `REACT_APP_BACKEND_URL`).
- **No hay Dockerfile/docker-compose** ni script de arranque unificado en el repo; la infraestructura de ejecución dependía de la plataforma Emergent.sh donde se generó (ver `.emergent/emergent.yml`), no está reproducida aquí.
- **No es un simulador de poker real**: no hay dealing multi-jugador, ni board, ni pot, ni bots con lógica de decisión, ni showdown. Todo lo "MTT" (jugadores restantes, eliminaciones, progreso) es una capa narrativa aleatoria (`tournament.js`) desacoplada de cualquier resultado real de la mano.
- **No hay auth ni cuentas de usuario**, confirmado explícitamente como decisión de MVP en `memory/PRD.md`. El progreso del jugador vive solo en `localStorage`: se pierde al cambiar de navegador/dispositivo, y no hay forma de sincronizar entre backend y frontend.
- **Deuda de dependencias sin usar:** `requirements.txt` del backend arrastra ~15 paquetes no usados en el código (auth, cloud, data science: `boto3`, `pyjwt`, `bcrypt`, `passlib`, `python-jose`, `pandas`, `numpy`, `cryptography`, `emergentintegrations`, etc.). En frontend, `framer-motion` está instalado pero no se usa en ningún componente, y la mayoría de los ~40 componentes `shadcn/ui` en `components/ui/` no están referenciados desde ninguna página.
- **Validación laxa de datos:** `HandActions` en el backend usa `extra="allow"`, por lo que cualquier clave de acción arbitraria en el JSON subido se acepta sin validar contra el set conocido (`fold`, `call`, `marginal_call`, `3bet`, `raise`, `all_in`); un JSON con errores tipográficos en las acciones se guardaría silenciosamente y rompería el frontend al no reconocer el label/color de esa acción (cae a un fallback genérico en `actionLabel`/`actionColor`, `poker.js:135-141`).
- **Tests limitados:** solo hay tests de integración HTTP para el backend (`backend/tests/test_scenarios_api.py`), y dependen de que haya un servidor corriendo y accesible. No hay tests unitarios de la lógica en `frontend/src/lib/` (donde vive toda la "inteligencia" del entrenamiento: selección de mano, evaluación de acción, avance de torneo), ni tests de componentes React, ni tests E2E ejecutándose en el repo (aunque existen `data-testid` por toda la UI, preparados para ese fin, en `frontend/src/constants/testIds.js`).
- **`test_result.md`** es una plantilla de protocolo de testing de la plataforma Emergent, sin entradas reales de ejecución — no aporta información sobre qué se probó efectivamente.
- **Backlog explícito no implementado** (documentado en `memory/PRD.md`): autenticación, modo Cash 9-max, feedback con IA generativa, soporte multi-idioma, optimización mobile, multiplayer async, insights de debilidades vía ML, exportar historial — ninguno de estos existe en el código actual.
