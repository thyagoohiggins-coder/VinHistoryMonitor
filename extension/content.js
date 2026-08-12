// Monitora o campo "VIN" de um formulario (Google Forms, Microsoft Forms
// etc.) e grava um historico com timestamp. A remocao automatica de
// duplicatas e opcional (configuravel no popup da extensao, desativada por
// padrao).

const VIN_LABEL_REGEX = /\bVIN\b/i;
const LABEL_SEARCH_MAX_DEPTH = 10;
const LABEL_TEXT_MAX_LENGTH = 400;

let lastSavedValue = "";

// So grava quando o campo e "finalizado" (perde o foco, Enter, troca de
// aba, fechamento da pagina) - nunca enquanto o usuario ainda esta digitando.
async function saveVin(rawValue) {
  const vin = vinNormalize(rawValue);
  if (!vin || vin === lastSavedValue) {
    return;
  }

  const settings = await vinGetSettings();
  const history = await vinGetHistory();

  const updated = settings.dedupeEnabled
    ? history.filter((entry) => entry.vin !== vin)
    : history.slice();

  updated.unshift({
    vin,
    timestamp: Date.now(),
  });

  await vinSetHistory(updated);
  lastSavedValue = vin;
}

// Retorna o texto do rotulo associado a um campo, tentando aria-labelledby,
// aria-label e, por fim, subindo pelos ancestrais ate achar um texto curto
// que contenha "VIN" (a pergunta do formulario).
function getFieldLabelText(input) {
  const labelledBy = input.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent || "")
      .join(" ")
      .trim();
    if (text) {
      return text;
    }
  }

  const ariaLabel = input.getAttribute("aria-label");
  if (ariaLabel) {
    return ariaLabel;
  }

  if (input.id) {
    const explicitLabel = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
    if (explicitLabel?.textContent) {
      return explicitLabel.textContent;
    }
  }

  let node = input.parentElement;
  let depth = 0;

  while (node && depth < LABEL_SEARCH_MAX_DEPTH) {
    const text = (node.textContent || "").trim();

    if (text && text.length <= LABEL_TEXT_MAX_LENGTH && VIN_LABEL_REGEX.test(text)) {
      return text;
    }

    node = node.parentElement;
    depth += 1;
  }

  return "";
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

function attachListener(input) {
  if (!input || input.dataset.vinMonitorAttached === "true") {
    return;
  }

  input.dataset.vinMonitorAttached = "true";

  const handleCommit = () => saveVin(getFieldValue(input));

  input.addEventListener("blur", handleCommit);
  input.addEventListener("change", handleCommit);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      handleCommit();
    }
  });

  // Garante que o valor seja salvo antes da pagina ser fechada/navegada
  window.addEventListener("beforeunload", handleCommit);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      handleCommit();
    }
  });
}

function scan() {
  const input = findVinInput();
  if (input) {
    attachListener(input);
  }
}

scan();

const observer = new MutationObserver(() => scan());
observer.observe(document.documentElement, { childList: true, subtree: true });
