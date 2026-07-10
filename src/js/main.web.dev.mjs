import { WEB_DEV_SCRIPTS } from './startup_manifest.mjs';
import { loadScripts, setDefaultDebugFlag } from './startup_loader.mjs';

const [webEnvScript, ...remainingScripts] = WEB_DEV_SCRIPTS;

await loadScripts([webEnvScript]);
setDefaultDebugFlag(globalThis.__BOARDFISH_WEB_DEV_MODE__ === true);
await loadScripts(remainingScripts);
