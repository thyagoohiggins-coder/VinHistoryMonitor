// Le as opcoes marcadas da pergunta "PEÇAS FALTANTES" (cripple) do formulario.
// Varias ou todas as opcoes podem estar marcadas.

const PARTS_LABEL_REGEX = /\bPE[ÇC]AS\s+FALTANTES\b/i;
const PARTS_CHECKBOX_SELECTOR = 'input[type="checkbox"], [role="checkbox"]';
const PARTS_TITLE_MAX_LENGTH = 200;

function isCheckboxChecked(el) {
  if (el.tagName === "INPUT") {
    return el.checked;
  }
  return el.getAttribute("aria-checked") === "true";
}

// Texto da opcao: aria-label / label associado, ou o texto do menor ancestral
// que contenha so esta caixa. Na opcao "Outra" soma o texto digitado.
function getCheckboxOptionText(box) {
  const ariaLabel = (box.getAttribute("aria-label") || "").trim();
  const labelledBy = box.getAttribute("aria-labelledby");
  const fromIds = labelledBy
    ? labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || "")
        .join(" ")
        .trim()
    : "";

  let wrapper = box.parentElement;
  for (let i = 0; i < 6 && wrapper; i += 1) {
    if (wrapper.querySelectorAll(PARTS_CHECKBOX_SELECTOR).length > 1) {
      wrapper = null;
      break;
    }
    const hasContent =
      (wrapper.textContent || "").trim() || wrapper.querySelector('input[type="text"], textarea');
    if (hasContent) {
      break;
    }
    wrapper = wrapper.parentElement;
  }

  const typed = wrapper
    ? [...wrapper.querySelectorAll('input[type="text"], input:not([type]), textarea')]
        .map((field) => field.value.trim())
        .filter(Boolean)
        .join(" ")
    : "";
  const placeholder = wrapper?.querySelector('input[type="text"], input:not([type]), textarea')?.placeholder || "";

  const base = (fromIds || ariaLabel || (wrapper?.textContent || "")).replace(/\s+/g, " ").trim();
  if (typed) {
    return base && base !== typed ? `${base}: ${typed}` : typed;
  }
  return base || placeholder.trim();
}

// Container da pergunta: o menor ancestral do titulo que ja contem caixas.
function findPartsQuestionContainer() {
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!/FALTANTES|PE[ÇC]AS/i.test(node.nodeValue || "")) {
      continue;
    }

    let title = node.parentElement;
    for (let i = 0; i < 4 && title; i += 1) {
      const text = title.textContent || "";
      if (text.length <= PARTS_TITLE_MAX_LENGTH && PARTS_LABEL_REGEX.test(text)) {
        break;
      }
      title = title.parentElement;
    }
    if (!title || !PARTS_LABEL_REGEX.test(title.textContent || "")) {
      continue;
    }
    if ((title.textContent || "").length > PARTS_TITLE_MAX_LENGTH) {
      continue;
    }

    let container = title;
    for (let i = 0; i < 10 && container; i += 1) {
      if (container.querySelector(PARTS_CHECKBOX_SELECTOR)) {
        return container;
      }
      container = container.parentElement;
    }
  }
  return null;
}

// Lista de opcoes marcadas, ou null se a pergunta nao esta na pagina.
function readMissingParts() {
  const container = findPartsQuestionContainer();
  if (!container) {
    return null;
  }

  const parts = [];
  for (const box of container.querySelectorAll(PARTS_CHECKBOX_SELECTOR)) {
    if (!isCheckboxChecked(box)) {
      continue;
    }
    const text = getCheckboxOptionText(box);
    if (text && !parts.includes(text)) {
      parts.push(text);
    }
  }
  return parts;
}
