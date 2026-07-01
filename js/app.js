const state = {
  passengers: [],
  schedules: [],
  locations: [],
  routeCache: new Map(),
  searchQuery: "",
  pickupMap: null,
  pickupLayer: null,
};
const defaultDate = getCurrentDateString();
const pickupMapInitialView = { lat: -23.896257, lng: 29.457121, zoom: 11 };
const movementLabels = {
  morningIn: "Morning In",
  morningOut: "Morning Out",
  eveningIn: "Evening In",
  eveningOut: "Evening Out",
};

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Failed to load ${path}`);
  return response.json();
}

function getCurrentDateString() {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function boot() {
  const [passengers, schedules, homeLocations] = await Promise.all([
    loadJson("/api/passengers"),
    loadJson("/api/schedules"),
    loadJson("/api/passenger-home-locations"),
  ]);

  state.passengers = passengers;
  state.schedules = schedules;
  state.locations = homeLocations.features || [];

  document.querySelector("#dispatchDate").value = defaultDate;
  setupTabs();
  setupEvents();
  renderAll();
  registerServiceWorker();
}

function setupTabs() {
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));
      document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
      button.classList.add("active");
      document.querySelector(`#${button.dataset.view}`).classList.add("active");
      if (button.dataset.view === "dispatch") {
        setTimeout(() => state.pickupMap?.invalidateSize(), 0);
      }
    });
  });
}

function setupEvents() {
  document.querySelector("#dispatchDate").addEventListener("change", () => renderDispatch());
  document.querySelector("#dispatchMovement").addEventListener("change", () => renderDispatch());
  document.querySelector("#searchInput").addEventListener("input", (e) => {
    state.searchQuery = e.target.value.trim().toLowerCase();
    renderSchedule();
  });
}

function renderAll() {
  renderMetrics();
  renderSchedule();
  renderDispatch();
}

function passenger(passengerId) {
  return state.passengers.find((item) => item.id === passengerId);
}

function locationForPassenger(passengerId) {
  return state.locations.find((feature) => feature.properties?.passenger_id === passengerId);
}

function passengerRecord(passengerId) {
  const base = passenger(passengerId);
  const location = locationForPassenger(passengerId);
  const properties = location?.properties || {};
  const coordinates = location?.geometry?.type === "Point" ? location.geometry.coordinates : null;

  return {
    id: passengerId,
    fullName: properties.full_name || base?.fullName || base?.shortName || "Unknown passenger",
    shortName: properties.short_name || base?.shortName || base?.fullName || "Unknown",
    pickupArea: properties.pickup_area || base?.pickupArea || "",
    dropoffArea: properties.dropoff_area || base?.dropoffArea || "",
    groupName: properties.group_name || "",
    phone: properties.phone || base?.phone || "",
    email: properties.email || base?.email || "",
    coordinates,
  };
}

function schedulesForDate(date) {
  return state.schedules.filter((item) => item.date === date);
}

function dates() {
  return [...new Set(state.schedules.map((item) => item.date))].sort();
}

function passengerNamesFor(date, movement) {
  return schedulesForMovement(date, movement)
    .map((item) => passenger(item.passengerId)?.fullName || passenger(item.passengerId)?.shortName)
    .filter(Boolean);
}

function schedulesForMovement(date, movement) {
  return schedulesForDate(date).filter((item) => item[movement] === true);
}

function passengersForMovement(date, movement) {
  return schedulesForMovement(date, movement).map((item) => passengerRecord(item.passengerId));
}

function renderMetrics() {
  document.querySelector("#metricRosterRange").textContent = formatRosterRange(dates());
  document.querySelector("#metricPassengers").textContent = String(state.passengers.length);
}

function matchesSearch(name) {
  if (!state.searchQuery) return true;
  return name.toLowerCase().includes(state.searchQuery);
}

function highlightText(name) {
  if (!state.searchQuery) return name;
  const idx = name.toLowerCase().indexOf(state.searchQuery);
  if (idx === -1) return name;
  return name.slice(0, idx) + "<mark>" + name.slice(idx, idx + state.searchQuery.length) + "</mark>" + name.slice(idx + state.searchQuery.length);
}

