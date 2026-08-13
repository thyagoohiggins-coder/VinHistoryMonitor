// Mantem o badge do icone da extensao com a contagem de VINs no historico.

const STORAGE_KEY = "vinHistory";

async function updateBadge() {
  const { [STORAGE_KEY]: history = [] } = await chrome.storage.local.get(STORAGE_KEY);
  const count = history.length;

  await chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });

  // Escuro, e nao verde: o icone ja e verde, entao um badge da mesma cor
  // se dissolveria nele.
  await chrome.action.setBadgeBackgroundColor({ color: "#1f2937" });

  // setBadgeTextColor so existe em navegadores mais novos.
  if (chrome.action.setBadgeTextColor) {
    await chrome.action.setBadgeTextColor({ color: "#ffffff" });
  }
}

chrome.runtime.onInstalled.addListener(updateBadge);
chrome.runtime.onStartup.addListener(updateBadge);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEY]) {
    updateBadge();
  }
});

updateBadge();
