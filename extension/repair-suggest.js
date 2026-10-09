// Campo "PRINCIPAL REPARO": aprende o que e digitado e mostra, num balao
// abaixo do campo, reparos parecidos ja registrados.

const REPAIR_LABEL_REGEX = /\bPRINCIPAL\s+REPAROS?\b/i;

let repairDb = [];
let repairInput = null;
let repairLearned = "";
let repairItems = [];
let repairActive = -1;
let repairBox = null;

repairGetAll().then((db) => {
  repairDb = db;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[REPAIR_STORAGE_KEY]) {
    repairDb = changes[REPAIR_STORAGE_KEY].newValue || [];
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
    if (REPAIR_LABEL_REGEX.test(getFieldLabelText(candidate, REPAIR_LABEL_REGEX))) {
      return candidate;
    }
  }
  return findRepairInputByQuestionText();
}

function setRepairValue(input, text) {
  if (input.tagName === "INPUT" || input.tagName === "TEXTAREA") {
    // O setter nativo faz o React/Forms perceber a mudanca.
    const proto = input.tagName === "INPUT" ? HTMLInputElement : HTMLTextAreaElement;
    Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(input, text);
  } else {
    input.textContent = text;
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
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
  [...repairBox.children].forEach((child, i) => {
    child.style.background = i === index ? "#e0f2f1" : "transparent";
  });
}

function pickRepair(index) {
  const item = repairItems[index];
  if (!item || !repairInput) {
    return;
  }
  setRepairValue(repairInput, item.text);
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
  const query = getFieldValue(repairInput);
  repairItems = repairSuggest(repairDb, query);
  if (repairItems.length === 0) {
    // Com texto digitado, avisa que a extensao esta ativa mas nada combinou.
    if (repairNormalize(query).length >= 2) {
      renderRepairBox(`Nenhum reparo parecido (${repairDb.length} no banco)`);
    } else {
      hideRepairBox();
    }
    return;
  }
  renderRepairBox();
}

function learnRepair() {
  if (!repairInput) {
    return;
  }
  const text = getFieldValue(repairInput).replace(/\s+/g, " ").trim();
  if (!text) {
    repairLearned = "";
    return;
  }
  // Clicar e sair sem alterar nao conta como um reparo novo.
  if (text === repairLearned) {
    return;
  }
  repairLearned = text;
  repairLearn(text);
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
  if (repairInput && repairInput.isConnected) {
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
