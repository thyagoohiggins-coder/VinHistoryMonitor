// Funcoes compartilhadas de acesso ao chrome.storage.local usadas pelo
// content script, pelo popup e pela pagina de historico/calendario.

const VIN_STORAGE_KEY = "vinHistory";
const VIN_SETTINGS_KEY = "vinSettings";
const VIN_DEFAULT_SETTINGS = {
  // Desativado por padrao: por padrao TODAS as entradas ficam no historico,
  // inclusive VINs repetidos (que sao destacados na interface).
  dedupeEnabled: false,
};

function vinNormalize(value) {
  return (value || "").trim().toUpperCase();
}

async function vinGetSettings() {
  const { [VIN_SETTINGS_KEY]: settings } = await chrome.storage.local.get(VIN_SETTINGS_KEY);
  return { ...VIN_DEFAULT_SETTINGS, ...(settings || {}) };
}

async function vinSetSettings(partial) {
  const current = await vinGetSettings();
  const next = { ...current, ...partial };
  await chrome.storage.local.set({ [VIN_SETTINGS_KEY]: next });
  return next;
}

async function vinGetHistory() {
  const { [VIN_STORAGE_KEY]: history = [] } = await chrome.storage.local.get(VIN_STORAGE_KEY);
  return history;
}

async function vinSetHistory(history) {
  await chrome.storage.local.set({ [VIN_STORAGE_KEY]: history });
}

// Remove uma unica entrada do historico pelo timestamp (identificador
// unico de cada registro).
async function vinDeleteEntry(timestamp) {
  const history = await vinGetHistory();
  const updated = history.filter((entry) => entry.timestamp !== timestamp);
  await vinSetHistory(updated);
  return updated;
}

// Chave no formato AAAA-MM-DD no fuso horario local, usada para agrupar por dia.
function vinDateKey(timestamp) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Retorna o conjunto de VINs que aparecem mais de uma vez no historico.
function vinFindDuplicates(history) {
  const counts = new Map();
  for (const entry of history) {
    counts.set(entry.vin, (counts.get(entry.vin) || 0) + 1);
  }

  const duplicates = new Set();
  for (const [vin, count] of counts) {
    if (count > 1) {
      duplicates.add(vin);
    }
  }
  return duplicates;
}

function vinGroupByDate(history) {
  const map = new Map();
  for (const entry of history) {
    const key = vinDateKey(entry.timestamp);
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(entry);
  }
  return map;
}
