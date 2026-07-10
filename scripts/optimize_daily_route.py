#!/usr/bin/env python3
"""Build Maetore route orders from schedules and passenger GeoJSON.

This intentionally does not need a database. It applies the Maetore movement
rules first, then uses a local OSM GraphML road graph by default. A haversine
fallback is available for quick diagnostics only.
"""

from __future__ import annotations

import argparse
import json
import math
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Iterable


R71 = {
    "id": "r71",
    "name": "Sasol R71",
    "coordinates": [29.5160153, -23.8978861],
}

SPECIAL_DESTINATIONS = {
    "ssi_security": {
        "id": "ssi_security",
        "name": "SSI Security",
        "coordinates": [29.4754902, -23.9133595],
    },
    "sasol_jorrisen": {
        "id": "sasol_jorrisen",
        "name": "Sasol Jorrisen",
        "coordinates": [29.4593845, -23.9052611],
    },
}

IN_MOVEMENTS = {"morningIn", "eveningIn"}
OUT_MOVEMENTS = {"morningOut", "eveningOut"}
MOVEMENTS = sorted(IN_MOVEMENTS | OUT_MOVEMENTS)
DEFAULT_GRAPHML = Path(
    "/home/moloko/My_Projects/maetore_routing/maetore_osm_outputs/maetore_polokwane_drive_graph.graphml"
)


@dataclass(frozen=True)
class Passenger:
    passenger_id: str
    full_name: str
    short_name: str
    pickup_area: str
    dropoff_area: str
    coordinates: list[float]


@dataclass(frozen=True)
class Stop:
    stop_type: str
    name: str
    coordinates: list[float]
    passengers: list[Passenger]
    note: str = ""


@dataclass(frozen=True)
class PendingStop:
    stop: Stop
    required_passenger_ids: set[str]
    picked_passenger_ids: set[str]


class DistanceEngine(ABC):
    name = "unknown"

    @abstractmethod
    def distance_km(self, a: list[float], b: list[float]) -> float:
        raise NotImplementedError


class HaversineEngine(DistanceEngine):
    name = "haversine"

    def distance_km(self, a: list[float], b: list[float]) -> float:
        return haversine_km(a, b)


class GraphMLEngine(DistanceEngine):
    name = "graphml_shortest_path"

    def __init__(self, graphml_path: Path):
        try:
            import networkx as nx
        except ImportError as exc:
            raise SystemExit("GraphML mode requires networkx to be installed.") from exc

        self.nx = nx
        self.graph = nx.read_graphml(graphml_path)
        self.nodes = []
        self.nearest_cache: dict[tuple[float, float], str] = {}

        for _, _, attrs in self.graph.edges(data=True):
            try:
                attrs["length"] = float(attrs.get("length", 0))
            except (TypeError, ValueError):
                attrs["length"] = 0.0

        for node_id, attrs in self.graph.nodes(data=True):
            try:
                lng = float(attrs["x"])
                lat = float(attrs["y"])
            except (KeyError, TypeError, ValueError):
                continue
            self.nodes.append((node_id, [lng, lat]))

        if not self.nodes:
            raise SystemExit(f"No x/y node coordinates found in {graphml_path}")

    def nearest_node(self, coordinates: list[float]) -> str:
        key = (round(coordinates[0], 7), round(coordinates[1], 7))
        if key not in self.nearest_cache:
            self.nearest_cache[key] = min(
                self.nodes,
                key=lambda item: haversine_km(coordinates, item[1]),
            )[0]
        return self.nearest_cache[key]

    def distance_km(self, a: list[float], b: list[float]) -> float:
        source = self.nearest_node(a)
        target = self.nearest_node(b)

        try:
            return float(
                self.nx.shortest_path_length(
                    self.graph,
                    source=source,
                    target=target,
                    weight="length",
                )
            ) / 1000
        except Exception:
            return haversine_km(a, b)


def load_json(path: Path):
    return json.loads(path.read_text())


def normalize_area(value: str) -> str:
    return " ".join(value.lower().replace("-", " ").split())


def destination_key(dropoff_area: str) -> str:
    normalized = normalize_area(dropoff_area)

    if "ssi" in normalized:
        return "ssi_security"
    if "jorrisen" in normalized or "jorissen" in normalized:
        return "sasol_jorrisen"
    return "r71"


def destination_for(dropoff_area: str) -> dict:
    key = destination_key(dropoff_area)
    if key == "r71":
        return R71
    return SPECIAL_DESTINATIONS[key]


