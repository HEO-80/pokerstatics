# PreflopLab — Sit&Go: layout que entra en una pantalla (sin scroll)

Objetivo: que toda la sesión (navbar + coach + mesa + acciones + raise) quepa en el viewport sin scroll vertical, y que los paneles laterales se puedan abrir/cerrar sin deformar la mesa.

Stack: React + Tailwind (CRA/CRACO). Componentes implicados:
`pages/SitAndGo.jsx`, `components/NavBar.jsx`, `components/TournamentHUD.jsx`, `components/CoachPanel.jsx`, `components/AiCoachPanel.jsx`, `components/ActivityLog.jsx`, `components/PokerTable.jsx`, `components/ActionButtons.jsx`, `components/PlayActionBar.jsx`.

---

## 1. Eliminar la segunda barra (la de "SIT & GO … SALIR")

Hoy hay **dos barras apiladas**: la NavBar y debajo la de sesión (logo SIT & GO + `Quedan 9/9 · Tu stack · Nivel · Ciegas · Sube en N manos` + SALIR). Eso consume ~50px y es la causa principal del desborde.

- **Quita el logo/bloque "SIT & GO"** de esa barra (la pestaña activa de la NavBar ya indica dónde estás).
- **Mueve el contexto de sesión a la NavBar**, a la derecha, como una **cápsula de stats** de una sola pieza: celdas `MESA / JUGADORES / STACK / NIVEL / CIEGAS`, cada una con etiqueta pequeña arriba (10px, `tracking-wide`, gris) y valor debajo (13px, `font-bold`, con color: stack verde, ciegas ámbar, mesa morado).
- **El botón SALIR** pasa también a la NavBar, a la derecha de la cápsula.
- Resultado: una sola barra de ~54px. Elimina el contenedor de la barra vieja (probablemente en `SitAndGo.jsx` o `TournamentHUD.jsx`).

## 2. Altura total controlada (esto es lo que quita el scroll)

En el contenedor raíz de `SitAndGo.jsx`:
```jsx
<div className="h-screen flex flex-col overflow-hidden">
  <NavBar … />                                   {/* shrink-0 */}
  <div className="flex-1 min-h-0 flex relative"> {/* body */}
    …
  </div>
</div>
```
Reglas clave, aplícalas a todos los hijos:
- Cada bloque de altura fija: `shrink-0`.
- Cada contenedor que debe absorber el resto: `flex-1 min-h-0` (el `min-h-0` es imprescindible o el flex desborda).
- Ningún `min-h-screen` ni alturas en `vh` dentro del body.

## 3. Panel izquierdo = AYUDA (`CoachPanel.jsx`), reordenado

El problema no es el ancho, es que vuelca 5 bloques de prosa a longitud completa. Reordénalo así (de arriba abajo):

1. **Cabecera**: `AYUDA` + `7 / 7` + badge `EN VIVO` + flechas ‹ ›.
2. **Veredicto ARRIBA** (hoy está al final): card con borde azul y glow → título grande `HAZ CALL` + badge `MARGINAL` (ámbar) + **una sola línea** de justificación. Es lo que se lee en 2 segundos.
3. **3 tiles de números** en `grid grid-cols-3 gap-2`: `POT ODDS 38.5%` (ámbar) · `EQUITY 45.3%` (verde) · `BREAKEVEN 55.6%` (rosa).
4. **Barra comparativa**: `NECESITAS 38.5%` vs `TIENES 45.3%`, con relleno verde al % de equity y una marca ámbar vertical en el % requerido. Comunica de un vistazo si el call es rentable.
5. **Acordeones plegables** (aquí vive TODO el texto largo que hoy causa el scroll): `POR QUÉ` (abierto por defecto), `LECTURA DEL RIVAL` (cerrado), `SI SUBES A 10` (cerrado). Cabecera clicable con caret que rota. El contenedor de acordeones es el único con `flex-1 min-h-0 overflow-y-auto`, así el scroll queda confinado ahí y nunca en la página.

Ancho del panel: `w-[302px] shrink-0`.

## 4. Panel COACH IA (`AiCoachPanel.jsx`) — encima del de ayuda

- **Mismo hueco, misma posición y mismo tamaño** que el panel de ayuda: el contenedor izquierdo pasa a `relative`, el panel de ayuda va en `absolute inset-0`, y el de Coach IA se monta también en `absolute inset-0` **por encima** cuando está activo.
- Identidad morada: fondo violáceo oscuro, borde `#7c3aed`, textos lila.
- Dentro, en la parte superior, un **botón alargado a todo el ancho**: `✦ PREGÚNTALE AL COACH (IA)` (fondo morado translúcido, borde morado, glow). Debajo, el área de respuesta `flex-1 min-h-0 overflow-y-auto`.
- Se cierra con el mismo botón de la toolbar (toggle) o con la ✕ de su cabecera.

## 5. Toolbar de la mesa: tres toggles

En la fila fina sobre la mesa (donde hoy están ACTIVIDAD / COACH IA), deja **tres botones en este orden**:

| Botón | Color | Controla |
|---|---|---|
| `? AYUDA` | **blanco** (fondo blanco, texto oscuro) cuando activo | panel izquierdo de ayuda |
| `✦ COACH IA` | morado (relleno translúcido + glow) | panel IA sobre el de ayuda |
| `⟲ ACTIVIDAD` | azul | drawer derecho |

Inactivos: fondo oscuro `#161b24`, borde `#2b3441`, texto gris, con sombra sutil. Activos: relleno del color + `ring` del mismo color.

## 6. Panel de actividad (`ActivityLog.jsx`) — columna en flujo, NO overlay

Importante: **no lo pongas `absolute` sobre la mesa**. Si se superpone, tapa asientos (KLAUS/MARCOS/ALBA quedaban cortados). Debe ser un **hermano flex** de la mesa:
```jsx
{actOpen && <aside className="w-[290px] shrink-0 …">…</aside>}
```
Así la mesa se estrecha y los asientos (posicionados en %) se recolocan solos. El log lleva su propio `overflow-y-auto`.

## 7. Mesa (`PokerTable.jsx`) y zona inferior

- La mesa vive en `flex-1 min-h-0` y el fieltro ocupa `w-full h-full` (elipse con `rounded-[50%/44%]`), sin alturas fijas → se adapta al espacio que quede.
- Los asientos se posicionan en **porcentajes** sobre el fieltro (no en px), para que sobrevivan al cambio de ancho al abrir/cerrar paneles.
- Zona inferior compacta y toda `shrink-0`: barra de timer (~30px) → `ActionButtons` en `grid grid-cols-4 gap-3` con botones de ~54px → fila de RAISE en **una sola línea** (slider + MIN/⅓/½/BOTE + valor), unos 62px.
- Reduce el padding vertical general (`px-4 py-2`) — es lo que permite que todo entre.

---

## Resumen de por qué esto resuelve el scroll
- Se elimina una barra completa (~50px).
- El texto largo del coach pasa de "todo desplegado" a acordeones, y su scroll queda dentro del panel.
- Todo el árbol usa `h-screen` + `flex-1 min-h-0` + `shrink-0`, así ninguna sección puede empujar la página.
- Los drawers son columnas en flujo, así abrir un panel reduce la mesa en vez de taparla.
