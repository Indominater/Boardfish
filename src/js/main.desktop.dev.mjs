import { DESKTOP_DEV_SCRIPTS } from './startup_manifest.mjs';
import { loadScripts, setDefaultDebugFlag } from './startup_loader.mjs';

setDefaultDebugFlag(false);
await loadScripts(DESKTOP_DEV_SCRIPTS);