def haversine_km(a: list[float], b: list[float]) -> float:
    lng1, lat1 = a
    lng2, lat2 = b
    radius_km = 6371.0088
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lng2 - lng1)
    h = (
        math.sin(delta_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    )
    return radius_km * 2 * math.atan2(math.sqrt(h), math.sqrt(1 - h))


def selected_passenger_ids(schedules: list[dict], date: str, movement: str) -> list[str]:
    return [
        item["passengerId"]
        for item in schedules
        if item.get("date") == date and item.get(movement) is True
    ]


def passengers_by_id(home_locations: dict) -> dict[str, Passenger]:
    passengers: dict[str, Passenger] = {}

    for feature in home_locations.get("features", []):
        props = feature.get("properties") or {}
        geometry = feature.get("geometry") or {}
        coordinates = geometry.get("coordinates")
        passenger_id = props.get("passenger_id")

        if (
            not passenger_id
            or geometry.get("type") != "Point"
            or not isinstance(coordinates, list)
            or len(coordinates) != 2
        ):
            continue

        passengers[passenger_id] = Passenger(
            passenger_id=passenger_id,
            full_name=props.get("full_name") or passenger_id,
            short_name=props.get("short_name") or props.get("full_name") or passenger_id,
            pickup_area=props.get("pickup_area") or "",
            dropoff_area=props.get("dropoff_area") or "",
            coordinates=[float(coordinates[0]), float(coordinates[1])],
        )

    return passengers


def nearest_neighbor_order(
    passengers: Iterable[Passenger],
    start_coordinates: list[float],
    engine: DistanceEngine,
) -> list[Passenger]:
    remaining = list(passengers)
    ordered: list[Passenger] = []
    current = start_coordinates

    while remaining:
        next_passenger = min(
            remaining,
            key=lambda passenger: engine.distance_km(current, passenger.coordinates),
        )
        ordered.append(next_passenger)
        remaining.remove(next_passenger)
        current = next_passenger.coordinates

    return ordered


def destination_groups(passengers: list[Passenger]) -> dict[str, list[Passenger]]:
    destination_groups: dict[str, list[Passenger]] = {}
    for passenger in passengers:
        destination_groups.setdefault(destination_key(passenger.dropoff_area), []).append(passenger)
    return destination_groups


def destination_stop(key: str, passengers: list[Passenger], stop_type: str, note: str) -> Stop:
    destination = R71 if key == "r71" else SPECIAL_DESTINATIONS[key]
    return Stop(
        stop_type=stop_type,
        name=destination["name"],
        coordinates=destination["coordinates"],
        passengers=passengers,
        note=note,
    )


def radial_event_order(
    pending_stops: list[PendingStop],
    direction: str,
    engine: DistanceEngine,
) -> list[Stop]:
    if direction not in {"inbound", "outbound"}:
        raise ValueError(f"Unsupported route direction: {direction}")

    picked_passenger_ids: set[str] = set()
    ordered: list[Stop] = []
    remaining = list(pending_stops)
    current_coordinates: list[float] | None = None

    while remaining:
        eligible = [
            item
            for item in remaining
            if item.required_passenger_ids.issubset(picked_passenger_ids)
        ]
        if not eligible:
            blocked = ", ".join(item.stop.name for item in remaining)
            raise SystemExit(f"No eligible next stop. Check pickup/dropoff dependencies: {blocked}")

        def order_key(item: PendingStop):
            radial_distance = engine.distance_km(R71["coordinates"], item.stop.coordinates)
            travel_distance = (
                engine.distance_km(current_coordinates, item.stop.coordinates)
                if current_coordinates is not None
                else 0.0
            )
            primary = -radial_distance if direction == "inbound" else radial_distance
            return (primary, travel_distance, item.stop.name)

        next_item = min(eligible, key=order_key)
        ordered.append(next_item.stop)
        picked_passenger_ids.update(next_item.picked_passenger_ids)
        current_coordinates = next_item.stop.coordinates
        remaining.remove(next_item)

    return ordered


def order_inbound(passengers: list[Passenger], engine: DistanceEngine) -> list[Stop]:
    if not passengers:
        return []

    pending: list[PendingStop] = []

    for passenger in passengers:
        pending.append(
            PendingStop(
                stop=Stop(
                    stop_type="pickup",
                    name=f"{passenger.full_name} pickup",
                    coordinates=passenger.coordinates,
                    passengers=[passenger],
                    note=f"{passenger.pickup_area} pickup",
                ),
                required_passenger_ids=set(),
                picked_passenger_ids={passenger.passenger_id},
            )
        )

    for key, group in destination_groups(passengers).items():
        pending.append(
            PendingStop(
                stop=destination_stop(
                    key,
                    group,
                    "dropoff",
                    "Inbound dropoff ordered by distance to R71",
                ),
                required_passenger_ids={passenger.passenger_id for passenger in group},
                picked_passenger_ids=set(),
            )
        )

    return radial_event_order(pending, "inbound", engine)


def order_outbound(passengers: list[Passenger], engine: DistanceEngine) -> list[Stop]:
    if not passengers:
        return []

    pending: list[PendingStop] = []

    for key, group in destination_groups(passengers).items():
        pending.append(
            PendingStop(
                stop=destination_stop(
                    key,
                    group,
                    "pickup",
                    "Outbound pickup ordered by distance from R71",
                ),
                required_passenger_ids=set(),
                picked_passenger_ids={passenger.passenger_id for passenger in group},
            )
        )

    for passenger in passengers:
        pending.append(
            PendingStop(
                stop=Stop(
                    stop_type="dropoff",
                    name=f"{passenger.full_name} dropoff",
                    coordinates=passenger.coordinates,
                    passengers=[passenger],
                    note=f"{passenger.pickup_area} dropoff",
                ),
                required_passenger_ids={passenger.passenger_id},
                picked_passenger_ids=set(),
            )
        )

    return radial_event_order(pending, "outbound", engine)


def route_stops(passengers: list[Passenger], movement: str, engine: DistanceEngine) -> list[Stop]:
    if movement in IN_MOVEMENTS:
        return order_inbound(passengers, engine)
    if movement in OUT_MOVEMENTS:
        return order_outbound(passengers, engine)
    raise ValueError(f"Unsupported movement: {movement}")


def stop_to_dict(stop: Stop, sequence: int, previous: Stop | None, engine: DistanceEngine) -> dict:
    return {
        "sequence": sequence,
        "type": stop.stop_type,
        "name": stop.name,
        "coordinates": stop.coordinates,
        "passengers": [
            {
                "id": passenger.passenger_id,
                "full_name": passenger.full_name,
                "short_name": passenger.short_name,
                "pickup_area": passenger.pickup_area,
                "dropoff_area": passenger.dropoff_area,
            }
            for passenger in stop.passengers
        ],
        "note": stop.note,
    }


def route_summary(stops: list[Stop], date: str, movement: str, engine: DistanceEngine) -> dict:
    stop_rows = []
    total_distance_km = 0.0
    previous = None

    for index, stop in enumerate(stops, start=1):
        row = stop_to_dict(stop, index, previous, engine)
        if previous:
            total_distance_km += engine.distance_km(previous.coordinates, stop.coordinates)
        stop_rows.append(row)
        previous = stop

    return {
        "date": date,
        "movement": movement,
        "distance_engine": engine.name,
        "rule_set": {
            "inbound": "order all eligible pickups and dropoffs furthest-to-closest to R71; never drop a passenger before pickup",
            "outbound": "order all eligible pickups and dropoffs closest-to-furthest from R71; never drop a passenger before pickup",
        },
        "r71": R71,
        "special_destinations": list(SPECIAL_DESTINATIONS.values()),
        "total_distance_km": round(total_distance_km, 3),
        "stops": stop_rows,
    }


def route_geojson(summary: dict) -> dict:
    features = []

    for stop in summary["stops"]:
        features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": stop["coordinates"],
                },
                "properties": {
                    "sequence": stop["sequence"],
                    "type": stop["type"],
                    "name": stop["name"],
                    "passenger_count": len(stop["passengers"]),
                    "passengers": ", ".join(passenger["full_name"] for passenger in stop["passengers"]),
                    "note": stop["note"],
                },
            }
        )

    return {
        "type": "FeatureCollection",
        "name": f"maetore_{summary['date']}_{summary['movement']}_route",
        "features": features,
    }


