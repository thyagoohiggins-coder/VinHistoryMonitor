// Monitora o campo "VIN" de um formulario (Google Forms, Microsoft Forms
// etc.) e grava um historico com timestamp. A remocao automatica de
// duplicatas e opcional (configuravel no popup da extensao, desativada por
// padrao).

const VIN_LABEL_REGEX = /\bVIN\b/i;
const LABEL_SEARCH_MAX_DEPTH = 10;
const LABEL_TEXT_MAX_LENGTH = 400;

// Conteudo do campo que ja foi registrado. Enquanto o campo continuar com
// esse mesmo valor, sair e voltar nele nao gera um novo registro - so clicar
// na caixa e clicar fora nao conta como um VIN novo.
let recordedValue = "";

// Registro (timestamp) do VIN atual, para anexar as pecas faltantes marcadas
// depois que o VIN ja foi gravado.
let currentEntryTimestamp = null;

// Quando o campo fica vazio (o formulario foi enviado e limpo, ou o usuario
// apagou o conteudo), o proximo preenchimento e um registro novo - mesmo que
// seja exatamente o mesmo VIN de antes.
function trackFieldCleared(rawValue) {
  if (!vinNormalize(rawValue)) {
    recordedValue = "";
    currentEntryTimestamp = null;
  }
}

// So grava quando o campo e "finalizado" (perde o foco, Enter, troca de
// aba, fechamento da pagina) - nunca enquanto o usuario ainda esta digitando.
async function saveVin(rawValue) {
  const vin = vinNormalize(rawValue);
  if (!vin) {
    return;
  }

  // Nada mudou desde o ultimo registro deste campo.
  if (vin === recordedValue) {
    return;
  }

  // So o prefixo sugerido (VIN ainda incompleto): nao grava.
  if (typeof prefixList !== "undefined" && prefixList.some((item) => vinCompareKey(item.prefix) === vinCompareKey(vin))) {
    return;
  }

  recordedValue = vin;

  const details = readFormDetails();
  // Reparo ja digitado antes do VIN ser registrado entra junto.
  const repair = typeof getCurrentRepairText === "function" ? getCurrentRepairText() : "";
  if (repair) {
    details.repair = repair;
  }
  const updated = await vinAddEntry(vin, details);
  // O registro novo e sempre o primeiro da lista.
  currentEntryTimestamp = updated[0]?.timestamp ?? null;
  lastAnnouncedParts = (details.parts || []).join("|");
  resetDetailTracking(details);

  if (currentEntryTimestamp !== null) {
    vinStatsUpsert(currentEntryTimestamp, {
      vin,
      model: details.model,
      color: details.color,
      repair: details.repair,
      parts: details.parts,
    });
  }
}

// VIN ja lancado antes (na lista ou nos indicadores, que guardam os dias
// anteriores): uma etiqueta pequena aparece na hora, dentro do campo VIN,
// enquanto se digita. Os lancamentos ficam em memoria para nao esperar o storage.
const knownVinLaunches = new Map();
let repeatNoticeEnabled = true;

function rebuildKnownVins(history, stats) {
  knownVinLaunches.clear();
  const add = (vin, ts) => {
    const key = vinCompareKey(vin);
    if (!key) return;
    if (!knownVinLaunches.has(key)) knownVinLaunches.set(key, new Set());
    knownVinLaunches.get(key).add(ts);
  };
  for (const entry of history) add(entry.vin, entry.timestamp);
  for (const record of stats) add(record.vin, record.ts);
}

let knownHistory = [];
let knownStats = [];
Promise.all([vinGetHistory(), vinStatsGetAll(), vinGetSettings()]).then(([history, stats, settings]) => {
  knownHistory = history;
  knownStats = stats;
  repeatNoticeEnabled = settings.repeatNoticeEnabled !== false;
  rebuildKnownVins(knownHistory, knownStats);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[VIN_STORAGE_KEY]) knownHistory = changes[VIN_STORAGE_KEY].newValue || [];
  if (changes[VIN_STATS_KEY]) knownStats = changes[VIN_STATS_KEY].newValue || [];
  if (changes[VIN_STORAGE_KEY] || changes[VIN_STATS_KEY]) rebuildKnownVins(knownHistory, knownStats);
  if (changes[VIN_SETTINGS_KEY]) {
    repeatNoticeEnabled = (changes[VIN_SETTINGS_KEY].newValue || {}).repeatNoticeEnabled !== false;
    if (!repeatNoticeEnabled) hideRepeatBadge();
  }
});

