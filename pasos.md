
# PROYECTO: Entrenador de Poker (PreflopLab + Mesa) — PASOS

> Base del proyecto: E:\Cursos\Projects\pokerstatics
> Referencia visual (NO tocar): E:\Cursos\Projects\PokerTraining

---

## ✅ HECHO Y VERIFICADO

- [x] Análisis de los dos proyectos y plan de fusión (pokerstatics = base, PokerTraining = referencia)
- [x] Motor de cálculo (`poker_engine.py`): equity mano-vs-rango (Monte Carlo), pot odds, breakeven
- [x] Motor validado contra equities conocidas (AA vs aleatorio 85%, AKs vs QQ 46%, etc.)
- [x] Router del motor (`poker_analysis.py`): endpoints /api/analyze y /api/analyze/scenario
- [x] Integración en server.py (2 líneas) — endpoint responde 200 en local
- [x] Backend corriendo en local (FastAPI + Mongo vía Docker), sin depender de Emergent
- [x] Frontend corriendo en local (React/CRA) y hablando con el backend
- [x] Limpieza de requirements.txt (quitado emergentintegrations y dependencias no usadas)
- [x] JSON de rangos subido y funcionando en el modo Train
- [x] Guardado en GitHub

---

## 🔨 EN CURSO

- [ ] **Paso 1 — Motor de una mano** (`poker_table.py`): reparto, ciegas, rondas de
      apuestas en orden posicional correcto, y showdown con SIDE-POTS
      - [ ] Módulo creado, reutilizando poker_engine
      - [ ] Tests: fold al BB / showdown heads-up / side-pot
      - [ ] Los 3 tests pasan (confirmar salida de pytest)

---

## ⬜ PENDIENTE (en orden)

- [ ] **Paso 2 — IA de los bots**: que los rivales decidan usando los rangos
      cargados (no random), con perfiles distintos (nit / agresivo / TAG...)
- [ ] **Paso 3 — Endpoint de la mesa**: conectar poker_table al server.py
      (crear/avanzar una mano vía API)
- [ ] **Paso 4 — Mesa visual**: enganchar la interfaz (asientos, cartas, fichas)
      al motor de la mesa. Reutilizar ideas visuales de PokerTraining
- [ ] **Paso 5 — El coach**: capa que narra usando el motor
      ("tu equity es X%, el bote te da Y%, breakeven Z%...")
      - [ ] Números exactos del motor (deterministas)
      - [ ] Narrativa (plantillas o IA) envolviendo esos números
      - [ ] Botón para activar/desactivar el coach

---

## 🌱 IDEAS PARA MÁS ADELANTE (no ahora)

- [ ] Progresión de dificultad por fase (rivales mejores según avanza el torneo)
- [ ] Extraer charts de PokerCoaching (PDF) a JSON con el script OpenCV — más datos
- [ ] Login / persistencia por usuario
- [ ] Modo cash 9-max además del torneo
- [ ] Modo "quick drill" con ranking

---

## 📌 NOTAS CLAVE

- Todo el cerebro del juego vive en el BACKEND (Python), testeable. El frontend solo pinta.
- Trabajar por pasos pequeños: cada pieza probada antes de montar la siguiente.
- Arrancar Claude Code en la carpeta `pokerstatics`.
- Backend: `cd backend` → `uvicorn server:app --reload --port 8000`
- Frontend: `cd frontend` → `yarn start`
- Mongo: `docker run -d --name mongo-preflop -p 27017:27017 mongo:7`


No, no lo va a hacer todo — y eso es a propósito, para que puedas verificar cada pieza antes de seguir. El prompt que le diste es solo un paso del proyecto.

Lo que va a hacer ahora Claude Code con ese prompt:

Solo el motor de una mano de poker (poker_table.py) + sus tests. Es decir, la lógica de: repartir cartas, gestionar las apuestas en orden correcto, y repartir el bote al final con side-pots. Nada más. En concreto:

Crea backend/poker_table.py
Crea backend/tests/test_poker_table.py
Ejecuta los tests y te dice si pasan

Lo que NO va a hacer ahora (y que viene después, paso a paso):

❌ La IA de los bots (que los rivales decidan con lógica) — le dijimos explícitamente que no
❌ El endpoint para conectarlo (le dije "no toques server.py todavía")
❌ La mesa visual / lo que ves en pantalla
❌ El coach que narra
❌ Nada del frontend

O sea, cuando termine no vas a ver nada nuevo en la web. Lo que tendrás es un módulo de Python probado, funcionando por debajo. Es un paso "de fontanería", invisible pero necesario.

Por qué lo troceamos así: es justo lo que nos funcionó con el motor de cálculo. Cada pieza pequeña, probada y confirmada antes de montar la siguiente encima. Si le pidiéramos "hazlo todo" de golpe, saldría un amasijo imposible de depurar, y con un modelo que no es Opus, más todavía. Trocear = poder pillar los fallos de uno en uno.

El orden completo que nos queda, para que tengas el mapa:

Motor de una mano ← lo que hace ahora
IA de los bots (que usen los rangos para decidir)
Endpoint que conecte todo
Enganchar la mesa visual
El coach

Así que cuando te dé la salida de los tests, revisamos que pasen (sobre todo el del side-pot), y de ahí pasamos al paso 2. Pégame el resultado cuando lo tenga.

Te explicas perfectamente, y es una idea muy buena — es un sistema de puntuación y niveles basado en la calidad de tus decisiones, no en si ganas o pierdes el bote. Eso es clave y lo has clavado, porque en poker puedes jugar perfecto y perder la mano (la parte de suerte que mencionabas antes). Lo justo es puntuar la decisión, no el resultado.

