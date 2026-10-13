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

let frozen = false;

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
  repairCountEl.textContent =
    db.length === 0
      ? "Nenhum reparo no banco ainda."
      : `${db.length} reparo${db.length === 1 ? "" : "s"} no banco.`;
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
    del.textContent = "\u{1F5D1}️";
    del.addEventListener("click", () => repairDelete(item.key));

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
