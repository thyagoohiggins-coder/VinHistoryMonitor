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

// Chave usada para decidir se dois registros sao o MESMO VIN. Ignora
// espacos, hifens e qualquer pontuacao, de modo que "95PEFL31 DVB101832",
// "95pefl31dvb101832" e "95PEFL31-DVB101832" contem como um so.
function vinCompareKey(vin) {
  return (vin || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
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
    const updated = await mutator(history);
    await vinSetHistory(updated);
    return updated;
  });

  // A fila nunca deve travar por causa de um erro em uma das operacoes.
  vinWriteQueue = result.catch(() => {});
  return result;
}

// Mantem apenas o registro mais recente de cada VIN.
function vinDedupeHistory(history) {
  const seen = new Set();
  const ordered = [...history].sort((a, b) => b.timestamp - a.timestamp);
  const kept = [];

  for (const entry of ordered) {
    const key = vinCompareKey(entry.vin);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    kept.push(entry);
  }

  return kept;
}

// Aplica a limpeza de duplicatas ao historico ja gravado. Usado ao ligar a
// opcao e pelo botao "Remover duplicatas agora".
async function vinRemoveDuplicatesNow() {
  return vinMutateHistory(vinDedupeHistory);
}

// Acrescenta um VIN ao historico respeitando a opcao de remover duplicatas.
async function vinAddEntry(vin) {
  const key = vinCompareKey(vin);

  // As configuracoes sao lidas dentro da fila para que uma mudanca na opcao
  // feita no mesmo instante nao seja ignorada por esta gravacao.
  return vinMutateHistory(async (history) => {
    const settings = await vinGetSettings();

    const base = settings.dedupeEnabled
      ? history.filter((entry) => vinCompareKey(entry.vin) !== key)
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

// Conjunto de chaves de VIN que aparecem mais de uma vez no historico.
// Compare sempre com vinCompareKey(entry.vin), nunca com entry.vin cru.
function vinFindDuplicates(history) {
  const counts = new Map();
  for (const entry of history) {
    const key = vinCompareKey(entry.vin);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const duplicates = new Set();
  for (const [key, count] of counts) {
    if (count > 1) {
      duplicates.add(key);
    }
  }
  return duplicates;
}

// Quantos registros seriam removidos por uma limpeza de duplicatas.
function vinCountRedundant(history) {
  const distinct = new Set(history.map((entry) => vinCompareKey(entry.vin)));
  return history.length - distinct.size;
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
