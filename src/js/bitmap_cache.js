'use strict';

(function initBitmapCache(root) {
  function createGroupedLruCache({
    memoryLimit,
    closeEntry = null,
    entryBytes = (entry) => entry?.bytes || 0,
    onEvict = null,
  }) {
    const groups = new Map();
    const entryNodes = new WeakMap();
    let lruHead = null;
    let lruTail = null;
    let bytes = 0;

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

    function detachLruNode(node) {
      if (node.prev) node.prev.next = node.next;
      else if (lruHead === node) lruHead = node.next;
      if (node.next) node.next.prev = node.prev;
      else if (lruTail === node) lruTail = node.prev;
      node.prev = null;
      node.next = null;
    }

    function appendLruNode(node) {
      node.prev = lruTail;
      if (lruTail) lruTail.next = node;
      else lruHead = node;
      lruTail = node;
    }

    function touchEntry(key, slot, entry) {
      let node = entryNodes.get(entry);
      if (node && lruTail === node) return;
      if (!node) {
        node = { key, slot, entry, prev: null, next: null };
        entryNodes.set(entry, node);
      } else detachLruNode(node);
      appendLruNode(node);
    }

    function untrackEntry(entry) {
      const node = entryNodes.get(entry);
      if (!node) return;
      detachLruNode(node);
      entryNodes.delete(entry);
    }

    function evictEntry(key, group, slot, entry, notify = false, dropEmptyGroup = true) {
      untrackEntry(entry);
      close(entry);
      bytes -= entryBytes(entry);
      group.delete(slot);
      if (dropEmptyGroup && !group.size) groups.delete(key);
      if (notify && onEvict) onEvict(entry, key, slot);
    }

    function set(key, slot, entry) {
      const group = getGroup(key);
      const existing = group.get(slot);
      if (existing) {
        evictEntry(key, group, slot, existing, false, false);
      }
      group.set(slot, entry);
      touchEntry(key, slot, entry);
      bytes += entryBytes(entry);
      prune();
      return entry;
    }

    function get(key, slot) {
      const entry = groups.get(key)?.get(slot) || null;
      if (entry) touchEntry(key, slot, entry);
      return entry;
    }

    function removeGroup(key) {
      const group = groups.get(key);
      if (!group) return;
      for (const entry of group.values()) {
        untrackEntry(entry);
        close(entry);
        bytes -= entryBytes(entry);
      }
      groups.delete(key);
      bytes = Math.max(0, bytes);
    }

    function clear() {
      for (const key of groups.keys()) removeGroup(key);
      lruHead = null;
      lruTail = null;
      bytes = 0;
    }

    function prune() {
      if (bytes <= memoryLimit) return;
      while (bytes > memoryLimit && lruHead) {
        const node = lruHead;
        const group = groups.get(node.key);
        const entry = group?.get(node.slot) || null;
        if (entry !== node.entry) {
          detachLruNode(node);
          entryNodes.delete(node.entry);
          continue;
        }
        evictEntry(node.key, group, node.slot, node.entry, true);
      }
      bytes = Math.max(0, bytes);
    }

    return {
      groups,
      get bytes() { return bytes; },
      get,
      set,
      removeGroup,
      clear,
    };
  }

  const api = Object.freeze({ createGroupedLruCache });
  root.BoardfishBitmapCache = api;
})(typeof window !== 'undefined' ? window : globalThis);