def passenger_selection(data_dir: Path, date: str, movement: str) -> list[Passenger]:
    schedules = load_json(data_dir / "schedules.json")
    home_locations = load_json(data_dir / "passenger-home-locations.geojson")
    passengers = passengers_by_id(home_locations)
    passenger_ids = selected_passenger_ids(schedules, date, movement)
    missing = [passenger_id for passenger_id in passenger_ids if passenger_id not in passengers]

    if missing:
        raise SystemExit(f"Missing home-location records for: {', '.join(missing)}")

    return [passengers[passenger_id] for passenger_id in passenger_ids]


def date_range(start: str, end: str) -> Iterable[str]:
    current = date.fromisoformat(start)
    final = date.fromisoformat(end)

    while current <= final:
        yield current.isoformat()
        current += timedelta(days=1)


def write_outputs(summary: dict, output_dir: Path) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = f"{summary['date']}_{summary['movement']}"
    json_path = output_dir / f"{stem}_route.json"
    geojson_path = output_dir / f"{stem}_route.geojson"

    json_path.write_text(json.dumps(summary, indent=2) + "\n")
    geojson_path.write_text(json.dumps(route_geojson(summary), indent=2) + "\n")
    return json_path, geojson_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Calculate Maetore daily movement route order without a database.",
    )
    parser.add_argument("--date", help="Schedule date in YYYY-MM-DD format.")
    parser.add_argument("--movement", choices=MOVEMENTS, help="Movement to route.")
    parser.add_argument("--start-date", help="First schedule date for batch generation in YYYY-MM-DD format.")
    parser.add_argument("--end-date", help="Last schedule date for batch generation in YYYY-MM-DD format.")
    parser.add_argument("--data-dir", default="data", type=Path, help="Directory containing schedules and passenger GeoJSON.")
    parser.add_argument("--output-dir", default="route_outputs", type=Path, help="Directory for route JSON/GeoJSON outputs.")
    parser.add_argument(
        "--graphml",
        default=DEFAULT_GRAPHML,
        type=Path,
        help=f"Local OSM drive graph GraphML for road shortest-path distances. Defaults to {DEFAULT_GRAPHML}.",
    )
    parser.add_argument(
        "--haversine",
        action="store_true",
        help="Use straight-line distance instead of the default GraphML road engine.",
    )
    parser.add_argument("--print", action="store_true", help="Print route stops to stdout.")
    return parser.parse_args()


