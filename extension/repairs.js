// Banco de dados de reparos: aprende cada texto digitado no campo "PRINCIPAL
// REPARO" e sugere reparos parecidos enquanto o usuario digita. Compartilhado
// pelo content script e pelo popup.

const REPAIR_STORAGE_KEY = "repairDb";
const REPAIR_MAX_ENTRIES = 2000;
const REPAIR_MAX_TEXT_LENGTH = 300;

// Minusculas, sem acento, sem pontuacao e com espacos colapsados.
function repairNormalize(text) {
  return (text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function repairTokens(text) {
  const norm = repairNormalize(text);
  return norm ? norm.split(" ") : [];
}

async function repairGetAll() {
  const { [REPAIR_STORAGE_KEY]: db = [] } = await chrome.storage.local.get(REPAIR_STORAGE_KEY);
  return Array.isArray(db) ? db : [];
}

let repairWriteQueue = Promise.resolve();

function repairMutate(mutator) {
  const result = repairWriteQueue.then(async () => {
    const updated = mutator(await repairGetAll());
    await chrome.storage.local.set({ [REPAIR_STORAGE_KEY]: updated });
    return updated;
  });
  repairWriteQueue = result.catch(() => {});
  return result;
}

// Aprende um reparo: se ja existe (comparacao normalizada) aumenta o uso e
// atualiza a data; senao cria uma entrada nova.
async function repairLearn(rawText) {
  const text = (rawText || "").replace(/\s+/g, " ").trim().slice(0, REPAIR_MAX_TEXT_LENGTH);
  const key = repairNormalize(text);
  if (!key) {
    return null;
  }

  return repairMutate((db) => {
    const now = Date.now();
    const existing = db.find((item) => item.key === key);
    if (existing) {
      existing.count += 1;
      existing.lastUsed = now;
      existing.text = text;
    } else {
      db.push({ key, text, count: 1, lastUsed: now });
    }

    if (db.length > REPAIR_MAX_ENTRIES) {
      db.sort((a, b) => b.count - a.count || b.lastUsed - a.lastUsed);
      db.length = REPAIR_MAX_ENTRIES;
    }
    return db;
  });
}

function repairDelete(key) {
  return repairMutate((db) => db.filter((item) => item.key !== key));
}

function repairClear() {
  return repairMutate(() => []);
}

// Distancia de edicao (Levenshtein) simples, para tolerar erros de digitacao.
function repairEditDistance(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

// Pontua quanto um token digitado combina com um token do reparo salvo.
function repairTokenScore(queryToken, candidateToken, isLast) {
  if (candidateToken === queryToken) return 1;
  // A ultima palavra ainda esta sendo digitada: prefixo conta.
  if (isLast && candidateToken.startsWith(queryToken)) return 0.9;
  if (queryToken.length >= 4 && candidateToken.includes(queryToken)) return 0.6;
  if (queryToken.length >= 4) {
    const limit = queryToken.length >= 7 ? 2 : 1;
    const head = isLast ? candidateToken.slice(0, queryToken.length) : candidateToken;
    if (repairEditDistance(queryToken, head) <= limit) return 0.7;
  }
  return 0;
}

// Reparos parecidos com o texto digitado, melhores primeiro.
function repairSuggest(db, query, limit = 6) {
  const queryNorm = repairNormalize(query);
  if (queryNorm.length < 2) {
    return [];
  }
  const queryTokens = queryNorm.split(" ");
  const scored = [];

  for (const item of db) {
    if (item.key === queryNorm) {
      continue;
    }

    const candTokens = item.key.split(" ");
    let score = 0;

    if (item.key.startsWith(queryNorm)) {
      score = 3;
    } else {
      let total = 0;
      for (let i = 0; i < queryTokens.length; i += 1) {
        const isLast = i === queryTokens.length - 1;
        let best = 0;
        for (const cand of candTokens) {
          best = Math.max(best, repairTokenScore(queryTokens[i], cand, isLast));
        }
        total += best;
      }
      const coverage = total / queryTokens.length;
      // Exige que a maior parte do que foi digitado encontre correspondencia.
      if (coverage < 0.5) {
        continue;
      }
      score = coverage * 2;
    }

    // Desempate: reparos mais usados e usados recentemente aparecem antes.
    score += Math.min(item.count, 20) * 0.02 + item.lastUsed / 1e15;
    scored.push({ item, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((entry) => entry.item);
}
