const listEl = document.getElementById("historyList");
const emptyStateEl = document.getElementById("emptyState");
const statsEl = document.getElementById("stats");
const countNumberEl = document.getElementById("countNumber");
const countLabelEl = document.getElementById("countLabel");
const clearBtn = document.getElementById("clearBtn");
const dedupeToggle = document.getElementById("dedupeToggle");
const purgeToggle = document.getElementById("purgeToggle");
const dedupeNowBtn = document.getElementById("dedupeNowBtn");
const dupeStatusEl = document.getElementById("dupeStatus");
const openCalendarBtn = document.getElementById("openCalendarBtn");
const shiftCountsEl = document.getElementById("shiftCounts");

// Ultimo estado conhecido, para redesenhar sem reler o storage a cada evento.
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
  const duplicates = vinFindDuplicates(history);

  const redundant = vinCountRedundant(history);
  dupeStatusEl.textContent =
    redundant > 0
      ? `${redundant} VIN${redundant === 1 ? "" : "s"} já lançado${redundant === 1 ? "" : "s"} repetido${redundant === 1 ? "" : "s"} no historico.`
      : "Nenhum VIN já lançado repetido no historico.";
  dedupeNowBtn.disabled = redundant === 0;

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
    const isDuplicate = duplicates.has(vinCompareKey(entry.vin));

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
      tag.textContent = "Já lançado";
      vinRow.appendChild(tag);
    }

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
    const partsRow = vinBuildPartsRow(entry);
    if (partsRow) {
      li.appendChild(partsRow);
    }
    listEl.appendChild(li);
  }
}

const repairCountEl = document.getElementById("repairCount");
const repairPanelEl = document.getElementById("repairPanel");
const repairListEl = document.getElementById("repairList");
const toggleRepairListBtn = document.getElementById("toggleRepairListBtn");
const clearRepairsBtn = document.getElementById("clearRepairsBtn");

function renderRepairs(db) {
  repairCountEl.textContent = db.length === 0
    ? "Nenhum reparo aprendido ainda. Eles sao salvos ao preencher o campo PRINCIPAL REPARO."
    : `${db.length} reparo${db.length === 1 ? "" : "s"} aprendido${db.length === 1 ? "" : "s"}.`;
  clearRepairsBtn.disabled = db.length === 0;

  repairListEl.innerHTML = "";
  const sorted = [...db].sort((a, b) => b.count - a.count || b.lastUsed - a.lastUsed);
  for (const item of sorted) {
    const li = document.createElement("li");
    li.className = "repair-item";

    const text = document.createElement("span");
    text.className = "repair-text";
    text.textContent = item.text;

    const count = document.createElement("span");
    count.className = "repair-uses";
    count.textContent = `${item.count}x`;

    const del = document.createElement("button");
    del.className = "delete-entry-btn";
    del.type = "button";
    del.title = "Remover este reparo";
    del.textContent = "🗑";
    del.addEventListener("click", () => repairDelete(item.key));

    li.append(text, count, del);
    repairListEl.appendChild(li);
  }
}

toggleRepairListBtn.addEventListener("click", () => {
  const escondido = repairPanelEl.classList.toggle("hidden");
  toggleRepairListBtn.textContent = escondido ? "Ver reparos aprendidos" : "Ocultar reparos aprendidos";
});

clearRepairsBtn.addEventListener("click", async () => {
  if (confirm("Apagar todo o banco de reparos aprendidos? Essa acao nao pode ser desfeita.")) {
    await repairClear();
  }
});

const repairAddForm = document.getElementById("repairAddForm");
const repairAddInput = document.getElementById("repairAddInput");
const repairBulkEl = document.getElementById("repairBulk");
const repairBulkText = document.getElementById("repairBulkText");

repairAddForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const added = await repairTeachMany([repairAddInput.value]);
  if (added === 0 && repairNormalize(repairAddInput.value)) {
    repairAddInput.select();
    return;
  }
  repairAddInput.value = "";
});

document.getElementById("toggleRepairBulkBtn").addEventListener("click", () => {
  repairBulkEl.classList.toggle("hidden");
});

document.getElementById("repairBulkBtn").addEventListener("click", async () => {
  const added = await repairTeachMany(repairBulkText.value.split(/\r?\n/));
  repairBulkText.value = "";
  repairBulkEl.classList.add("hidden");
  repairCountEl.textContent = `${added} reparo${added === 1 ? "" : "s"} novo${added === 1 ? "" : "s"} importado${added === 1 ? "" : "s"}.`;
});

document.getElementById("exportRepairsBtn").addEventListener("click", async () => {
  const db = await repairGetAll();
  const blob = new Blob([db.map((item) => item.text).join("\n")], { type: "text/plain" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "reparos.txt";
  link.click();
  URL.revokeObjectURL(link.href);
});

async function load() {
  repairGetAll().then(renderRepairs);
  const settings = await vinGetSettings();
  // Limpa o que ja venceu antes de mostrar a lista.
  const history = await vinPurgeExpired();
  dedupeToggle.checked = settings.dedupeEnabled;
  purgeToggle.checked = settings.autoPurgeEnabled;
  currentShifts = settings.shifts;
  render(history);
}

clearBtn.addEventListener("click", async () => {
  if (!confirm("Apagar todo o historico de VINs? Essa acao nao pode ser desfeita.")) {
    return;
  }
  await vinMutateHistory(() => []);
  render([]);
});

purgeToggle.addEventListener("change", async () => {
  await vinSetSettings({ autoPurgeEnabled: purgeToggle.checked });
  if (purgeToggle.checked) {
    render(await vinPurgeExpired());
  }
});

dedupeToggle.addEventListener("change", async () => {
  await vinSetSettings({ dedupeEnabled: dedupeToggle.checked });

  // Ligar a opcao tem que valer tambem para o que ja esta gravado, senao as
  // duplicatas antigas continuam na lista e a opcao parece nao fazer nada.
  if (dedupeToggle.checked) {
    render(await vinRemoveDuplicatesNow());
  }
});

dedupeNowBtn.addEventListener("click", async () => {
  const history = await vinGetHistory();
  const redundant = vinCountRedundant(history);
  if (redundant === 0) {
    return;
  }

  const confirmed = confirm(
    `Remover ${redundant} registro${redundant === 1 ? "" : "s"} repetido${redundant === 1 ? "" : "s"}?\n\n` +
      "De cada VIN já lançado fica apenas o registro mais recente."
  );
  if (!confirmed) {
    return;
  }

  render(await vinRemoveDuplicatesNow());
});

openCalendarBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("history.html") });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") {
    return;
  }
  if (changes[REPAIR_STORAGE_KEY]) {
    renderRepairs(changes[REPAIR_STORAGE_KEY].newValue || []);
  }
  if (changes[VIN_STORAGE_KEY]) {
    render(changes[VIN_STORAGE_KEY].newValue || []);
  }
  if (changes[VIN_SETTINGS_KEY]) {
    const settings = { ...VIN_DEFAULT_SETTINGS, ...(changes[VIN_SETTINGS_KEY].newValue || {}) };
    dedupeToggle.checked = settings.dedupeEnabled;
    purgeToggle.checked = settings.autoPurgeEnabled;
  }
});

load();
