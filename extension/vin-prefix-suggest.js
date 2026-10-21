// Campo VIN: ao clicar, mostra os modelos e prefixos cadastrados (nas
// configuracoes). Escolher um preenche o prefixo, marca o modelo no
// formulario quando ele existe, e a pessoa completa o restante do VIN.

let prefixList = [];
let prefixItems = [];
let prefixActive = -1;
let prefixBox = null;
let prefixInput = null;

vinGetPrefixes().then((list) => {
  prefixList = list;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[VIN_PREFIX_KEY]) {
    prefixList = changes[VIN_PREFIX_KEY].newValue || [];
  }
});

function ensurePrefixBox() {
  if (prefixBox) {
    return prefixBox;
  }
  prefixBox = document.createElement("div");
  prefixBox.id = "vin-monitor-prefix-box";
  prefixBox.style.cssText =
    "position:fixed;z-index:2147483647;display:none;box-sizing:border-box;" +
    "background:#fff;color:#1f2937;border:1px solid #cbd5e1;border-radius:8px;" +
    "box-shadow:0 6px 20px rgba(0,0,0,.18);font:14px/1.35 system-ui,sans-serif;" +
    "max-height:280px;overflow:auto;padding:4px 0;";
  // mousedown + preventDefault: o campo VIN nao perde o foco (e nao grava
  // um VIN incompleto) ao clicar numa sugestao.
  prefixBox.addEventListener("mousedown", (event) => event.preventDefault());
  document.documentElement.appendChild(prefixBox);
  return prefixBox;
}

function hidePrefixBox() {
  prefixItems = [];
  prefixActive = -1;
  if (prefixBox) {
    prefixBox.style.display = "none";
  }
}

function positionPrefixBox() {
  if (!prefixBox || prefixBox.style.display === "none" || !prefixInput) {
    return;
  }
  if (!prefixInput.isConnected) {
    hidePrefixBox();
    return;
  }
  const rect = prefixInput.getBoundingClientRect();
  prefixBox.style.left = `${Math.max(rect.left, 0)}px`;
  prefixBox.style.top = `${rect.bottom + 4}px`;
  prefixBox.style.width = `${Math.max(Math.min(rect.width, 420), 260)}px`;
}

function highlightPrefix(index) {
  prefixActive = index;
  // O primeiro filho e o titulo.
  [...prefixBox.children].slice(1).forEach((child, i) => {
    child.style.background = i === index ? "#eef2ff" : "transparent";
  });
}

