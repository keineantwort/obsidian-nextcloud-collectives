#!/usr/bin/env node
// M0 spike: exercises every endpoint from PLAN.md §4.2 against the LOCAL Docker
// test server and stores anonymised responses under tests/fixtures/m0/.
// Dev tooling only (runs in Node, never bundled into the plugin).
//
// Usage: scripts/dev-nextcloud/down.sh --reset && scripts/dev-nextcloud/up.sh
//        node scripts/m0-spike/record-fixtures.mjs

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const devDir = join(root, 'scripts', 'dev-nextcloud');
const outDir = join(root, 'tests', 'fixtures', 'm0');

const env = Object.fromEntries(
	readFileSync(join(devDir, '.env'), 'utf8')
		.split('\n')
		.filter((l) => l.includes('=') && !l.startsWith('#'))
		.map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);

const base = `http://localhost:${env.NC_PORT}`;
if (!/^http:\/\/localhost:\d+$/.test(base)) throw new Error('Refusing to run against a non-local server');

const user = env.NC_TEST_USER;
const appPassword = createAppPassword();
const basic = (u, p) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');
const AUTH = basic(user, appPassword);
const ADMIN_AUTH = basic(env.NC_ADMIN_USER, env.NC_ADMIN_PASSWORD);
const OCS = `${base}/ocs/v2.php/apps/collectives/api/v1.0`;
const DAV = `${base}/remote.php/dav/files/${user}`;
const OCS_HEADERS = { 'OCS-APIRequest': 'true', Accept: 'application/json' };

const circleIds = new Map();
const findings = [];

function createAppPassword() {
	const out = execFileSync(
		'docker',
		['compose', 'exec', '-T', '-u', 'www-data', '-e', 'OC_PASS', 'nextcloud', 'php', 'occ',
			'user:auth-tokens:add', '--password-from-env', '--name', 'm0-fixtures', env.NC_TEST_USER],
		{ cwd: devDir, env: { ...process.env, OC_PASS: env.NC_TEST_PASSWORD }, encoding: 'utf8' },
	);
	return out.trim().split('\n').pop().trim();
}

