const dedupeToggle = document.getElementById("dedupeToggle");
const purgeToggle = document.getElementById("purgeToggle");
const freezeToggle = document.getElementById("freezeToggle");
const dedupeNowBtn = document.getElementById("dedupeNowBtn");
const dupeStatusEl = document.getElementById("dupeStatus");
const repairCountEl = document.getElementById("repairCount");
const repairListEl = document.getElementById("repairList");
const repairAddForm = document.getElementById("repairAddForm");
const repairAddInput = document.getElementById("repairAddInput");
const repairAddBtn = document.getElementById("repairAddBtn");
const repairBulkText = document.getElementById("repairBulkText");
const repairBulkBtn = document.getElementById("repairBulkBtn");
const clearRepairsBtn = document.getElementById("clearRepairsBtn");
const unlockForm = document.getElementById("unlockForm");
const pinInput = document.getElementById("pinInput");
const pinMessage = document.getElementById("pinMessage");
const protectedActions = document.getElementById("protectedActions");
const showDeleteToggle = document.getElementById("showDeleteToggle");
const shiftPurgeListEl = document.getElementById("shiftPurgeList");

let frozen = false;
let unlockedNow = false;
let repairDbCache = [];

// ---------------------------------------------------------------- VINs
function renderDupes(history) {
  const redundant = vinCountRedundant(history);
  dupeStatusEl.textContent =
    redundant > 0
      ? `${redundant} VIN${redundant === 1 ? "" : "s"} já lançado${redundant === 1 ? "" : "s"} repetido${redundant === 1 ? "" : "s"} na lista.`
      : "Nenhum VIN já lançado repetido na lista.";
  dedupeNowBtn.disabled = redundant === 0;
}

dedupeToggle.addEventListener("change", async () => {
  await vinSetSettings({ dedupeEnabled: dedupeToggle.checked });
  // Ligar a opcao vale tambem para o que ja esta gravado.
  if (dedupeToggle.checked) {
    renderDupes(await vinRemoveDuplicatesNow());
  }
});

purgeToggle.addEventListener("change", async () => {
  await vinSetSettings({ autoPurgeEnabled: purgeToggle.checked });
  if (purgeToggle.checked) {
    renderDupes(await vinPurgeExpired());
  }
});

const repeatNoticeToggle = document.getElementById("repeatNoticeToggle");
repeatNoticeToggle.addEventListener("change", () => vinSetSettings({ repeatNoticeEnabled: repeatNoticeToggle.checked }));

const prefixToggle = document.getElementById("prefixToggle");
prefixToggle.addEventListener("change", () => vinSetSettings({ prefixSuggestEnabled: prefixToggle.checked }));

const shiftOnlyToggle = document.getElementById("shiftOnlyToggle");
shiftOnlyToggle.addEventListener("change", async () => {
  await vinSetSettings({ shiftOnlyMode: shiftOnlyToggle.checked });
  renderDupes(await vinPurgeExpired());
});

showDeleteToggle.addEventListener("change", () => vinSetSettings({ showDeleteButton: showDeleteToggle.checked }));

// Uma caixa por turno: apaga os VINs daquele turno quando ele termina.
function renderShiftPurge(settings) {
  shiftPurgeListEl.innerHTML = "";
  for (const shift of settings.shifts) {
    const row = document.createElement("label");
    row.className = "switch-row";
    const text = document.createElement("span");
    text.textContent = `Apagar VINs do ${shift.label} ao fim dele (${shift.end})`;
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = (settings.purgeShiftIds || []).includes(shift.id);
    box.addEventListener("change", async () => {
      const atual = (await vinGetSettings()).purgeShiftIds || [];
      const ids = box.checked ? [...new Set([...atual, shift.id])] : atual.filter((id) => id !== shift.id);
      await vinSetSettings({ purgeShiftIds: ids });
      renderDupes(await vinPurgeExpired());
    });
    row.append(text, box);
    shiftPurgeListEl.appendChild(row);
  }
}

// ------------------------------------------------- modelos e prefixos
const prefixListEl = document.getElementById("prefixList");
const prefixStatusEl = document.getElementById("prefixStatus");

function addPrefixRow(item = { model: "", prefix: "" }) {
  const row = document.createElement("div");
  row.className = "prefix-row";

  const model = document.createElement("input");
  model.type = "text";
  model.className = "prefix-model";
  model.placeholder = "Modelo (ex.: S202 (Uni-T))";
  model.maxLength = 60;
  model.value = item.model;

  const prefix = document.createElement("input");
  prefix.type = "text";
  prefix.className = "prefix-code";
  prefix.placeholder = "Prefixo (ex.: 95PLDL61DVB)";
  prefix.maxLength = 17;
  prefix.value = item.prefix;
  prefix.addEventListener("input", () => {
    prefix.value = prefix.value.toUpperCase().replace(/\s+/g, "");
  });

  const del = document.createElement("button");
  del.type = "button";
  del.className = "entry-btn entry-btn-delete";
  del.textContent = "Remover";
  del.addEventListener("click", () => row.remove());

  for (const input of [model, prefix]) {
    input.addEventListener("input", () => {
      prefixStatusEl.textContent = "Alteracoes nao salvas.";
    });
  }

  row.append(model, prefix, del);
  prefixListEl.appendChild(row);
  return row;
}

function renderPrefixes(list) {
  prefixListEl.innerHTML = "";
  list.forEach((item) => addPrefixRow(item));
}

document.getElementById("prefixAddBtn").addEventListener("click", () => {
  addPrefixRow().querySelector("input").focus();
});

