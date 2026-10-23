// Campo "PRINCIPAL REPARO": aprende o que e digitado e mostra, num balao
// abaixo do campo, reparos parecidos ja registrados.

const REPAIR_LABEL_REGEX = /\bPRINCIPAL\s+REPAROS?\b/i;

let repairDb = [];
let repairInput = null;
let repairLearned = "";
// Reparos ja contados no VIN atual: "ts|CHAVE".
const repairLearnedParts = new Set();
let repairItems = [];
let repairActive = -1;
let repairBox = null;
let repairMinChars = 2;

repairGetAll().then((db) => {
  repairDb = db;
});
vinGetSettings().then((settings) => {
  repairMinChars = settings.repairMinChars || 2;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[REPAIR_STORAGE_KEY]) {
    repairDb = changes[REPAIR_STORAGE_KEY].newValue || [];
  }
  if (changes[VIN_SETTINGS_KEY]) {
    repairMinChars = (changes[VIN_SETTINGS_KEY].newValue || {}).repairMinChars || 2;
  }
});

function isVisibleField(el) {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

// Plano B, independente da estrutura do HTML: acha o texto da pergunta e
// devolve o primeiro campo de texto que vem depois dele na pagina.
function findRepairInputByQuestionText() {
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  const fields = [...document.querySelectorAll('input, textarea, [contenteditable="true"]')].filter(
    (el) => (el.tagName !== "INPUT" || isVinCandidateInput(el)) && isVisibleField(el)
  );

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!/REPARO|PRINCIPAL/i.test(node.nodeValue || "")) {
      continue;
    }

    // O titulo pode estar quebrado em varios elementos: sobe ate achar um
    // ancestral curto cujo texto completo case com o rotulo.
    let anchor = node.parentElement;
    for (let i = 0; i < 4 && anchor; i += 1) {
      const text = anchor.textContent || "";
      if (text.length <= 200 && REPAIR_LABEL_REGEX.test(text)) {
        break;
      }
      anchor = anchor.parentElement;
    }
    if (!anchor || anchor.closest("#vin-monitor-repair-box, script, style")) {
      continue;
    }
    if (!REPAIR_LABEL_REGEX.test(anchor.textContent || "") || (anchor.textContent || "").length > 200) {
      continue;
    }

    const field = fields.find(
      (el) => anchor.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING && !anchor.contains(el)
    );
    if (field) {
      return field;
    }
  }
  return null;
}

function findRepairInput() {
  const candidates = document.querySelectorAll('input, textarea, [contenteditable="true"]');
  for (const candidate of candidates) {
    if (candidate.tagName === "INPUT" && !isVinCandidateInput(candidate)) {
      continue;
    }
    if (REPAIR_LABEL_REGEX.test(getFieldLabelText(candidate, REPAIR_LABEL_REGEX)) && isRendered(candidate)) {
      return candidate;
    }
  }
  return findRepairInputByQuestionText();
}

