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

// Texto copiado de um VIN: hora, modelo/cor, reparo e/ou cripple.
function buildCopyText(entry) {
  const hora = new Date(entry.timestamp).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Array.isArray(entry.parts) ? entry.parts : [];
  const repair = (entry.repair || "").trim();
  const tipo =
    repair && parts.length > 0 ? "Reparo + Cripple" : repair ? "Reparo" : parts.length > 0 ? "Cripple" : "";

  const lines = [`VIN: ${entry.vin}`, `Hora: ${hora}`];
  const modeloCor = [entry.model && `Modelo: ${entry.model}`, entry.color && `Cor: ${entry.color}`].filter(Boolean);
  if (modeloCor.length > 0) lines.push(modeloCor.join(" | "));
  if (tipo) lines.push(`Tipo: ${tipo}`);
  if (repair) lines.push(`Reparo: ${repair}`);
  if (parts.length > 0) lines.push(`Cripple: ${parts.join(", ")}`);
  return lines.join("\n");
}

async function copyEntry(entry, button) {
  try {
    await navigator.clipboard.writeText(buildCopyText(entry));
    button.textContent = "\u2714";
    button.title = "Copiado!";
  } catch (error) {
    button.textContent = "\u2716";
    button.title = "Nao foi possivel copiar";
  }
  setTimeout(() => {
    button.textContent = "\u{1F4CB}";
    button.title = "Copiar dados do VIN";
  }, 1500);
}

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

    const copyBtn = document.createElement("button");
    copyBtn.className = "copy-entry-btn";
    copyBtn.title = "Copiar dados do VIN";
    copyBtn.setAttribute("aria-label", "Copiar dados do VIN");
    copyBtn.textContent = "\u{1F4CB}";
    copyBtn.addEventListener("click", () => copyEntry(entry, copyBtn));
    vinRow.appendChild(copyBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-entry-btn";
    deleteBtn.title = "Apagar este VIN";
    deleteBtn.setAttribute("aria-label", "Apagar este VIN");
    deleteBtn.textContent = "\u{1F5D1}️";
    deleteBtn.addEventListener("click", async () => {
      const remaining = await vinDeleteEntry(entry.timestamp);
      render(remaining);
    });
    vinRow.appendChild(deleteBtn);

    const timeEl = document.createElement("div");
    timeEl.className = "time";
    timeEl.textContent = formatTimestamp(entry.timestamp);

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
document.getElementById("openSettingsBtn").addEventListener("click", () => openPage("settings.html"));

async function load() {
  const settings = await vinGetSettings();
  currentShifts = settings.shifts;
  // Limpa o que ja venceu antes de mostrar a lista.
  render(await vinPurgeExpired());
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[VIN_STORAGE_KEY]) {
    render(changes[VIN_STORAGE_KEY].newValue || []);
  }
});

load();
