// Mantem o badge do icone da extensao com a contagem de VINs no historico.

const STORAGE_KEY = "vinHistory";

async function updateBadge() {
  const { [STORAGE_KEY]: history = [] } = await chrome.storage.local.get(STORAGE_KEY);
  const count = history.length;

  await chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#0b8043" });
}

chrome.runtime.onInstalled.addListener(updateBadge);
chrome.runtime.onStartup.addListener(updateBadge);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEY]) {
    updateBadge();
  }
});

updateBadge();
