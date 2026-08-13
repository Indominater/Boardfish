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
  await Promise.all(scripts.map((src) => loadLegacyScript(new URL(src, import.meta.url).href)));
}
