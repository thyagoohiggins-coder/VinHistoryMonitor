const periodSelect = document.getElementById("periodSelect");
const kpisEl = document.getElementById("kpis");
const modelBarsEl = document.getElementById("modelBars");
const repairBarsEl = document.getElementById("repairBars");

const NO_MODEL = "Sem modelo";
const TOP_REPAIRS = 10;

function bump(map, key, by = 1) {
  map.set(key, (map.get(key) || 0) + by);
}

function topEntry(map) {
  let best = null;
  for (const [key, count] of map) {
    if (!best || count > best[1]) best = [key, count];
  }
  return best;
}

// Agrega os registros: cada VIN conta uma vez (o mais recente) e so entram
// os registrados a partir de `since` (ms). `partsByTs` completa as pecas
// faltantes de registros antigos que nao as gravaram nos indicadores.
function computeStats(records, since, partsByTs = new Map()) {
  const byVin = new Map();
  for (const record of records) {
    if (!record.vin || record.ts < since) continue;
    const key = vinCompareKey(record.vin);
    const previous = byVin.get(key);
    if (!previous || record.ts > previous.ts) byVin.set(key, record);
  }

  const items = [...byVin.values()];
  const models = new Map();
  const repairs = new Map();
  let withCripple = 0;

  for (const item of items) {
    const modelName = item.model || NO_MODEL;
    const parts = Array.isArray(item.parts) ? item.parts : partsByTs.get(item.ts) || [];

    if (parts.length > 0) {
      withCripple += 1;
      if (!models.has(modelName)) {
        models.set(modelName, { name: modelName, count: 0, vins: 0, parts: new Map() });
      }
      const model = models.get(modelName);
      model.vins += 1;
      for (const part of parts) {
        const label = String(part).trim();
        if (!label) continue;
        model.count += 1;
        bump(model.parts, label);
      }
    }

    const repairKey = repairNormalize(item.repair);
    if (repairKey) {
      if (!repairs.has(repairKey)) {
        repairs.set(repairKey, { key: repairKey, count: 0, texts: new Map() });
      }
      const repair = repairs.get(repairKey);
      repair.count += 1;
      bump(repair.texts, item.repair.trim());
    }
  }

  return {
    total: items.length,
    withCripple,
    withRepair: items.filter((item) => repairNormalize(item.repair)).length,
    models: [...models.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    repairs: [...repairs.values()].sort((a, b) => b.count - a.count),
  };
}

// ---------------------------------------------------------------- tela
function sinceFor(period) {
  if (period === "all") return 0;
  if (period === "today") return vinCycleStart(Date.now(), VIN_DEFAULT_SHIFTS);
  return Date.now() - Number(period) * 86400000;
}

function makeKpi(label, value) {
  const box = document.createElement("div");
  box.className = "kpi";
  const l = document.createElement("span");
  l.className = "kpi-label";
  l.textContent = label;
  const v = document.createElement("span");
  v.className = "kpi-value";
  v.textContent = value;
  box.append(l, v);
  return box;
}

function makeBarRow(label, value, max, segments, note, single, chips) {
  const frag = document.createDocumentFragment();

  const row = document.createElement("div");
  row.className = "bar-row" + (single ? " single" : "");

  const name = document.createElement("span");
  name.className = "bar-label";
  name.textContent = label;

  const track = document.createElement("div");
  track.className = "bar-track";
  track.style.width = `${Math.max((value / max) * 100, 2)}%`;
  for (const seg of segments) {
    const part = document.createElement("div");
    part.className = "bar-seg" + (seg.light ? " light" : "");
    part.style.flex = String(seg.count);
    if (seg.color) part.style.background = seg.color;
    part.title = `${seg.label}: ${seg.count}`;
    track.appendChild(part);
  }

  const count = document.createElement("span");
  count.className = "bar-value";
  count.textContent = String(value);

  row.append(name, track, count);

  if (note) {
    const p = document.createElement("p");
    p.className = "bar-note";
    p.textContent = note;
    row.appendChild(p);
  }
  if (chips && chips.length > 0) {
    const list = document.createElement("div");
    list.className = "cripple-list";
    for (const text of chips) {
      const chip = document.createElement("span");
      chip.className = "cripple-chip";
      chip.textContent = text;
      list.appendChild(chip);
    }
    row.appendChild(list);
  }
  frag.appendChild(row);
  return frag;
}

function repairLabel(repair) {
  return topEntry(repair.texts)[0];
}

function render(records) {
  const stats = computeStats(records, sinceFor(periodSelect.value), historyParts);

  kpisEl.innerHTML = "";
  const topModel = stats.models[0];
  const topRepair = stats.repairs[0];
  kpisEl.append(
    makeKpi("VINs analisados", String(stats.total)),
    makeKpi("Com cripple", String(stats.withCripple)),
    makeKpi("Modelo com mais cripples", topModel ? `${topModel.name} (${topModel.count})` : "—"),
    makeKpi("Reparo mais frequente", topRepair ? `${repairLabel(topRepair)} (${topRepair.count})` : "—")
  );

  // Cripples por modelo: total de pecas faltantes e quais foram.
  modelBarsEl.innerHTML = "";
  if (stats.models.length === 0) {
    modelBarsEl.innerHTML = '<p class="empty-list">Nenhum cripple registrado no periodo.</p>';
  }
  const maxModel = stats.models[0]?.count || 1;
  for (const model of stats.models) {
    const chips = [...model.parts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([part, count]) => `${part} (${count})`);
    const note = `${model.vins} ${model.vins === 1 ? "VIN" : "VINs"} com cripple`;
    modelBarsEl.appendChild(
      makeBarRow(model.name, model.count, maxModel, [{ label: "Cripples", count: model.count }], note, true, chips)
    );
  }

  // Reparos mais frequentes.
  repairBarsEl.innerHTML = "";
  const top = stats.repairs.slice(0, TOP_REPAIRS);
  if (top.length === 0) {
    repairBarsEl.innerHTML = '<p class="empty-list">Nenhum reparo registrado no periodo.</p>';
  }
  const maxRepair = top[0]?.count || 1;
  for (const repair of top) {
    repairBarsEl.appendChild(
      makeBarRow(repairLabel(repair), repair.count, maxRepair, [{ label: "Total", count: repair.count }], "", true)
    );
  }
}

let allRecords = [];
// Pecas faltantes do historico (por timestamp), para registros dos
// indicadores gravados antes de guardarem as pecas.
let historyParts = new Map();

function indexHistoryParts(history) {
  historyParts = new Map(
    (history || []).filter((entry) => Array.isArray(entry.parts)).map((entry) => [entry.timestamp, entry.parts])
  );
}

periodSelect.addEventListener("change", () => render(allRecords));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[VIN_STORAGE_KEY]) indexHistoryParts(changes[VIN_STORAGE_KEY].newValue);
  if (changes[VIN_STATS_KEY]) allRecords = changes[VIN_STATS_KEY].newValue || [];
  if (changes[VIN_STORAGE_KEY] || changes[VIN_STATS_KEY]) render(allRecords);
});

(async function iniciar() {
  indexHistoryParts(await vinGetHistory());
  allRecords = await vinStatsGetAll();
  render(allRecords);
})();
