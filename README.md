# Moto Consumo

PWA mobile-first para registrar repostajes y consultar el consumo real de una motocicleta. Los datos permanecen exclusivamente en el dispositivo mediante IndexedDB.

## Desarrollo

Requiere Node.js 22 y pnpm.

```bash
pnpm install
pnpm dev
```

Comprobaciones disponibles:

```bash
pnpm build
pnpm test
pnpm build:github
```

## GitHub Pages

El workflow `.github/workflows/deploy-pages.yml` publica automáticamente la versión estática al hacer push a `main`. En el repositorio, selecciona **Settings → Pages → Source → GitHub Actions** una sola vez.

La ruta base, el manifiesto y el service worker son relativos, por lo que funcionan tanto en un dominio propio como en la subruta de un proyecto de GitHub Pages.
