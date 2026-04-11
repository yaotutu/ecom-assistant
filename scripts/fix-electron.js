// Post-build script: Inject Electron API workaround for Windows
const fs = require('fs');
const path = require('path');

const mainJsPath = path.join(__dirname, '..', 'dist', 'main', 'main.js');

if (!fs.existsSync(mainJsPath)) {
  console.log('[Fix] dist/main/main.js not found');
  process.exit(0);
}

let content = fs.readFileSync(mainJsPath, 'utf-8');

// Check if already patched
if (content.includes('// ELECTRON_WINDOWS_FIX')) {
  console.log('[Fix] Already patched');
  process.exit(0);
}

// Inject fix at the beginning of the file
const fix = `
// ELECTRON_WINDOWS_FIX
const _electron = (() => {
  // Try to get from Electron's internal module system (may fail)
  try {
    const electronModule = process._linkedBinding?.('electron');
    if (electronModule?.app) return electronModule;
  } catch (e) {}
  
  // Try from global
  if (global.electron?.app) return global.electron;
  
  // Use require (may return string path on Windows)
  const e = require('electron');
  if (e?.app) return e;
  
  // Fatal error
  console.error('[Main] Failed to load Electron API. This is a known issue on Windows.');
  console.error('[Main] Please try running: npm run build && .\\\\node_modules\\\\electron\\\\dist\\\\electron.exe .');
  process.exit(1);
})();

// Export for use in the module
const electron = _electron;
`;

// Replace the first require('electron') with our fix
content = content.replace(
  'const electron = require("electron");',
  fix.trim()
);

fs.writeFileSync(mainJsPath, content, 'utf-8');
console.log('[Fix] Patched electron import');
