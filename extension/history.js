const WEEKDAY_LABELS = ["D", "S", "T", "Q", "Q", "S", "S"];
// 2026 e o ano corrente aparecem sempre (na virada do ano o calendario novo
// precisa existir antes do primeiro registro, senao o dia atual fica
// inacessivel). 2027 aparece assim que tiver historico.
const YEARS_ALWAYS_SHOWN = [...new Set([2026, new Date().getFullYear()])].sort();
const YEARS_HISTORY_ONLY = [2027];

const calendarContainer = document.getElementById("calendarContainer");
const emptyYearsMsg = document.getElementById("emptyYearsMsg");
const totalCountEl = document.getElementById("totalCount");
const clearAllBtn = document.getElementById("clearAllBtn");

const dayPanel = document.getElementById("dayPanel");
const dayPanelTitle = document.getElementById("dayPanelTitle");
const dayPanelList = document.getElementById("dayPanelList");
const closeDayPanelBtn = document.getElementById("closeDayPanel");

let currentHistory = [];
let selectedDateKey = null;

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function buildMonth(year, monthIndex, dataByDate) {
  const monthEl = document.createElement("div");
  monthEl.className = "month";

  const title = document.createElement("div");
  title.className = "month-title";
  title.textContent = new Date(year, monthIndex, 1).toLocaleDateString("pt-BR", {
    month: "long",
  });
  monthEl.appendChild(title);

  const weekdaysEl = document.createElement("div");
  weekdaysEl.className = "weekdays";
  for (const label of WEEKDAY_LABELS) {
    const span = document.createElement("span");
    span.textContent = label;
    weekdaysEl.appendChild(span);
  }
  monthEl.appendChild(weekdaysEl);

  const daysGrid = document.createElement("div");
  daysGrid.className = "days-grid";

  const firstWeekday = new Date(year, monthIndex, 1).getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();

  for (let i = 0; i < firstWeekday; i += 1) {
    const empty = document.createElement("div");
    empty.className = "day-cell empty";
    daysGrid.appendChild(empty);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const entries = dataByDate.get(key) || [];

    const cell = document.createElement("div");
    cell.className = "day-cell in-month";
    cell.dataset.date = key;
    cell.textContent = String(day);

    if (entries.length > 0) {
      cell.classList.add("has-data");

      const duplicates = vinFindDuplicates(currentHistory);
      const hasDuplicate = entries.some((entry) => duplicates.has(entry.vin));
      if (hasDuplicate) {
        cell.classList.add("has-duplicate");
      }

      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = String(entries.length);
      cell.appendChild(badge);
    }

    cell.addEventListener("click", () => openDayPanel(key));
    daysGrid.appendChild(cell);
  }

  monthEl.appendChild(daysGrid);
  return monthEl;
}

function buildYearSection(year, dataByDate) {
  const section = document.createElement("section");
  section.className = "year-section";

  const title = document.createElement("h2");
  title.className = "year-title";
  title.textContent = String(year);
  section.appendChild(title);

  const grid = document.createElement("div");
  grid.className = "months-grid";
  for (let month = 0; month < 12; month += 1) {
    grid.appendChild(buildMonth(year, month, dataByDate));
  }
  section.appendChild(grid);

  return section;
}

function renderCalendar(history) {
  currentHistory = history;
  calendarContainer.innerHTML = "";

  const dataByDate = vinGroupByDate(history);
  const yearsWithData = new Set(
    history.map((entry) => new Date(entry.timestamp).getFullYear())
  );

  totalCountEl.textContent = `${history.length} VIN${history.length === 1 ? "" : "s"} no historico`;

  const yearsToRender = [
    ...new Set([
      ...YEARS_ALWAYS_SHOWN,
      ...YEARS_HISTORY_ONLY.filter((year) => yearsWithData.has(year)),
    ]),
  ].sort((a, b) => a - b);

  for (const year of yearsToRender) {
    calendarContainer.appendChild(buildYearSection(year, dataByDate));
  }

  const otherYears = [...yearsWithData].filter(
    (year) => !YEARS_ALWAYS_SHOWN.includes(year) && !YEARS_HISTORY_ONLY.includes(year)
  );
  emptyYearsMsg.textContent =
    otherYears.length > 0
      ? `Tambem ha registros em: ${otherYears.sort((a, b) => a - b).join(", ")} (fora do periodo exibido).`
      : "";
}

function openDayPanel(dateKey) {
  selectedDateKey = dateKey;

  const entries = currentHistory
    .filter((entry) => vinDateKey(entry.timestamp) === dateKey)
    .sort((a, b) => b.timestamp - a.timestamp);

  const duplicates = vinFindDuplicates(currentHistory);

  const [year, month, day] = dateKey.split("-");
  dayPanelTitle.textContent = `${day}/${month}/${year}`;

  dayPanelList.innerHTML = "";

  if (entries.length === 0) {
    const empty = document.createElement("li");
    empty.className = "day-panel-empty";
    empty.textContent = "Nenhum VIN registrado nesse dia.";
    dayPanelList.appendChild(empty);
  } else {
    for (const entry of entries) {
      const isDuplicate = duplicates.has(entry.vin);

      const li = document.createElement("li");
      li.className = "day-panel-item" + (isDuplicate ? " duplicate-entry" : "");

      const vinRow = document.createElement("div");
      vinRow.className = "vin-row";

      const vinEl = document.createElement("span");
      vinEl.className = "vin";
      vinEl.textContent = entry.vin;
      vinRow.appendChild(vinEl);

      if (isDuplicate) {
        const tag = document.createElement("span");
        tag.className = "duplicate-tag";
        tag.textContent = "duplicado";
        vinRow.appendChild(tag);
      }

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "delete-entry-btn";
      deleteBtn.title = "Apagar este VIN";
      deleteBtn.setAttribute("aria-label", "Apagar este VIN");
      deleteBtn.textContent = "\u{1F5D1}️";
      deleteBtn.addEventListener("click", async () => {
        await vinDeleteEntry(entry.timestamp);
      });
      vinRow.appendChild(deleteBtn);

      const timeEl = document.createElement("div");
      timeEl.className = "time";
      timeEl.textContent = formatTime(entry.timestamp);

      li.appendChild(vinRow);
      li.appendChild(timeEl);
      dayPanelList.appendChild(li);
    }
  }

  dayPanel.classList.remove("hidden");
}

function closeDayPanel() {
  dayPanel.classList.add("hidden");
  selectedDateKey = null;
}

closeDayPanelBtn.addEventListener("click", closeDayPanel);

clearAllBtn.addEventListener("click", async () => {
  if (!confirm("Apagar todo o historico de VINs? Essa acao nao pode ser desfeita.")) {
    return;
  }
  await vinMutateHistory(() => []);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[VIN_STORAGE_KEY]) {
    return;
  }

  const newHistory = changes[VIN_STORAGE_KEY].newValue || [];
  renderCalendar(newHistory);

  if (!dayPanel.classList.contains("hidden") && selectedDateKey) {
    openDayPanel(selectedDateKey);
  }
});

vinGetHistory().then(renderCalendar);
