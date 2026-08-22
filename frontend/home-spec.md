# PreflopLab — HOME (dark) · Especificación de diseño

Rediseño de la home. Tema oscuro, estética "terminal de trader": datos tabulares, bordes finos, elevación por sombras, acentos de color con significado. **No** casino, **no** gradientes de fondo grandes, **no** emoji decorativo.

Ancho de referencia del diseño: 1600px. Todo el layout es fluido (grid/flex + gap); los valores en px son de la maqueta a 1600.

---

## 0. Tipografía (importante — es lo que le da el carácter)

Dos familias, cargadas desde Google Fonts:

```html
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
```

- **`Barlow Condensed` 700** → SOLO para titulares, números grandes y etiquetas de botón. Condensada y contundente. Aplícala a: H1 del hero, títulos de tarjeta, valores numéricos de las métricas/tiles, texto de los CTA, titular del CTA final.
- **`JetBrains Mono`** → todo lo demás: cuerpo, etiquetas, badges, navegación, datos. Es lo que da el aire de herramienta técnica.
- **Etiquetas de sección y micro-etiquetas**: JetBrains Mono, 8–10px, `font-weight:700`, `letter-spacing:1.2–1.7px`, mayúsculas, color `#616c7c`. Este patrón se repite en toda la página (`ESTRUCTURA DEL TORNEO`, `CÓMO FUNCIONA`, `TU PRECISIÓN`…).

En Tailwind: extiende el theme con `display: ['Barlow Condensed', 'sans-serif']` y `mono: ['JetBrains Mono', 'monospace']`.

---

## 1. Paleta y semántica del color

| Rol | Base | Claro (texto sobre oscuro) |
|---|---|---|
| Azul eléctrico — acción principal / raise / precisión | `#3b82f6` | `#7aa6ff` |
| Verde — acierto / call / en vivo | `#10b981` | `#34d399` |
| Ámbar — marginal / errores / ciegas | `#f59e0b` | `#fbbf24` |
| Morado — all-in / Coach IA / fase | `#a855f7` | `#c4a3f7` |

Superficies (de fuera a dentro):

| Uso | Valor |
|---|---|
| Fondo de página | `#0a0c11` |
| Navbar | `#11151c` |
| Card / panel | `#0f131a` |
| Tile interior (dentro de una card) | `#161b24` |
| Borde de card | `#1e2530` – `#222a36` |
| Borde de tile | `#252d3a` |
| Separador de sección | `#161c25` |

Texto: principal `#e8edf4` · secundario `#96a1b1` · terciario `#8b95a4` · micro-etiqueta `#616c7c`.

**Sombras** (la profundidad es clave, nada plano):
- Card/panel: `0 5px 20px rgba(0,0,0,.5)`
- Tile: `0 2px 8px rgba(0,0,0,.42)`
- Navbar: `0 2px 14px rgba(0,0,0,.55)`
- Mockup destacado: `0 14px 44px rgba(0,0,0,.6)`
- Barra hundida (progreso): `inset 0 1px 3px rgba(0,0,0,.6)`
- **Glow de color** (para elementos con acento): `0 0 0 1px <color>22, 0 3px 10px <color>2e`

Patrón recurrente: **card con `border-top: 2px solid <color-de-acento>`** para identificar de qué trata cada tarjeta.

---

## 2. NAVBAR (64px, sticky)

