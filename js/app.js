const state = { passengers: [], schedules: [], searchQuery: "" };
const defaultDate = getTodayDateString();

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Failed to load ${path}`);
  return response.json();
}

function getTodayDateString() {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function boot() {
  [state.passengers, state.schedules] = await Promise.all([
    loadJson("/api/passengers"),
    loadJson("/api/schedules"),
  ]);

  document.querySelector("#todayDate").value = defaultDate;
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
  document.querySelector("#todayDate").addEventListener("change", renderToday);
  document.querySelector("#refreshTodayBtn").addEventListener("click", renderToday);
  document.querySelector("#copyScheduleBtn").addEventListener("click", copyTodaySchedule);
  document.querySelector("#searchInput").addEventListener("input", (e) => {
    state.searchQuery = e.target.value.trim().toLowerCase();
    renderSchedule();
  });
}

function renderAll() {
  renderMetrics();
  renderSchedule();
  renderToday();
}

function passenger(passengerId) {
  return state.passengers.find((item) => item.id === passengerId);
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
  const todaySchedules = schedulesForDate(date);

  if (movement === "morningIn" || movement === "eveningOut") {
    return todaySchedules.filter((item) => item.shift === "D");
  }

  if (movement === "eveningIn") {
    return todaySchedules.filter((item) => item.shift === "N");
  }

  if (movement === "morningOut") {
    return schedulesForDate(previousDate(date)).filter((item) => item.shift === "N");
  }

  return [];
}

function renderMetrics() {
  document.querySelector("#metricDays").textContent = String(dates().length);
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

function renderToday() {
  const date = document.querySelector("#todayDate").value || defaultDate;
  const mappings = [
    ["todayMorningIn", "todayMorningInCount", "morningIn"],
    ["todayMorningOut", "todayMorningOutCount", "morningOut"],
    ["todayEveningIn", "todayEveningInCount", "eveningIn"],
    ["todayEveningOut", "todayEveningOutCount", "eveningOut"],
  ];

  mappings.forEach(([listId, countId, field]) => {
    const names = passengerNamesFor(date, field);
    document.querySelector(`#${listId}`).innerHTML = renderPassengerList(names);
    document.querySelector(`#${countId}`).textContent = String(names.length);
  });

  renderMetrics();
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

function copyTodaySchedule() {
  const date = document.querySelector("#todayDate")?.value || defaultDate;
  const text = [
    `Maetore schedule for ${formatDate(date)}`,
    `Morning In: ${passengerNamesFor(date, "morningIn").join(", ") || "None"}`,
    `Morning Out: ${passengerNamesFor(date, "morningOut").join(", ") || "None"}`,
    `Evening In: ${passengerNamesFor(date, "eveningIn").join(", ") || "None"}`,
    `Evening Out: ${passengerNamesFor(date, "eveningOut").join(", ") || "None"}`,
  ].join("\n");

  navigator.clipboard?.writeText(text);
  alert("Today schedule copied.");
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
