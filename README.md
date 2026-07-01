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

## Shift interpretation

- `D` day shift = Morning In + Evening Out
- `N` night shift = Evening In + Morning Out
- `OFF` = no trip

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
