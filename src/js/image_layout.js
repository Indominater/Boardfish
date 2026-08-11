'use strict';

(function initImageLayout(root) {
  const DEFAULT_IMAGE_MAX_DIMENSION = 600;
  const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2;
  // Unrestricted row partitioning is exponential. Keep common selections exact
  // and use bounded deterministic refinement for larger boards.
  const EXACT_PARTITION_IMAGE_LIMIT = 13;
  const LOCAL_IMPROVEMENT_STEP_FACTOR = 4;

  const finitePositiveNumber = (value) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  };

  const numericTolerance = (a, b) => Math.max(1, Math.abs(a || 0), Math.abs(b || 0)) * 1e-12;

  const compareIds = (left, right) => {
    const a = String(left);
    const b = String(right);
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  };

  const compareNumberArrays = (left, right) => {
    const count = Math.min(left.length, right.length);
    for (let i = 0; i < count; i++) {
      if (left[i] !== right[i]) return left[i] - right[i];
    }
    return left.length - right.length;
  };

  const randomUnit = (random) => {
    const sample = Number(random());
    return Number.isFinite(sample)
      ? Math.min(Math.max(sample, 0), 1 - Number.EPSILON)
      : 0;
  };

  function shuffledCopy(values, random) {
    const shuffled = values.slice();
    for (let index = shuffled.length - 1; index > 0; index--) {
      const swapIndex = Math.floor(randomUnit(random) * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
  }

  function normalizedImageItems(images, rowHeight) {
    const items = [];
    const seenIds = new Set();
    for (let sourceIndex = 0; sourceIndex < images.length; sourceIndex++) {
      const image = images[sourceIndex];
      if (!image || image.id == null || seenIds.has(String(image.id))) continue;
      const sourceWidth = finitePositiveNumber(image.w);
      const sourceHeight = finitePositiveNumber(image.h);
      if (sourceWidth == null || sourceHeight == null) continue;
      const width = sourceWidth / sourceHeight * rowHeight;
      if (!Number.isFinite(width) || width <= 0) continue;
      seenIds.add(String(image.id));
      items.push({
        id: image.id,
        sortId: String(image.id),
        width,
      });
    }
    items.sort((a, b) => b.width - a.width || compareIds(a.sortId, b.sortId));
    for (let rank = 0; rank < items.length; rank++) items[rank].rank = rank;
    return items;
  }

  function canonicalRows(rows) {
    const canonical = rows.map((row) => {
      const items = row.items;
      let width = 0;
      for (const item of items) width += item.width;
      return { items, width, ranks: items.map((item) => item.rank) };
    });
    canonical.sort((a, b) => {
      const tolerance = numericTolerance(a.width, b.width);
      if (Math.abs(a.width - b.width) > tolerance) return b.width - a.width;
      return compareNumberArrays(a.ranks, b.ranks);
    });
    return canonical;
  }

  function exactPartitionsByRowCount(items, requestedRowCounts) {
    const itemCount = items.length;
    const maxRowCount = Math.max(...requestedRowCounts);
    const stateCount = 1 << itemCount;
    const fullMask = stateCount - 1;
    const subsetCounts = new Uint8Array(stateCount);
    const subsetWidths = new Float64Array(stateCount);
    for (let mask = 1; mask < stateCount; mask++) {
      const bit = mask & -mask;
      const rank = 31 - Math.clz32(bit);
      const previous = mask ^ bit;
      subsetCounts[mask] = subsetCounts[previous] + 1;
      subsetWidths[mask] = subsetWidths[previous] + items[rank].width;
    }

    // With a fixed target and row count, the variable part of the requested
    // squared error is just the sum of squared row widths.
    const choices = new Array(itemCount + 1);
    let previousCosts = new Float64Array(stateCount);
    for (let mask = 1; mask < stateCount; mask++) {
      previousCosts[mask] = subsetWidths[mask] * subsetWidths[mask];
    }

    for (let rowCount = 2; rowCount <= maxRowCount; rowCount++) {
      const nextCosts = new Float64Array(stateCount);
      const nextChoices = new Int32Array(stateCount);
      nextCosts.fill(Infinity);
      nextChoices.fill(-1);
      for (let mask = 1; mask < stateCount; mask++) {
        if (subsetCounts[mask] < rowCount) continue;
        const anchoredBit = mask & -mask;
        const availableForRemainingRows = mask ^ anchoredBit;
        for (
          let remainingMask = availableForRemainingRows;
          remainingMask;
          remainingMask = (remainingMask - 1) & availableForRemainingRows
        ) {
          if (subsetCounts[remainingMask] < rowCount - 1) continue;
          const previousCost = previousCosts[remainingMask];
          const rowMask = mask ^ remainingMask;
          const rowWidth = subsetWidths[rowMask];
          const candidateCost = previousCost + rowWidth * rowWidth;
          const currentCost = nextCosts[mask];
          const tolerance = numericTolerance(candidateCost, currentCost);
          if (
            candidateCost < currentCost - tolerance ||
            (
              Math.abs(candidateCost - currentCost) <= tolerance &&
              (nextChoices[mask] < 0 || remainingMask < nextChoices[mask])
            )
          ) {
            nextCosts[mask] = candidateCost;
            nextChoices[mask] = remainingMask;
          }
        }
      }
      previousCosts = nextCosts;
      choices[rowCount] = nextChoices;
    }

    const partitions = new Array(itemCount + 1);
    for (const rowCount of requestedRowCounts) {
      let mask = fullMask;
      let rowsRemaining = rowCount;
      const rows = [];
      while (rowsRemaining > 1) {
        const remainingMask = choices[rowsRemaining][mask];
        if (remainingMask < 0) break;
        const rowMask = mask ^ remainingMask;
        const rowItems = [];
        for (let rank = 0; rank < itemCount; rank++) {
          if (rowMask & (1 << rank)) rowItems.push(items[rank]);
        }
        rows.push({ items: rowItems });
        mask = remainingMask;
        rowsRemaining--;
      }
      if (rowsRemaining === 1 && mask) {
        const rowItems = [];
        for (let rank = 0; rank < itemCount; rank++) {
          if (mask & (1 << rank)) rowItems.push(items[rank]);
        }
        rows.push({ items: rowItems });
      }
      partitions[rowCount] = canonicalRows(rows);
    }
    return partitions;
  }

  const operationKeyCompare = (left, right) => {
    if (!right) return -1;
    return compareNumberArrays(left.key, right.key);
  };

  function bestImprovingOperation(rows) {
    let best = null;
    let currentCost = 0;
    for (const row of rows) currentCost += row.width * row.width;
    const improvementTolerance = numericTolerance(currentCost);

    for (let from = 0; from < rows.length; from++) {
      const source = rows[from];
      if (source.items.length <= 1) continue;
      for (const item of source.items) {
        for (let to = 0; to < rows.length; to++) {
          if (to === from) continue;
          const target = rows[to];
          const delta = 2 * item.width * (target.width - source.width + item.width);
          if (delta >= -improvementTolerance) continue;
          const operation = {
            type: 'move',
            delta,
            from,
            to,
            item,
            key: [0, item.rank, from, to],
          };
          const bestTolerance = numericTolerance(delta, best?.delta ?? 0);
          if (
            !best ||
            delta < best.delta - bestTolerance ||
            (Math.abs(delta - best.delta) <= bestTolerance && operationKeyCompare(operation, best) < 0)
          ) best = operation;
        }
      }
    }

    for (let leftIndex = 0; leftIndex < rows.length; leftIndex++) {
      const left = rows[leftIndex];
      for (let rightIndex = leftIndex + 1; rightIndex < rows.length; rightIndex++) {
        const right = rows[rightIndex];
        for (const leftItem of left.items) {
          for (const rightItem of right.items) {
            const widthDelta = rightItem.width - leftItem.width;
            const delta = 2 * widthDelta * (left.width - right.width + widthDelta);
            if (delta >= -improvementTolerance) continue;
            const operation = {
              type: 'swap',
              delta,
              from: leftIndex,
              to: rightIndex,
              item: leftItem,
              otherItem: rightItem,
              key: [1, leftItem.rank, rightItem.rank, leftIndex, rightIndex],
            };
            const bestTolerance = numericTolerance(delta, best?.delta ?? 0);
            if (
              !best ||
              delta < best.delta - bestTolerance ||
              (Math.abs(delta - best.delta) <= bestTolerance && operationKeyCompare(operation, best) < 0)
            ) best = operation;
          }
        }
      }
    }
    return best;
  }

  function applyImprovingOperation(rows, operation) {
    const source = rows[operation.from];
    const target = rows[operation.to];
    if (operation.type === 'move') {
      source.items.splice(source.items.indexOf(operation.item), 1);
      target.items.push(operation.item);
    } else {
      const sourceIndex = source.items.indexOf(operation.item);
      const targetIndex = target.items.indexOf(operation.otherItem);
      source.items[sourceIndex] = operation.otherItem;
      target.items[targetIndex] = operation.item;
    }
    for (const row of [source, target]) {
      row.items.sort((a, b) => a.rank - b.rank);
      row.width = row.items.reduce((sum, item) => sum + item.width, 0);
    }
  }

  function balancedGreedyPartition(items, rowCount) {
    const rows = Array.from({ length: rowCount }, (_, index) => ({ index, items: [], width: 0 }));
    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      const item = items[itemIndex];
      let target = rows[itemIndex];
      if (itemIndex >= rowCount) {
        target = rows[0];
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          const tolerance = numericTolerance(row.width, target.width);
          if (
            row.width < target.width - tolerance ||
            (Math.abs(row.width - target.width) <= tolerance && row.index < target.index)
          ) target = row;
        }
      }
      target.items.push(item);
      target.width += item.width;
    }

    const maxSteps = Math.max(1, items.length * LOCAL_IMPROVEMENT_STEP_FACTOR);
    for (let step = 0; step < maxSteps; step++) {
      const operation = bestImprovingOperation(rows);
      if (!operation) break;
      applyImprovingOperation(rows, operation);
    }
    return canonicalRows(rows);
  }

  const goldenErrorForRows = (rows, idealWidth) => {
    let error = 0;
    for (const row of rows) error += (row.width - idealWidth) ** 2;
    return error;
  };

  function randomizeScorePreservingMembership(rows, idealWidth, random) {
    const randomizedRows = rows.map((row) => ({
      ...row,
      items: row.items.slice(),
      ranks: row.ranks.slice(),
    }));
    const slotsByWidth = new Map();
    for (let rowIndex = 0; rowIndex < randomizedRows.length; rowIndex++) {
      const row = randomizedRows[rowIndex];
      for (let itemIndex = 0; itemIndex < row.items.length; itemIndex++) {
        const item = row.items[itemIndex];
        if (!slotsByWidth.has(item.width)) slotsByWidth.set(item.width, []);
        slotsByWidth.get(item.width).push({ rowIndex, itemIndex, item });
      }
    }
    for (const slots of slotsByWidth.values()) {
      if (slots.length < 2) continue;
      const shuffledItems = shuffledCopy(slots.map((slot) => slot.item), random);
      for (let index = 0; index < slots.length; index++) {
        const slot = slots[index];
        randomizedRows[slot.rowIndex].items[slot.itemIndex] = shuffledItems[index];
      }
    }
    for (const row of randomizedRows) row.ranks = row.items.map((item) => item.rank);

    const originalError = goldenErrorForRows(randomizedRows, idealWidth);
    let selectedSwap = null;
    let tiedChoiceCount = 1;
    for (let leftIndex = 0; leftIndex < randomizedRows.length; leftIndex++) {
      const left = randomizedRows[leftIndex];
      for (let rightIndex = leftIndex + 1; rightIndex < randomizedRows.length; rightIndex++) {
        const right = randomizedRows[rightIndex];
        for (const leftItem of left.items) {
          for (const rightItem of right.items) {
            if (leftItem.width === rightItem.width) continue;
            const leftWidth = left.width - leftItem.width + rightItem.width;
            const rightWidth = right.width - rightItem.width + leftItem.width;
            let candidateError = 0;
            for (let rowIndex = 0; rowIndex < randomizedRows.length; rowIndex++) {
              const width = rowIndex === leftIndex
                ? leftWidth
                : (rowIndex === rightIndex ? rightWidth : randomizedRows[rowIndex].width);
              candidateError += (width - idealWidth) ** 2;
            }
            if (candidateError !== originalError) continue;
            tiedChoiceCount++;
            if (randomUnit(random) < 1 / tiedChoiceCount) {
              selectedSwap = { leftIndex, rightIndex, leftItem, rightItem, leftWidth, rightWidth };
            }
          }
        }
      }
    }
    if (!selectedSwap) return randomizedRows;

    const left = randomizedRows[selectedSwap.leftIndex];
    const right = randomizedRows[selectedSwap.rightIndex];
    const leftItemIndex = left.items.indexOf(selectedSwap.leftItem);
    const rightItemIndex = right.items.indexOf(selectedSwap.rightItem);
    left.items[leftItemIndex] = selectedSwap.rightItem;
    right.items[rightItemIndex] = selectedSwap.leftItem;
    left.width = selectedSwap.leftWidth;
    right.width = selectedSwap.rightWidth;
    left.ranks = left.items.map((item) => item.rank);
    right.ranks = right.items.map((item) => item.rank);
    return randomizedRows;
  }

  const theoreticalRowErrorLowerBound = (totalWidth, rowHeight, rowCount) => {
    const idealWidth = GOLDEN_RATIO * rowCount * rowHeight;
    return (totalWidth - rowCount * idealWidth) ** 2 / rowCount;
  };

  function planGoldenRatioImageLayout(images, center = {}, options = {}) {
    if (!Array.isArray(images)) return null;
    const rowHeight = finitePositiveNumber(options.rowHeight) || DEFAULT_IMAGE_MAX_DIMENSION;
    const items = normalizedImageItems(images, rowHeight);
    if (!items.length) return null;
    const randomizeTies = options.randomizeTies === true;
    const random = typeof options.random === 'function' ? options.random : Math.random;
    const centerX = Number.isFinite(Number(center.x)) ? Number(center.x) : 0;
    const centerY = Number.isFinite(Number(center.y)) ? Number(center.y) : 0;
    const totalWidth = items.reduce((sum, item) => sum + item.width, 0);
    if (!Number.isFinite(totalWidth)) return null;
    const candidates = [];
    for (let rowCount = 1; rowCount <= items.length; rowCount++) {
      candidates.push({
        rowCount,
        lowerBound: theoreticalRowErrorLowerBound(totalWidth, rowHeight, rowCount),
      });
    }
    if (candidates.some((candidate) => !Number.isFinite(candidate.lowerBound))) return null;
    candidates.sort((a, b) => a.lowerBound - b.lowerBound || a.rowCount - b.rowCount);

    let exactPartitions = null;
    if (items.length <= EXACT_PARTITION_IMAGE_LIMIT) {
      const provisional = candidates[0];
      const provisionalIdealWidth = GOLDEN_RATIO * provisional.rowCount * rowHeight;
      const provisionalRows = balancedGreedyPartition(items, provisional.rowCount);
      const upperBound = goldenErrorForRows(provisionalRows, provisionalIdealWidth);
      if (!Number.isFinite(upperBound)) return null;
      const possibleRowCounts = candidates
        .filter((candidate) => (
          candidate.lowerBound <= upperBound + numericTolerance(candidate.lowerBound, upperBound)
        ))
        .map((candidate) => candidate.rowCount);
      exactPartitions = exactPartitionsByRowCount(items, possibleRowCounts);
    }

    let best = null;
    let bestTieCount = 0;
    for (const candidate of candidates) {
      if (
        best &&
        candidate.lowerBound > best.error + numericTolerance(candidate.lowerBound, best.error)
      ) break;
      if (exactPartitions && !exactPartitions[candidate.rowCount]) continue;
      const idealWidth = GOLDEN_RATIO * candidate.rowCount * rowHeight;
      const rows = exactPartitions
        ? exactPartitions[candidate.rowCount]
        : balancedGreedyPartition(items, candidate.rowCount);
      if (
        rows.length !== candidate.rowCount ||
        rows.some((row) => !row.items.length) ||
        rows.reduce((count, row) => count + row.items.length, 0) !== items.length
      ) return null;
      const error = goldenErrorForRows(rows, idealWidth);
      if (!Number.isFinite(error)) return null;
      const tolerance = numericTolerance(error, best?.error ?? 0);
      if (!best || error < best.error - tolerance) {
        best = { rows, rowCount: candidate.rowCount, idealWidth, error };
        bestTieCount = 1;
      } else if (Math.abs(error - best.error) <= tolerance) {
        if (randomizeTies && error === best.error) {
          bestTieCount++;
          if (randomUnit(random) < 1 / bestTieCount) {
            best = { rows, rowCount: candidate.rowCount, idealWidth, error };
          }
        } else if (candidate.rowCount < best.rowCount) {
          best = { rows, rowCount: candidate.rowCount, idealWidth, error };
          bestTieCount = 1;
        }
      }
    }
    if (!best) return null;

    if (randomizeTies) {
      best.rows = randomizeScorePreservingMembership(best.rows, best.idealWidth, random);
      best.error = goldenErrorForRows(best.rows, best.idealWidth);
    }

    let presentationRows = best.rows;
    if (options.shuffleOrder === true) {
      // Membership ties are settled above; randomize row and in-row presentation too.
      presentationRows = shuffledCopy(best.rows, random).map((row) => ({
        ...row,
        items: shuffledCopy(row.items, random),
      }));
    }
    const occupiedWidth = best.rows.reduce((width, row) => Math.max(width, row.width), 0);
    const height = best.rowCount * rowHeight;
    const left = centerX - occupiedWidth / 2;
    const top = centerY - height / 2;
    const placements = [];
    const rows = presentationRows.map((row, rowIndex) => {
      let cursorX = left;
      const itemIds = [];
      for (let column = 0; column < row.items.length; column++) {
        const item = row.items[column];
        itemIds.push(item.id);
        placements.push({
          id: item.id,
          row: rowIndex,
          column,
          x: cursorX,
          y: top + rowIndex * rowHeight,
          w: item.width,
          h: rowHeight,
        });
        cursorX += item.width;
      }
      return {
        y: top + rowIndex * rowHeight,
        width: row.width,
        itemIds,
      };
    });

    return {
      rowHeight,
      rowCount: best.rowCount,
      idealWidth: best.idealWidth,
      occupiedWidth,
      height,
      error: best.error,
      left,
      top,
      rows,
      placements,
    };
  }

  const api = Object.freeze({
    DEFAULT_IMAGE_MAX_DIMENSION,
    GOLDEN_RATIO,
    planGoldenRatioImageLayout,
  });
  root.BoardfishImageLayout = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