function renderSchedule() {
  const rows = dates()
    .filter((date) => {
      if (!state.searchQuery) return true;
      const movements = ["morningIn", "morningOut", "eveningIn", "eveningOut"];
      return movements.some((movement) =>
        passengerNamesFor(date, movement).some((name) => matchesSearch(name))
      );
    })
    .map((date) => {
      const morningIn = passengerNamesFor(date, "morningIn");
      const morningOut = passengerNamesFor(date, "morningOut");
      const eveningIn = passengerNamesFor(date, "eveningIn");
      const eveningOut = passengerNamesFor(date, "eveningOut");

      return `
        <tr>
          <td>
            <div class="date-block">
              <strong>${formatDate(date)}</strong>
              <span class="muted">${countTrips(morningIn, morningOut, eveningIn, eveningOut)} passengers moving</span>
            </div>
          </td>
          <td>${renderPassengerList(morningIn)}</td>
          <td>${renderPassengerList(morningOut)}</td>
          <td>${renderPassengerList(eveningIn)}</td>
          <td>${renderPassengerList(eveningOut)}</td>
        </tr>
      `;
    })
    .join("");

  document.querySelector("#scheduleRows").innerHTML = rows;
}

async function renderDispatch() {
  const date = document.querySelector("#dispatchDate").value || defaultDate;
  const movement = document.querySelector("#dispatchMovement").value;
  const route = await loadRoute(date, movement);
  const stops = route?.stops || [];
  const stopsWithLocations = stops.filter((stop) => hasCoordinates(stop));

  document.querySelector("#dispatchTitle").textContent = movementLabels[movement];
  document.querySelector("#dispatchSubtitle").textContent = route
    ? formatDate(date)
    : `${formatDate(date)} · no route order`;
  document.querySelector("#dispatchCount").textContent = String(stops.length);
  document.querySelector("#dispatchMapSummary").textContent = route
    ? `${stopsWithLocations.length} ordered stops`
    : "No route order generated for this selection";
  document.querySelector("#dispatchList").innerHTML = renderDispatchList(stops);
  renderPickupMap(stopsWithLocations);
}

async function loadRoute(date, movement) {
  const path = `/route_outputs/${routeFileName(date, movement)}`;

  if (state.routeCache.has(path)) {
    return state.routeCache.get(path);
  }

  try {
    const route = await loadJson(path);
    state.routeCache.set(path, route);
    return route;
  } catch (error) {
    state.routeCache.set(path, null);
    return null;
  }
}

function routeFileName(date, movement) {
  return `${date}_${movement}_route.json`;
}

