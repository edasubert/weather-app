# TODO — maybe someday

Ideas considered but not (yet) implemented. Kept here with enough context to pick up later.

## Precipitation probability in the 14-day outlook
The outlook chart shows precipitation *amounts*, but two weeks out `precipitation_probability` is often the more honest signal. Add it to `HOURLY_VARS` for `fetchOutlook` and render as a subtle band or secondary line in `src/chart.ts` (`buildOutlookChart`). Needs a y-axis decision: 0–100 % maps naturally onto the same normalized scale used for cloud cover.

## Share button
The URL already encodes full state (location + settings), so sharing is just exposing it: a small button using `navigator.share` where available, falling back to `navigator.clipboard.writeText` with a brief "copied" confirmation. Natural spot: next to the location label in the weather view header.

## Model comparison mode
The model picker already lists ~38 models. Allow selecting a second model and overlay its temperature/pressure lines on the hourly chart (e.g. thinner or dotted strokes in the same per-metric colors) to compare forecasts — a genuinely distinctive feature. Requires two `fetchWeather` calls and a variant of `buildChart` that accepts a second series set; the legend and tooltip grid need a third column.

## Stale-data refresh
If a tab stays open overnight, "today" is silently yesterday's fetch. Record the fetch timestamp in the weather view state and re-run `loadWeather` on `visibilitychange` (document becoming visible) when the data is older than ~1 hour. Cheap insurance; also covers laptops waking from sleep.
