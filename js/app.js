const state = {
  passengers: [],
  schedules: [],
  locations: [],
  searchQuery: "",
};
const defaultDate = getCurrentDateString();
const scheduleStartDate = "2026-07-12";
const scheduleEndDate = "2026-08-08";
const movementLabels = {
  morningIn: "Morning In",
  morningOut: "Morning Out",
  eveningIn: "Evening In",
  eveningOut: "Evening Out",
};

async function loadJson(path) {
  const response = await fetch(path, { cache: "no-store" });
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

  const dispatchDate = document.querySelector("#dispatchDate");
  dispatchDate.min = scheduleStartDate;
  dispatchDate.max = scheduleEndDate;
  dispatchDate.value = clampDateToScheduleWindow(defaultDate);
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
  const result = [];
  let date = scheduleStartDate;

  while (date <= scheduleEndDate) {
    result.push(date);
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    date = next.toISOString().slice(0, 10);
  }

  return result;
}

function passengerNamesFor(date, movement) {
  return schedulesForMovement(date, movement)
    .map((item) => passengerRecord(item.passengerId).fullName)
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
  const passengerIds = new Set([
    ...state.passengers.map((item) => item.id),
    ...state.locations.map((feature) => feature.properties?.passenger_id),
  ].filter(Boolean));
  document.querySelector("#metricPassengers").textContent = String(passengerIds.size);
}

function clampDateToScheduleWindow(date) {
  if (date < scheduleStartDate) return scheduleStartDate;
  if (date > scheduleEndDate) return scheduleEndDate;
  return date;
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
  const date = document.querySelector("#dispatchDate").value || clampDateToScheduleWindow(defaultDate);
  const movement = document.querySelector("#dispatchMovement").value;
  const route = await loadRoute(date, movement);
  const stops = route?.stops || [];

  document.querySelector("#dispatchTitle").textContent = movementLabels[movement];
  document.querySelector("#dispatchSubtitle").textContent = route
    ? formatDate(date)
    : `${formatDate(date)} · no route order`;
  document.querySelector("#dispatchCount").textContent = String(stops.length);
  document.querySelector("#dispatchList").innerHTML = renderDispatchList(stops);
}

async function loadRoute(date, movement) {
  const path = `/route_outputs/${routeFileName(date, movement)}`;

  try {
    const route = await loadJson(path);
    return route;
  } catch (error) {
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
      const isPassengerHomeStop = / (pickup|dropoff)$/i.test(stop.name);
      const area = isPassengerHomeStop
        ? stop.passengers[0]?.pickup_area || stop.name
        : stop.name;

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

function passengerDisplayNames(stop) {
  return stop.passengers.map((passenger) => passenger.full_name || passenger.short_name).join(", ");
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
    navigator.serviceWorker.register("sw.js?v=" + Date.now()).catch(() => {
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
