#!/usr/bin/env node
// Host the game on the internet for free from your own computer.
//
//   npm run online
//
// Starts the Blockforge server, then opens a free Cloudflare "quick tunnel"
// (no account needed) that gives the server a public https address to share
// with friends. The world stays on this computer, so it is online while this
// program runs. The address changes each time it starts.
//
// The tunnel program (cloudflared, by Cloudflare) is downloaded once from its
// official GitHub releases into ./.tools/ if it is not already installed.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = path.join(ROOT, '.tools');
const PORT = Number(process.env.PORT) || 8080;
process.env.PORT = String(PORT);
// Players arrive through the tunnel, which says who they really are.
if (process.env.TRUST_PROXY === undefined) process.env.TRUST_PROXY = 'true';

// Which cloudflared release file fits this computer.
function assetName() {
  const { platform, arch } = process;
  if (platform === 'win32') return arch === 'ia32' ? 'cloudflared-windows-386.exe' : 'cloudflared-windows-amd64.exe';
  if (platform === 'darwin') return arch === 'arm64' ? 'cloudflared-darwin-arm64.tgz' : 'cloudflared-darwin-amd64.tgz';
  if (platform === 'linux') {
    if (arch === 'arm64') return 'cloudflared-linux-arm64';
    if (arch === 'arm') return 'cloudflared-linux-arm';
    if (arch === 'ia32') return 'cloudflared-linux-386';
    return 'cloudflared-linux-amd64';
  }
  return null;
}

function onPath(cmd) {
  const r = spawnSync(cmd, ['--version'], { stdio: 'ignore', shell: false });
  return r.status === 0;
}

async function findCloudflared() {
  if (process.env.CLOUDFLARED && fs.existsSync(process.env.CLOUDFLARED)) return process.env.CLOUDFLARED;
  if (onPath('cloudflared')) return 'cloudflared';
  const exe = path.join(TOOLS, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  if (fs.existsSync(exe)) return exe;
  const asset = assetName();
  if (!asset) throw new Error(`No tunnel program is available for ${process.platform}/${process.arch}. Install cloudflared yourself: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/`);
  const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`;
  console.log(`[online] Downloading the free Cloudflare tunnel program (one time only)...\n         ${url}`);
  fs.mkdirSync(TOOLS, { recursive: true });
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed (${res.status} ${res.statusText})`);
  const data = Buffer.from(await res.arrayBuffer());
  if (asset.endsWith('.tgz')) {
    const tgz = path.join(TOOLS, asset);
    fs.writeFileSync(tgz, data);
    const r = spawnSync('tar', ['-xzf', tgz, '-C', TOOLS], { stdio: 'inherit' });
    fs.rmSync(tgz, { force: true });
    if (r.status !== 0 || !fs.existsSync(exe)) throw new Error('Could not unpack the tunnel program');
  } else {
    fs.writeFileSync(exe, data);
  }
  if (process.platform !== 'win32') fs.chmodSync(exe, 0o755);
  return exe;
}

async function waitForServer() {
  for (let i = 0; i < 600; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('The game server did not start');
}

function banner(url) {
  const line = '='.repeat(Math.max(48, url.length + 8));
  console.log(`\n${line}\n  Your game is online! Send this link to your friends:\n\n    ${url}\n\n  They open it, click Multiplayer, type a name and join.\n  It works while this window stays open. The link changes\n  every time you start it. Press Ctrl+C to save and stop.\n${line}\n`);
}

// Quick tunnel addresses look like https://three-random-words-here.trycloudflare.com
const TUNNEL_URL = /https:\/\/(?!api\.)[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com/;

// Resolves with the running tunnel process, or null if it could not start.
function startTunnel(bin) {
  return new Promise((resolve) => {
    let found = false;
    const child = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    const scan = (d) => {
      const text = d.toString();
      if (process.env.VERBOSE) process.stdout.write('[tunnel] ' + text);
      const m = TUNNEL_URL.exec(text);
      if (m && !found) {
        found = true;
        banner(m[0]);
        resolve(child);
      }
    };
    child.stdout.on('data', scan);
    child.stderr.on('data', scan);
    child.on('error', (e) => {
      console.error(`[online] Could not start the tunnel: ${e.message}`);
      resolve(null);
    });
    child.on('exit', () => {
      if (!found) resolve(null);
      else if (!stopping) console.error('[online] The tunnel closed. Restart this program to get a new link.');
    });
    process.on('exit', () => child.kill());
    setTimeout(() => {
      if (!found) console.log('[online] Still waiting for the tunnel... (check your internet connection or firewall)');
    }, 20000).unref();
  });
}

let stopping = false;
process.on('SIGINT', () => (stopping = true));
process.on('SIGTERM', () => (stopping = true));

// Start the game server in this process (its console commands keep working).
await import('./server.js');
await waitForServer();
if (/^(1|true|yes)$/i.test(process.env.NO_TUNNEL || '')) {
  console.log('[online] NO_TUNNEL is set: running without a public link.');
} else {
  try {
    const bin = await findCloudflared();
    let tunnel = null;
    for (let attempt = 1; attempt <= 3 && !tunnel && !stopping; attempt++) {
      if (attempt > 1) {
        console.log(`[online] Trying to open the tunnel again (attempt ${attempt} of 3)...`);
        await new Promise((r) => setTimeout(r, 5000 * attempt));
      }
      tunnel = await startTunnel(bin);
    }
    if (!tunnel && !stopping) {
      console.error('[online] Could not open a public link (no internet, or a firewall blocks Cloudflare).');
      console.error(`[online] The game still works here: http://localhost:${PORT} (and on your Wi-Fi at the addresses above).`);
    }
  } catch (e) {
    console.error(`[online] ${e.message}`);
    console.error(`[online] The game still runs on this computer: http://localhost:${PORT}`);
  }
}