- `background:#11151c`, `border-bottom:1px solid #1e2530`, sombra de navbar, `position:sticky; top:0; z-index:30`.
- Izquierda: logo cuadrado 35px `rounded-[10px]` con `linear-gradient(140deg,#3b82f6,#6366f1)` y glow azul; al lado "PREFLOP**LAB**" (Barlow Condensed 700, 20px, "LAB" en azul) y debajo `MTT TRAINER` (7.5px, `letter-spacing:1.6px`, `#5b6674`).
- Centro: los 8 tabs con su glifo delante (`⌂ Home`, `◈ Train`, `⛁ Práctica`, `♞ Torneo`, `♛ Sit&Go`, `▦ Stats`, `↺ Review`, `↥ Admin`), 12.5px, padding `9px 15px`, `rounded-[9px]`.
  - **Tab activo**: `background:#1c2230`, `border:1px solid #3b82f6`, texto `#e8edf4`, `box-shadow:0 0 0 1px rgba(59,130,246,.2), 0 3px 10px rgba(0,0,0,.45)`.
  - Inactivos: solo texto `#8b95a4`, `border:1px solid transparent` (para que no salten al activarse).
- Derecha: botón `◔ Entrar` — `bg #161b24`, `border #2f3846`, sombra de tile.

---

## 3. HERO — `grid-template-columns: 1fr 748px`, gap 52px, padding `56px 60px 48px`

### Columna izquierda
1. **Badge de contexto**: `RANGOS GTO · 500 JUGADORES · MESA FINAL` — azul translúcido (`bg rgba(59,130,246,.11)`, `border #2f6fed`, texto `#7aa6ff`), 9.5px/700/`ls 1.5px`, con un **punto verde de 5px que late** delante (`animation: pulseDot 2s infinite`, `box-shadow:0 0 6px #34d399`).
2. **H1**: Barlow Condensed 700, **112px**, `line-height:.85`, `letter-spacing:-2px`, en dos líneas → `PREFLOP` en azul `#3b82f6` / `EDGE.` en blanco con el punto final en azul.
3. **Subtítulo** 16.5px `line-height:1.68` color `#96a1b1`, con los términos técnicos (`fold equity`, `bloqueadores`, `ICM`) resaltados en `#e8edf4`.
4. **Línea de gancho**: texto 13px ámbar `#fbbf24` con `border-left:2px solid #f59e0b` y `padding-left:12px` → "Puntúas por la calidad de tu decisión, no por ganar el bote."
5. **Dos CTA**:
   - Primario `♠ EMPEZAR TORNEO →`: **fondo blanco**, texto `#0a0c11`, Barlow Condensed 22px/700/`ls 1.2px`, padding `18px 32px`, `rounded-[11px]`, la flecha en azul, `box-shadow:0 6px 26px rgba(255,255,255,.15), 0 2px 8px rgba(0,0,0,.55)`.
   - Secundario `↑ SUBIR RANGOS`: `bg #141922`, `border #2f3846`, texto `#c2cad6`, misma tipografía y altura.
6. **Cápsula de credibilidad**: una sola pieza segmentada (`bg #141922`, `border #232b38`, `rounded-[11px]`, `overflow:hidden`, `width:fit-content`) con 4 celdas separadas por `border-right:1px solid #232b38`: `500 / JUGADORES MÁX`, `9 / FASES DE CIEGAS`, `169 / COMBOS POR RANGO`, `GTO / BASE DE RANGOS`. Valor en Barlow Condensed 25px; etiqueta 8.5px `#616c7c`.

### Columna derecha — dashboard "en directo"
**a) Card "ESTRUCTURA DEL TORNEO"** con badge `● EN DIRECTO` (verde, punto latiendo):
- 5 tiles en `grid-cols-5 gap-9px`: `JUGADORES 500` (blanco), `NIVEL 4` (azul), `CIEGAS 3/6` (ámbar), `TU STACK 112` (verde), `FASE MEDIA` (morado). Valores Barlow Condensed 24px.
- Debajo, **barra de progreso al dinero**: etiquetas `PROGRESO AL DINERO · TOP 75` / `PUESTO 128 / 500`; barra 6px con relleno `linear-gradient(90deg,#1d4ed8,#3b82f6,#60a5fa)` al 74.4% y una **marca verde vertical de 2px** al 85% (la burbuja) con `box-shadow:0 0 6px #34d399`.

**b) Fila `grid-template-columns: 1fr 268px`** con las métricas a la izquierda y el heatmap a la derecha.