document.getElementById("prefixSaveBtn").addEventListener("click", async () => {
  const list = [...prefixListEl.querySelectorAll(".prefix-row")].map((row) => ({
    model: row.querySelector(".prefix-model").value,
    prefix: row.querySelector(".prefix-code").value,
  }));
  renderPrefixes(await vinSetPrefixes(list));
  prefixStatusEl.textContent = "Modelos salvos.";
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
  if (confirmed) {
    renderDupes(await vinRemoveDuplicatesNow());
  }
});

// ---------------------------------------------------- banco de reparos
function applyFrozenState() {
  freezeToggle.checked = frozen;
  repairAddInput.disabled = frozen;
  repairAddBtn.disabled = frozen;
  repairBulkBtn.disabled = frozen;
  repairBulkText.disabled = frozen;
  repairAddInput.placeholder = frozen ? "Banco congelado" : "Ensinar novo reparo...";
}

function renderRepairs(db) {
  repairDbCache = db;
  repairCountEl.textContent =
    db.length === 0
      ? "Nenhum reparo no banco ainda."
      : `${db.length} reparo${db.length === 1 ? "" : "s"} no banco.`;
  clearRepairsBtn.disabled = db.length === 0;

  repairListEl.innerHTML = "";
  const sorted = [...db].sort((a, b) => a.text.localeCompare(b.text, "pt-BR", { sensitivity: "base" }));
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
    del.textContent = "\u{1F5D1}️";
    del.addEventListener("click", () => repairDelete(item.key));

    // Remover um reparo so com a area protegida desbloqueada.
    del.hidden = !unlockedNow;
    li.append(text, count, del);
    repairListEl.appendChild(li);
  }
}

freezeToggle.addEventListener("change", async () => {
  frozen = freezeToggle.checked;
  await vinSetSettings({ repairFrozen: frozen });
  applyFrozenState();
});

repairAddForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (frozen) {
    return;
  }
  const added = await repairTeachMany([repairAddInput.value]);
  if (added === 0 && repairNormalize(repairAddInput.value)) {
    repairAddInput.select();
    return;
  }
  repairAddInput.value = "";
});

repairBulkBtn.addEventListener("click", async () => {
  if (frozen) {
    return;
  }
  const added = await repairTeachMany(repairBulkText.value.split(/\r?\n/));
  repairBulkText.value = "";
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

clearRepairsBtn.addEventListener("click", async () => {
  if (confirm("Apagar todo o banco de reparos? Essa acao nao pode ser desfeita.")) {
    await repairClear();
  }
});

// ------------------------------------------------------ area protegida
function setUnlocked(unlocked) {
  unlockedNow = unlocked;
  renderRepairs(repairDbCache);
  protectedActions.hidden = !unlocked;
  unlockForm.hidden = unlocked;
  pinInput.value = "";
}

function showPinMessage(text, ok = false) {
  pinMessage.textContent = text;
  pinMessage.classList.toggle("ok", ok);
}

unlockForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (await vinCheckPin(pinInput.value)) {
    showPinMessage("Desbloqueado.", true);
    setUnlocked(true);
  } else {
    showPinMessage("PIN incorreto.");
    pinInput.select();
  }
});

document.getElementById("lockBtn").addEventListener("click", () => {
  setUnlocked(false);
  showPinMessage("");
});

document.getElementById("clearHistoryBtn").addEventListener("click", async () => {
  if (!confirm("Apagar TODOS os VINs da lista? Essa acao nao pode ser desfeita.")) {
    return;
  }
  // Apagar a lista nao mexe nos indicadores (so a limpeza propria deles).
  renderDupes(await vinMutateHistory(() => []));
  showPinMessage("Historico apagado.", true);
});

document.getElementById("clearStatsBtn").addEventListener("click", async () => {
  if (!confirm("Apagar TODOS os dados dos indicadores? Essa acao nao pode ser desfeita.")) {
    return;
  }
  await vinStatsClear();
  showPinMessage("Indicadores apagados.", true);
});

document.getElementById("changePinForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.getElementById("newPinInput");
  if (!/^\d{4,12}$/.test(input.value)) {
    showPinMessage("O PIN deve ter de 4 a 12 digitos.");
    return;
  }
  await vinSetPin(input.value);
  input.value = "";
  showPinMessage("PIN alterado.", true);
});

// -------------------------------------------------------------- inicio
async function iniciar() {
  const settings = await vinGetSettings();
  dedupeToggle.checked = settings.dedupeEnabled;
  purgeToggle.checked = settings.autoPurgeEnabled;
  showDeleteToggle.checked = settings.showDeleteButton !== false;
  shiftOnlyToggle.checked = settings.shiftOnlyMode === true;
  prefixToggle.checked = settings.prefixSuggestEnabled !== false;
  repeatNoticeToggle.checked = settings.repeatNoticeEnabled !== false;
  renderShiftPurge(settings);
  renderPrefixes(await vinGetPrefixes());
  frozen = settings.repairFrozen === true;
  applyFrozenState();
  setUnlocked(false);

  renderDupes(await vinPurgeExpired());
  renderRepairs(await repairGetAll());
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") {
    return;
  }
  if (changes[REPAIR_STORAGE_KEY]) {
    renderRepairs(changes[REPAIR_STORAGE_KEY].newValue || []);
  }
  if (changes[VIN_STORAGE_KEY]) {
    renderDupes(changes[VIN_STORAGE_KEY].newValue || []);
  }
});

iniciar();
