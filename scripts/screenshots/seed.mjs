#!/usr/bin/env node
// Screenshots (ONC-32): creates a throwaway user with sample collectives on the LOCAL Docker test server.
// Dev tooling only (runs in Node, never bundled into the plugin). Re-running starts the user from scratch.
//
// Usage: node scripts/screenshots/seed.mjs <en|de> <out.json>
// Writes { serverUrl, user, appPassword } to out.json for capture.mjs. Keep that file out of the repo.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const devDir = join(root, 'scripts', 'dev-nextcloud');

const [lang, outFile] = process.argv.slice(2);
if (!['en', 'de'].includes(lang) || !outFile) throw new Error('Usage: seed.mjs <en|de> <out.json>');

const env = Object.fromEntries(
	readFileSync(join(devDir, '.env'), 'utf8')
		.split('\n')
		.filter((l) => l.includes('=') && !l.startsWith('#'))
		.map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const base = `http://localhost:${env.NC_PORT}`;
if (!/^http:\/\/localhost:\d+$/.test(base)) throw new Error('Refusing to run against a non-local server');

const user = `shots-${lang}`;
const OCS = `${base}/ocs/v2.php/apps/collectives/api/v1.0`;

/** Sample content per language: collectives with emoji, pages as [emoji, title, text, subpages]. */
const CONTENT = {
	en: {
		displayName: 'Sam Example',
		collectives: [
			{ name: 'Team Handbook', emoji: '📘', readme: 'Everything a new team member needs in the first weeks.\n', pages: [
				['👋', 'Onboarding', '- [ ] Get a laptop and accounts\n- [ ] Meet your buddy\n- [ ] Read the [[Meetings]] page\n\nQuestions? Ask in the team chat.\n', []],
				['🗓️', 'Meetings', 'Weekly sync on Monday at 10:00, retro every second Friday.\n', [
					['', 'Weekly 2026-10-19', '## Decisions\n\n- Release 1.4 goes out on Thursday.\n- Sam reviews the new docs.\n'],
					['🔁', 'Retro Q3', '**Went well:** fewer late-night deploys.\n\n**To improve:** clearer tickets.\n'],
				]],
				['🛠️', 'Tools', '| Tool | What for |\n|---|---|\n| Nextcloud | files, wiki |\n| Obsidian | notes |\n', []],
			] },
			{ name: 'Recipes', emoji: '🍳', readme: 'Tried and tested.\n', pages: [
				['🥞', 'Pancakes', '- 200 g flour\n- 2 eggs\n- 300 ml milk\n\nRest the batter for 20 minutes.\n', []],
				['🍲', 'Lentil Soup', 'Red lentils, carrots, cumin, lemon juice.\n', []],
			] },
			{ name: 'Projects', emoji: '🚀', readme: '', pages: [
				['🌐', 'Website Relaunch', 'Goal: new design and faster pages by December.\n', []],
			] },
		],
	},
	de: {
		displayName: 'Sam Beispiel',
		collectives: [
			{ name: 'Team-Handbuch', emoji: '📘', readme: 'Alles, was neue Teammitglieder in den ersten Wochen brauchen.\n', pages: [
				['👋', 'Einarbeitung', '- [ ] Laptop und Zugänge abholen\n- [ ] Pat:in kennenlernen\n- [ ] Seite [[Besprechungen]] lesen\n\nFragen? Einfach im Team-Chat stellen.\n', []],
				['🗓️', 'Besprechungen', 'Wochentreffen montags um 10 Uhr, Retro jeden zweiten Freitag.\n', [
					['', 'Wochentreffen 2026-10-19', '## Beschlüsse\n\n- Version 1.4 geht am Donnerstag raus.\n- Sam prüft die neue Doku.\n'],
					['🔁', 'Retro Q3', '**Gut gelaufen:** weniger nächtliche Deployments.\n\n**Verbessern:** klarere Tickets.\n'],
				]],
				['🛠️', 'Werkzeuge', '| Werkzeug | Wofür |\n|---|---|\n| Nextcloud | Dateien, Wiki |\n| Obsidian | Notizen |\n', []],
			] },
			{ name: 'Rezepte', emoji: '🍳', readme: 'Erprobt und für gut befunden.\n', pages: [
				['🥞', 'Pfannkuchen', '- 200 g Mehl\n- 2 Eier\n- 300 ml Milch\n\nTeig 20 Minuten ruhen lassen.\n', []],
				['🍲', 'Linsensuppe', 'Rote Linsen, Möhren, Kreuzkümmel, Zitronensaft.\n', []],
			] },
			{ name: 'Projekte', emoji: '🚀', readme: '', pages: [
				['🌐', 'Website-Relaunch', 'Ziel: neues Design und schnellere Seiten bis Dezember.\n', []],
			] },
		],
	},
}[lang];

function occOnce(args, extraEnv) {
	return execFileSync(
		'docker',
		['compose', 'exec', '-T', '-u', 'www-data', ...Object.keys(extraEnv).flatMap((k) => ['-e', k]), 'nextcloud', 'php', 'occ', ...args],
		{ cwd: devDir, env: { ...process.env, ...extraEnv }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
	);
}

const isLocked = (e) => String(e.stderr ?? '').includes('database is locked');

/** Runs occ; retries while the SQLite database of the test server is locked by another client (tests, a synced vault). */
function occ(args, extraEnv = {}) {
	for (let attempt = 1; ; attempt++) {
		try {
			return occOnce(args, extraEnv);
		} catch (e) {
			if (!isLocked(e) || attempt === 5) throw e;
			execFileSync('sleep', ['2']);
		}
	}
}

function userExists() {
	try { occ(['user:info', user]); return true; } catch { return false; }
}

const basic = (u, p) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');
let auth = '';

async function ocs(method, path, body) {
	const headers = { 'OCS-APIRequest': 'true', Accept: 'application/json', Authorization: auth };
	if (body !== undefined) headers['Content-Type'] = 'application/json';
	const res = await fetch(OCS + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
	if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
	return (await res.json()).ocs.data;
}

async function dav(path, text) {
	const url = `${base}/remote.php/dav/files/${encodeURIComponent(user)}/${path.split('/').map(encodeURIComponent).join('/')}`;
	const res = await fetch(url, { method: 'PUT', headers: { Authorization: auth, 'Content-Type': 'text/markdown' }, body: text });
	if (!res.ok) throw new Error(`PUT ${path} → ${res.status}`);
}

/** Writes the text of a page through WebDAV; the page info knows where its file lives. */
async function writePage(page, text) {
	const dir = page.filePath ? `${page.collectivePath}/${page.filePath}` : page.collectivePath;
	await dav(`${dir}/${page.fileName}`, text);
}

async function addPage(collectiveId, parentId, [emoji, title, text]) {
	const { page } = await ocs('POST', `/collectives/${collectiveId}/pages/${parentId}`, { title });
	if (emoji) await ocs('PUT', `/collectives/${collectiveId}/pages/${page.id}/emoji`, { emoji });
	await writePage(page, text);
	return page;
}

// Start from scratch: remove the old collectives (otherwise their circles outlive the user) and the user itself.
const password = randomBytes(18).toString('base64url');
if (userExists()) {
	occ(['user:resetpassword', '--password-from-env', user], { OC_PASS: password });
	auth = basic(user, password);
	for (const c of (await ocs('GET', '/collectives')).collectives) {
		await ocs('DELETE', `/collectives/${c.id}`);
		await ocs('DELETE', `/collectives/trash/${c.id}`);
	}
	occ(['user:delete', user]);
}
try {
	occOnce(['user:add', '--password-from-env', '--display-name', CONTENT.displayName, user], { OC_PASS: password });
} catch (e) {
	// user:add creates the account before it stores the display name; a lock in between leaves the account behind.
	// The display name appears in no screenshot, so an existing account is good enough.
	if (!isLocked(e) || !userExists()) throw e;
}
auth = basic(user, password);

for (const c of CONTENT.collectives) {
	const { collective } = await ocs('POST', '/collectives', { name: c.name, emoji: c.emoji });
	const pages = await ocs('GET', `/collectives/${collective.id}/pages`);
	const landing = pages.pages.find((p) => p.parentId === 0);
	await writePage(landing, c.readme);
	for (const [emoji, title, text, children] of c.pages) {
		const page = await addPage(collective.id, landing.id, [emoji, title, text]);
		for (const child of children) await addPage(collective.id, page.id, child);
	}
}

const appPassword = occ(['user:auth-tokens:add', '--password-from-env', '--name', 'obsidian-screenshots', user], { OC_PASS: password })
	.trim().split('\n').pop().trim();
writeFileSync(outFile, JSON.stringify({ serverUrl: base, user, appPassword }, null, '\t') + '\n', { mode: 0o600 });
console.log(`Seeded ${CONTENT.collectives.length} collectives for ${user}`);
