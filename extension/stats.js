const periodSelect = document.getElementById("periodSelect");
const kpisEl = document.getElementById("kpis");
const modelBarsEl = document.getElementById("modelBars");
const repairBarsEl = document.getElementById("repairBars");
const colorLegendEl = document.getElementById("colorLegend");

const NO_MODEL = "Sem modelo";
const NO_COLOR = "Sem cor";
const TOP_REPAIRS = 10;

// Cores conhecidas dos veiculos; as demais ficam cinza-claro.
const COLOR_HEX = {
  CINZA: "#9ca3af",
  PRETO: "#111827",
  AZUL: "#2563eb",
  BRANCO: "#ffffff",
  PRATA: "#d1d5db",
  VERMELHO: "#dc2626",
  VERDE: "#16a34a",
  AMARELO: "#facc15",
  LARANJA: "#f97316",
  MARROM: "#92400e",
  VINHO: "#7f1d1d",
  BEGE: "#d6c3a1",
  DOURADO: "#ca9a2b",
};

function colorHex(name) {
  const key = (name || "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  return COLOR_HEX[key] || "#e5e7eb";
}

function isLightColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const luminance = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return luminance > 200;
}

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
// os registrados a partir de `since` (ms).
function computeStats(records, since) {
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
  const colors = new Map();

  for (const item of items) {
    const modelName = item.model || NO_MODEL;
    const colorName = item.color || NO_COLOR;

    if (!models.has(modelName)) {
      models.set(modelName, { name: modelName, count: 0, colors: new Map(), repairs: new Map() });
    }
    const model = models.get(modelName);
    model.count += 1;
    bump(model.colors, colorName);
    bump(colors, colorName);

    const repairKey = repairNormalize(item.repair);
    if (repairKey) {
      if (!repairs.has(repairKey)) {
        repairs.set(repairKey, { key: repairKey, count: 0, texts: new Map(), models: new Map() });
      }
      const repair = repairs.get(repairKey);
      repair.count += 1;
      bump(repair.texts, item.repair.trim());
      bump(repair.models, modelName);
      bump(model.repairs, repairKey);
    }
  }

  return {
    total: items.length,
    withRepair: items.filter((item) => repairNormalize(item.repair)).length,
    models: [...models.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    repairs: [...repairs.values()].sort((a, b) => b.count - a.count),
    colors: [...colors.entries()].sort((a, b) => b[1] - a[1]),
  };
}

// ---------------------------------------------------------------- tela
function sinceFor(period) {
  if (period === "all") return 0;
  if (period === "today") return vinCycleStart(Date.now(), VIN_DEFAULT_SHIFTS);
  return Date.now() - Number(period) * 86400000;
}

function makeKpi(label, value, italic) {
  const box = document.createElement("div");
  box.className = "kpi" + (italic ? " kpi-italic" : "");
  const l = document.createElement("span");
  l.className = "kpi-label";
  l.textContent = label;
  const v = document.createElement("span");
  v.className = "kpi-value";
  v.textContent = value;
  box.append(l, v);
  return box;
}

function makeBarRow(label, value, max, segments, note, single) {
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
  frag.appendChild(row);
  return frag;
}

function repairLabel(repair) {
  return topEntry(repair.texts)[0];
}

function render(records) {
  const stats = computeStats(records, sinceFor(periodSelect.value));

  kpisEl.innerHTML = "";
  const topModel = stats.models[0];
  const topRepair = stats.repairs[0];
  kpisEl.append(
    makeKpi("VINs analisados", String(stats.total)),
    makeKpi("Com reparo informado", String(stats.withRepair)),
    makeKpi("Modelo com mais reparos", topModel ? `${topModel.name} (${topModel.count})` : "—"),
    makeKpi("Reparo crítico mais frequente", topRepair ? `${repairLabel(topRepair)} (${topRepair.count})` : "—", true)
  );

  // Modelos, cada barra dividida pelas cores dos veiculos.
  modelBarsEl.innerHTML = "";
  colorLegendEl.innerHTML = "";
  if (stats.models.length === 0) {
    modelBarsEl.innerHTML = '<p class="empty-list">Sem dados no periodo. Os indicadores sao gravados a partir da versao atual, conforme os VINs sao lancados.</p>';
  }
  const maxModel = stats.models[0]?.count || 1;
  for (const model of stats.models) {
    const segments = [...model.colors.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => {
        const color = colorHex(label);
        return { label, count, color, light: isLightColor(color) };
      });
    const topModelRepair = topEntry(model.repairs);
    const note = topModelRepair
      ? `Mais comum: ${repairLabel(repairsByKey(stats, topModelRepair[0]))} (${topModelRepair[1]})`
      : "";
    modelBarsEl.appendChild(makeBarRow(model.name, model.count, maxModel, segments, note, false));
  }

  for (const [label, count] of stats.colors) {
    const chip = document.createElement("span");
    chip.className = "legend-chip";
    const dot = document.createElement("span");
    dot.className = "legend-dot";
    dot.style.background = colorHex(label);
    chip.append(dot, `${label} (${count})`);
    colorLegendEl.appendChild(chip);
  }

  // Reparos mais frequentes.
  repairBarsEl.innerHTML = "";
  const top = stats.repairs.slice(0, TOP_REPAIRS);
  if (top.length === 0) {
    repairBarsEl.innerHTML = '<p class="empty-list">Nenhum reparo registrado no periodo.</p>';
  }
  const maxRepair = top[0]?.count || 1;
  for (const repair of top) {
    const topRepairModel = topEntry(repair.models);
    const note = topRepairModel ? `Mais em: ${topRepairModel[0]} (${topRepairModel[1]})` : "";
    repairBarsEl.appendChild(
      makeBarRow(repairLabel(repair), repair.count, maxRepair, [{ label: "Total", count: repair.count }], note, true)
    );
  }
}

function repairsByKey(stats, key) {
  return stats.repairs.find((repair) => repair.key === key);
}

let allRecords = [];

periodSelect.addEventListener("change", () => render(allRecords));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[VIN_STATS_KEY]) {
    allRecords = changes[VIN_STATS_KEY].newValue || [];
    render(allRecords);
  }
});

(async function iniciar() {
  allRecords = await vinStatsGetAll();
  render(allRecords);
})();
