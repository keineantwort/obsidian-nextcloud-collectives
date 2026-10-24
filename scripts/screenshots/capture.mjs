#!/usr/bin/env node
// Screenshots (ONC-32): drives a running Obsidian over the Chrome DevTools Protocol and captures the plugin UI.
// Dev tooling only (runs in Node, never bundled into the plugin). Needs the test server user from seed.mjs.
//
// Usage: npm run build
//        open -a Obsidian --args --remote-debugging-port=9222
//        node scripts/screenshots/capture.mjs <en|de> <creds.json> <vault dir>
// The vault dir must not exist yet. Images go to docs/images/<lang>/. Obsidian's UI language is switched for the
// run and restored afterwards; the new vault stays registered in Obsidian until removed from the vault switcher.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [lang, credsFile, vaultArg] = process.argv.slice(2);
if (!['en', 'de'].includes(lang) || !credsFile || !vaultArg) throw new Error('Usage: capture.mjs <en|de> <creds.json> <vault dir>');
const creds = JSON.parse(readFileSync(credsFile, 'utf8'));
if (!/^http:\/\/localhost:\d+$/.test(creds.serverUrl)) throw new Error('Refusing to run against a non-local server');
const vault = resolve(vaultArg);
if (existsSync(vault)) throw new Error(`${vault} exists; capture.mjs needs a fresh vault`);
const outDir = join(root, 'docs', 'images', lang);
const PORT = 9222;
const PLUGIN = 'nextcloud-collectives';
const SECRET_ID = 'nextcloud-collectives-5c7ee75e07c0';
const WIDTH = 1280;
const HEIGHT = 800;

/** Names of the pages the scenarios touch, per language (see seed.mjs). */
const PAGES = {
	en: { collective: 'Team Handbook', open: 'Onboarding', conflict: 'Onboarding', delete: 'Lentil Soup' },
	de: { collective: 'Team-Handbuch', open: 'Einarbeitung', conflict: 'Einarbeitung', delete: 'Linsensuppe' },
}[lang];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function prepareVault() {
	const pluginDir = join(vault, '.obsidian', 'plugins', PLUGIN);
	mkdirSync(pluginDir, { recursive: true });
	for (const f of ['main.js', 'manifest.json', 'styles.css']) copyFileSync(join(root, f), join(pluginDir, f));
	const settings = {
		serverUrl: creds.serverUrl, username: creds.user, appPasswordSecretId: SECRET_ID,
		// Only manual runs, so every dialog appears when the script asks for it.
		syncIntervalMinutes: 0, syncOnStartup: false, syncOnSave: false, syncOnForeground: false,
	};
	writeFileSync(join(pluginDir, 'data.json'), JSON.stringify(settings, null, '\t'));
	writeFileSync(join(vault, '.obsidian', 'community-plugins.json'), JSON.stringify([PLUGIN]));
	writeFileSync(join(vault, '.obsidian', 'appearance.json'), JSON.stringify({ theme: 'obsidian' }));
	// No empty properties block above the note.
	writeFileSync(join(vault, '.obsidian', 'app.json'), JSON.stringify({ propertiesInDocument: 'hidden' }));
}

/** Minimal CDP session over the WebSocket of one target. */
async function connect(wsUrl) {
	const ws = new WebSocket(wsUrl);
	await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
	let next = 1;
	const pending = new Map();
	ws.onmessage = (ev) => {
		const msg = JSON.parse(ev.data);
		const p = pending.get(msg.id);
		if (!p) return;
		pending.delete(msg.id);
		if (msg.error) p.fail(new Error(msg.error.message)); else p.ok(msg.result);
	};
	const send = (method, params = {}) => new Promise((ok, fail) => {
		const id = next++;
		pending.set(id, { ok, fail });
		ws.send(JSON.stringify({ id, method, params }));
	});
	/** Evaluates an async function body in the page; returns its JSON value. */
	const run = async (body) => {
		const res = await send('Runtime.evaluate', { expression: `(async () => { ${body} })()`, awaitPromise: true, returnByValue: true });
		if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
		return res.result.value;
	};
	return { send, run, close: () => ws.close() };
}

async function targets() {
	const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
	return (await res.json()).filter((t) => t.type === 'page');
}

async function waitFor(desc, fn, timeoutMs = 30000) {
	const end = Date.now() + timeoutMs;
	for (;;) {
		const value = await fn();
		if (value) return value;
		if (Date.now() > end) throw new Error(`Timeout: ${desc}`);
		await sleep(250);
	}
}

