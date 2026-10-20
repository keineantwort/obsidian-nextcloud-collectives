import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { HttpRequest, HttpResponse, RequestFn } from '../../src/api/http';

export interface TestServerEnv {
	baseUrl: string;
	user: string;
	password: string;
	/** NC_VERSION of the server image: a major version ('35') or a tag such as 'latest'. Empty if unknown. */
	ncVersion: string;
}

const ENV_PATH = fileURLToPath(new URL('../../scripts/dev-nextcloud/.env', import.meta.url));
const NOT_CONFIGURED = 'Testserver nicht konfiguriert: npm run nc:up ausführen';

/** Parses KEY=VALUE lines; ignores blank lines and lines starting with '#'. */
function parseEnvFile(content: string): Record<string, string> {
	const vars: Record<string, string> = {};
	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line === '' || line.startsWith('#')) continue;
		const eq = line.indexOf('=');
		if (eq <= 0) continue;
		vars[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
	}
	return vars;
}

/**
 * Reads the throwaway test-server credentials from scripts/dev-nextcloud/.env at runtime. The same variables in the
 * process environment win, so a second server (another NC_PORT, e.g. in CI per Nextcloud version) needs no .env edit.
 */
export function loadTestServerEnv(): TestServerEnv {
	const vars = existsSync(ENV_PATH) ? parseEnvFile(readFileSync(ENV_PATH, 'utf8')) : {};
	const pick = (name: string): string | undefined => {
		const fromProcess = process.env[name];
		return fromProcess !== undefined && fromProcess !== '' ? fromProcess : vars[name];
	};
	const port = pick('NC_PORT');
	const user = pick('NC_TEST_USER');
	const password = pick('NC_TEST_PASSWORD');
	if (!port || !user || !password) throw new Error(NOT_CONFIGURED);
	return { baseUrl: 'http://localhost:' + port, user, password, ncVersion: pick('NC_VERSION') ?? '' };
}

/** Test-only RequestFn backed by Node's global fetch. Resolves for every HTTP status; fetch rejections propagate. */
export const fetchRequest: RequestFn = async (req: HttpRequest): Promise<HttpResponse> => {
	const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
	const headers: Record<string, string> = {};
	res.headers.forEach((value, key) => {
		headers[key] = value;
	});
	if (req.binaryResponse) return { status: res.status, headers, text: '', data: await res.arrayBuffer() };
	return { status: res.status, headers, text: await res.text() };
};
