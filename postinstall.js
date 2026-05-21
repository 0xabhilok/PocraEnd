'use strict';

// Fetches the better-sqlite3 native binary that matches the installed Electron.
//
// better-sqlite3's binary is tied to a V8 ABI (NODE_MODULE_VERSION). `npm install`
// downloads the binary for your *system* Node, but the app runs inside Electron,
// which bundles its own Node with a different ABI -- so that binary fails to load.
// This re-fetches the prebuilt binary built for Electron. No compiler needed.
//
// active-win uses N-API (ABI-stable), so it needs no fixup.

const { execFileSync } = require('node:child_process');
const path = require('node:path');

let electronVersion;
try {
  electronVersion = require('electron/package.json').version;
} catch {
  console.log('[postinstall] electron not installed - skipping native fixup.');
  process.exit(0);
}

const betterSqliteDir = path.dirname(require.resolve('better-sqlite3/package.json'));
const prebuildInstall = require.resolve('prebuild-install/bin.js');

console.log(`[postinstall] fetching better-sqlite3 binary for Electron ${electronVersion}...`);
try {
  execFileSync(
    process.execPath,
    [prebuildInstall, '--runtime=electron', `--target=${electronVersion}`],
    { cwd: betterSqliteDir, stdio: 'inherit' }
  );
  console.log('[postinstall] better-sqlite3 is ready for Electron.');
} catch {
  console.error('[postinstall] FAILED to fetch the Electron binary for better-sqlite3.');
  console.error('[postinstall] The app will crash with a NODE_MODULE_VERSION error until fixed.');
  process.exit(1);
}
