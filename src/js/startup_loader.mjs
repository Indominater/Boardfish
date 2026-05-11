export function setDefaultDebugFlag(enabled) {
  if (Object.prototype.hasOwnProperty.call(globalThis, '__BOARDFISH_DEBUG_TOOLS_ENABLED__')) return;
  Object.defineProperty(globalThis, '__BOARDFISH_DEBUG_TOOLS_ENABLED__', {
    value: !!enabled,
    writable: false,
    configurable: false,
  });
}

export function loadLegacyScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`failed to load ${src}`));
    document.body.appendChild(script);
  });
}

export async function loadScripts(scripts) {
  for (const src of scripts) {
    await loadLegacyScript(new URL(src, import.meta.url).href);
  }
}
