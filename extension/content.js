// Monitora o campo "VIN" de um formulario do Google Forms e grava um
// historico com timestamp, removendo VINs duplicados automaticamente.

const STORAGE_KEY = "vinHistory";
const VIN_LABEL_REGEX = /\bVIN\b/i;
const SAVE_DEBOUNCE_MS = 1200;

let debounceTimer = null;
let lastSavedValue = "";

function normalizeVin(value) {
  return (value || "").trim().toUpperCase();
}

async function saveVin(rawValue) {
  const vin = normalizeVin(rawValue);
  if (!vin || vin === lastSavedValue) {
    return;
  }

  const { [STORAGE_KEY]: history = [] } = await chrome.storage.local.get(STORAGE_KEY);

  // Remove qualquer entrada anterior com o mesmo VIN (remocao automatica de duplicatas)
  const deduped = history.filter((entry) => entry.vin !== vin);

  deduped.unshift({
    vin,
    timestamp: Date.now(),
  });

  await chrome.storage.local.set({ [STORAGE_KEY]: deduped });
  lastSavedValue = vin;
}

function scheduleSave(value) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => saveVin(value), SAVE_DEBOUNCE_MS);
}

function findVinInput() {
  const listItems = document.querySelectorAll('div[role="listitem"]');

  for (const item of listItems) {
    const headingEl = item.querySelector('div[role="heading"]') || item;
    const headingText = headingEl.textContent || "";

    if (VIN_LABEL_REGEX.test(headingText)) {
      return item.querySelector('input[type="text"], input:not([type]), textarea');
    }
  }

  return null;
}

function attachListener(input) {
  if (!input || input.dataset.vinMonitorAttached === "true") {
    return;
  }

  input.dataset.vinMonitorAttached = "true";

  const handleInput = () => scheduleSave(input.value);
  const handleCommit = () => {
    clearTimeout(debounceTimer);
    saveVin(input.value);
  };

  input.addEventListener("input", handleInput);
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
