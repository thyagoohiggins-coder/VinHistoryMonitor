// Le as opcoes marcadas da pergunta "PEÇAS FALTANTES" (cripple) do formulario.
// Varias ou todas as opcoes podem estar marcadas.

const PARTS_LABEL_REGEX = /\bPE[ÇC]AS\s+FALTANTES\b/i;
const PARTS_CHECKBOX_SELECTOR = 'input[type="checkbox"], [role="checkbox"]';
const PARTS_TITLE_MAX_LENGTH = 200;

// O elemento esta realmente na tela? O Forms esconde perguntas ramificadas
// (display:none, hidden, altura zero) em vez de remove-las, e as respostas
// escondidas continuam marcadas no HTML.
function isRendered(el) {
  if (!el || !el.isConnected) {
    return false;
  }
  for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
    if (node.hidden) {
      return false;
    }
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isCheckboxChecked(el) {
  if (el.tagName === "INPUT") {
    return el.checked;
  }
  return el.getAttribute("aria-checked") === "true";
}

const PARTS_TEXT_FIELD_SELECTOR = 'input[type="text"], input:not([type]), textarea';

// Menor "raiz" da opcao: o maior ancestral que contem so esta caixa. E nela
// que ficam o texto da opcao e, na opcao "Outra", o campo de texto digitado.
function getOptionRoot(box, selector) {
  let root = box.parentElement;
  let last = root;
  for (let i = 0; i < 6 && root; i += 1) {
    if (root.querySelectorAll(selector).length > 1) {
      break;
    }
    last = root;
    root = root.parentElement;
  }
  return last;
}

// Texto digitado na opcao "Outra" (vazio nas demais).
function getOptionTypedText(box, selector = PARTS_CHECKBOX_SELECTOR) {
  const root = getOptionRoot(box, selector);
  if (!root) {
    return "";
  }
  return [...root.querySelectorAll(PARTS_TEXT_FIELD_SELECTOR)]
    .map((field) => field.value.trim())
    .filter(Boolean)
    .join(" ");
}

// Texto da opcao: aria-label / label associado, ou o texto da raiz da opcao.
// Na opcao "Outra" vale o que foi digitado ("Outra: texto").
function getCheckboxOptionText(box, selector = PARTS_CHECKBOX_SELECTOR) {
  const ariaLabel = (box.getAttribute("aria-label") || "").trim();
  const labelledBy = box.getAttribute("aria-labelledby");
  const fromIds = labelledBy
    ? labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || "")
        .join(" ")
        .trim()
    : "";

  const root = getOptionRoot(box, selector);
  const placeholder = root?.querySelector(PARTS_TEXT_FIELD_SELECTOR)?.placeholder || "";
  const typed = getOptionTypedText(box, selector);

  const base = (fromIds || ariaLabel || (root?.textContent || "")).replace(/\s+/g, " ").trim();
  if (typed) {
    // "Outra resposta" + texto vira "Outra: texto".
    return !base || base === typed || /^outra/i.test(base) ? `Outra: ${typed}` : `${base}: ${typed}`;
  }
  return base || placeholder.trim();
}

// Container da pergunta: o menor ancestral do titulo que ja contem opcoes.
// `titleRegex` casa com o titulo; `maxTitle` limita o tamanho do texto dele.
function findQuestionContainer(titleRegex, selector, prefilter, maxTitle = PARTS_TITLE_MAX_LENGTH) {
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!prefilter.test(node.nodeValue || "")) {
      continue;
    }

    let title = node.parentElement;
    for (let i = 0; i < 4 && title; i += 1) {
      const text = (title.textContent || "").trim();
      if (text.length <= maxTitle && titleRegex.test(text)) {
        break;
      }
      title = title.parentElement;
    }
    if (!title) {
      continue;
    }
    const titleText = (title.textContent || "").trim();
    if (titleText.length > maxTitle || !titleRegex.test(titleText)) {
      continue;
    }

    let container = title;
    for (let i = 0; i < 10 && container; i += 1) {
      if (container.querySelector(selector)) {
        // Pergunta escondida pelo formulario conta como ausente.
        if (isRendered(container)) {
          return container;
        }
        break;
      }
      container = container.parentElement;
    }
  }
  return null;
}

// Textos das opcoes marcadas dentro do container.
function readCheckedTexts(container, selector) {
  const texts = [];
  for (const box of container.querySelectorAll(selector)) {
    // A opcao "Outra" conta mesmo sem a caixa marcada, se ha texto digitado.
    if (!isCheckboxChecked(box) && !getOptionTypedText(box, selector)) {
      continue;
    }
    const text = getCheckboxOptionText(box, selector);
    if (text && !texts.includes(text)) {
      texts.push(text);
    }
  }
  return texts;
}

// Lista de opcoes marcadas, ou null se a pergunta nao esta na pagina.
function readMissingParts() {
  const container = findQuestionContainer(PARTS_LABEL_REGEX, PARTS_CHECKBOX_SELECTOR, /FALTANTES|PE[ÇC]AS/i);
  return container ? readCheckedTexts(container, PARTS_CHECKBOX_SELECTOR) : null;
}

// Perguntas de escolha unica (MODELO e COR): titulo curto que COMECA com o
// nome da pergunta (com ou sem numero na frente).
const PARTS_RADIO_SELECTOR = 'input[type="radio"], [role="radio"]';
const MODEL_TITLE_REGEX = /^(?:\d+\s*[.)]\s*)?MODELO\b/i;
const COLOR_TITLE_REGEX = /^(?:\d+\s*[.)]\s*)?COR\b/i;

// Opcao marcada ("" se nenhuma) ou null se a pergunta nao esta na pagina.
function readRadioAnswer(titleRegex, prefilter) {
  const container = findQuestionContainer(titleRegex, PARTS_RADIO_SELECTOR, prefilter, 60);
  return container ? readCheckedTexts(container, PARTS_RADIO_SELECTOR)[0] || "" : null;
}

// Modelo, cor e pecas faltantes; so inclui o que foi encontrado na pagina.
function readFormDetails() {
  const details = {};
  const parts = readMissingParts();
  if (parts) details.parts = parts;
  const model = readRadioAnswer(MODEL_TITLE_REGEX, /MODELO/i);
  if (model !== null) details.model = model;
  const color = readRadioAnswer(COLOR_TITLE_REGEX, /\bCOR\b/i);
  if (color !== null) details.color = color;
  return details;
}
