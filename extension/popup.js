const listEl = document.getElementById("historyList");
const emptyStateEl = document.getElementById("emptyState");
const statsEl = document.getElementById("stats");
const countNumberEl = document.getElementById("countNumber");
const countLabelEl = document.getElementById("countLabel");
const clearBtn = document.getElementById("clearBtn");
const dedupeToggle = document.getElementById("dedupeToggle");
const openCalendarBtn = document.getElementById("openCalendarBtn");
const dayPicker = document.getElementById("dayPicker");
const deleteDayBtn = document.getElementById("deleteDayBtn");

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function render(history) {
  listEl.innerHTML = "";

  const isEmpty = !history || history.length === 0;
  const count = isEmpty ? 0 : history.length;
  const duplicates = vinFindDuplicates(history || []);

  emptyStateEl.style.display = isEmpty ? "block" : "none";
  listEl.style.display = isEmpty ? "none" : "block";
  statsEl.style.display = isEmpty ? "none" : "flex";
  countNumberEl.textContent = String(count);
  countLabelEl.textContent = `VIN${count === 1 ? "" : "s"} registrado${count === 1 ? "" : "s"}`;

  if (isEmpty) {
    return;
  }

  const sorted = [...history].sort((a, b) => b.timestamp - a.timestamp);

  for (const entry of sorted) {
    const isDuplicate = duplicates.has(entry.vin);

    const li = document.createElement("li");
    li.className = "history-item" + (isDuplicate ? " duplicate-entry" : "");

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

    const timeEl = document.createElement("div");
    timeEl.className = "time";
    timeEl.textContent = formatTimestamp(entry.timestamp);

    li.appendChild(vinRow);
    li.appendChild(timeEl);
    listEl.appendChild(li);
  }
}

async function load() {
  const [history, settings] = await Promise.all([vinGetHistory(), vinGetSettings()]);
  dedupeToggle.checked = settings.dedupeEnabled;
  render(history);
}

clearBtn.addEventListener("click", async () => {
  if (!confirm("Apagar todo o historico de VINs? Essa acao nao pode ser desfeita.")) {
    return;
  }
  await vinSetHistory([]);
  render([]);
});

dedupeToggle.addEventListener("change", async () => {
  await vinSetSettings({ dedupeEnabled: dedupeToggle.checked });
});

openCalendarBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("history.html") });
});

deleteDayBtn.addEventListener("click", async () => {
  const selectedDate = dayPicker.value;
  if (!selectedDate) {
    alert("Escolha um dia para apagar.");
    return;
  }

  const history = await vinGetHistory();
  const remaining = history.filter((entry) => vinDateKey(entry.timestamp) !== selectedDate);

  if (remaining.length === history.length) {
    alert("Nenhum VIN encontrado nesse dia.");
    return;
  }

  await vinSetHistory(remaining);
  render(remaining);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") {
    return;
  }
  if (changes[VIN_STORAGE_KEY]) {
    render(changes[VIN_STORAGE_KEY].newValue || []);
  }
  if (changes[VIN_SETTINGS_KEY]) {
    dedupeToggle.checked = (changes[VIN_SETTINGS_KEY].newValue || VIN_DEFAULT_SETTINGS).dedupeEnabled;
  }
});

load();