Déjame reflejar lo que describes para confirmar que lo entiendo, porque hay un matiz importante:

Lo que puntúa es la calidad de la decisión contra lo óptimo (GTO/rango), no el resultado de la mano. Ejemplos de lo que dices:

Vas con AA all-in en el momento correcto (el rango decía all-in) → ganas puntos, aunque pierdas la mano contra una mano peor que ligó
Tiras esos mismos AA antes de tiempo por miedo (el rango decía subir/all-in) → pierdes puntos, aunque "te salvaras" de perder fichas
Juegas una mano marginal exactamente como marca el rango → puntos
Haces un fold que el rango premia → puntos

Y sobre eso, un sistema de niveles de progresión: según aciertas decisiones difíciles vas subiendo de nivel, y los escenarios que te tocan se vuelven más complejos (manos más marginales, spots más difíciles, decisiones más finas). Como un ELO tuyo de "calidad de decisión".

Esto encaja perfectísimo con lo que ya tenemos montado, y aquí está lo bonito: la infraestructura para puntuar ya existe. El sistema ya compara tu acción contra el rango (correcto/incorrecto lo viste en las pantallas de PreflopLab). Solo hay que convertir ese "correcto/incorrecto" binario en puntos ponderados por dificultad. Y el motor de cálculo nos da la munición para ponderar bien.

Cómo lo plantearía (la lógica de puntos):

No todos los aciertos valen igual. Acertar que AA va all-in es fácil (todo el mundo lo sabe) → pocos puntos. Acertar un fold marginal difícil, o un 3-bet de farol fino → muchos puntos. La idea es: cuanto más difícil la decisión, más puntos vale acertarla (y más pierdes si fallas). El motor ya sabe medir "dificultad": una mano donde el rango es 100% una acción es fácil; una mano con estrategia mixta (50% call / 50% fold) o que está justo en el borde del rango es difícil. Eso es medible.

Un esbozo de cómo asignar puntos:

Decisión fácil bien (mano clara, rango 100% una acción): +1
Decisión difícil bien (mano en el borde, o estrategia mixta): +3 a +5
Fallo en decisión fácil (tiraste AA que era all-in claro): -3 (penaliza más porque es un error gordo)
Fallo en decisión difícil: -1 (era difícil, se perdona más)
Racha de aciertos: multiplicador (gamificación, ya hay "streak" en PreflopLab)

Y los niveles salen de tu puntuación acumulada: Nivel 1 (novato) → escenarios fáciles; según subes, el sistema te sirve escenarios más difíciles (spots marginales, stacks incómodos, decisiones de estrategia mixta).

Ahora, lo importante de cuándo construir esto. Esto es una capa de "gamificación/scoring" que va encima de que la mesa funcione. Ahora mismo estamos en el paso 1 (el motor de la mesa). Meter el scoring ahora sería adelantarnos. Lo lógico es:

Que la mesa funcione (paso 1, en curso)
Bots + endpoint + mesa visual (pasos 2-4)
El coach (paso 5)
El sistema de puntos y niveles ← encaja aquí, o incluso en paralelo al coach, porque ambos usan lo mismo: comparar tu decisión contra lo óptimo

Te lo añado al pasos.md como paso planificado para que no se pierda la idea. Aquí el bloque para que lo pegues en el archivo (sustituye la sección de "IDEAS PARA MÁS ADELANTE" o añádelo antes):

markdown
- [ ] **Paso 6 — Sistema de puntos y niveles (scoring por calidad de decisión)**
      Puntúa la DECISIÓN contra el rango óptimo, NO el resultado de la mano
      (puedes perder el bote y aun así ganar puntos si jugaste bien).
      - [ ] Puntos ponderados por dificultad de la decisión:
            - Acierto en decisión fácil (rango claro): pocos puntos (+1)
            - Acierto en decisión difícil (mixta / borde de rango): muchos (+3 a +5)
            - Fallo en decisión fácil (ej. tirar AA que era all-in): penaliza fuerte (-3)
            - Fallo en decisión difícil: penaliza poco (-1)
      - [ ] Multiplicador por racha de aciertos (aprovechar el "streak" existente)
      - [ ] Niveles de progresión: la puntuación acumulada sube tu nivel
      - [ ] Dificultad adaptativa: a más nivel, escenarios más difíciles
            (manos marginales, stacks incómodos, estrategia mixta)
      - [ ] Usa el motor para medir "dificultad" de cada spot (mixta = difícil)


      Dónde estamos:

✅ Paso 1 — Motor de una mano (reparto, apuestas, side-pots) — hecho, 3 tests en verde
⬜ Paso 2 — IA de los bots ← siguiente
⬜ Paso 3 — Endpoint de la mesa
⬜ Paso 4 — Mesa visual
⬜ Paso 5 — El coach
⬜ Paso 6 — Puntos y niveles

El siguiente paso es la IA de los bots — que los rivales decidan usando los rangos que tienes cargados en Mongo, en vez de al azar. Aquí es donde tu mesa empieza a sentirse "de verdad", porque los rivales jugarán rangos coherentes (y el coach luego podrá razonar sobre ellos: "el UTG subió, su rango es fuerte...").

commit
feat(backend): motor de mesa y IA de bots con tests

- poker_table.py: motor de una mano (reparto, ciegas/ante, orden
  posicional con re-apertura de ronda, showdown con side-pots)
- poker_bot.py: decisiones de rivales (perfiles nit/tag/lag/station,
  rangos preflop ponderados + Chen, equity vs pot odds postflop)
- tests: 3 tests de mesa + 4 de bots (incl. fuzz 200 manos), todos verdes

