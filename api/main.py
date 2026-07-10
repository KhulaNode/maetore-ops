from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import json
from pathlib import Path

app = FastAPI(title="Maetore Ops API", docs_url=None, redoc_url=None)

NO_CACHE_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
}


def json_response(data):
    return JSONResponse(content=data, headers=NO_CACHE_HEADERS)

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
    return json_response(load("passengers"))


@app.get("/api/schedules")
def get_schedules():
    return json_response(load("schedules"))


@app.get("/api/invoices")
def get_invoices():
    return json_response(load("invoices"))


@app.get("/api/passenger-home-locations")
def get_passenger_home_locations():
    return json_response(load_geojson("passenger-home-locations"))


@app.get("/api/config")
def get_config():
    return json_response(load("config"))


@app.get("/api/health")
def health():
    return json_response({"status": "ok"})
