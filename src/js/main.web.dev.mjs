import { WEB_DEV_SCRIPTS } from './startup_manifest.mjs';
import { loadScripts } from './startup_loader.mjs';

await loadScripts(WEB_DEV_SCRIPTS);