**Métricas** (2 cards apiladas, `border-left:2px solid <color>`), layout horizontal:
- Icono en caja 36px con glow del color · etiqueta + subtítulo · valor grande (Barlow Condensed 40px) + delta en pill (`+6` azul / `−2` ámbar).
- Barra de progreso hundida al % correspondiente.
- Pie: **sparkline de 12 barritas** de 4px (las 3 últimas a color pleno, el resto al 30%) y a la derecha el enlace `DASHBOARD →` / `REVISAR →`.
- Datos: `TU PRECISIÓN 64% (+6), 11 manos jugadas, barra 64%` (azul) · `ERRORES 4 (−2), Manos por revisar, barra 34%` (ámbar).

**c) Rejilla 13×13 (la firma visual)** — card 268px de ancho:
- Cabecera: `RANGO · UTG APERTURA` + `169 combos · 18.4% abierto`.
- `grid-template-columns: repeat(13, 1fr)`, `gap:1.5px`, celdas `aspect-ratio:1`, `rounded-[2px]`, texto 6.5px/600 centrado.
- **Generación**: filas y columnas con el orden `A K Q J T 9 8 7 6 5 4 3 2`. Diagonal = pareja (`AA`), encima de la diagonal = suited (`AKs`), debajo = offsuit (`AKo`).
- Color por acción:
  - all-in/4-bet → `bg rgba(168,85,247,.34)`, `border #a855f7`, texto `#e9d5ff`
  - raise/3-bet → `bg rgba(59,130,246,.3)`, `border rgba(59,130,246,.75)`, texto `#bfdbfe`
  - call → `bg rgba(16,185,129,.22)`, `border rgba(16,185,129,.55)`, texto `#a7f3d0`
  - fold → `bg #141922`, `border #1e2530`, texto `#4b5563`
- Clasificación (heurística de apertura UTG, sustitúyela por tus rangos reales si los tienes en el backend): parejas ≥TT → all-in; parejas 77–99 → raise; parejas menores → call; A con suited o kicker ≥J → raise; K suited con kicker ≥9 → raise; ambas ≥Q → raise; suited con gap ≤2 y baja ≥6 → call; cualquier A → call; K con kicker ≥T → call; resto fold.
- **Leyenda** debajo, 4 filas con cuadradito de color + nombre + % a la derecha: All-in 3.0% · Raise 15.4% · Call 11.8% · Fold 69.8%.

---

## 4. CUATRO MODOS — `grid-cols-4 gap-15px`, padding `44px 60px 46px`

Cabecera de sección: etiqueta `CUATRO FORMAS DE ENTRENAR` + línea `flex-1 h-px` con `linear-gradient(90deg,#232b38,transparent)`. **Este patrón de cabecera se repite en todas las secciones.**

Cada tarjeta: `bg #0f131a`, `border #1e2530`, `border-top:2px solid <color>`, `rounded-[13px]`, padding `19px 20px 21px`, sombra de card. Dentro: icono en caja 38px con glow + badge a la derecha; título Barlow Condensed 25px; cuerpo 12.5px `#8b95a4`.

**Hover** (todas las tarjetas de la página): `border-color:<color>`, `box-shadow:0 0 0 1px <color>33, 0 12px 30px <color>26`, `transform:translateY(-3px)`, `transition:all .16s`.

| Modo | Icono | Badge | Color |
|---|---|---|---|
| TORNEO | ♞ | MULTI-MESA | azul |
| SIT&GO | ♛ | 9 JUGADORES | morado |
| PRÁCTICA | ⛁ | MANOS SUELTAS | verde |
| TRAIN | ◈ | ESCENARIOS | ámbar |

---

## 5. COACH IA — `grid-template-columns: 1fr 640px`, gap 56px

Fondo de sección: `linear-gradient(180deg,#0c0f15,#0a0c11)` (sutil, solo para separar la banda).

