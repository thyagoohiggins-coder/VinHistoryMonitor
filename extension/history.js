const listContainer = document.getElementById("listContainer");
const totalCountEl = document.getElementById("totalCount");
const dupeCountEl = document.getElementById("dupeCount");
const shiftCountsEl = document.getElementById("shiftCounts");
const purgeInfoEl = document.getElementById("purgeInfo");
const searchInput = document.getElementById("searchInput");
const modelFilter = document.getElementById("modelFilter");
const colorFilter = document.getElementById("colorFilter");
const timeFrom = document.getElementById("timeFrom");
const timeTo = document.getElementById("timeTo");
const repairFilter = document.getElementById("repairFilter");
const clearFiltersBtn = document.getElementById("clearFilters");
const filterCountEl = document.getElementById("filterCount");

let currentHistory = [];
let currentShifts = VIN_DEFAULT_SHIFTS;
let autoPurge = true;
let showDelete = true;
let purgeShiftIds = [];
let currentSettings = VIN_DEFAULT_SETTINGS;

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

function renderPurgeInfo() {
  if (currentSettings.shiftOnlyMode) {
    const turno = vinCurrentShift(currentSettings);
    purgeInfoEl.textContent = turno
      ? `Modo turno: so o ${turno.label} aparece; tudo e apagado no fim dele (${turno.end}).`
      : "Modo turno: a lista e apagada no fim de cada turno.";
    return;
  }
  const textos = [];
  if (autoPurge) {
    const proxima = new Date(vinNextCycleStart(Date.now(), currentShifts));
    const hora = proxima.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const dia = proxima.toLocaleDateString("pt-BR");
    textos.push(`Os VINs sao apagados automaticamente no fim do 3º turno (proxima limpeza: ${dia} as ${hora}).`);
  }
  const turnos = currentShifts.filter((shift) => purgeShiftIds.includes(shift.id)).map((shift) => shift.label);
  if (turnos.length > 0) {
    textos.push(`VINs apagados ao fim do turno: ${turnos.join(", ")}.`);
  }
  purgeInfoEl.textContent = textos.length > 0 ? textos.join(" ") : "Limpeza automatica desativada.";
}

function applySettings(settings) {
  currentSettings = { ...settings, shifts: currentShifts };
  autoPurge = settings.autoPurgeEnabled;
  showDelete = settings.showDeleteButton !== false;
  purgeShiftIds = settings.purgeShiftIds || [];
}

function buildEntry(entry, repeats) {
  const repeat = repeats.get(entry.timestamp);

  const li = document.createElement("li");
  li.className = "vin-item";
  vinMarkRepeat(li, repeat);

  const vinEl = document.createElement("span");
  vinEl.className = "vin";
  vinEl.textContent = entry.vin;
  li.appendChild(vinEl);

  const badges = vinBuildModelColorBadges(entry);
  if (badges) {
    li.appendChild(badges);
  }

  if (repeat) {
    li.appendChild(vinBuildLaunchTag(repeat.ordinal));
  }

  const timeEl = vinBuildTimeBadge(entry.timestamp, "span");
  li.appendChild(timeEl);

  const repairRow = vinBuildRepairRow(entry);
  if (repairRow) {
    li.appendChild(repairRow);
  }

  const partsRow = vinBuildPartsRow(entry);
  if (partsRow) {
    li.appendChild(partsRow);
  }

  const buttons = document.createElement("div");
  buttons.className = "entry-actions";
  buttons.appendChild(vinBuildEntryButton("copy", (button) => vinCopyToClipboard(vinCopyText(entry), button)));
  if (showDelete) {
    buttons.appendChild(vinBuildEntryButton("delete", () => vinDeleteEntry(entry.timestamp)));
  }
  li.appendChild(buttons);

  return li;
}

// Texto sem acentos, maiusculo e com espacos simples, para comparar reparos.
function filterText(value) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function timeToMinutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value || "");
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

// Intervalo de hora inclusivo; "De 22:00 ate 02:00" atravessa a meia-noite.
function inTimeRange(timestamp, from, to) {
  if (from === null && to === null) return true;
  const minutos = vinMinutesOfDay(timestamp);
  if (from === null) return minutos <= to;
  if (to === null) return minutos >= from;
  return from <= to ? minutos >= from && minutos <= to : minutos >= from || minutos <= to;
}