async function shoot(page, name) {
	// A window in the background may not repaint: bring it to the front first.
	await page.run(`const w = require('@electron/remote').getCurrentWindow(); w.show(); w.focus(); return true;`);
	await sleep(1200); // let animations and the status bar settle
	// No toasts, tooltips or focus ring in the picture.
	await page.run(`document.querySelectorAll('.notice-container .notice, .tooltip').forEach((n) => n.remove()); document.activeElement?.blur(); return true;`);
	const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
	writeFileSync(join(outDir, `${name}.png`), Buffer.from(data, 'base64'));
	console.log(`  ${lang}/${name}.png`);
}

const cmd = (page, id) => page.run(`app.commands.executeCommandById('${PLUGIN}:${id}'); return true;`);
const modalOpen = (page, cls) => page.run(`return !!document.querySelector('.modal.${cls}');`);
/** Closes the open dialogs the way a user does: Escape until none is left. */
async function closeModals(page) {
	for (let i = 0; i < 5 && await page.run(`return !!document.querySelector('.modal-container');`); i++) {
		for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
		await sleep(400);
	}
}

/** Runs a manual sync and waits until the plugin is idle again (or a dialog of the given class asks). */
async function sync(page, dialogCls) {
	await cmd(page, 'sync-now');
	await sleep(1500);
	if (dialogCls) return waitFor(`dialog ${dialogCls}`, () => modalOpen(page, dialogCls));
	// `sync` is private in TypeScript, but readable at runtime.
	await waitFor('sync finished', () => page.run(`return !app.plugins.plugins['${PLUGIN}'].sync.running;`));
	await sleep(1500);
}

const AUTH = 'Basic ' + Buffer.from(`${creds.user}:${creds.appPassword}`).toString('base64');

/** WebDAV path of a page, from the OCS page list (the user folder of Collectives differs between server versions). */
async function serverPath(collectiveName, title) {
	const ocs = async (path) => {
		const res = await fetch(`${creds.serverUrl}/ocs/v2.php/apps/collectives/api/v1.0${path}`, { headers: { Authorization: AUTH, 'OCS-APIRequest': 'true', Accept: 'application/json' } });
		return (await res.json()).ocs.data;
	};
	const collective = (await ocs('/collectives')).collectives.find((c) => c.name === collectiveName);
	const page = (await ocs(`/collectives/${collective.id}/pages`)).pages.find((p) => p.title === title);
	return [page.collectivePath, page.filePath, page.fileName].filter(Boolean).join('/');
}

async function davPut(path, text) {
	const url = `${creds.serverUrl}/remote.php/dav/files/${encodeURIComponent(creds.user)}/${path.split('/').map(encodeURIComponent).join('/')}`;
	const res = await fetch(url, { method: 'PUT', headers: { Authorization: AUTH, 'Content-Type': 'text/markdown' }, body: text });
	if (!res.ok) throw new Error(`PUT ${path} → ${res.status}`);
}

mkdirSync(outDir, { recursive: true });
prepareVault();

// Any Obsidian window can switch the language and open the new vault.
const [first] = await targets();
if (!first) throw new Error(`No Obsidian window on port ${PORT}; start Obsidian with --remote-debugging-port=${PORT}`);
const opener = await connect(first.webSocketDebuggerUrl);
const previousLanguage = await opener.run(`return localStorage.getItem('language');`);