function setRepairValue(input, text) {
  if (input.tagName === "INPUT" || input.tagName === "TEXTAREA") {
    // Primeiro como se fosse digitado (selecionar tudo + inserir): o Forms
    // atualiza o proprio estado sem misturar com o texto antigo. Se o
    // navegador nao aceitar, usa o setter nativo.
    input.focus();
    input.select();
    let ok = false;
    try {
      ok = document.execCommand("insertText", false, text);
    } catch (error) {
      ok = false;
    }
    if (!ok || input.value !== text) {
      const proto = input.tagName === "INPUT" ? HTMLInputElement : HTMLTextAreaElement;
      Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    input.setSelectionRange(text.length, text.length);
  } else {
    input.textContent = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function ensureRepairBox() {
  if (repairBox) {
    return repairBox;
  }
  repairBox = document.createElement("div");
  repairBox.id = "vin-monitor-repair-box";
  repairBox.style.cssText =
    "position:fixed;z-index:2147483647;display:none;box-sizing:border-box;" +
    "background:#fff;color:#1f2937;border:1px solid #cbd5e1;border-radius:8px;" +
    "box-shadow:0 6px 20px rgba(0,0,0,.18);font:14px/1.35 system-ui,sans-serif;" +
    "max-height:260px;overflow:auto;padding:4px 0;";
  // mousedown + preventDefault evita que o campo perca o foco ao clicar.
  repairBox.addEventListener("mousedown", (event) => event.preventDefault());
  document.documentElement.appendChild(repairBox);
  return repairBox;
}

function showRepairToast(message) {
  const toast = document.createElement("div");
  toast.textContent = message;
  toast.style.cssText =
    "position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#0f766e;color:#fff;" +
    "padding:8px 12px;border-radius:8px;font:13px system-ui,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.25);";
  document.documentElement.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function hideRepairBox() {
  repairItems = [];
  repairActive = -1;
  if (repairBox) {
    repairBox.style.display = "none";
  }
}

function positionRepairBox() {
  if (!repairBox || repairBox.style.display === "none" || !repairInput) {
    return;
  }
  if (!repairInput.isConnected) {
    hideRepairBox();
    return;
  }
  const rect = repairInput.getBoundingClientRect();
  repairBox.style.left = `${Math.max(rect.left, 0)}px`;
  repairBox.style.top = `${rect.bottom + 4}px`;
  repairBox.style.width = `${Math.max(rect.width, 240)}px`;
}

function highlightRepair(index) {
  repairActive = index;
  // O primeiro filho e o titulo: os itens comecam no segundo.
  [...repairBox.children].slice(1).forEach((child, i) => {
    child.style.background = i === index ? "#e0f2f1" : "transparent";
  });
}

// A sugestao escolhida sempre soma ao que ja esta na caixa: completa o que
// estava sendo digitado depois da ultima escolha, sem separador.
let repairPickedValue = "";
let repairPickedTexts = [];

// Separadores entre reparos digitados a mao: "falha no ABS, fluido de freio".
const REPAIR_SEPARATOR_REGEX = /[,;\n]/g;
// Cada reparo novo e buscado pelas suas duas primeiras palavras: depois da
// segunda palavra e de um espaco, a proxima letra ja comeca outro reparo.
const REPAIR_GROUP_WORDS = 2;

// { before, current }: `current` e o trecho do reparo que esta sendo digitado
// (o que busca as sugestoes e e trocado ao escolher); `before` e o resto.
function splitRepairText(text) {
  let before = "";
  let current = text;
  if (repairPickedValue && text.startsWith(repairPickedValue)) {
    before = repairPickedValue;
    current = text.slice(repairPickedValue.length);
  } else {
    repairPickedValue = "";
    repairPickedTexts = [];
  }
  let cut = -1;
  for (const match of current.matchAll(REPAIR_SEPARATOR_REGEX)) cut = match.index;
  if (cut !== -1) {
    before += current.slice(0, cut + 1);
    current = current.slice(cut + 1);
  }

  const words = [...current.matchAll(/\S+/g)];
  if (words.length === 0) {
    return { before: before + current, current: "" };
  }
  const endsWithSpace = /\s$/.test(current);
  if (endsWithSpace && words.length % REPAIR_GROUP_WORDS === 0) {
    // Duas palavras e um espaco: o proximo reparo ainda nao comecou.
    return { before: before + current, current: "" };
  }
  const start = Math.floor((words.length - 1) / REPAIR_GROUP_WORDS) * REPAIR_GROUP_WORDS;
  const index = words[start].index;
  return { before: before + current.slice(0, index), current: current.slice(index) };
}

function pickRepair(index) {
  const item = repairItems[index];
  if (!item || !repairInput) {
    return;
  }
  const text = getFieldValue(repairInput);
  const { before, current } = splitRepairText(text);
  const typed = current.trim();
  // O trecho em digitacao e a busca que gerou a sugestao quando cada palavra
  // dele e o comeco de alguma palavra da sugestao (ex.: "Ma" -> "marca de
  // ferramenta"): ele e trocado pela sugestao, nunca repetido.
  const itemTokens = repairTokens(item.text);
  const tokens = repairTokens(typed);
  const isSearch =
    tokens.length > 0 &&
    (repairNormalize(item.text).startsWith(repairNormalize(typed)) ||
      tokens.every((token) => itemTokens.some((cand) => cand.startsWith(token))));
  let value;
  if (!typed || isSearch) {
    value = before + item.text;
  } else {
    // Busca pela ultima palavra (ex.: "solto luz" -> "Luz de cortesia").
    const last = typed.split(/\s+/).pop();
    const lastIsSearch = itemTokens.some((cand) => cand.startsWith(repairNormalize(last)));
    value = lastIsSearch
      ? before + current.slice(0, current.lastIndexOf(last)) + item.text
      : text + (/\s$/.test(text) ? "" : " ") + item.text;
  }
  // Antes de gravar: o "change" disparado ja aprende com a escolha.
  repairPickedValue = value;
  repairPickedTexts.push(item.text);
  setRepairValue(repairInput, value);
  hideRepairBox();
  repairInput.focus();
}

function renderRepairBox(emptyMessage) {
  const box = ensureRepairBox();
  box.textContent = "";

  const title = document.createElement("div");
  title.textContent = emptyMessage || "Reparos similares";
  title.style.cssText = "padding:2px 12px 4px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.04em;";
  box.appendChild(title);

  repairItems.forEach((item, index) => {
    const row = document.createElement("div");
    row.textContent = item.text;
    row.title = `Usado ${item.count}x`;
    row.style.cssText = "padding:6px 12px;cursor:pointer;white-space:normal;word-break:break-word;";
    row.addEventListener("mouseenter", () => highlightRepair(index));
    row.addEventListener("click", () => pickRepair(index));
    box.appendChild(row);
  });

  // O titulo ocupa o primeiro filho; os itens vem depois.
  highlightRepair(-1);
  box.style.display = "block";
  positionRepairBox();
}

function updateRepairSuggestions() {
  if (!repairInput || !repairInput.isConnected || document.activeElement !== repairInput) {
    hideRepairBox();
    return;
  }
  const { before, current } = splitRepairText(getFieldValue(repairInput));
  const query = current.trim();
  // Reparos que ja estao na caixa (escolhidos ou digitados) nao aparecem de novo.
  const used = new Set(repairPickedTexts.map(repairNormalize));
  const beforeNorm = ` ${repairNormalize(before)} `;
  const isUsed = (item) => used.has(item.key) || beforeNorm.includes(` ${item.key} `);

  if (repairNormalize(query).replace(/ /g, "").length < repairMinChars) {
    hideRepairBox();
    return;
  }
  // Todas as sugestoes que combinam; sem nenhuma, tenta so a ultima palavra.
  repairItems = repairSuggest(repairDb, query, Infinity, repairMinChars).filter((item) => !isUsed(item));
  const last = query.split(/\s+/).pop();
  if (repairItems.length === 0 && last !== query && repairNormalize(last).length >= repairMinChars) {
    repairItems = repairSuggest(repairDb, last, Infinity, repairMinChars).filter((item) => !isUsed(item));
  }
  if (repairItems.length === 0) {
    renderRepairBox(`Nenhum reparo parecido (${repairDb.length} no banco)`);
    return;
  }
  renderRepairBox();
}

// true/false: o campo PRINCIPAL REPARO esta (ou nao) na tela agora.
function isRepairFieldPresent() {
  if (repairInput && isRendered(repairInput)) {
    return true;
  }
  return findRepairInput() !== null;
}

// Texto atual do campo de reparo ("" se nao ha campo ou esta vazio).
function getCurrentRepairText() {
  if (!repairInput || !isRendered(repairInput)) {
    return "";
  }
  return getFieldValue(repairInput).replace(/\s+/g, " ").trim();
}

function learnRepair() {
  // Campo escondido pelo formulario: o texto que ficou la nao vale.
  if (!repairInput || !isRendered(repairInput)) {
    return;
  }
  const text = getFieldValue(repairInput).replace(/\s+/g, " ").trim();
  if (!text) {
    // Reparo apagado da caixa: tira tambem do VIN atual (lista e indicadores),
    // desde que o campo VIN ainda mostre esse mesmo VIN.
    const vinAtual =
      currentVinInput && currentVinInput.isConnected && vinNormalize(getFieldValue(currentVinInput)) === recordedValue;
    if (currentEntryTimestamp !== null && vinAtual) {
      vinSetEntryDetails(currentEntryTimestamp, { repair: "" });
      vinStatsUpsert(currentEntryTimestamp, { repair: "" });
    }
    repairLearned = "";
    return;
  }
  // Clicar e sair sem alterar nao conta como um reparo novo. O mesmo texto
  // num VIN diferente conta (o formulario reinicia a cada envio).
  const learnedKey = `${currentEntryTimestamp}|${text}`;
  if (learnedKey === repairLearned) {
    return;
  }
  repairLearned = learnedKey;
  // Com sugestoes escolhidas, cada uma conta sozinha no banco; sem nenhuma,
  // o texto inteiro e aprendido. Cada reparo conta uma vez por VIN.
  splitRepairText(getFieldValue(repairInput));
  const learned = repairPickedTexts.length > 0 ? repairPickedTexts : [text];
  for (const part of learned) {
    const partKey = `${currentEntryTimestamp}|${repairNormalize(part)}`;
    if (!repairLearnedParts.has(partKey)) {
      repairLearnedParts.add(partKey);
      repairLearn(part);
    }
  }

  // O reparo fica junto do VIN (lista) e tambem entra nos indicadores.
  if (currentEntryTimestamp !== null) {
    vinSetEntryDetails(currentEntryTimestamp, { repair: text });
    vinStatsUpsert(currentEntryTimestamp, { repair: text });
  }
}

function attachRepairInput(input) {
  repairInput = input;
  console.log("[VIN Monitor] campo PRINCIPAL REPARO encontrado; sugestoes ativas.");
  showRepairToast(`Sugestoes de reparo ativas (${repairDb.length} no banco)`);
  if (input.dataset.vinMonitorRepair === "true") {
    return;
  }
  input.dataset.vinMonitorRepair = "true";

  input.addEventListener("input", () => {
    if (!getFieldValue(input).trim()) {
      repairLearned = "";
      repairPickedValue = "";
      repairPickedTexts = [];
    }
    updateRepairSuggestions();
  });
  input.addEventListener("focus", updateRepairSuggestions);
  input.addEventListener("blur", () => {
    learnRepair();
    hideRepairBox();
  });
  input.addEventListener("change", learnRepair);

  input.addEventListener(
    "keydown",
    (event) => {
      const open = repairBox && repairBox.style.display !== "none" && repairItems.length > 0;
      if (open && event.key === "ArrowDown") {
        event.preventDefault();
        highlightRepair((repairActive + 1) % repairItems.length);
      } else if (open && event.key === "ArrowUp") {
        event.preventDefault();
        highlightRepair((repairActive - 1 + repairItems.length) % repairItems.length);
      } else if (open && event.key === "Enter" && repairActive >= 0) {
        event.preventDefault();
        event.stopPropagation();
        pickRepair(repairActive);
      } else if (open && event.key === "Escape") {
        hideRepairBox();
      }
    },
    true
  );
}

window.addEventListener("pagehide", learnRepair);
window.addEventListener("scroll", positionRepairBox, true);
window.addEventListener("resize", positionRepairBox);

let repairScanPending = false;
function scanRepair() {
  // Campo atual ainda na tela: nada a procurar.
  if (repairInput && isRendered(repairInput)) {
    return;
  }
  const input = findRepairInput();
  if (input) {
    attachRepairInput(input);
  }
}

new MutationObserver(() => {
  if (repairScanPending) {
    return;
  }
  repairScanPending = true;
  requestAnimationFrame(() => {
    repairScanPending = false;
    scanRepair();
  });
}).observe(document.documentElement, { childList: true, subtree: true });

scanRepair();
