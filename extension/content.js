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

// Quando o campo fica vazio (o formulario foi enviado e limpo, ou o usuario
// apagou o conteudo), o proximo preenchimento e um registro novo - mesmo que
// seja exatamente o mesmo VIN de antes.
function trackFieldCleared(rawValue) {
  if (!vinNormalize(rawValue)) {
    recordedValue = "";
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

  await vinAddEntry(vin);
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