def distance_engine(args: argparse.Namespace) -> DistanceEngine:
    if args.haversine:
        return HaversineEngine()

    if not args.graphml.exists():
        raise SystemExit(
            f"Default GraphML route engine file not found: {args.graphml}. "
            "Pass --graphml PATH or use --haversine for diagnostics."
        )
    return GraphMLEngine(args.graphml)


def build_route(args: argparse.Namespace, route_date: str, movement: str, engine: DistanceEngine) -> dict | None:
    passengers = passenger_selection(args.data_dir, route_date, movement)
    if not passengers:
        return None

    stops = route_stops(passengers, movement, engine)
    summary = route_summary(stops, route_date, movement, engine)
    json_path, geojson_path = write_outputs(summary, args.output_dir)

    if args.print:
        for stop in summary["stops"]:
            passenger_names = ", ".join(passenger["short_name"] for passenger in stop["passengers"])
            print(
                f"{stop['sequence']:02d}. {stop['type'].upper():7} "
                f"{stop['name']}"
                f"{' - ' + passenger_names if passenger_names else ''}"
            )
        print(f"Total approximate distance: {summary['total_distance_km']} km")

    print(f"Wrote {json_path}")
    print(f"Wrote {geojson_path}")
    return summary


def main() -> None:
    args = parse_args()

    single_route = args.date or args.movement
    batch_route = args.start_date or args.end_date
    if single_route and batch_route:
        raise SystemExit("Use either --date/--movement or --start-date/--end-date, not both.")
    if single_route and not (args.date and args.movement):
        raise SystemExit("--date and --movement must be used together.")
    if batch_route and not (args.start_date and args.end_date):
        raise SystemExit("--start-date and --end-date must be used together.")
    if not single_route and not batch_route:
        raise SystemExit("Provide --date/--movement or --start-date/--end-date.")

    engine = distance_engine(args)

    if args.date and args.movement:
        build_route(args, args.date, args.movement, engine)
        return

    generated = 0
    for route_date in date_range(args.start_date, args.end_date):
        for movement in MOVEMENTS:
            summary = build_route(args, route_date, movement, engine)
            if summary:
                generated += 1

    print(f"Generated {generated} route filesets.")


if __name__ == "__main__":
    main()
