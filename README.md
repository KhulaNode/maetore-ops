# Maetore Transport Services SPA/PWA v2

A lightweight HTML/CSS/JS single-page app for Sasol R71 Staff Transport.

## Features

- Brighter Maetore-themed UI based on the uploaded image
- Static JSON datastore
- Schedule split into 4 trip columns:
  - Morning In
  - Morning Out
  - Evening In
  - Evening Out
- Today view
- Passenger private page preview
- Payment page link to Paystack
- DynamoDB-ready JSON structure

## Shift interpretation and transport rules

- `D` day shift = **Morning In** and **Evening Out** on the roster date.
- `N` night shift starts with **Evening In** on the roster date and ends with **Morning Out** on the following calendar date.
- For consecutive `N` dates, the first `N` has Evening In only; each middle `N` date has Morning Out (from the previous night) and Evening In (for the new night).
- The date after the final `N` has Morning Out only, even when that roster date is marked `OFF`.
- `OFF` = no trip, unless it is carrying the Morning Out after a preceding `N` shift.
- `D/S` is treated as a day shift for its own transport (Morning In + Evening Out). If it immediately follows an `N`, it also retains that night shift's Morning Out.

These rules are applied per passenger and date. Do not place a Morning Out on the same date as the first night shift unless that passenger also worked an `N` shift the previous night.

## Route ordering script

Build daily road-distance route orders without PostGIS or pgRouting:

```bash
python3 scripts/optimize_daily_route.py --date 2026-07-09 --movement morningIn --print
```

The script reads `data/schedules.json` and `data/passenger-home-locations.geojson`, then writes:

- `route_outputs/<date>_<movement>_route.json`
- `route_outputs/<date>_<movement>_route.geojson`

Generate every movement for a date range:

```bash
python3 scripts/optimize_daily_route.py --start-date 2026-07-01 --end-date 2026-07-14
```

Movements:

- `morningIn`
- `eveningIn`
- `morningOut`
- `eveningOut`

Rules:

- Inbound trips order all eligible pickups and dropoffs furthest-to-closest to Sasol R71.
- Outbound trips order all eligible pickups and dropoffs closest-to-furthest from Sasol R71.
- A passenger can never be dropped off before their pickup stop has happened.
- Dropoffs can happen between pickups when their distance rank places them there.

By default distances use the local OSM GraphML road engine:

```text
/home/moloko/My_Projects/maetore_routing/maetore_osm_outputs/maetore_polokwane_drive_graph.graphml
```

To use a different local OSM road graph, pass GraphML:

```bash
python3 scripts/optimize_daily_route.py \
  --date 2026-07-09 \
  --movement morningIn \
  --graphml /home/moloko/My_Projects/maetore_routing/maetore_osm_outputs/maetore_polokwane_drive_graph.graphml \
  --print
```

Use `--haversine` only for quick diagnostics when a road graph is unavailable.
