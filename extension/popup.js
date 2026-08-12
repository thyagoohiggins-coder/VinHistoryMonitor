const STORAGE_KEY = "vinHistory";

const listEl = document.getElementById("historyList");
const emptyStateEl = document.getElementById("emptyState");
const countEl = document.getElementById("count");
const clearBtn = document.getElementById("clearBtn");

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function render(history) {
  listEl.innerHTML = "";

  const isEmpty = !history || history.length === 0;
  emptyStateEl.style.display = isEmpty ? "block" : "none";
  listEl.style.display = isEmpty ? "none" : "block";
  countEl.textContent = isEmpty
    ? ""
    : `${history.length} VIN${history.length === 1 ? "" : "s"} unico${history.length === 1 ? "" : "s"} registrado${history.length === 1 ? "" : "s"}`;

  if (isEmpty) {
    return;
  }

  const sorted = [...history].sort((a, b) => b.timestamp - a.timestamp);

  for (const entry of sorted) {
    const li = document.createElement("li");
    li.className = "history-item";

    const vinEl = document.createElement("div");
    vinEl.className = "vin";
    vinEl.textContent = entry.vin;

    const timeEl = document.createElement("div");
    timeEl.className = "time";
    timeEl.textContent = formatTimestamp(entry.timestamp);

    li.appendChild(vinEl);
    li.appendChild(timeEl);
    listEl.appendChild(li);
  }
}

async function load() {
  const { [STORAGE_KEY]: history = [] } = await chrome.storage.local.get(STORAGE_KEY);
  render(history);
}

clearBtn.addEventListener("click", async () => {
  await chrome.storage.local.set({ [STORAGE_KEY]: [] });
  render([]);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEY]) {
    render(changes[STORAGE_KEY].newValue || []);
  }
});

load();