**Izquierda**: badge morado `✦ COACH IA`; titular Barlow Condensed 56px a dos tonos → "NO TE DICE QUÉ HACER." en blanco / "TE DICE POR QUÉ." en `#c4a3f7`; párrafo 15px; y 4 puntos numerados (`01`–`04`) donde el número va en pill con el color de cada uno (azul, verde, ámbar, morado): pot odds/equity/breakeven · lectura del rival · fold equity · ICM y burbuja.

**Derecha — mockup del panel de ayuda real** (`bg #0f131a`, `border #222a36`, `rounded-[15px]`, padding 16px, sombra de mockup):
1. Cabecera en tile: `AYUDA · MANO 4` + badge `● EN VIVO`.
2. Fila `1fr 186px`: **card de veredicto** (`bg #101a2a`, `border #2f6fed`, glow azul) con `HAZ CALL` en Barlow Condensed 27px azul claro + badge `MARGINAL` ámbar + una línea de justificación; y al lado un tile con **las dos cartas** K♦ Q♦ (44×60px, blancas, `rounded-[6px]`, sombra fuerte, rojo `#dc2626`) y `BTN · 97 BB` debajo.
3. **3 tiles matemáticos**: `POT ODDS 38.5%` (ámbar) · `EQUITY 45.3%` (verde) · `BREAKEVEN 55.6%` (rosa `#f087b6`).
4. **Barra equity vs requerido**: `NECESITAS 38.5%` / `TIENES 45.3%`; barra 7px con relleno verde degradado al 45.3% y **marca ámbar de 2px al 38.5%** con glow. Comunica de un vistazo si es rentable.
5. **Desglose de frecuencias**: 3 filas con pill de acción (54px de ancho), barra 5px y % a la derecha → `CALL 93%` azul, `RAISE 5%` verde, `ALL-IN 2%` morado.

---

## 6. CÓMO FUNCIONA — `grid-cols-3 gap-17px`

Tarjetas con `border-top:2px solid <color>`, número grande `01/02/03` en Barlow Condensed 30px color `#2b3441` (apagado, decorativo) e icono en caja a la derecha. Título Barlow Condensed 26px, cuerpo 13px, y al pie un **badge-etiqueta** que evita el hueco vacío que tenía el diseño anterior:

1. **SIMULACIÓN REAL** (azul, ♞) — badge `MOTOR EN TIEMPO REAL`
2. **ESTRATEGIA MIXTA** (verde, ◈) — badge `DESGLOSE POR FRECUENCIA`
3. **MAPA DE DEBILIDADES** (morado, ▦) — badge `POSICIÓN · FASE · ACCIÓN`

---

## 7. CTA FINAL

Banda `margin: 0 60px 56px`, padding `40px 46px`, `bg #0f131a`, `border #222a36`, **`border-top:2px solid #3b82f6`**, `rounded-[16px]`, `box-shadow:0 8px 34px rgba(0,0,0,.55)`. A la izquierda titular Barlow Condensed 44px "500 JUGADORES. UNA DECISIÓN CADA VEZ." + línea de apoyo; a la derecha el CTA blanco repetido.

---

## 8. Animación

Una sola, para los puntos de estado "en vivo":

```css
@keyframes pulseDot { 0%,100%{opacity:1} 50%{opacity:.35} }
```

Aplicada a los puntos verdes de 4–5px de los badges EN DIRECTO / EN VIVO. Nada más se mueve.

---

## Reglas transversales
- Grupos de elementos con **flex/grid + `gap`**, nunca márgenes por elemento.
- Toda card lleva borde + sombra; **nada plano**.
- El color siempre significa algo (azul acción, verde acierto, ámbar marginal, morado all-in). No decorar con color.
- Micro-etiquetas siempre en mayúsculas con `letter-spacing`.
- Los datos del dashboard deben venir del backend real cuando exista el endpoint; en la maqueta van los valores de arriba.
