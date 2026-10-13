// Mantem o badge do icone da extensao com a contagem de VINs no historico.

importScripts("storage.js");

const STORAGE_KEY = "vinHistory";
const PURGE_ALARM = "vinPurge";

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

// Agenda o alarme para a proxima virada do dia de producao (fim do 3º turno).
async function schedulePurge() {
  const settings = await vinGetSettings();
  if (!settings.autoPurgeEnabled) {
    await chrome.alarms.clear(PURGE_ALARM);
    return;
  }
  await chrome.alarms.create(PURGE_ALARM, {
    when: vinNextCycleStart(Date.now(), settings.shifts),
  });
}

// Limpa o que ja venceu (cobre o navegador fechado na virada) e reagenda.
async function purgeAndSchedule() {
  await vinPurgeExpired();
  await schedulePurge();
}

chrome.runtime.onInstalled.addListener(() => {
  updateBadge();
purgeAndSchedule();
  purgeAndSchedule();
});
chrome.runtime.onStartup.addListener(() => {
  updateBadge();
purgeAndSchedule();
  purgeAndSchedule();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === PURGE_ALARM) {
    purgeAndSchedule();
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") {
    return;
  }
  if (changes[STORAGE_KEY]) {
    updateBadge();
purgeAndSchedule();
  }
  // Horarios dos turnos ou a opcao de apagar mudaram: reagenda.
  if (changes[VIN_SETTINGS_KEY]) {
    purgeAndSchedule();
  }
});

updateBadge();
purgeAndSchedule();