function renderDispatchList(stops) {
  if (!stops.length) {
    return `<div class="empty-state">No route order generated for this movement.</div>`;
  }

  return stops
    .map((stop) => {
      const passengerNames = passengerDisplayNames(stop);
      const area = stop.passengers[0]?.pickup_area || stop.name;

      return `
        <article class="manifest-card">
          <div class="manifest-index">${stop.sequence}</div>
          <div class="manifest-main">
            <div class="stop-title-row">
              <h3>${escapeHtml(passengerNames || stop.name)}</h3>
              <span class="stop-type ${stop.type}">${escapeHtml(stop.type)}</span>
            </div>
            <p>${escapeHtml(area)}</p>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderPickupMap(records) {
  const mapElement = document.querySelector("#dispatchMap");

  if (!records.length) {
    destroyPickupMap();
    mapElement.innerHTML = `<div class="map-empty">No pickup coordinates for this movement.</div>`;
    return;
  }

  if (typeof L === "undefined") {
    destroyPickupMap();
    mapElement.innerHTML = `<div class="map-empty">Map library failed to load.</div>`;
    return;
  }

  if (!state.pickupMap) {
    mapElement.innerHTML = "";
    state.pickupMap = L.map(mapElement, {
      zoomControl: true,
      scrollWheelZoom: true,
      tap: true,
    }).setView([pickupMapInitialView.lat, pickupMapInitialView.lng], pickupMapInitialView.zoom);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(state.pickupMap);

  }

  if (state.pickupLayer) {
    state.pickupLayer.remove();
  }

  const groups = groupByCoordinates(records);

  const markers = groups.map((group) => {
    const [lng, lat] = group[0].coordinates;
    const seqs = group.map((r) => r.sequence);
    const label = seqs.length > 1 ? `${Math.min(...seqs)}-${Math.max(...seqs)}` : String(seqs[0]);

    const types = [...new Set(group.map((r) => r.type))];
    const typeClass = types.length === 1 ? types[0] : "pickup";
    const groupClass = group.length > 1 ? "pickup-marker-grouped" : "";

    const popupHtml = group
      .map((r) => {
        const names = passengerDisplayNames(r);
        return `<strong>${r.sequence}. ${escapeHtml(names || r.name)}</strong><br>${escapeHtml(r.type)}`;
      })
      .join("<hr style=\"margin:4px 0;border-color:rgba(6,42,49,0.1)\">");

    return L.marker([lat, lng], {
      icon: L.divIcon({
        className: `pickup-marker pickup-marker-${typeClass} ${groupClass}`,
        html: `<span>${label}</span>`,
        iconSize: null,
      }),
      title: group.map((r) => r.name).join(", "),
    }).bindPopup(popupHtml);
  });

  state.pickupLayer = L.featureGroup(markers).addTo(state.pickupMap);
  setTimeout(() => state.pickupMap?.invalidateSize(), 0);
}

function renderPassengerList(names) {
  if (!names.length) {
    return `<div class="empty-state">No passengers assigned</div>`;
  }

  return names
    .filter((name) => matchesSearch(name))
    .map((name) => `<div class="passenger-name">${highlightText(name)}</div>`)
    .join("");
}

function countTrips(...groups) {
  return new Set(groups.flat()).size;
}

function previousDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function formatDate(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  return date.toLocaleDateString("en-ZA", { weekday: "short", day: "2-digit", month: "short" });
}

function formatRosterRange(dateList) {
  if (!dateList.length) return "No roster";

  const first = new Date(`${dateList[0]}T00:00:00`);
  const last = new Date(`${dateList[dateList.length - 1]}T00:00:00`);
  const sameYear = first.getFullYear() === last.getFullYear();

  const firstFormat = sameYear
    ? { day: "2-digit", month: "short" }
    : { day: "2-digit", month: "short", year: "numeric" };
  const lastFormat = { day: "2-digit", month: "short", year: "numeric" };

  return `${first.toLocaleDateString("en-ZA", firstFormat)} - ${last.toLocaleDateString("en-ZA", lastFormat)}`;
}

function groupByCoordinates(records) {
  const threshold = 50;
  const groups = [];
  let current = [records[0]];

  for (let i = 1; i < records.length; i++) {
    const [lng1, lat1] = current[current.length - 1].coordinates;
    const [lng2, lat2] = records[i].coordinates;
    const dist = L.latLng(lat1, lng1).distanceTo(L.latLng(lat2, lng2));

    if (dist <= threshold) {
      current.push(records[i]);
    } else {
      groups.push(current);
      current = [records[i]];
    }
  }
  if (current.length) groups.push(current);
  return groups;
}

function hasCoordinates(record) {
  return Array.isArray(record.coordinates)
    && Number.isFinite(record.coordinates[0])
    && Number.isFinite(record.coordinates[1]);
}

function passengerDisplayNames(stop) {
  return stop.passengers.map((passenger) => passenger.full_name || passenger.short_name).join(", ");
}

function destroyPickupMap() {
  if (!state.pickupMap) return;

  state.pickupMap.remove();
  state.pickupMap = null;
  state.pickupLayer = null;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {
      console.warn("Service worker registration failed. This is fine in some local setups.");
    });
  }
}

boot().catch((error) => {
  console.error(error);
  document.body.innerHTML = `
    <main>
      <section class="panel">
        <h1>App failed to load</h1>
        <p>${error.message}</p>
        <p>Run <code>docker compose up</code> from the project root.</p>
      </section>
    </main>
  `;
});
