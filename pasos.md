
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

¡Los 4 tests pasan, incluido el fuzz de 200 manos! Ese es el que da confianza de verdad: significa que los bots jugaron cientos de manos completas con distintos perfiles y números de jugadores, sin lanzar una sola acción ilegal y conservando las fichas. La lógica de decisión es sólida.

Y presta atención a lo que reporta, porque es exactamente lo que queríamos que pasara: el fuzz cazó un bug real. Los tamaños de apuesta salían con decimales (pot × 0.66, etc.), y eso descuadraba el reparto de botes que asume fichas enteras — una mano acabó con 1612.48 en vez de 1611. Lo arregló redondeando los importes a entero, y sin tocar poker_table.py (que sigue intacto y verde). Ese es justo el valor de haber pedido el fuzz: un error que en producción habría sido un "de vez en cuando las fichas no cuadran y no sé por qué", cazado y resuelto antes de que llegue a la mesa. Sonnet 5 lo manejó muy bien.

Un par de detalles buenos que hizo bien:

Heurística de Chen + posición para cuando no hay rango cargado — es una fórmula estándar y reconocida para valorar manos preflop, buena elección
Postflop compara equity real vs pot odds — usa el motor de verdad, no inventa
Clamp final de legalidad — cualquier decisión pasa por un filtro que garantiza que sea legal, red de seguridad correcta

Paso 2 hecho y verificado. Marca las casillas.

Dónde estamos:

✅ Paso 1 — Motor de una mano (side-pots) — 3 tests verdes
✅ Paso 2 — IA de los bots (perfiles, rangos, equity) — 4 tests verdes
⬜ Paso 3 — Endpoint de la mesa ← siguiente
⬜ Paso 4 — Mesa visual
⬜ Paso 5 — El coach
⬜ Paso 6 — Puntos y niveles

Ya tienes todo el cerebro del juego funcionando por debajo: repartir, apostar, side-pots, y rivales que deciden con criterio. Lo que falta ahora es sacarlo del backend puro y hacerlo jugable.

El siguiente paso (3) es el endpoint de la mesa: conectar poker_table + poker_bot al server.py para que se pueda crear una mano, ver el estado, y que tú (y los bots) actuéis vía API. Aquí es donde por fin tocamos server.py — que hasta ahora habíamos dejado en paz a propósito. Es también donde entra una decisión de diseño que conviene pensar un momento: cómo se guarda el estado de una mano entre jugada y jugada (en memoria, o en Mongo).

¡Los 3 tests pasan y los 10 en conjunto siguen verdes! La mesa ya es jugable por API — el test clave (jugar una partida entera con las cartas de los rivales ocultas hasta el final, conservando fichas) pasó. Eso es un hito grande: tienes el juego completo funcionando por debajo, solo que aún sin cara visible.

Y fíjate en dos cosas que hizo bien Sonnet, porque demuestran que trabajó con criterio y no a ciegas:

1. Tocó server.py con exactamente las 2 líneas que pedimos (import + include_router), nada más. Justo lo que queríamos.

2. Te corrigió un error MÍO. En el prompt te dije que reutilizara poker_table.state(), pero ese método no existe — me lo inventé al redactar. En vez de crear un state() falso o duplicar lógica, construyó la vista del hero directamente en el router a partir de los atributos reales de la clase Hand. Eso es exactamente lo que quieres de un agente: que verifique contra el código real en vez de tragarse una instrucción incorrecta. Bien por él, y disculpa el desliz por mi parte.

Sobre su pregunta (si quieres un Hand.state() reutilizable): sí, pero más adelante. Cuando lleguemos al coach y al frontend probablemente venga bien tener ese método centralizado. Por ahora déjalo como está — funciona, y no conviene tocar poker_table.py sin necesidad. Lo apuntamos para cuando haga falta.

Paso 3 hecho y verificado.

Dónde estamos:

✅ Paso 1 — Motor de una mano (side-pots)
✅ Paso 2 — IA de los bots
✅ Paso 3 — Endpoint de la mesa (jugable por API, cartas ocultas) ← recién hecho
⬜ Paso 4 — Mesa visual ← siguiente
⬜ Paso 5 — El coach
⬜ Paso 6 — Puntos y niveles

Has terminado todo el backend del juego. Repartir, apostar, side-pots, bots con criterio, y una API para jugar manos completas. Todo probado, 10 tests en verde.

El paso 4 es la mesa visual — y aquí cambia el tipo de trabajo: dejamos el backend (Python, lógico, testeable) y pasamos al frontend (React, visual). Es más "de diseño" y menos "de verificación con tests", así que el flujo será distinto: en vez de tests que pasan, iremos mirando capturas de cómo se ve.

Este es un momento perfecto para commit antes de meternos con el frontend, porque el backend queda cerrado y estable. Un mensaje sencillo:

feat(backend): API de mesa jugable con estado en memoria

Y hago balance, porque el Sit & Go está prácticamente cerrado a nivel funcional. Repasando tu lista de cosas pendientes, quedaban:


✅ Paso 1 — Motor de una mano (side-pots)
✅ Paso 2 — IA de los bots
✅ Paso 3 — Endpoint de la mesa (jugable por API, cartas ocultas) ← recién hecho
⬜ Paso 4 — Mesa visual ← siguiente
⬜ Paso 5 — El coach
⬜ Paso 6 — Puntos y niveles

✅ Ciegas que suben — hecho ahora
⬜ Asientos fijos (que los jugadores no cambien de sitio al eliminarse) — el bug que detectaste ayer, aún pendiente
⬜ Nombres random + pedirte tu nombre
⬜ Separar los asientos de la derecha que se solapan
⬜ Sonidos + temporizador de turno
⬜ El coach (la joya, aún sin empezar)
⬜ la actividad no se tiene que reiniciar asi podemos ver que ha asaduranteo todo el rato quien gano que mano y que hicieron, que ponga tal resuvio tall hizo call tal hizo re raise, el otro all in, tal gagno el bote con tanto.. y cada mano numerada mano 23, oo mano 24 ciga bb tal, ciegga sb tal, este hace call, este hace raise, luego sale el flop, con as ded picas tal y tal.. asi todo

Después de que confirmes las ciegas y hagas el commit, yo iría a por los asientos fijos + nombres + separación de la derecha (los tres van juntos, son "identidad y posición de los jugadores").