let page;
try {
	await opener.run(`localStorage.setItem('language', ${JSON.stringify(lang)}); return true;`);
	const before = new Set((await targets()).map((t) => t.id));
	await opener.run(`return require('electron').ipcRenderer.sendSync('vault-open', ${JSON.stringify(vault)}, false);`);
	const target = await waitFor('vault window', async () => (await targets()).find((t) => !before.has(t.id) && t.title.includes(basename(vault))));
	page = await connect(target.webSocketDebuggerUrl);
	await page.send('Page.enable');
	await waitFor('workspace ready', () => page.run(`return !!(window.app && app.workspace.layoutReady);`).catch(() => false));

	// A new vault starts in restricted mode. Turn community plugins on directly instead of racing the trust dialog,
	// then close that dialog if it shows up.
	await page.run(`if (!app.plugins.isEnabled()) await app.plugins.setEnable(true); return true;`);
	await sleep(1500);
	await closeModals(page);
	// No Obsidian Sync icon in the status bar.
	await page.run(`await app.internalPlugins.getPluginById('sync')?.disable(true); return true;`);
	await page.run(`app.secretStorage.setSecret('${SECRET_ID}', ${JSON.stringify(creds.appPassword)});
		await app.plugins.disablePlugin('${PLUGIN}'); await app.plugins.enablePlugin('${PLUGIN}'); return true;`);
	await waitFor('plugin loaded', () => page.run(`return !!app.plugins.plugins['${PLUGIN}'];`));

	// Electron does not implement the CDP Browser domain; resize through the window itself.
	await page.run(`require('@electron/remote').getCurrentWindow().setContentSize(${WIDTH}, ${HEIGHT}); return true;`);

	// 1. File list with emoji after the first sync.
	await sync(page);
	await page.run(`
		const files = app.vault.getMarkdownFiles();
		const note = files.find((f) => f.basename === ${JSON.stringify(PAGES.open)});
		// Reading view: no cursor that turns a line back into raw Markdown.
		await app.workspace.getLeaf(false).openFile(note, { state: { mode: 'preview' } });
		const explorer = app.workspace.getLeavesOfType('file-explorer')[0];
		app.workspace.revealLeaf(explorer);
		explorer.view.revealInFolder(note);
		for (const item of Object.values(explorer.view.fileItems)) if (item.setCollapsed && item.file.path.split('/').length < 3) item.setCollapsed(false);
		return true;`);
	await shoot(page, 'file-list');

	// 2. Settings.
	// Obsidian may open the settings in a window of their own; capture that one if it appears.
	const beforeSettings = new Set((await targets()).map((t) => t.id));
	await page.run(`app.setting.open(); app.setting.openTabById('${PLUGIN}'); return true;`);
	const settingsTarget = await waitFor('settings window', async () => (await targets()).find((t) => !beforeSettings.has(t.id)), 10000).catch(() => undefined);
	const settingsPage = settingsTarget ? await connect(settingsTarget.webSocketDebuggerUrl) : page;
	if (settingsTarget) await settingsPage.send('Page.enable');
	await shoot(settingsPage, 'settings');
	if (settingsTarget) settingsPage.close();
	await page.run(`app.setting.close(); return true;`);

	// 3. Conflict: the same page changed in the vault and on the server.
	await page.run(`
		const note = app.vault.getMarkdownFiles().find((f) => f.basename === ${JSON.stringify(PAGES.conflict)});
		await app.vault.process(note, (t) => t.replace(/\\n\\n(?=Questions|Fragen)/, ${JSON.stringify(lang === 'en' ? '\n\nWelcome aboard! Your first week is planned for you.\n\n' : '\n\nWillkommen an Bord! Deine erste Woche ist schon geplant.\n\n')}));
		return true;`);
	const conflictPath = await serverPath(PAGES.collective, PAGES.conflict);
	const serverText = lang === 'en'
		? '- [ ] Get a laptop, accounts and a desk\n- [ ] Meet your buddy\n- [ ] Read the [[Meetings]] page\n\nQuestions? Ask in the team chat or your buddy.\n'
		: '- [ ] Laptop, Zugänge und Schreibtisch abholen\n- [ ] Pat:in kennenlernen\n- [ ] Seite [[Besprechungen]] lesen\n\nFragen? Einfach im Team-Chat oder bei der Pat:in.\n';
	await sleep(1100);
	await davPut(conflictPath, serverText);
	await sleep(1100);
	await sync(page);
	await cmd(page, 'show-conflicts');
	await waitFor('conflict dialog', () => modalOpen(page, 'nc-conflict-modal'));
	await page.run(`const d = document.querySelector('.nc-conflict-modal details'); if (d) d.open = true; return true;`);
	await shoot(page, 'conflict');
	await closeModals(page);

	// 4. Deletion prompt: a note deleted in the vault.
	await page.run(`
		const note = app.vault.getMarkdownFiles().find((f) => f.basename === ${JSON.stringify(PAGES.delete)});
		await app.fileManager.trashFile(note); return true;`);
	await sync(page, 'nc-confirm');
	await shoot(page, 'delete-confirm');
	await page.run(`document.querySelector('.modal.nc-confirm .modal-button-container button')?.click(); return true;`);
	await sleep(1500);

	// 5. Log.
	await cmd(page, 'show-log');
	await waitFor('log dialog', () => modalOpen(page, 'nc-log'));
	await shoot(page, 'log');
	await closeModals(page);
} finally {
	await opener.run(previousLanguage === null ? `localStorage.removeItem('language'); return true;` : `localStorage.setItem('language', ${JSON.stringify(previousLanguage)}); return true;`);
	page?.close();
	opener.close();
}
