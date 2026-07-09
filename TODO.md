# TODO — maybe someday

Ideas considered but not (yet) implemented. Kept here with enough context to pick up later.

## Persist settings in localStorage
Unit, language, theme, high-contrast, model, and last viewed location currently live only in the URL — a fresh visit resets everything to defaults (language now auto-detects from the browser, the rest don't). Mirror them to `localStorage` on change and read them at bootstrap, with URL params taking priority so shared links still override. Local-only storage keeps the no-cookies/no-tracking promise intact. Main touch points: `readUrlSettings()` and the spots that mutate `unit`/`theme`/`model`/`comparison` in `src/main.ts`.

## Recent / favorite locations
Once settings persist, keep a short list (say 5) of recently viewed locations in `localStorage` and show them on the search screen for one-tap access. `GeoResult` already carries everything needed (name, admin1, country, lat, lon).

## Precipitation probability in the 14-day outlook
The outlook chart shows precipitation *amounts*, but two weeks out `precipitation_probability` is often the more honest signal. Add it to `HOURLY_VARS` for `fetchOutlook` and render as a subtle band or secondary line in `src/chart.ts` (`buildOutlookChart`). Needs a y-axis decision: 0–100 % maps naturally onto the same normalized scale used for cloud cover.

## Share button
The URL already encodes full state (location + settings), so sharing is just exposing it: a small button using `navigator.share` where available, falling back to `navigator.clipboard.writeText` with a brief "copied" confirmation. Natural spot: next to the location label in the weather view header.

## PWA / offline support
A static app is the ideal candidate: add a web manifest (installable, proper icon) and a service worker that precaches the app shell and serves the last-fetched weather response when offline, with a visible "stale data from <time>" note. Vite has `vite-plugin-pwa` for this; keep it dependency-light if possible.

## Model comparison mode
The model picker already lists ~38 models. Allow selecting a second model and overlay its temperature/pressure lines on the hourly chart (e.g. thinner or dotted strokes in the same per-metric colors) to compare forecasts — a genuinely distinctive feature. Requires two `fetchWeather` calls and a variant of `buildChart` that accepts a second series set; the legend and tooltip grid need a third column.

## Stale-data refresh
If a tab stays open overnight, "today" is silently yesterday's fetch. Record the fetch timestamp in the weather view state and re-run `loadWeather` on `visibilitychange` (document becoming visible) when the data is older than ~1 hour. Cheap insurance; also covers laptops waking from sleep.