function prefixKey(text) {
  return (text || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function modelKey(text) {
  return (text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Marca no formulario a opcao de MODELO que corresponde ao nome cadastrado
// (igual, ou o nome cadastrado comeca com ela: "T1E ADAS (Tiggo 7)" -> "T1E ADAS").
function selectFormModel(modelName) {
  const container = findQuestionContainer(MODEL_TITLE_REGEX, PARTS_RADIO_SELECTOR, /MODELO/i, 60);
  if (!container) {
    return;
  }
  const alvo = modelKey(modelName);
  let melhor = null;
  let melhorTamanho = 0;
  for (const radio of container.querySelectorAll(PARTS_RADIO_SELECTOR)) {
    const opcao = modelKey(getCheckboxOptionText(radio, PARTS_RADIO_SELECTOR));
    if (!opcao) continue;
    const casa = alvo === opcao || alvo.startsWith(`${opcao} `) || alvo.startsWith(`${opcao}(`);
    if (casa && opcao.length > melhorTamanho) {
      melhor = radio;
      melhorTamanho = opcao.length;
    }
  }
  if (melhor && !isCheckboxChecked(melhor)) {
    // click() nao move o foco: o campo VIN continua ativo.
    melhor.click();
  }
}

function setVinFieldValue(input, text) {
  if (input.tagName === "INPUT" || input.tagName === "TEXTAREA") {
    const proto = input.tagName === "INPUT" ? HTMLInputElement : HTMLTextAreaElement;
    Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(input, text);
    input.setSelectionRange?.(text.length, text.length);
  } else {
    input.textContent = text;
  }
  // So "input": o "change" gravaria o VIN ainda incompleto.
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function pickPrefix(index) {
  const item = prefixItems[index];
  if (!item || !prefixInput) {
    return;
  }
  setVinFieldValue(prefixInput, item.prefix);
  selectFormModel(item.model);
  hidePrefixBox();
  prefixInput.focus();
}

function updatePrefixSuggestions() {
  if (!prefixInput || !prefixInput.isConnected || document.activeElement !== prefixInput) {
    hidePrefixBox();
    return;
  }
  const typed = prefixKey(getFieldValue(prefixInput));
  // Sugere enquanto o que foi digitado ainda e o comeco de algum prefixo (ou
  // de algum nome de modelo); depois que o prefixo esta completo, some.
  prefixItems = prefixList.filter((item) => {
    const prefix = prefixKey(item.prefix);
    if (!prefix) return false;
    if (!typed) return true;
    return (prefix.startsWith(typed) && prefix !== typed) || prefixKey(item.model).startsWith(typed);
  });
  if (prefixItems.length === 0) {
    hidePrefixBox();
    return;
  }

  const box = ensurePrefixBox();
  box.textContent = "";
  const title = document.createElement("div");
  title.textContent = "Modelo e prefixo do VIN";
  title.style.cssText = "padding:2px 12px 4px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.04em;";
  box.appendChild(title);

  prefixItems.forEach((item, index) => {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;justify-content:space-between;gap:12px;padding:6px 12px;cursor:pointer;";
    const model = document.createElement("span");
    model.textContent = item.model || "(sem nome)";
    model.style.cssText = "font-weight:600;";
    const prefix = document.createElement("span");
    prefix.textContent = item.prefix;
    prefix.style.cssText = "font-family:ui-monospace,Consolas,monospace;color:#4338ca;letter-spacing:.04em;";
    row.append(model, prefix);
    row.addEventListener("mouseenter", () => highlightPrefix(index));
    row.addEventListener("click", () => pickPrefix(index));
    box.appendChild(row);
  });

  highlightPrefix(-1);
  box.style.display = "block";
  positionPrefixBox();
}

function attachPrefixInput(input) {
  prefixInput = input;
  if (input.dataset.vinMonitorPrefix === "true") {
    return;
  }
  input.dataset.vinMonitorPrefix = "true";

  input.addEventListener("focus", updatePrefixSuggestions);
  input.addEventListener("click", updatePrefixSuggestions);
  input.addEventListener("input", updatePrefixSuggestions);
  input.addEventListener("blur", hidePrefixBox);
  input.addEventListener(
    "keydown",
    (event) => {
      const open = prefixBox && prefixBox.style.display !== "none" && prefixItems.length > 0;
      if (!open) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        highlightPrefix((prefixActive + 1) % prefixItems.length);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        highlightPrefix((prefixActive - 1 + prefixItems.length) % prefixItems.length);
      } else if (event.key === "Enter" && prefixActive >= 0) {
        // Impede que o Enter grave o VIN incompleto.
        event.preventDefault();
        event.stopImmediatePropagation();
        pickPrefix(prefixActive);
      } else if (event.key === "Escape") {
        hidePrefixBox();
      }
    },
    true
  );
}

window.addEventListener("scroll", positionPrefixBox, true);
window.addEventListener("resize", positionPrefixBox);

function scanPrefix() {
  const input = findVinInput();
  if (input && input !== prefixInput) {
    attachPrefixInput(input);
  }
}

let prefixScanPending = false;
new MutationObserver(() => {
  if (prefixScanPending) return;
  prefixScanPending = true;
  requestAnimationFrame(() => {
    prefixScanPending = false;
    scanPrefix();
  });
}).observe(document.documentElement, { childList: true, subtree: true });

scanPrefix();
