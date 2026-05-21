'use strict';

(function initBitmapCache(root) {
  function createGroupedLruCache({
    memoryLimit,
    closeEntry = null,
    entryBytes = (entry) => entry?.bytes || 0,
    onEvict = null,
  }) {
    const groups = new Map();
    let bytes = 0;
    let useCounter = 1;

    function getGroup(key) {
      let group = groups.get(key);
      if (!group) {
        group = new Map();
        groups.set(key, group);
      }
      return group;
    }

    function close(entry) {
      if (closeEntry) closeEntry(entry);
      else if (entry?.bitmap?.close) entry.bitmap.close();
    }

    function set(key, slot, entry) {
      const group = getGroup(key);
      const existing = group.get(slot);
      if (existing) {
        close(existing);
        bytes -= entryBytes(existing);
      }
      entry.lastUsed = useCounter++;
      group.set(slot, entry);
      bytes += entryBytes(entry);
      prune();
      return entry;
    }

    function get(key, slot) {
      const entry = groups.get(key)?.get(slot) || null;
      if (entry) entry.lastUsed = useCounter++;
      return entry;
    }

    function removeGroup(key) {
      const group = groups.get(key);
      if (!group) return;
      for (const entry of group.values()) {
        close(entry);
        bytes -= entryBytes(entry);
      }
      group.clear();
      groups.delete(key);
      bytes = Math.max(0, bytes);
    }

    function clear() {
      for (const key of groups.keys()) removeGroup(key);
      bytes = 0;
      useCounter = 1;
    }

    function prune() {
      if (bytes <= memoryLimit) return 0;
      const entries = [];
      for (const [key, group] of groups.entries()) {
        for (const [slot, entry] of group.entries()) entries.push({ key, group, slot, entry });
      }
      entries.sort((a, b) => (a.entry.lastUsed || 0) - (b.entry.lastUsed || 0));
      let evicted = 0;
      for (const item of entries) {
        if (bytes <= memoryLimit) break;
        close(item.entry);
        bytes -= entryBytes(item.entry);
        item.group.delete(item.slot);
        if (!item.group.size) groups.delete(item.key);
        evicted++;
        if (onEvict) onEvict(item.entry, item.key, item.slot);
      }
      bytes = Math.max(0, bytes);
      return evicted;
    }

    return {
      groups,
      get bytes() { return bytes; },
      get useCounter() { return useCounter; },
      getGroup,
      get,
      set,
      removeGroup,
      clear,
      prune,
    };
  }

  const api = Object.freeze({ createGroupedLruCache });
  root.BoardfishBitmapCache = api;
  if (root !== globalThis) globalThis.BoardfishBitmapCache = api;
})(typeof window !== 'undefined' ? window : globalThis);
