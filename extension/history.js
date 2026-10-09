const listContainer = document.getElementById("listContainer");
const totalCountEl = document.getElementById("totalCount");
const dupeCountEl = document.getElementById("dupeCount");
const dedupeNowBtn = document.getElementById("dedupeNowBtn");
const clearAllBtn = document.getElementById("clearAllBtn");
const shiftCountsEl = document.getElementById("shiftCounts");
const purgeInfoEl = document.getElementById("purgeInfo");
const searchInput = document.getElementById("searchInput");

let currentHistory = [];
let currentShifts = VIN_DEFAULT_SHIFTS;
let autoPurge = true;

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

function renderPurgeInfo() {
  if (!autoPurge) {
    purgeInfoEl.textContent = "Limpeza automatica desativada (ative no popup da extensao).";
    return;
  }
  const proxima = new Date(vinNextCycleStart(Date.now(), currentShifts));
  const hora = proxima.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const dia = proxima.toLocaleDateString("pt-BR");
  purgeInfoEl.textContent = `Os VINs sao apagados automaticamente no fim do 3º turno (proxima limpeza: ${dia} as ${hora}).`;
}

function buildEntry(entry, duplicates) {
  const isDuplicate = duplicates.has(vinCompareKey(entry.vin));

  const li = document.createElement("li");
  li.className = "vin-item" + (isDuplicate ? " duplicate-entry" : "");

  const vinEl = document.createElement("span");
  vinEl.className = "vin";
  vinEl.textContent = entry.vin;
  li.appendChild(vinEl);

  if (isDuplicate) {
    const tag = document.createElement("span");
    tag.className = "duplicate-tag";
    tag.textContent = "Já lançado";
    li.appendChild(tag);
  }

  const timeEl = document.createElement("span");
  timeEl.className = "time";
  timeEl.textContent = formatTime(entry.timestamp);
  li.appendChild(timeEl);

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "delete-entry-btn";
  deleteBtn.title = "Apagar este VIN";
  deleteBtn.setAttribute("aria-label", "Apagar este VIN");
  deleteBtn.textContent = "\u{1F5D1}️";
  deleteBtn.addEventListener("click", () => vinDeleteEntry(entry.timestamp));
  li.appendChild(deleteBtn);

  const partsRow = vinBuildPartsRow(entry);
  if (partsRow) {
    li.appendChild(partsRow);
  }

  return li;
}

function renderList() {
  listContainer.innerHTML = "";

  const termo = vinCompareKey(searchInput.value);
  const filtrado = termo
    ? currentHistory.filter((entry) => vinCompareKey(entry.vin).includes(termo))
    : currentHistory;

  if (currentHistory.length === 0) {
    const vazio = document.createElement("p");
    vazio.className = "empty-list";
    vazio.textContent = "Nenhum VIN na lista. Preencha o campo VIN no formulario.";
    listContainer.appendChild(vazio);
    return;
  }

  const duplicates = vinFindDuplicates(currentHistory);

  for (const grupo of vinGroupByShift(filtrado, currentShifts)) {
    const section = document.createElement("section");
    section.className = "day-shift-group";

    const titulo = document.createElement("div");
    titulo.className = "day-shift-heading";

    const nome = document.createElement("span");
    nome.textContent = grupo.shift
      ? `${grupo.shift.label} (${grupo.shift.start}–${grupo.shift.end})`
      : "Fora de turno";

    const qtd = document.createElement("span");
    qtd.className = "qtd";
    qtd.textContent = `${grupo.entries.length} VIN${grupo.entries.length === 1 ? "" : "s"}`;

    titulo.appendChild(nome);
    titulo.appendChild(qtd);
    section.appendChild(titulo);

    const ul = document.createElement("ul");
    ul.className = "vin-list";
    for (const entry of grupo.entries) {
      ul.appendChild(buildEntry(entry, duplicates));
    }
    section.appendChild(ul);
    listContainer.appendChild(section);
  }
}

function render(history) {
  currentHistory = history || [];

  totalCountEl.textContent = `${currentHistory.length} VIN${currentHistory.length === 1 ? "" : "s"} na lista`;

  const redundant = vinCountRedundant(currentHistory);
  dupeCountEl.textContent =
    redundant > 0 ? `${redundant} já lançado${redundant === 1 ? "" : "s"} repetido${redundant === 1 ? "" : "s"}` : "";
  dedupeNowBtn.disabled = redundant === 0;

  renderShiftCounts(currentHistory, currentShifts);
  renderList();
}

searchInput.addEventListener("input", renderList);

dedupeNowBtn.addEventListener("click", async () => {
  const redundant = vinCountRedundant(currentHistory);
  if (redundant === 0) {
    return;
  }

  const confirmed = confirm(
    `Remover ${redundant} registro${redundant === 1 ? "" : "s"} repetido${redundant === 1 ? "" : "s"}?\n\n` +
      "De cada VIN já lançado fica apenas o registro mais recente."
  );
  if (confirmed) {
    await vinRemoveDuplicatesNow();
  }
});

clearAllBtn.addEventListener("click", async () => {
  if (!confirm("Apagar todos os VINs da lista? Essa acao nao pode ser desfeita.")) {
    return;
  }
  await vinMutateHistory(() => []);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") {
    return;
  }

  if (changes[VIN_SETTINGS_KEY]) {
    const settings = { ...VIN_DEFAULT_SETTINGS, ...(changes[VIN_SETTINGS_KEY].newValue || {}) };
    autoPurge = settings.autoPurgeEnabled;
    renderPurgeInfo();
    render(currentHistory);
  }

  if (changes[VIN_STORAGE_KEY]) {
    render(changes[VIN_STORAGE_KEY].newValue || []);
  }
});

async function iniciar() {
  const settings = await vinGetSettings();
  currentShifts = settings.shifts;
  autoPurge = settings.autoPurgeEnabled;
  renderPurgeInfo();
  // Limpa o que ja venceu antes de mostrar a lista.
  render(await vinPurgeExpired());
}

iniciar();
