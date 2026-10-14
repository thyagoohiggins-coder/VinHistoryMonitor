// Limpeza automatica dos VINs ao fim do 3º turno (alarme diario).

importScripts("storage.js");

const PURGE_ALARM = "vinPurge";

// O icone nao mostra mais a contagem de VINs: apaga qualquer numero que uma
// versao anterior tenha deixado no icone.
function clearBadge() {
  chrome.action.setBadgeText({ text: "" });
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

function start() {
  clearBadge();
  purgeAndSchedule();
}

chrome.runtime.onInstalled.addListener(start);
chrome.runtime.onStartup.addListener(start);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === PURGE_ALARM) {
    purgeAndSchedule();
  }
});

// Horarios dos turnos ou a opcao de apagar mudaram: reagenda.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[VIN_SETTINGS_KEY]) {
    purgeAndSchedule();
  }
});

start();