let repeatBadge = null;
let repeatBadgeTimer = null;

function hideRepeatBadge() {
  clearTimeout(repeatBadgeTimer);
  repeatBadge?.remove();
  repeatBadge = null;
}

// Etiqueta dentro do campo, no canto direito: "2º lançamento – veículo retornou...".
function showRepeatBadge(input, vezes) {
  hideRepeatBadge();
  const rect = input.getBoundingClientRect();
  if (rect.width === 0) return;

  repeatBadge = document.createElement("div");
  repeatBadge.id = "vin-monitor-repeat-notice";
  repeatBadge.textContent = `${vezes}º lançamento – veículo retornou ou o VIN foi repetido`;
  repeatBadge.style.cssText =
    "position:fixed;z-index:2147483647;pointer-events:none;box-sizing:border-box;" +
    "padding:2px 8px;border-radius:10px;background:#7c3aed;color:#fff;" +
    "font:700 11px/16px system-ui,sans-serif;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.2);";
  document.documentElement.appendChild(repeatBadge);
  // Campo estreito: a etiqueta nao passa da borda esquerda dele.
  repeatBadge.style.maxWidth = `${Math.max(rect.width - 16, 120)}px`;
  repeatBadge.style.overflow = "hidden";
  repeatBadge.style.textOverflow = "ellipsis";
  const largura = repeatBadge.offsetWidth;
  repeatBadge.style.left = `${Math.max(rect.right - largura - 8, rect.left + 8)}px`;
  repeatBadge.style.top = `${rect.top + (rect.height - 20) / 2}px`;
  repeatBadgeTimer = setTimeout(hideRepeatBadge, 3000);
}

function checkRepeatedVin(input) {
  if (!repeatNoticeEnabled) return;
  const key = vinCompareKey(getFieldValue(input));
  const launches = knownVinLaunches.get(key);
  // O registro deste proprio preenchimento (se ja gravado) nao conta duas vezes.
  const anteriores = launches ? [...launches].filter((ts) => ts !== currentEntryTimestamp).length : 0;
  if (anteriores === 0) {
    hideRepeatBadge();
    return;
  }
  showRepeatBadge(input, anteriores + 1);
}

document.addEventListener(
  "input",
  (event) => {
    if (currentVinInput && event.target === currentVinInput) checkRepeatedVin(currentVinInput);
  },
  true
);
// Rolar a pagina acompanha o campo (em vez de esconder a etiqueta antes da hora).
window.addEventListener(
  "scroll",
  () => {
    if (!repeatBadge || !currentVinInput?.isConnected) return;
    const rect = currentVinInput.getBoundingClientRect();
    const largura = repeatBadge.offsetWidth;
    repeatBadge.style.left = `${Math.max(rect.right - largura - 8, rect.left + 8)}px`;
    repeatBadge.style.top = `${rect.top + (rect.height - 20) / 2}px`;
  },
  true
);

// Modelo, cor e as opcoes de "PEÇAS FALTANTES" costumam ser marcadas depois do VIN: ao
// clicar numa caixa, atualiza o registro do VIN atual.
// Aviso rapido na tela quando as pecas faltantes mudam: confirma que a
// extensao viu a marcacao (ou a retirada) de uma opcao.
let lastAnnouncedParts = null;
function announceParts(parts) {
  if (!parts) {
    return;
  }
  const key = parts.join("|");
  if (lastAnnouncedParts !== null && key !== lastAnnouncedParts) {
    const toast = document.createElement("div");
    toast.textContent = parts.length === 0 ? "Cripple: nenhuma peça" : `Cripple atualizado (${parts.length})`;
    toast.style.cssText =
      "position:fixed;right:12px;bottom:12px;z-index:2147483647;background:#111;color:#fff;" +
      "padding:5px 10px;border-radius:6px;font:12px system-ui,sans-serif;opacity:.9;";
    document.documentElement.appendChild(toast);
    setTimeout(() => toast.remove(), 1800);
  }
  lastAnnouncedParts = key;
}

