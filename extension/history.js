const WEEKDAY_LABELS = ["D", "S", "T", "Q", "Q", "S", "S"];
// 2026 e o ano corrente aparecem sempre (na virada do ano o calendario novo
// precisa existir antes do primeiro registro, senao o dia atual fica
// inacessivel). 2027 aparece assim que tiver historico.
const YEARS_ALWAYS_SHOWN = [...new Set([2026, new Date().getFullYear()])].sort();
const YEARS_HISTORY_ONLY = [2027];

const calendarContainer = document.getElementById("calendarContainer");
const emptyYearsMsg = document.getElementById("emptyYearsMsg");
const totalCountEl = document.getElementById("totalCount");
const dupeCountEl = document.getElementById("dupeCount");
const dedupeNowBtn = document.getElementById("dedupeNowBtn");
const clearAllBtn = document.getElementById("clearAllBtn");

const dayPanel = document.getElementById("dayPanel");
const dayPanelTitle = document.getElementById("dayPanelTitle");
const dayPanelList = document.getElementById("dayPanelList");
const closeDayPanelBtn = document.getElementById("closeDayPanel");

const shiftCountsEl = document.getElementById("shiftCounts");

let currentHistory = [];
let currentShifts = VIN_DEFAULT_SHIFTS;
let selectedDateKey = null;

function renderShiftCounts(history, shifts) {
  shiftCountsEl.innerHTML = "";

  for (const grupo of vinGroupByShift(history, shifts)) {
    const li = document.createElement("li");
    li.className = "shift-count-item" + (grupo.shift ? "" : " no-shift");

    const nome = document.createElement("span");
    nome.className = "shift-count-name";
    nome.textContent = grupo.shift ? grupo.shift.label : "Fora de turno";

    if (grupo.shift) {
      const faixa = document.createElement("span");
      faixa.className = "shift-count-range";
      faixa.textContent = `${grupo.shift.start}–${grupo.shift.end}`;
      nome.appendChild(faixa);
    }

    const valor = document.createElement("span");
    valor.className = "shift-count-value";
    valor.textContent = String(grupo.entries.length);

    li.appendChild(nome);
    li.appendChild(valor);
    shiftCountsEl.appendChild(li);
  }
}

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
      const hasDuplicate = entries.some((entry) =>
        duplicates.has(vinCompareKey(entry.vin))
      );
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

  const redundant = vinCountRedundant(history);
  dupeCountEl.textContent =
    redundant > 0 ? `${redundant} duplicado${redundant === 1 ? "" : "s"}` : "";
  dedupeNowBtn.disabled = redundant === 0;

  renderShiftCounts(history, currentShifts);

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
    // Os VINs do dia sao separados por turno; turnos sem registro naquele dia
    // nao viram secao vazia.
    for (const grupo of vinGroupByShift(entries, currentShifts)) {
      if (grupo.entries.length === 0) {
        continue;
      }

      const cabecalho = document.createElement("li");
      cabecalho.className = "day-shift-group";

      const titulo = document.createElement("div");
      titulo.className = "day-shift-heading";

      const nome = document.createElement("span");
      nome.textContent = grupo.shift ? grupo.shift.label : "Fora de turno";

      const qtd = document.createElement("span");
      qtd.className = "qtd";
      qtd.textContent = `${grupo.entries.length} VIN${grupo.entries.length === 1 ? "" : "s"}`;

      titulo.appendChild(nome);
      titulo.appendChild(qtd);
      cabecalho.appendChild(titulo);
      dayPanelList.appendChild(cabecalho);

      renderDayEntries(grupo.entries, duplicates);
    }
  }

  dayPanel.classList.remove("hidden");
}

function renderDayEntries(entries, duplicates) {
  for (const entry of entries) {
    const isDuplicate = duplicates.has(vinCompareKey(entry.vin));

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

function closeDayPanel() {
  dayPanel.classList.add("hidden");
  selectedDateKey = null;
}

closeDayPanelBtn.addEventListener("click", closeDayPanel);

dedupeNowBtn.addEventListener("click", async () => {
  const redundant = vinCountRedundant(currentHistory);
  if (redundant === 0) {
    return;
  }

  const confirmed = confirm(
    `Remover ${redundant} registro${redundant === 1 ? "" : "s"} duplicado${redundant === 1 ? "" : "s"}?\n\n` +
      "De cada VIN repetido fica apenas o registro mais recente. " +
      "Os registros mais antigos desses VINs saem do calendario."
  );
  if (!confirmed) {
    return;
  }

  await vinRemoveDuplicatesNow();
});

clearAllBtn.addEventListener("click", async () => {
  if (!confirm("Apagar todo o historico de VINs? Essa acao nao pode ser desfeita.")) {
    return;
  }
  await vinMutateHistory(() => []);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") {
    return;
  }

  // Mudar os horarios dos turnos no popup precisa redesenhar esta pagina, que
  // pode estar aberta em outra aba.
  if (changes[VIN_SETTINGS_KEY]) {
    const settings = {
      ...VIN_DEFAULT_SETTINGS,
      ...(changes[VIN_SETTINGS_KEY].newValue || {}),
    };
    if (Array.isArray(settings.shifts) && settings.shifts.length > 0) {
      currentShifts = settings.shifts;
      renderShiftCounts(currentHistory, currentShifts);
    }
  }

  if (changes[VIN_STORAGE_KEY]) {
    renderCalendar(changes[VIN_STORAGE_KEY].newValue || []);
  }

  if (!dayPanel.classList.contains("hidden") && selectedDateKey) {
    openDayPanel(selectedDateKey);
  }
});

async function iniciar() {
  const [history, settings] = await Promise.all([vinGetHistory(), vinGetSettings()]);
  currentShifts = settings.shifts;
  renderCalendar(history);
}

iniciar();