// Preenche um <select> com os valores existentes, mantendo a escolha atual.
function fillFilterOptions(select, values) {
  const atual = select.value;
  const unicos = [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (atual && !unicos.includes(atual)) unicos.unshift(atual);
  while (select.options.length > 1) select.remove(1);
  for (const value of unicos) {
    select.add(new Option(value, value));
  }
  select.value = atual;
}

function applyFilters(history) {
  const termo = vinCompareKey(searchInput.value);
  const modelo = modelFilter.value;
  const cor = colorFilter.value;
  const from = timeToMinutes(timeFrom.value);
  const to = timeToMinutes(timeTo.value);
  const reparo = filterText(repairFilter.value);

  return history.filter(
    (entry) =>
      (!termo || vinCompareKey(entry.vin).includes(termo)) &&
      (!modelo || entry.model === modelo) &&
      (!cor || entry.color === cor) &&
      inTimeRange(entry.timestamp, from, to) &&
      (!reparo || filterText(entry.repair).includes(reparo))
  );
}

function hasActiveFilter() {
  return Boolean(
    searchInput.value.trim() ||
      modelFilter.value ||
      colorFilter.value ||
      timeFrom.value ||
      timeTo.value ||
      repairFilter.value.trim()
  );
}

function renderList() {
  listContainer.innerHTML = "";

  const filtrado = applyFilters(currentHistory);
  filterCountEl.textContent = hasActiveFilter()
    ? `${filtrado.length} de ${currentHistory.length} VIN${currentHistory.length === 1 ? "" : "s"}`
    : "";

  if (currentHistory.length === 0) {
    const vazio = document.createElement("p");
    vazio.className = "empty-list";
    vazio.textContent = "Nenhum VIN na lista. Preencha o campo VIN no formulario.";
    listContainer.appendChild(vazio);
    return;
  }

  if (filtrado.length === 0) {
    const vazio = document.createElement("p");
    vazio.className = "empty-list";
    vazio.textContent = "Nenhum VIN encontrado com esses filtros.";
    listContainer.appendChild(vazio);
    return;
  }

  const repeats = vinRepeatInfo(currentHistory);

  for (const grupo of vinGroupByShift(filtrado, currentShifts)) {
    // Modo turno: os outros turnos estao sempre vazios, nao aparecem.
    if (currentSettings.shiftOnlyMode && grupo.entries.length === 0) {
      continue;
    }
    const section = document.createElement("section");
    section.className = "day-shift-group" + (grupo.shift ? ` shift-${grupo.shift.id}` : " no-shift");

    const titulo = document.createElement("div");
    titulo.className = "day-shift-heading";

    const nome = document.createElement("span");
    nome.textContent = grupo.shift
      ? `${grupo.shift.label} (${grupo.shift.start}–${grupo.shift.end})`
      : "Fora de turno";

    const qtd = document.createElement("span");
    qtd.className = "qtd";
    qtd.textContent = `${grupo.entries.length} VIN${grupo.entries.length === 1 ? "" : "s"}`;

    const lado = document.createElement("span");
    lado.className = "heading-side";
    lado.appendChild(qtd);
    if (grupo.entries.length > 0) {
      const copyShift = document.createElement("button");
      copyShift.type = "button";
      copyShift.className = "entry-btn entry-btn-copy";
      copyShift.textContent = "Copiar turno";
      copyShift.addEventListener("click", () =>
        vinCopyToClipboard(vinCopyTextList(grupo.entries, nome.textContent), copyShift)
      );
      lado.appendChild(copyShift);
    }

    titulo.appendChild(nome);
    titulo.appendChild(lado);
    section.appendChild(titulo);

    const ul = document.createElement("ul");
    ul.className = "vin-list";
    for (const entry of grupo.entries) {
      ul.appendChild(buildEntry(entry, repeats));
    }
    section.appendChild(ul);
    listContainer.appendChild(section);
  }

  vinDecorateRepeats(listContainer);
}

// A largura da janela muda a altura das linhas: redesenha a linha lateral.
let decorateTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(decorateTimer);
  decorateTimer = setTimeout(() => vinDecorateRepeats(listContainer), 100);
});

function render(history) {
  currentHistory = vinVisibleHistory(history || [], currentSettings);

  totalCountEl.textContent = `${currentHistory.length} VIN${currentHistory.length === 1 ? "" : "s"} na lista`;

  const redundant = vinCountRedundant(currentHistory);
  dupeCountEl.textContent =
    redundant > 0 ? `${redundant} lançamento${redundant === 1 ? "" : "s"} repetido${redundant === 1 ? "" : "s"}` : "";

  renderShiftCounts(currentHistory, currentShifts);
  fillFilterOptions(modelFilter, currentHistory.map((entry) => entry.model));
  fillFilterOptions(colorFilter, currentHistory.map((entry) => entry.color));
  renderList();
}

for (const el of [searchInput, repairFilter, timeFrom, timeTo]) {
  el.addEventListener("input", renderList);
}
for (const el of [modelFilter, colorFilter, timeFrom, timeTo]) {
  el.addEventListener("change", renderList);
}
document.getElementById("copyFilteredBtn").addEventListener("click", (event) => {
  const title = hasActiveFilter() ? "VINs filtrados" : "Todos os VINs da lista";
  vinCopyToClipboard(vinCopyTextList(applyFilters(currentHistory), title), event.currentTarget);
});

clearFiltersBtn.addEventListener("click", () => {
  for (const el of [searchInput, modelFilter, colorFilter, timeFrom, timeTo, repairFilter]) {
    el.value = "";
  }
  renderList();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") {
    return;
  }

  if (changes[VIN_SETTINGS_KEY]) {
    const settings = { ...VIN_DEFAULT_SETTINGS, ...(changes[VIN_SETTINGS_KEY].newValue || {}) };
    applySettings(settings);
    renderPurgeInfo();
    vinGetHistory().then(render);
  }

  if (changes[VIN_STORAGE_KEY]) {
    render(changes[VIN_STORAGE_KEY].newValue || []);
  }
});

async function iniciar() {
  const settings = await vinGetSettings();
  currentShifts = settings.shifts;
  applySettings(settings);
  renderPurgeInfo();
  // Limpa o que ja venceu antes de mostrar a lista.
  render(await vinPurgeExpired());
}

iniciar();
