'use strict';

// Runtime behavior shared by production and the developer diagnostics.
var openHydrationConcurrency = 8;

function getOpenHydrationConcurrency() {
  return openHydrationConcurrency;
}

function setOpenHydrationConcurrency(value) {
  const next = Math.max(1, Math.min(32, Math.floor(Number(value) || openHydrationConcurrency)));
  openHydrationConcurrency = next;
  return next;
}

async function mapWithConcurrency(items, limit, worker, collectResults = true) {
  const out = collectResults ? new Array(items.length) : null;
  let next = 0;
  const workerCount = Math.max(1, Math.min(Number(limit) || 1, items.length));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (next < items.length) {
      const index = next++;
      const result = await worker(items[index], index);
      if (collectResults) out[index] = result;
    }
  }));
  return out;
}