// Perguntas lidas deste VIN e quantas leituras seguidas vieram sem elas. Quando
// uma resposta do formulario esconde a pergunta (ex.: PEÇAS FALTANTES some),
// o que foi marcado antes deixa de valer e e limpo.
const DETAIL_KEYS = ["parts", "model", "color"];
let detailsSeen = {};
let detailsAbsent = {};
let repairSeen = false;
let repairAbsent = 0;

// O campo "PRINCIPAL REPARO" tambem pode ser escondido por uma resposta.
function repairFieldPresent() {
  return typeof isRepairFieldPresent === "function" ? isRepairFieldPresent() : null;
}

function resetDetailTracking(details) {
  detailsSeen = {};
  detailsAbsent = {};
  for (const key of DETAIL_KEYS) {
    detailsSeen[key] = key in details;
    detailsAbsent[key] = 0;
  }
  repairSeen = repairFieldPresent() === true;
  repairAbsent = 0;
}

// Completa `details` com valores vazios para perguntas que sumiram da tela
// (confirmado em duas leituras, para ignorar redesenhos momentaneos).
// Retorna true se ainda e preciso reconferir em instantes.
function applyHiddenQuestions(details) {
  let recheck = false;
  for (const key of DETAIL_KEYS) {
    if (key in details) {
      detailsSeen[key] = true;
      detailsAbsent[key] = 0;
    } else if (detailsSeen[key]) {
      detailsAbsent[key] += 1;
      if (detailsAbsent[key] >= 2) {
        details[key] = key === "parts" ? [] : "";
      } else {
        recheck = true;
      }
    }
  }

  const repairPresent = repairFieldPresent();
  if (repairPresent === true) {
    repairSeen = true;
    repairAbsent = 0;
  } else if (repairPresent === false && repairSeen) {
    repairAbsent += 1;
    if (repairAbsent >= 2) {
      // Campo escondido: o texto digitado antes deixa de valer para este VIN.
      details.repair = "";
      repairSeen = false;
      if (typeof repairLearned !== "undefined") {
        repairLearned = "";
      }
    } else {
      recheck = true;
    }
  }
  return recheck;
}

let partsRefreshTimer = null;
function refreshPartsSoon() {
  clearTimeout(partsRefreshTimer);
  partsRefreshTimer = setTimeout(() => {
    // So atualiza enquanto existe um VIN preenchido na tela: depois do envio o
    // formulario volta vazio (o registro atual e liberado) e nao pode apagar
    // as pecas ja registradas.
    if (
      currentEntryTimestamp === null ||
      !currentVinInput ||
      !currentVinInput.isConnected ||
      !vinNormalize(getFieldValue(currentVinInput))
    ) {
      return;
    }
    const details = readFormDetails();
    const recheck = applyHiddenQuestions(details);
    if (recheck) {
      setTimeout(refreshPartsSoon, 300);
    }
    if (Object.keys(details).length > 0) {
      announceParts(details.parts);
      vinSetEntryDetails(currentEntryTimestamp, details);
      vinStatsUpsert(currentEntryTimestamp, {
        model: details.model,
        color: details.color,
        repair: details.repair,
        parts: details.parts,
      });
    }
  }, 150);
}

for (const type of ["click", "change", "input", "keyup", "mouseup"]) {
  document.addEventListener(type, refreshPartsSoon, true);
}

// Rede de seguranca: o Forms as vezes muda a caixa (marcar/desmarcar) sem um
// evento que chegue ate aqui. Enquanto ha um VIN atual, confere a cada 0,8s;
// so grava se algo mudou.
setInterval(() => {
  if (currentEntryTimestamp !== null && document.visibilityState === "visible") {
    refreshPartsSoon();
  }
}, 800);

