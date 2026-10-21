const listEl = document.getElementById("historyList");
const emptyStateEl = document.getElementById("emptyState");
const countNumberEl = document.getElementById("countNumber");
const countLabelEl = document.getElementById("countLabel");
const shiftCountsEl = document.getElementById("shiftCounts");
const summaryEl = document.getElementById("summary");
const toggleSummaryBtn = document.getElementById("toggleSummaryBtn");
const vinSearchEl = document.getElementById("vinSearch");
const noMatchEl = document.getElementById("noMatch");

let currentShifts = VIN_DEFAULT_SHIFTS;
let currentHistory = [];
let showDelete = true;

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

function render(history) {
  listEl.innerHTML = "";

  history = history || [];
  currentHistory = history;

  renderShiftCounts(history, currentShifts);

  const isEmpty = history.length === 0;
  const count = history.length;
  const repeats = vinRepeatInfo(history);

  emptyStateEl.style.display = isEmpty ? "block" : "none";
  listEl.style.display = isEmpty ? "none" : "block";
  countNumberEl.textContent = String(count);
  countLabelEl.textContent = `VIN${count === 1 ? "" : "s"} registrado${count === 1 ? "" : "s"}`;

  const termo = vinCompareKey(vinSearchEl.value);
  const sorted = [...history]
    .filter((entry) => !termo || vinCompareKey(entry.vin).includes(termo))
    .sort((a, b) => b.timestamp - a.timestamp);
  noMatchEl.style.display = !isEmpty && sorted.length === 0 ? "block" : "none";

  if (isEmpty) {
    return;
  }

  for (const entry of sorted) {
    const repeat = repeats.get(entry.timestamp);

    const li = document.createElement("li");
    li.className = "history-item";
    vinMarkRepeat(li, repeat);

    const vinRow = document.createElement("div");
    vinRow.className = "vin-row";

    const vinEl = document.createElement("span");
    vinEl.className = "vin";
    vinEl.textContent = entry.vin;
    vinRow.appendChild(vinEl);

    const badges = vinBuildModelColorBadges(entry);
    if (badges) {
      vinRow.appendChild(badges);
    }

    if (repeat) {
      vinRow.appendChild(vinBuildLaunchTag(repeat.ordinal));
    }

    const buttons = document.createElement("div");
    buttons.className = "entry-actions";
    buttons.appendChild(vinBuildEntryButton("copy", (button) => vinCopyToClipboard(vinCopyText(entry), button)));
    if (showDelete) {
      buttons.appendChild(
        vinBuildEntryButton("delete", async () => {
          render(await vinDeleteEntry(entry.timestamp));
        })
      );
    }

    const timeEl = vinBuildTimeBadge(entry.timestamp, "div");

    li.appendChild(vinRow);
    li.appendChild(timeEl);
    const repairRow = vinBuildRepairRow(entry);
    if (repairRow) {
      li.appendChild(repairRow);
    }

    const partsRow = vinBuildPartsRow(entry);
    if (partsRow) {
      li.appendChild(partsRow);
    }
    li.appendChild(buttons);
    listEl.appendChild(li);
  }

  vinDecorateRepeats(listEl);
}

// O resumo (total e VINs por turno) fica escondido ate o usuario pedir.
function setSummaryVisible(visible) {
  summaryEl.classList.toggle("hidden", !visible);
  toggleSummaryBtn.textContent = visible ? "Ocultar resumo" : "Mostrar resumo";
}

vinSearchEl.addEventListener("input", () => render(currentHistory));

toggleSummaryBtn.addEventListener("click", () => {
  setSummaryVisible(summaryEl.classList.contains("hidden"));
});

function openPage(file) {
  chrome.tabs.create({ url: chrome.runtime.getURL(file) });
}

document.getElementById("openListBtn").addEventListener("click", () => openPage("history.html"));
document.getElementById("openStatsBtn").addEventListener("click", () => openPage("stats.html"));
// Todos os VINs do dia de producao atual.
document.getElementById("copyDayBtn").addEventListener("click", (event) => {
  const inicio = vinCycleStart(Date.now(), currentShifts);
  const doDia = currentHistory.filter((entry) => entry.timestamp >= inicio);
  vinCopyToClipboard(vinCopyTextList(doDia, "VINs do dia"), event.currentTarget);
});

document.getElementById("openSettingsBtn").addEventListener("click", () => openPage("settings.html"));

async function load() {
  const settings = await vinGetSettings();
  currentShifts = settings.shifts;
  showDelete = settings.showDeleteButton !== false;
  // Limpa o que ja venceu antes de mostrar a lista.
  render(await vinPurgeExpired());
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") {
    return;
  }
  if (changes[VIN_SETTINGS_KEY]) {
    showDelete = (changes[VIN_SETTINGS_KEY].newValue || {}).showDeleteButton !== false;
    render(currentHistory);
  }
  if (changes[VIN_STORAGE_KEY]) {
    render(changes[VIN_STORAGE_KEY].newValue || []);
  }
});

load();
