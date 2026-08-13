// Funcoes compartilhadas de acesso ao chrome.storage.local usadas pelo
// content script, pelo popup e pela pagina de historico/calendario.

const VIN_STORAGE_KEY = "vinHistory";
const VIN_SETTINGS_KEY = "vinSettings";
const VIN_DEFAULT_SHIFTS = [
  { id: "t1", label: "1º turno", start: "06:00", end: "14:00" },
  { id: "t2", label: "2º turno", start: "14:00", end: "22:00" },
  { id: "t3", label: "3º turno", start: "22:00", end: "06:00" },
];

const VIN_DEFAULT_SETTINGS = {
  // Desativado por padrao: por padrao TODAS as entradas ficam no historico,
  // inclusive VINs repetidos (que sao destacados na interface).
  dedupeEnabled: false,
  shifts: VIN_DEFAULT_SHIFTS,
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
  const merged = { ...VIN_DEFAULT_SETTINGS, ...(settings || {}) };

  // Um valor gravado por uma versao antiga (ou corrompido) nao pode deixar a
  // extensao sem turnos.
  if (!Array.isArray(merged.shifts) || merged.shifts.length === 0) {
    merged.shifts = VIN_DEFAULT_SHIFTS;
  }

  return merged;
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

// ---------------------------------------------------------------------------
// Turnos
// ---------------------------------------------------------------------------

// "HH:MM" -> minutos desde a meia-noite, ou null se invalido.
function vinParseTime(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec((text || "").trim());
  if (!match) {
    return null;
  }

  const horas = Number(match[1]);
  const minutos = Number(match[2]);
  if (horas > 23 || minutos > 59) {
    return null;
  }

  return horas * 60 + minutos;
}

function vinMinutesOfDay(timestamp) {
  const date = new Date(timestamp);
  return date.getHours() * 60 + date.getMinutes();
}

// Um turno cobre um instante se o horario cair entre inicio e fim. Quando o
// fim e menor que o inicio (3º turno, 22:00 -> 06:00) o intervalo atravessa a
// meia-noite e o teste se inverte.
function vinShiftCovers(shift, minutosDoDia) {
  const inicio = vinParseTime(shift.start);
  const fim = vinParseTime(shift.end);

  // Horario invalido ou intervalo de duracao zero nao cobre nada - assim um
  // turno mal preenchido nao engole os registros dos outros.
  if (inicio === null || fim === null || inicio === fim) {
    return false;
  }

  return inicio < fim
    ? minutosDoDia >= inicio && minutosDoDia < fim
    : minutosDoDia >= inicio || minutosDoDia < fim;
}

// Turno de um registro, ou null se nenhum turno cobrir aquele horario.
// Se dois turnos se sobrepuserem, vale o primeiro da lista.
function vinShiftForTimestamp(timestamp, shifts) {
  const minutos = vinMinutesOfDay(timestamp);
  return shifts.find((shift) => vinShiftCovers(shift, minutos)) || null;
}

// Separa o historico por turno. Retorna uma lista na ordem dos turnos
// configurados, com um balde final para o que ficou fora de todos eles.
function vinGroupByShift(history, shifts) {
  const grupos = shifts.map((shift) => ({ shift, entries: [] }));
  const porId = new Map(grupos.map((grupo) => [grupo.shift.id, grupo]));
  const foraDeTurno = { shift: null, entries: [] };

  for (const entry of history) {
    const shift = vinShiftForTimestamp(entry.timestamp, shifts);
    const destino = shift ? porId.get(shift.id) || foraDeTurno : foraDeTurno;
    destino.entries.push(entry);
  }

  for (const grupo of grupos) {
    grupo.entries.sort((a, b) => b.timestamp - a.timestamp);
  }
  foraDeTurno.entries.sort((a, b) => b.timestamp - a.timestamp);

  return foraDeTurno.entries.length > 0 ? [...grupos, foraDeTurno] : grupos;
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
