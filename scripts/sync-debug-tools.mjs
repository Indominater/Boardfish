import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const capabilityPath = path.join(root, 'src-tauri/capabilities/default.json');
const generatedCapabilityPath = path.join(root, 'src-tauri/gen/schemas/capabilities.json');

function writeIfChanged(filePath, contents) {
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === contents) return;
  fs.writeFileSync(filePath, contents);
}

const devtoolsPermission = 'core:webview:deny-internal-toggle-devtools';

const capability = {
  identifier: 'default',
  description: 'Default capabilities',
  windows: ['main'],
  permissions: [
    'core:app:allow-set-app-theme',
    'core:event:allow-listen',
    devtoolsPermission,
    'core:window:allow-start-dragging',
    'dialog:default',
  ],
};

writeIfChanged(capabilityPath, `${JSON.stringify(capability, null, 2)}\n`);

const generated = {
  default: {
    identifier: capability.identifier,
    description: capability.description,
    local: true,
    windows: capability.windows,
    permissions: capability.permissions,
  },
};

writeIfChanged(generatedCapabilityPath, JSON.stringify(generated));
