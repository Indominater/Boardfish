'use strict';

(function initBitmapCache(root) {
  function createGroupedLruCache({
    memoryLimit,
    closeEntry = null,
    entryBytes = (entry) => entry?.bytes || 0,
    onEvict = null,
  }) {
    const groups = new Map();
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
      else lruHead = node.next;
      if (node.next) node.next.prev = node.prev;
      else lruTail = node.prev;
      node.prev = node.next = null;
    }

    function appendLruNode(node) {
      node.prev = lruTail;
      if (lruTail) lruTail.next = node;
      else lruHead = node;
      lruTail = node;
    }

    function touchNode(node) {
      if (lruTail === node) return;
      detachLruNode(node);
      appendLruNode(node);
    }

    function evictNode(group, node, notify = false, dropEmptyGroup = true) {
      detachLruNode(node);
      close(node.entry);
      bytes -= entryBytes(node.entry);
      group.delete(node.slot);
      if (dropEmptyGroup && !group.size) groups.delete(node.key);
      if (notify && onEvict) onEvict(node.entry, node.key, node.slot);
    }

    function set(key, slot, entry) {
      const group = getGroup(key);
      const existing = group.get(slot);
      if (existing) evictNode(group, existing, false, false);
      const node = { key, slot, entry, prev: null, next: null };
      group.set(slot, node);
      appendLruNode(node);
      bytes += entryBytes(entry);
      prune();
      return entry;
    }

    function get(key, slot, touch = true) {
      const node = groups.get(key)?.get(slot) || null;
      if (node && touch) touchNode(node);
      return node?.entry || null;
    }

    function removeGroup(key) {
      const group = groups.get(key);
      if (!group) return;
      for (const node of group.values()) {
        detachLruNode(node);
        close(node.entry);
        bytes -= entryBytes(node.entry);
      }
      groups.delete(key);
      bytes = Math.max(0, bytes);
    }

    function clear() {
      for (const group of groups.values()) for (const node of group.values()) close(node.entry);
      groups.clear();
      lruHead = lruTail = null;
      bytes = 0;
    }

    function prune() {
      if (bytes <= memoryLimit) return;
      while (bytes > memoryLimit && lruHead) {
        const node = lruHead;
        const group = groups.get(node.key);
        evictNode(group, node, true);
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