// Retorna o texto do rotulo associado a um campo, tentando aria-labelledby,
// aria-label e, por fim, subindo pelos ancestrais ate achar um texto curto
// que contenha "VIN" (a pergunta do formulario).
function getFieldLabelText(input, labelRegex = VIN_LABEL_REGEX) {
  // Junta TODAS as fontes de rotulo (e nao so a primeira que existir): um
  // aria-labelledby que aponta so para uma descricao nao pode esconder o
  // titulo da pergunta.
  const sources = [];

  const labelledBy = input.getAttribute("aria-labelledby");
  if (labelledBy) {
    sources.push(
      labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || "")
        .join(" ")
    );
  }

  sources.push(input.getAttribute("aria-label") || "");

  if (input.id) {
    sources.push(document.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent || "");
  }

  const direct = sources.find((text) => text.trim() && labelRegex.test(text));
  if (direct) {
    return direct;
  }

  let node = input.parentElement;
  let depth = 0;

  while (node && depth < LABEL_SEARCH_MAX_DEPTH) {
    // Se o ancestral ja contem outros campos de texto, o texto dele mistura
    // varias perguntas: o rotulo de OUTRO campo faria este parecer o certo.
    if (countTextFields(node) > 1) {
      break;
    }

    const text = (node.textContent || "").trim();

    if (text && text.length <= LABEL_TEXT_MAX_LENGTH && labelRegex.test(text)) {
      return text;
    }

    node = node.parentElement;
    depth += 1;
  }

  return sources.find((text) => text.trim()) || "";
}

function countTextFields(node) {
  let count = 0;
  for (const el of node.querySelectorAll('input, textarea, [contenteditable="true"]')) {
    if (el.tagName !== "INPUT" || isVinCandidateInput(el)) {
      count += 1;
    }
  }
  return count;
}

function isVinCandidateInput(input) {
  if (input.type && !["text", "search", "tel", "url"].includes(input.type)) {
    return false;
  }
  return true;
}

function findVinInput() {
  const candidates = document.querySelectorAll('input, textarea, [contenteditable="true"]');

  for (const candidate of candidates) {
    if (candidate.tagName === "INPUT" && !isVinCandidateInput(candidate)) {
      continue;
    }

    if (VIN_LABEL_REGEX.test(getFieldLabelText(candidate))) {
      return candidate;
    }
  }

  return null;
}

function getFieldValue(input) {
  if (input.tagName === "INPUT" || input.tagName === "TEXTAREA") {
    return input.value;
  }
  return input.textContent || "";
}

// Campo VIN atualmente na tela. O formulario se redesenha a cada envio, entao
// esse ponteiro e atualizado, e nao acumulado - do contrario cada novo campo
// somaria mais um listener global gravando valores antigos.
let currentVinInput = null;

function commitCurrentInput() {
  if (currentVinInput && currentVinInput.isConnected) {
    saveVin(getFieldValue(currentVinInput));
  }
}

function attachListener(input) {
  currentVinInput = input;

  // O formulario recria o campo vazio depois de cada envio; isso libera o
  // proximo registro mesmo que o VIN seja igual ao anterior.
  trackFieldCleared(getFieldValue(input));

  if (input.dataset.vinMonitorAttached === "true") {
    return;
  }

  input.dataset.vinMonitorAttached = "true";

  const handleCommit = () => saveVin(getFieldValue(input));

  // Este listener nunca grava nada: serve so para perceber que o campo foi
  // esvaziado durante a digitacao.
  input.addEventListener("input", () => trackFieldCleared(getFieldValue(input)));

  input.addEventListener("blur", handleCommit);
  input.addEventListener("change", handleCommit);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      handleCommit();
    }
  });
}

// Registrados uma unica vez, sempre atuando sobre o campo atual, para
// garantir que o valor seja salvo antes da pagina ser fechada/navegada.
window.addEventListener("pagehide", commitCurrentInput);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    commitCurrentInput();
  }
});

function scan() {
  const input = findVinInput();
  if (input) {
    attachListener(input);
  }
}

scan();

const observer = new MutationObserver(() => scan());
observer.observe(document.documentElement, { childList: true, subtree: true });
