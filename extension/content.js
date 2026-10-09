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

  recordedValue = vin;

  const updated = await vinAddEntry(vin, readMissingParts());
  // O registro novo e sempre o primeiro da lista.
  currentEntryTimestamp = updated[0]?.timestamp ?? null;
}

// As opcoes de "PEÇAS FALTANTES" costumam ser marcadas depois do VIN: ao
// clicar numa caixa, atualiza o registro do VIN atual.
let partsRefreshTimer = null;
function refreshPartsSoon() {
  clearTimeout(partsRefreshTimer);
  partsRefreshTimer = setTimeout(() => {
    // So atualiza enquanto o campo ainda mostra o VIN gravado: depois do
    // envio o formulario volta zerado e apagaria as pecas ja registradas.
    if (
      currentEntryTimestamp === null ||
      !currentVinInput ||
      !currentVinInput.isConnected ||
      vinNormalize(getFieldValue(currentVinInput)) !== recordedValue
    ) {
      return;
    }
    const parts = readMissingParts();
    if (parts) {
      vinSetEntryParts(currentEntryTimestamp, parts);
    }
  }, 150);
}

for (const type of ["click", "change", "input", "keyup"]) {
  document.addEventListener(type, refreshPartsSoon, true);
}

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
