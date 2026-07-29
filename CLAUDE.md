# Céntrico (atlas-zmg)

Web app de mapa para análisis gráfico de la Zona Metropolitana de Guadalajara:
el usuario dibuja zonas, rutas y puntos de interés, los organiza y calcula
"centros óptimos" ponderados para decidir dónde vivir. 100% estática, sin
backend. Deploy en Vercel; datos del usuario en localStorage (aislados por
navegador/dominio, se migran con export/import GeoJSON).

## Stack y estructura

- Vite (vanilla JS, sin framework). `npm run dev` / `npm run build`.
- Leaflet 1.9.4 + Leaflet.draw 1.0.4 **por CDN (cdnjs)** en `index.html`;
  `L` es global. Migrar a npm es refactor pendiente, no urgente (leaflet-draw
  tiene fricción con ESM: espera `L` global).
- `index.html` — markup (header con export/import/borrar, sidebar, mapa).
- `src/main.js` — TODA la lógica en un IIFE (~1100 líneas). Modularizar es
  pendiente; si se hace, cortes naturales: state/persistencia, sidebar/cards,
  drawing, routing (A→B), centers.
- `src/style.css` — tokens Catppuccin Latte en `:root` (preferencia del
  usuario). UI en español.

## Modelo de datos

- `registry: Map<id, {layer, props}>` con props:
  `{id, kind: 'zone'|'route'|'marker', name, color, notes, group, order, role,
    freq, imp}`.
  - `freq` = visitas/semana (default 1), `imp` = importancia 1–5 (default 3).
  - Peso efectivo `effWeight() = max(0.1, freq × imp)`. Afecta todos los
    cálculos de centro.
  - `role`: null | 'center' | 'center-global' | 'center-routes' — marca los
    resultados de cálculos; se EXCLUYEN como insumo de nuevos cálculos
    (filtro `role.startsWith('center')`) y se reemplazan al recalcular su
    mismo tipo.
- `groups: [{id, name, collapsed}]` — agrupación por tópicos en la sidebar,
  con drag&drop (handle ⠿; drop sobre tarjeta = insertar antes, sobre
  cabecera/cuerpo de grupo = mover al grupo).
- Persistencia: localStorage key `atlas-zmg-v1`, guarda un FeatureCollection
  GeoJSON con `properties` = props y un miembro extra `groups`. Export/import
  usa exactamente el mismo formato (compatible con GeoPandas).
- Zonas se representan por su centroide (`getBounds().getCenter()`) en todos
  los cálculos; rutas nunca son insumo de centros.

## Algoritmos

1. **Centros lineales** (`computeCenter`): proyección equirectangular local,
   centroide ponderado + mediana geométrica ponderada (Weiszfeld, 300 iter,
   tolerancia 0.5 m). Genera DOS marcadores por cálculo: mediana (verde,
   recomendado) y promedio (gris, referencia didáctica del sesgo por
   atípicos). Botones: ◉ Centro (solo puntos) y ◎ Global (puntos + zonas).
2. **Centro por red vial** (`computeRouteCenter`, botón ◈ Rutas): malla
   gruesa 7×7 sobre bbox de destinos (pad 20%) → OSRM `/table` con
   `annotations=distance` (un request, candidatos como sources) → mejor por
   suma ponderada de km → malla fina 5×5 alrededor → snap a vialidad
   (`data.sources[i].location`). Límite: 45 destinos (tope del demo ~100
   coordenadas por tabla).
3. **Ruta A→B**: modo con banner; clic en mapa o sobre figura existente
   (marker → posición exacta, zona → centroide, ruta → punto del clic).
   OSRM `/route` perfil driving; fallback a línea recta si falla. La ruta se
   autonombra "NombreA → NombreB".
4. Métrica clave en notas de centros: **km-viaje semanales** =
   Σ freq_i × 2 × dist_i (ida y vuelta). Es la cifra para comparar
   escenarios.

## Servicios externos

- OSRM demo público (`router.project-osrm.org`), sin API key, sin SLA.
  Manejar fallos con mensaje y reintento manual. Si se necesita volumen:
  self-host OSRM o migrar a ORS/Mapbox.
- Tiles: Carto light (default) y OSM. Requieren internet.

## Convenciones

- UI y textos en español (es-MX). Tono directo, sin filler.
- Colores de elementos: paleta de 6 (latte): #1e66f5 #40a02b #fe640b #d20f39
  #8839ef #179299. Centros: mediana #40a02b, promedio #7c7f93, rutas #fe640b.
- `stopPropagation` obligatorio en cualquier control interactivo dentro de
  `.card` — el click de tarjeta dispara `select()` → `render()` que
  reconstruye el DOM y mata inputs nativos (bug ya ocurrido con el color
  picker).
- `.gitignore` incluye `*.geojson`: los datos del usuario contienen
  ubicaciones personales reales (casa, rutinas) y NUNCA se commitean.

## Pendientes / ideas discutidas

- Modularizar `src/main.js`; migrar Leaflet a npm.
- Radio de bici: círculo configurable (~5 km) alrededor de un centro para
  clasificar destinos bici vs auto.
- Toggle de visibilidad por grupo en el mapa.
- Optimizar por tiempo de manejo (OSRM duration) como alternativa a km —
  el usuario eligió km deliberadamente porque es agnóstico al modo
  (bici para cercano, auto para lejano).
- Perfiles bici/caminata en A→B; rutas con paradas intermedias.