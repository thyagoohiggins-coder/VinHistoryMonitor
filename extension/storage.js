// Funcoes compartilhadas de acesso ao chrome.storage.local usadas pelo
// content script, pelo popup e pela pagina de historico/calendario.

const VIN_STORAGE_KEY = "vinHistory";
const VIN_SETTINGS_KEY = "vinSettings";
// Registro permanente (nao e apagado na virada do dia) usado nos indicadores:
// { ts, vin, model, color, parts, repair } por VIN lancado.
const VIN_STATS_KEY = "vinStats";
const VIN_STATS_MAX = 20000;
const VIN_PIN_KEY = "vinPinHash";
// Modelos e prefixos de VIN sugeridos ao clicar no campo VIN do formulario.
const VIN_PREFIX_KEY = "vinPrefixes";
const VIN_DEFAULT_PREFIXES = [
  { model: "S202 (Uni-T)", prefix: "95PLDL61DVB" },
  { model: "C655 (CS55)", prefix: "95PJCL61DVB" },
  { model: "C928 (CS75)", prefix: "95PKDM81DVB" },
  { model: "T1E ADAS (Tiggo 7)", prefix: "95PEEL61DVB" },
];
const VIN_DEFAULT_PIN = "0000";
// Horarios FIXOS dos turnos (nao sao configuraveis).
const VIN_DEFAULT_SHIFTS = [
  { id: "t1", label: "1º turno", start: "06:00", end: "15:48" },
  { id: "t2", label: "2º turno", start: "15:48", end: "01:00" },
  { id: "t3", label: "3º turno", start: "01:00", end: "06:00" },
];

