import { WEB_PREVIEW_SCRIPTS } from './startup_manifest.mjs';
import { loadScripts, setDefaultDebugFlag } from './startup_loader.mjs';

setDefaultDebugFlag(false);
await loadScripts(WEB_PREVIEW_SCRIPTS);
