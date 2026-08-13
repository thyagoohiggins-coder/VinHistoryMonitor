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
  return vinMutateHistory((history) =>
    history.filter((entry) => entry.timestamp !== timestamp)
  );
}

// Fila de escrita: chrome.storage e assincrono, entao duas alteracoes
// disparadas ao mesmo tempo (ex.: blur e change no mesmo instante) leriam
// a mesma versao do historico e a segunda sobrescreveria a primeira,
// perdendo registros. Encadeando as operacoes, cada uma le o resultado
// ja gravado pela anterior.
let vinWriteQueue = Promise.resolve();

function vinMutateHistory(mutator) {
  const result = vinWriteQueue.then(async () => {
    const history = await vinGetHistory();
    const updated = mutator(history);
    await vinSetHistory(updated);
    return updated;
  });

  // A fila nunca deve travar por causa de um erro em uma das operacoes.
  vinWriteQueue = result.catch(() => {});
  return result;
}

// Acrescenta um VIN ao historico respeitando a opcao de remover duplicatas.
async function vinAddEntry(vin) {
  const settings = await vinGetSettings();

  return vinMutateHistory((history) => {
    const base = settings.dedupeEnabled
      ? history.filter((entry) => entry.vin !== vin)
      : history.slice();

    // O timestamp identifica cada registro, entao nao pode se repetir.
    let timestamp = Date.now();
    while (base.some((entry) => entry.timestamp === timestamp)) {
      timestamp += 1;
    }

    base.unshift({ vin, timestamp });
    return base;
  });
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