const VIN_DEFAULT_SETTINGS = {
  // Desativado por padrao: por padrao TODAS as entradas ficam no historico,
  // inclusive VINs repetidos (que sao destacados na interface).
  dedupeEnabled: false,
  // Apaga os VINs quando o dia de producao termina (fim do 3º turno, que e
  // quando o 1º turno recomeca).
  autoPurgeEnabled: true,
  // Banco de reparos congelado: nao aprende nem aceita reparos novos.
  repairFrozen: false,
  // Mostra o botao "Apagar" em cada VIN (popup e lista).
  showDeleteButton: true,
  // Turnos cujos VINs sao apagados automaticamente quando o turno termina.
  purgeShiftIds: [],
  // Modo turno: a lista mostra so o turno atual e tudo e apagado no fim de
  // cada turno (vale para todos os turnos).
  shiftOnlyMode: false,
  // Sugestoes de modelo/prefixo ao clicar no campo VIN.
  prefixSuggestEnabled: true,
  // Aviso no formulario quando o VIN digitado ja foi lancado antes.
  repeatNoticeEnabled: true,
  // Letras minimas digitadas para o banco de reparos sugerir.
  repairMinChars: 2,
  // Etiquetas de criticidade (N1-N4) na lista e a menor que aparece
  // (ex.: 3 = so N3 e N4 ganham etiqueta).
  levelBadgesEnabled: true,
  levelMinShown: 1,
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

  // Os turnos sao fixos: qualquer horario gravado por versoes antigas e ignorado.
  merged.shifts = VIN_DEFAULT_SHIFTS;

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
  const updated = await vinMutateHistory((history) =>
    history.filter((entry) => entry.timestamp !== timestamp)
  );
  // Um VIN apagado a mao (ex.: digitado errado) tambem sai dos indicadores.
  await vinStatsDelete(timestamp);
  return updated;
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
async function vinAddEntry(vin, details) {
  const key = vinCompareKey(vin);

  // As configuracoes sao lidas dentro da fila para que uma mudanca na opcao
  // feita no mesmo instante nao seja ignorada por esta gravacao.
  return vinMutateHistory(async (history) => {
    const settings = await vinGetSettings();

    // Garante que um dia de producao ja encerrado nao fique misturado com o novo.
    const current = vinApplyPurge(history, settings);

    const base = settings.dedupeEnabled
      ? current.filter((entry) => vinCompareKey(entry.vin) !== key)
      : current.slice();

    // O timestamp identifica cada registro, entao nao pode se repetir.
    let timestamp = Date.now();
    while (base.some((entry) => entry.timestamp === timestamp)) {
      timestamp += 1;
    }

    const entry = { vin, timestamp };
    Object.assign(entry, details || {});
    base.unshift(entry);
    return base;
  });
}

// ---------------------------------------------------------------------------
// Dia de producao: comeca quando o 1º turno comeca (fim do 3º turno) e os
// VINs sao apagados automaticamente nessa virada.
// ---------------------------------------------------------------------------

// Instante (ms) do inicio do dia de producao mais recente, ate `agora`.
function vinCycleStart(agora, shifts) {
  const minutos = vinParseTime(shifts[0]?.start);
  const base = minutos === null ? 6 * 60 : minutos;

  const inicio = new Date(agora);
  inicio.setHours(Math.floor(base / 60), base % 60, 0, 0);
  if (inicio.getTime() > agora) {
    inicio.setDate(inicio.getDate() - 1);
  }
  return inicio.getTime();
}

// Proxima virada do dia de producao (quando os VINs serao apagados).
function vinNextCycleStart(agora, shifts) {
  const proximo = new Date(vinCycleStart(agora, shifts));
  proximo.setDate(proximo.getDate() + 1);
  return proximo.getTime();
}

// Historico sem os VINs de dias de producao ja encerrados.
function vinDropExpired(history, shifts, agora = Date.now()) {
  const limite = vinCycleStart(agora, shifts);
  return history.filter((entry) => entry.timestamp >= limite);
}

// Fim (ms) da ocorrencia do turno que contem `timestamp`. Turnos que
// atravessam a meia-noite terminam no dia seguinte.
function vinShiftOccurrenceEnd(timestamp, shift) {
  const inicio = vinParseTime(shift.start);
  const fim = vinParseTime(shift.end);
  const data = new Date(timestamp);
  const minutos = vinMinutesOfDay(timestamp);
  data.setHours(Math.floor(fim / 60), fim % 60, 0, 0);
  if (fim <= inicio && minutos >= inicio) {
    data.setDate(data.getDate() + 1);
  }
  return data.getTime();
}

// Proximo fim (ms) de um turno depois de `agora`.
function vinNextShiftEnd(agora, shift) {
  const fim = vinParseTime(shift.end);
  const data = new Date(agora);
  data.setHours(Math.floor(fim / 60), fim % 60, 0, 0);
  if (data.getTime() <= agora) {
    data.setDate(data.getDate() + 1);
  }
  return data.getTime();
}

// Historico sem os VINs dos turnos marcados para apagar que ja terminaram.
function vinDropShiftExpired(history, settings, agora = Date.now()) {
  const ids = settings.shiftOnlyMode ? settings.shifts.map((shift) => shift.id) : settings.purgeShiftIds || [];
  if (ids.length === 0) {
    return history;
  }
  return history.filter((entry) => {
    const shift = vinShiftForTimestamp(entry.timestamp, settings.shifts);
    return !shift || !ids.includes(shift.id) || vinShiftOccurrenceEnd(entry.timestamp, shift) > agora;
  });
}

// Proxima limpeza automatica (fim do dia ou fim de um turno marcado), ou null.
function vinNextPurgeTime(agora, settings) {
  const ids = settings.shiftOnlyMode ? settings.shifts.map((shift) => shift.id) : settings.purgeShiftIds || [];
  const tempos = ids
    .map((id) => settings.shifts.find((shift) => shift.id === id))
    .filter(Boolean)
    .map((shift) => vinNextShiftEnd(agora, shift));
  if (settings.autoPurgeEnabled) {
    tempos.push(vinNextCycleStart(agora, settings.shifts));
  }
  return tempos.length > 0 ? Math.min(...tempos) : null;
}

function vinApplyPurge(history, settings, agora = Date.now()) {
  const kept = settings.autoPurgeEnabled ? vinDropExpired(history, settings.shifts, agora) : history;
  return vinDropShiftExpired(kept, settings, agora);
}

// O que a lista deve mostrar agora: no modo turno, so o turno atual (mesmo
// que a limpeza do storage ainda nao tenha rodado).
function vinVisibleHistory(history, settings, agora = Date.now()) {
  return settings.shiftOnlyMode ? vinApplyPurge(history, settings, agora) : history;
}

// Turno atual (ou null).
function vinCurrentShift(settings, agora = Date.now()) {
  return vinShiftForTimestamp(agora, settings.shifts);
}

// Apaga do storage os VINs vencidos (dia encerrado e turnos marcados).
// Retorna o historico atual.
async function vinPurgeExpired() {
  const settings = await vinGetSettings();
  if (settings.shiftOnlyMode) {
    await vinPurgeStatsByShift(settings);
  }
  // So grava quando ha algo vencido (evita escritas e eventos desnecessarios).
  const history = await vinGetHistory();
  const kept = vinApplyPurge(history, settings);
  if (kept.length === history.length) {
    return history;
  }
  return vinMutateHistory((current) => vinApplyPurge(current, settings));
}

// Modo turno: os indicadores tambem sao apagados no fim de cada turno.
async function vinPurgeStatsByShift(settings, agora = Date.now()) {
  const vigente = (record) => {
    const shift = vinShiftForTimestamp(record.ts, settings.shifts);
    return !shift || vinShiftOccurrenceEnd(record.ts, shift) > agora;
  };
  const stats = await vinStatsGetAll();
  if (stats.every(vigente)) {
    return;
  }
  await vinStatsMutate((current) => current.filter(vigente));
}

// Ocorrencia do turno que contem `timestamp`: { shift, start, end } (ms), ou null.
function vinShiftOccurrence(timestamp, shifts) {
  const shift = vinShiftForTimestamp(timestamp, shifts);
  if (!shift) {
    return null;
  }
  const end = vinShiftOccurrenceEnd(timestamp, shift);
  const inicio = vinParseTime(shift.start);
  const fim = vinParseTime(shift.end);
  const duracao = ((fim - inicio + 1440) % 1440 || 1440) * 60000;
  return { shift, start: end - duracao, end };
}

// Atualiza modelo, cor e pecas faltantes de um registro ja gravado.
async function vinSetEntryDetails(timestamp, details) {
  return vinMutateHistory((history) =>
    history.map((entry) => {
      if (entry.timestamp !== timestamp) {
        return entry;
      }
      const merged = { ...entry, ...details };
      return JSON.stringify(merged) === JSON.stringify(entry) ? entry : merged;
    })
  );
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

// Linha "Cripple: ..." com as pecas faltantes de um registro (undefined se o
// registro nao tem a informacao).
function vinBuildPartsRow(entry) {
  if (!Array.isArray(entry.parts)) {
    return null;
  }

  const row = document.createElement("div");
  row.className = "parts-row" + (entry.parts.length === 0 ? " parts-none" : "");

  const label = document.createElement("span");
  label.className = "parts-label";
  label.textContent = entry.parts.length === 0 ? "Cripple: nenhum" : `Cripple (${entry.parts.length}):`;
  row.appendChild(label);

  for (const part of entry.parts) {
    const chip = document.createElement("span");
    chip.className = "part-chip";
    chip.textContent = part;
    row.appendChild(chip);
  }
  return row;
}

// Etiquetas de modelo e cor para ficar ao lado do VIN (null se nao houver).
function vinBuildModelColorBadges(entry) {
  const items = [entry.model, entry.color].filter(Boolean);
  if (items.length === 0) {
    return null;
  }
  const box = document.createElement("span");
  box.className = "vin-badges";
  [["model", entry.model], ["color", entry.color]].forEach(([kind, value]) => {
    if (!value) return;
    const badge = document.createElement("span");
    badge.className = `vin-badge vin-badge-${kind}`;
    badge.textContent = value;
    box.appendChild(badge);
  });
  return box;
}

// ---------------------------------------------------------------------------
// Indicadores (registro permanente por VIN)
// ---------------------------------------------------------------------------

async function vinStatsGetAll() {
  const { [VIN_STATS_KEY]: stats = [] } = await chrome.storage.local.get(VIN_STATS_KEY);
  return Array.isArray(stats) ? stats : [];
}

let vinStatsQueue = Promise.resolve();

function vinStatsMutate(mutator) {
  const result = vinStatsQueue.then(async () => {
    const updated = mutator(await vinStatsGetAll());
    await chrome.storage.local.set({ [VIN_STATS_KEY]: updated });
    return updated;
  });
  vinStatsQueue = result.catch(() => {});
  return result;
}

// Cria ou atualiza o registro do VIN identificado por `ts`; so grava os
// campos informados (undefined/null mantem o valor anterior).
function vinStatsUpsert(ts, patch) {
  const clean = {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (value !== undefined && value !== null) {
      clean[key] = value;
    }
  }

  return vinStatsMutate((stats) => {
    const index = stats.findIndex((item) => item.ts === ts);
    if (index === -1) {
      stats.push({ ts, ...clean });
      return stats.length > VIN_STATS_MAX ? stats.slice(-VIN_STATS_MAX) : stats;
    }
    stats[index] = { ...stats[index], ...clean };
    return stats;
  });
}

function vinStatsDelete(ts) {
  return vinStatsMutate((stats) => stats.filter((item) => item.ts !== ts));
}

function vinStatsClear() {
  return vinStatsMutate(() => []);
}

// ---------------------------------------------------------------------------
// PIN das acoes protegidas (padrao 0000). E uma trava de interface, nao
// criptografia: serve para evitar cliques acidentais de outras pessoas.
// ---------------------------------------------------------------------------

async function vinHashPin(pin) {
  const bytes = new TextEncoder().encode(`vin-monitor:${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function vinCheckPin(pin) {
  const { [VIN_PIN_KEY]: stored } = await chrome.storage.local.get(VIN_PIN_KEY);
  const expected = stored || (await vinHashPin(VIN_DEFAULT_PIN));
  return (await vinHashPin(String(pin))) === expected;
}

async function vinSetPin(newPin) {
  await chrome.storage.local.set({ [VIN_PIN_KEY]: await vinHashPin(String(newPin)) });
}

// Linha "Reparo: ..." com o principal reparo digitado para o VIN.
function vinBuildRepairRow(entry) {
  if (!entry.repair) {
    return null;
  }
  const row = document.createElement("div");
  row.className = "repair-row";

  const label = document.createElement("span");
  label.className = "repair-label";
  label.textContent = "Reparo:";

  const text = document.createElement("span");
  text.className = "repair-value";
  text.textContent = entry.repair;

  row.append(label, text);
  return row;
}

// ---------------------------------------------------------------------------
// VINs repetidos: "Primeiro lancamento", "Segundo lancamento"... e uma linha
// lateral ligando os lancamentos do mesmo VIN.
// ---------------------------------------------------------------------------

const VIN_ORDINALS = [
  "Primeiro", "Segundo", "Terceiro", "Quarto", "Quinto",
  "Sexto", "Sétimo", "Oitavo", "Nono", "Décimo",
];
// Cor da linha de cada grupo de VIN repetido (varia de um VIN para outro).
const VIN_GROUP_COLORS = ["#2563eb", "#ea580c", "#db2777", "#0891b2", "#16a34a", "#ca8a04"];
const VIN_LANE_WIDTH = 12;

// Para cada registro de VIN repetido: { key, ordinal, total, color }, indexado
// pelo timestamp. O mais antigo do VIN e o primeiro lancamento.
function vinRepeatInfo(history) {
  const groups = new Map();
  for (const entry of history) {
    const key = vinCompareKey(entry.vin);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(entry);
  }

  const repeated = [...groups.entries()]
    .filter(([, list]) => list.length > 1)
    .sort((a, b) => Math.min(...a[1].map((e) => e.timestamp)) - Math.min(...b[1].map((e) => e.timestamp)));

  const info = new Map();
  repeated.forEach(([key, list], index) => {
    const color = VIN_GROUP_COLORS[index % VIN_GROUP_COLORS.length];
    [...list]
      .sort((a, b) => a.timestamp - b.timestamp)
      .forEach((entry, i) => info.set(entry.timestamp, { key, ordinal: i + 1, total: list.length, color }));
  });
  return info;
}

function vinBuildLaunchTag(ordinal) {
  const tag = document.createElement("span");
  // Primeiro lancamento: preto; todos os seguintes seguem o padrao do segundo (roxo).
  tag.className = `launch-tag launch-${Math.min(ordinal, 2)}`;
  tag.textContent = `${VIN_ORDINALS[ordinal - 1] || `${ordinal}º`} lançamento`;
  return tag;
}

// Marca o <li> do registro para a linha lateral (chamar vinDecorateRepeats
// no container depois de montar a lista).
function vinMarkRepeat(li, info) {
  if (info) {
    li.dataset.repeatKey = info.key;
    li.dataset.repeatColor = info.color;
  }
}

// Desenha, na margem esquerda do container, uma linha por VIN repetido
// ligando seus lancamentos, com um ponto em cada um. Grupos que nao se
// sobrepoem dividem a mesma faixa.
function vinDecorateRepeats(container) {
  container.querySelectorAll(".repeat-line, .repeat-dot").forEach((el) => el.remove());

  const items = [...container.querySelectorAll("[data-repeat-key]")];
  const groups = new Map();
  items.forEach((li, index) => {
    const key = li.dataset.repeatKey;
    if (!groups.has(key)) {
      groups.set(key, { color: li.dataset.repeatColor, items: [], first: index, last: index });
    }
    const group = groups.get(key);
    group.items.push(li);
    group.last = index;
  });

  const linked = [...groups.values()].filter((group) => group.items.length > 1);
  linked.sort((a, b) => a.first - b.first);

  // Faixas: o primeiro grupo livre (que ja terminou) reaproveita a faixa.
  const laneEnds = [];
  for (const group of linked) {
    let lane = laneEnds.findIndex((end) => end < group.first);
    if (lane === -1) {
      lane = laneEnds.length;
    }
    laneEnds[lane] = group.last;
    group.lane = lane;
  }

  container.style.position = "relative";
  container.style.paddingLeft = linked.length > 0 ? `${laneEnds.length * VIN_LANE_WIDTH + 6}px` : "";

  const base = container.getBoundingClientRect();
  const center = (li) => {
    const rect = li.getBoundingClientRect();
    return rect.top - base.top + rect.height / 2;
  };

  for (const group of linked) {
    const x = 3 + group.lane * VIN_LANE_WIDTH;
    const centers = group.items.map(center);

    const line = document.createElement("div");
    line.className = "repeat-line";
    line.style.cssText =
      `position:absolute;width:1px;left:${x + 2}px;top:${Math.min(...centers)}px;` +
      `height:${Math.max(...centers) - Math.min(...centers)}px;background:${group.color};`;
    container.appendChild(line);

    for (const y of centers) {
      const dot = document.createElement("div");
      dot.className = "repeat-dot";
      dot.style.cssText =
        `position:absolute;width:5px;height:5px;border-radius:50%;left:${x}px;top:${y - 2.5}px;` +
        `background:${group.color};box-sizing:content-box;`;
      container.appendChild(dot);
    }
  }
}

// ---------------------------------------------------------------------------
// Copiar VINs e botoes de acao de cada registro
// ---------------------------------------------------------------------------

function vinFormatDateTime(timestamp) {
  return new Date(timestamp).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// Etiqueta compacta de data/hora do VIN: "21/10" + hora em destaque.
function vinBuildTimeBadge(timestamp, tag = "span") {
  const date = new Date(timestamp);
  const badge = document.createElement(tag);
  badge.className = "time";
  badge.title = vinFormatDateTime(timestamp);

  const dia = document.createElement("span");
  dia.className = "time-date";
  dia.textContent = date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

  const hora = document.createElement("span");
  hora.className = "time-hour";
  hora.textContent = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  badge.append(dia, hora);
  return badge;
}

// Texto copiado de um VIN: data/hora, modelo/cor, reparo e/ou cripple.
function vinCopyText(entry) {
  const parts = Array.isArray(entry.parts) ? entry.parts : [];
  const repair = (entry.repair || "").trim();
  const tipo =
    repair && parts.length > 0 ? "Reparo + Cripple" : repair ? "Reparo" : parts.length > 0 ? "Cripple" : "";

  const lines = [`VIN: ${entry.vin}`, `Registro: ${vinFormatDateTime(entry.timestamp)}`];
  const modeloCor = [entry.model && `Modelo: ${entry.model}`, entry.color && `Cor: ${entry.color}`].filter(Boolean);
  if (modeloCor.length > 0) lines.push(modeloCor.join(" | "));
  if (tipo) lines.push(`Tipo: ${tipo}`);
  if (entry.level) lines.push(`Criticidade: N${entry.level}`);
  if (repair) lines.push(`Reparo: ${repair}`);
  if (parts.length > 0) lines.push(`Cripple: ${parts.join(", ")}`);
  return lines.join("\n");
}

// Varios VINs (do mais antigo ao mais recente), com um titulo.
function vinCopyTextList(entries, title) {
  const sorted = [...entries].sort((a, b) => a.timestamp - b.timestamp);
  return [`${title} (${sorted.length} VIN${sorted.length === 1 ? "" : "s"})`, ...sorted.map(vinCopyText)].join("\n\n");
}

// Copia e mostra a confirmacao no proprio botao.
async function vinCopyToClipboard(text, button) {
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copiado!";
  } catch (error) {
    button.textContent = "Erro ao copiar";
  }
  setTimeout(() => {
    button.textContent = original;
  }, 1500);
}

// Botao retangular "Copiar" (amarelo) ou "Apagar" (vermelho) de um VIN.
function vinBuildEntryButton(kind, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `entry-btn entry-btn-${kind}`;
  button.textContent = kind === "copy" ? "Copiar" : "Apagar";
  button.title = kind === "copy" ? "Copiar dados do VIN" : "Apagar este VIN";
  button.addEventListener("click", () => onClick(button));
  return button;
}

// ---------------------------------------------------------------------------
// Prefixos de VIN por modelo
// ---------------------------------------------------------------------------

async function vinGetPrefixes() {
  const { [VIN_PREFIX_KEY]: list } = await chrome.storage.local.get(VIN_PREFIX_KEY);
  return Array.isArray(list) ? list : VIN_DEFAULT_PREFIXES;
}

async function vinSetPrefixes(list) {
  const clean = list
    .map((item) => ({ model: (item.model || "").trim(), prefix: vinNormalize(item.prefix).replace(/\s+/g, "") }))
    .filter((item) => item.model || item.prefix);
  await chrome.storage.local.set({ [VIN_PREFIX_KEY]: clean });
  return clean;
}

// ---------------------------------------------------------------------------
// Visao do VIN para a lista: reparos (inclusive "reparo - ..." escrito em
// "Outra" do cripple) e a criticidade (N1-N4) do banco de reparos.
// ---------------------------------------------------------------------------

const VIN_REPAIR_DB_KEY = "repairDb";
const VIN_PART_AS_REPAIR_REGEX = /^\s*(?:outr[ao]s?\s*:\s*)?reparo\s*-+>?\s*(.*)$/i;

function vinRepairKey(text) {
  return (text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function vinGetRepairDb() {
  const { [VIN_REPAIR_DB_KEY]: db = [] } = await chrome.storage.local.get(VIN_REPAIR_DB_KEY);
  return Array.isArray(db) ? db : [];
}

// Maior criticidade (1-4) entre os reparos do banco presentes no texto, ou 0.
function vinRepairLevel(repairText, repairDb) {
  const texto = ` ${vinRepairKey(repairText)} `;
  if (texto.trim() === "") return 0;
  let level = 0;
  for (const item of repairDb || []) {
    if (item.level > level && item.key && texto.includes(` ${item.key} `)) {
      level = item.level;
    }
  }
  return level;
}

// Copia do registro com: cripples sem os "reparo - ...", esses textos somados
// ao reparo, `rawLevel` (maior criticidade, 0 = nenhuma) e `level` (a que
// aparece, conforme as configuracoes).
function vinEntryView(entry, repairDb, settings = VIN_DEFAULT_SETTINGS) {
  const repairs = [];
  if ((entry.repair || "").trim()) repairs.push(entry.repair.trim());
  let parts = entry.parts;
  if (Array.isArray(entry.parts)) {
    parts = [];
    for (const part of entry.parts) {
      const match = VIN_PART_AS_REPAIR_REGEX.exec(part || "");
      if (match) {
        if (match[1].trim()) repairs.push(match[1].trim());
      } else {
        parts.push(part);
      }
    }
  }
  const repair = repairs.join(", ");
  const rawLevel = vinRepairLevel(repair, repairDb);
  // `level` e o que aparece (etiqueta e copiar); `rawLevel` serve ao filtro.
  const mostra = settings.levelBadgesEnabled !== false && rawLevel >= (settings.levelMinShown || 1);
  return { ...entry, repair, parts, rawLevel, level: mostra ? rawLevel : 0 };
}

// Etiqueta "N1".."N4" (null sem criticidade).
function vinBuildLevelBadge(level) {
  if (!level) return null;
  const badge = document.createElement("span");
  badge.className = `level-badge level-${level}`;
  badge.textContent = `N${level}`;
  return badge;
}