function anonymise(text) {
	let t = text.replaceAll(base, 'https://cloud.example.test').replaceAll(base.replace(/\//g, '\\/'), 'https:\\/\\/cloud.example.test');
	for (const [real, placeholder] of circleIds) t = t.replaceAll(real, placeholder);
	if (t.includes(appPassword) || t.includes(env.NC_ADMIN_PASSWORD) || t.includes(env.NC_TEST_PASSWORD)) {
		throw new Error('Credential would leak into fixture');
	}
	return t;
}

function save(name, data) {
	mkdirSync(outDir, { recursive: true });
	const body = typeof data === 'string' ? data : JSON.stringify(data, null, '\t') + '\n';
	writeFileSync(join(outDir, name), anonymise(body));
}

async function ocs(method, path, body, { auth = AUTH, fixture } = {}) {
	const headers = { ...OCS_HEADERS, Authorization: auth };
	if (body !== undefined) headers['Content-Type'] = 'application/json';
	const res = await fetch(OCS + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
	const text = await res.text();
	let json;
	try { json = JSON.parse(text); } catch { json = { raw: text }; }
	const circleId = json?.ocs?.data?.collective?.circleId;
	if (circleId && !circleIds.has(circleId)) circleIds.set(circleId, `CIRCLE_ID_${circleIds.size + 1}`);
	if (fixture) save(`${fixture}.json`, { request: { method, path, body: body ?? null }, status: res.status, response: json });
	return { status: res.status, data: json?.ocs?.data };
}

async function dav(method, path, { body, headers = {}, fixture } = {}) {
	const url = DAV + path.split('/').map(encodeURIComponent).join('/');
	const res = await fetch(url, { method, headers: { Authorization: AUTH, ...headers }, body });
	const text = await res.text();
	const keep = ['etag', 'oc-etag', 'oc-fileid', 'content-type', 'last-modified'];
	const resHeaders = Object.fromEntries([...res.headers].filter(([k]) => keep.includes(k)));
	if (fixture) {
		save(`${fixture}.json`, { request: { method, path, headers }, status: res.status, headers: resHeaders });
		if (text) save(`${fixture}.body.${text.startsWith('<?xml') ? 'xml' : 'txt'}`, text);
	}
	return { status: res.status, headers: resHeaders, text };
}

function note(key, value) {
	findings.push({ key, value });
	console.log(`• ${key}: ${JSON.stringify(value)}`);
}

function expect(cond, msg) {
	if (!cond) throw new Error(`Assumption failed: ${msg}`);
}

async function main() {
	const caps = await fetch(`${base}/ocs/v2.php/cloud/capabilities`, { headers: { ...OCS_HEADERS, Authorization: AUTH } }).then((r) => r.json());
	note('nextcloudVersion', caps.ocs.data.version.string);
	note('collectivesInCapabilities', 'collectives' in caps.ocs.data.capabilities);

	const existing = await ocs('GET', '/collectives');
	expect(existing.data.collectives.length === 0, 'test server must be fresh (run down.sh --reset)');

	// Collectives
	const c1 = (await ocs('POST', '/collectives', { name: 'Handbuch', emoji: '📘' }, { fixture: 'collective-create' })).data.collective;
	const c2 = (await ocs('POST', '/collectives', { name: 'Projekte' })).data.collective;
	await ocs('GET', '/collectives', undefined, { fixture: 'collectives-list' });

	// Pages and structure
	const landing = (await ocs('GET', `/collectives/${c1.id}/pages`, undefined, { fixture: 'pages-list-initial' })).data.pages[0];
	note('landingPage', { title: landing.title, fileName: landing.fileName, collectivePath: landing.collectivePath, parentId: landing.parentId });
	const onboarding = (await ocs('POST', `/collectives/${c1.id}/pages/${landing.id}`, { title: 'Onboarding' }, { fixture: 'page-create' })).data.page;
	const prozesse = (await ocs('POST', `/collectives/${c1.id}/pages/${landing.id}`, { title: 'Prozesse' })).data.page;
	await dav('PUT', `/${prozesse.collectivePath}/Prozesse.md`, { body: '# Prozesse\n\nInhalt.\n' });
	const urlaub = (await ocs('POST', `/collectives/${c1.id}/pages/${prozesse.id}`, { title: 'Urlaub' })).data.page;
	const prozesseAfter = (await ocs('GET', `/collectives/${c1.id}/pages/${prozesse.id}`, undefined, { fixture: 'page-get-after-leaf-to-parent' })).data.page;
	note('leafToParentKeepsFileId', prozesseAfter.id === prozesse.id && prozesseAfter.fileName === 'Readme.md');
	const special = (await ocs('POST', `/collectives/${c1.id}/pages/${landing.id}`, { title: 'A/B: Fragen? #1 [x]' }, { fixture: 'page-create-special-chars' })).data.page;
	note('serverSanitisedTitle', special.title);

	// WebDAV content + ETags
	const pagePath = `/${onboarding.collectivePath}/${onboarding.fileName}`;
	const get1 = await dav('GET', pagePath, { fixture: 'dav-get-empty-page' });
	const put1 = await dav('PUT', pagePath, { body: '# Onboarding\n\nv1\n', headers: { 'If-Match': get1.headers.etag }, fixture: 'dav-put-if-match-ok' });
	const put2 = await dav('PUT', pagePath, { body: 'stale', headers: { 'If-Match': get1.headers.etag }, fixture: 'dav-put-if-match-stale' });
	note('ifMatch', { ok: put1.status, stale: put2.status, putReturnsEtag: Boolean(put1.headers.etag) });
	const created = await dav('PUT', `/${onboarding.collectivePath}/Per WebDAV.md`, { body: 'neu', headers: { 'If-None-Match': '*' }, fixture: 'dav-put-new-file' });
	const pagesAfterDav = (await ocs('GET', `/collectives/${c1.id}/pages`)).data.pages;
	note('davCreatedFileBecomesPage', pagesAfterDav.some((p) => p.title === 'Per WebDAV'));
	note('ocFileIdHeaderFormat', created.headers['oc-fileid']);
	await dav('PROPFIND', `/${onboarding.collectivePath}`, {
		headers: { Depth: '1', 'Content-Type': 'application/xml' },
		body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><d:getetag/><d:getlastmodified/><d:getcontentlength/><oc:fileid/><d:resourcetype/></d:prop></d:propfind>',
		fixture: 'dav-propfind-depth1',
	});

	// Last editor: does a plain WebDAV PUT update lastUserId (i.e. is touch needed)?
	await ocs('GET', `/collectives/${c1.id}/pages/${onboarding.id}/touch`, undefined, { fixture: 'page-touch' });

	// Links: which formats does the server recognise (linkedPageIds)?
	const linkBody = [
		'# Links',
		'',
		`Relativ: [Urlaub](Prozesse/Urlaub.md?fileId=${urlaub.id})`,
		`Absolut: [Onboarding](${base}/index.php/apps/collectives/${c1.slug}-${c1.id}/${onboarding.slug}-${onboarding.id})`,
		`Root-relativ: [Prozesse](/index.php/apps/collectives/${c1.slug}-${c1.id}/${prozesse.slug}-${prozesse.id}#abschnitt)`,
		'Extern: [Nextcloud](https://nextcloud.com)',
		'',
		`![bild.png](.attachments.${onboarding.id}/bild.png)`,
		'',
	].join('\n');
	await dav('PUT', `/${landing.collectivePath}/Readme.md`, { body: linkBody });
	const landingAfter = (await ocs('GET', `/collectives/${c1.id}/pages/${landing.id}`, undefined, { fixture: 'page-get-with-links' })).data.page;
	note('linkedPageIds', { expected: [urlaub.id, onboarding.id, prozesse.id].sort(), actual: [...landingAfter.linkedPageIds].sort() });
	save('content-links.md', linkBody);

	// Tags and emoji
	await ocs('POST', `/collectives/${c1.id}/tags`, { name: 'Projekt' }, { fixture: 'tag-create-missing-color' });
	const tag = (await ocs('POST', `/collectives/${c1.id}/tags`, { name: 'Projekt', color: '0082c9' }, { fixture: 'tag-create' })).data.tag;
	await ocs('POST', `/collectives/${c1.id}/tags`, { name: 'Projekt', color: '0082c9' }, { fixture: 'tag-create-duplicate' });
	await ocs('POST', `/collectives/${c1.id}/tags`, { name: 'Rot', color: '#ff0000' }, { fixture: 'tag-create-hash-color' });
	await ocs('GET', `/collectives/${c1.id}/tags`, undefined, { fixture: 'tags-list' });
	await ocs('PUT', `/collectives/${c1.id}/pages/${urlaub.id}/tags/${tag.id}`, undefined, { fixture: 'page-tag-add' });
	await ocs('PUT', `/collectives/${c1.id}/pages/${urlaub.id}/emoji`, { emoji: '🏖️' }, { fixture: 'page-emoji-set' });
	await ocs('PUT', `/collectives/${c1.id}/pages/${onboarding.id}/emoji`, { emoji: null }, { fixture: 'page-emoji-remove' });

	// Attachments: WebDAV PUT vs. OCS multipart
	const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a9e20000000049454e44ae426082', 'hex');
	await dav('MKCOL', `/${onboarding.collectivePath}/.attachments.${onboarding.id}`);
	await dav('PUT', `/${onboarding.collectivePath}/.attachments.${onboarding.id}/bild.png`, { body: png });
	const form = new FormData();
	form.append('file', new Blob(['hallo'], { type: 'text/plain' }), 'notiz.txt');
	const mp = await fetch(`${OCS}/collectives/${c1.id}/pages/${urlaub.id}/attachments`, { method: 'POST', headers: { ...OCS_HEADERS, Authorization: AUTH }, body: form });
	const mpJson = await mp.json();
	save('attachment-upload-multipart.json', { status: mp.status, response: mpJson });
	const atts = await ocs('GET', `/collectives/${c1.id}/pages/${onboarding.id}/attachments`, undefined, { fixture: 'attachments-list' });
	note('davUploadedAttachmentListed', atts.data.attachments.some((a) => a.name === 'bild.png'));
	const uploaded = mpJson.ocs.data.attachment;
	const del = await ocs('DELETE', `/collectives/${c1.id}/pages/${urlaub.id}/attachments/${uploaded.id}`, undefined, { fixture: 'attachment-delete' });
	const left = (await ocs('GET', `/collectives/${c1.id}/pages/${urlaub.id}/attachments`)).data.attachments;
	note('attachmentDelete', { status: del.status, removed: !left.some((a) => a.id === uploaded.id) });

	// Leaf -> parent with attachment: does the attachment folder move along?
	await ocs('POST', `/collectives/${c1.id}/pages/${onboarding.id}`, { title: 'Erster Tag' });
	const attsAfter = await ocs('GET', `/collectives/${c1.id}/pages/${onboarding.id}/attachments`);
	note('attachmentsAfterLeafToParent', attsAfter.data.attachments.map((a) => a.internalPath));

	// Rename / move / cross-collective move
	await ocs('PUT', `/collectives/${c1.id}/pages/${special.id}`, { title: 'Umbenannt' }, { fixture: 'page-rename' });
	await ocs('PUT', `/collectives/${c1.id}/pages/${special.id}`, { parentId: prozesse.id }, { fixture: 'page-move' });
	await ocs('PUT', `/collectives/${c1.id}/pages/${urlaub.id}/to/${c2.id}`, {}, { fixture: 'page-move-to-collective' });
	const moved = (await ocs('GET', `/collectives/${c2.id}/pages/${urlaub.id}`)).data.page;
	note('crossCollectiveMove', { idKept: moved.id === urlaub.id, tagsKept: moved.tags.length > 0, emojiKept: moved.emoji === '🏖️' });

	// Trash + restore
	await ocs('DELETE', `/collectives/${c1.id}/pages/${prozesse.id}`, undefined, { fixture: 'page-trash' });
	await ocs('GET', `/collectives/${c1.id}/pages/trash`, undefined, { fixture: 'pages-trash-list' });
	await ocs('PATCH', `/collectives/${c1.id}/pages/trash/${prozesse.id}`, undefined, { fixture: 'page-restore' });
	const restoredIds = (await ocs('GET', `/collectives/${c1.id}/pages`, undefined, { fixture: 'pages-list-final' })).data.pages.map((p) => p.id);
	note('restoreParentRestoresChildren', restoredIds.includes(prozesse.id) && restoredIds.includes(special.id));

	// Collective rename (Circles API) and permissions
	const renamed = await fetch(`${base}/ocs/v2.php/apps/circles/circles/${c2.circleId}/name`, {
		method: 'PUT', headers: { ...OCS_HEADERS, Authorization: AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ value: 'Projekte Neu' }),
	});
	const afterRename = (await ocs('GET', '/collectives')).data.collectives.find((c) => c.id === c2.id);
	note('collectiveRenameViaCircles', { status: renamed.status, name: afterRename.name, slug: afterRename.slug });
	const adminCol = (await ocs('POST', '/collectives', { name: 'Admins Wiki' }, { auth: ADMIN_AUTH })).data.collective;
	await fetch(`${base}/ocs/v2.php/apps/circles/circles/${adminCol.circleId}/members`, {
		method: 'POST', headers: { ...OCS_HEADERS, Authorization: ADMIN_AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: user, type: 1 }),
	});
	const memberDelete = await ocs('DELETE', `/collectives/${adminCol.id}`, undefined, { fixture: 'collective-trash-as-member' });
	const ownerDelete = await ocs('DELETE', `/collectives/${c2.id}`, undefined, { fixture: 'collective-trash' });
	await ocs('GET', '/collectives/trash', undefined, { fixture: 'collectives-trash-list' });
	await ocs('PATCH', `/collectives/trash/${c2.id}`);
	note('collectiveTrash', { member: memberDelete.status, admin: ownerDelete.status });

	save('findings.json', findings);
	console.log(`\nFixtures geschrieben nach ${outDir}`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
