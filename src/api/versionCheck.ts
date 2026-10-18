import { isRecord } from '../util/isRecord';
import type { OcsClient } from './ocsClient';

export const OCS_CAPABILITIES = '/ocs/v2.php/cloud/capabilities';

/** Nextcloud major versions the plugin was tested against (PLAN §15 no. 6: Nextcloud 33, Collectives 4.7). */
export const TESTED_NEXTCLOUD_MAJORS: readonly number[] = [33];

export interface ServerVersion { major: number; minor: number; micro: number; string: string; }
/** tested = a version from the list; untested = any other version (older or newer). */
export type VersionStatus = 'tested' | 'untested';

/** Reads `version` from the data of the capabilities endpoint; null if it is missing or malformed. */
export function parseServerVersion(data: unknown): ServerVersion | null {
	if (!isRecord(data)) return null;
	const v = data['version'];
	if (!isRecord(v)) return null;
	const { major, minor, micro } = v;
	if (typeof major !== 'number' || typeof minor !== 'number' || typeof micro !== 'number') return null;
	if (![major, minor, micro].every((n) => Number.isInteger(n) && n >= 0)) return null;
	const text = typeof v['string'] === 'string' && v['string'] !== '' ? v['string'] : `${major}.${minor}.${micro}`;
	return { major, minor, micro, string: text };
}

export function versionStatus(version: ServerVersion): VersionStatus {
	return TESTED_NEXTCLOUD_MAJORS.includes(version.major) ? 'tested' : 'untested';
}

/** Asks the server for its Nextcloud version. Rejects like any OCS call; resolves null if the answer has no usable version. */
export async function fetchServerVersion(ocs: OcsClient): Promise<ServerVersion | null> {
	return parseServerVersion(await ocs.request('GET', OCS_CAPABILITIES));
}
