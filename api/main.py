from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import json
from pathlib import Path

app = FastAPI(title="Maetore Ops API", docs_url=None, redoc_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA = Path("/app/data")


def load(name: str):
    try:
        return json.loads((DATA / f"{name}.json").read_text())
    except FileNotFoundError:
        raise HTTPException(404, f"{name}.json not found")


def load_geojson(name: str):
    try:
        return json.loads((DATA / f"{name}.geojson").read_text())
    except FileNotFoundError:
        raise HTTPException(404, f"{name}.geojson not found")


@app.get("/api/passengers")
def get_passengers():
    return load("passengers")


@app.get("/api/schedules")
def get_schedules():
    return load("schedules")


@app.get("/api/invoices")
def get_invoices():
    return load("invoices")


@app.get("/api/groups")
def get_groups():
    return load("groups")


@app.get("/api/passenger-home-locations")
def get_passenger_home_locations():
    return load_geojson("passenger-home-locations")


@app.get("/api/config")
def get_config():
    return load("config")


@app.get("/api/health")
def health():
    return {"status": "ok"}
