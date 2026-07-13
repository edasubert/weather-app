# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Static weather app — no server, no cookies, no tracking. Built with TypeScript and Tailwind CSS. Core feature: show today's forecast alongside yesterday's weather for comparison.

## Stack

- **Vite** — dev server and bundler
- **TypeScript** — strict, `moduleResolution: "bundler"`
- **Tailwind CSS v4** — via `@tailwindcss/vite` plugin (no PostCSS config, no tailwind.config.js)
- No backend, no analytics, no cookies

## Theming

All colors go through semantic tokens defined in `src/style.css`: an `@theme` block declares them (`--color-heading`, `--color-surface`, `--color-edge`, …) and the `.dark` / `.hc` / `.hc.dark` blocks override the same variables. Markup uses one utility per color (`text-muted`, `bg-surface`, `border-edge`) — never per-theme variant chains. The `dark:`/`hc:` variants (declared via `@custom-variant`) are reserved for structural differences only (e.g. `hc:border-2`, `hc:grid-cols-1`). Chart SVG internals and tooltips consume plain variables (`--chart-label`, `--tooltip-bg`, …) directly.

## Commands

```
npm run dev        # start Vite dev server (http://localhost:5173)
npm run build      # tsc + vite build → dist/
npm run preview    # serve dist/ locally
npm run typecheck  # tsc --noEmit
```

## Architecture

All logic is client-side. Source is under `src/`:

- `weather.ts` — single `fetchWeather(lat, lon)` call to Open-Meteo forecast API with `past_days=1&forecast_days=1`; returns `{ today, yesterday }` from the same response (index 0 = yesterday, index 1 = today)
- `geocoding.ts` — `searchCity(query)` via Open-Meteo geocoding API (no key required); geolocated positions are labeled with their coordinates (no reverse-geocoding service)
- `wmo.ts` — WMO weather code → `{ label, emoji }` lookup table
- `types.ts` — `DailyWeather` and `GeoResult` interfaces
- `main.ts` — app state, DOM rendering, event handling; module-level `unit` ('C'|'F') and `suggestions` variables drive re-renders


## Weather comparison
There will be a comparison of today's weather forecast to yesterday's weather history. 
* temperature
    * will state the difference in degrees
    * will comment on the significance of change
* precipitation
    * if there is no rain on both days, just state still no rain or something like that
    * if there was rain yesterday but is none forecasted for today, just state no rain today or something like that
    * if there was no rain yesterday but it is forecasted for today, just state it will rain today or something like that
    * if there is rain on both days, just state it will rain more/less/about the same or something like that
* wind
    * will state the difference in speed
    * will comment on the difference in wind today and yesterday