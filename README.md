# Atlas ZMG

Mapa interactivo de la Zona Metropolitana de Guadalajara para análisis gráfico:
zonas, rutas, puntos de interés con notas, pesos (visitas/semana × importancia)
y cálculo de centros óptimos (mediana geométrica ponderada y centro por red vial
con OSRM).

## Desarrollo local

```bash
npm install
npm run dev        # http://localhost:5173
```

Los datos se guardan en localStorage del navegador (por dominio: lo que guardes
en localhost es independiente de lo que guardes en producción). Usa
Exportar/Importar GeoJSON para mover datos entre entornos.

## Git

```bash
git init
git add .
git commit -m "Atlas ZMG: mapa de análisis con centros ponderados"
gh repo create atlas-zmg --private --source=. --push
# (o crea el repo en github.com y: git remote add origin <url> && git push -u origin main)
```

## Deploy en Vercel

Opción A — desde la web: vercel.com → Add New Project → importa el repo.
Vercel detecta Vite solo (build `vite build`, output `dist/`). Cada push a
`main` redespliega.

Opción B — CLI:

```bash
npx vercel        # primer deploy (acepta defaults)
npx vercel --prod
```

## Notas de arquitectura

- 100% estático, sin backend: Leaflet + Leaflet.draw por CDN, lógica en
  `src/main.js`, estilos en `src/style.css`.
- Enrutamiento y matrices de distancia: servidor demo público de OSRM
  (sin API key; sin garantía de disponibilidad — para volumen serio,
  self-host de OSRM o cambiar a ORS/Mapbox).
- Peso efectivo de cada elemento = visitas/semana × importancia (1–5).
  Con los valores por defecto (1 × 3) todos pesan igual.
- Los centros reportan km-viaje semanales (ida y vuelta) para comparar
  escenarios de forma tangible.
