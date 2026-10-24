import { describe, expect, it } from 'vitest';
import { extractErrorDetail, MAX_DETAIL_LENGTH } from '../../src/api/errorDetail';

const PASSWORD = 'pw-SECRET-123';
const USERNAME = 'alice';
const SECRETS = [PASSWORD, USERNAME];

const SABRE_PRECONDITION = `<?xml version="1.0" encoding="utf-8"?>
<d:error xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns">
  <s:exception>Sabre\\DAV\\Exception\\PreconditionFailed</s:exception>
  <s:message>An If-Match header was specified, but none of the specified ETags matched.</s:message>
  <s:header>If-Match</s:header>
</d:error>`;

function ocsBody(message: unknown): string {
	return JSON.stringify({ ocs: { meta: { status: 'failure', statuscode: 400, message }, data: [] } });
}

describe('extractErrorDetail: OCS bodies', () => {
	it('returns the message at ocs.meta.message', () => {
		const text = JSON.stringify({
			ocs: { meta: { status: 'failure', statuscode: 400, message: 'Tag already exists for collective: Projekt' }, data: [] },
		});

		expect(extractErrorDetail(text, SECRETS)).toBe('Tag already exists for collective: Projekt');
	});

	it('returns undefined when ocs.meta has no message', () => {
		const text = JSON.stringify({ ocs: { meta: { status: 'failure', statuscode: 500 }, data: [] } });

		expect(extractErrorDetail(text, SECRETS)).toBeUndefined();
	});

	it('returns undefined when ocs.meta.message is empty', () => {
		expect(extractErrorDetail(ocsBody(''), SECRETS)).toBeUndefined();
	});

	it('returns undefined when ocs.meta.message is not a string', () => {
		expect(extractErrorDetail(ocsBody(42), SECRETS)).toBeUndefined();
	});
});

describe('extractErrorDetail: WebDAV (Sabre) error bodies', () => {
	it('returns exception and message joined by ": "', () => {
		expect(extractErrorDetail(SABRE_PRECONDITION, SECRETS)).toBe(
			'Sabre\\DAV\\Exception\\PreconditionFailed: An If-Match header was specified, but none of the specified ETags matched.',
		);
	});

	it('returns only the exception when the message is missing', () => {
		const text = `<d:error xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns"><s:exception>Sabre\\DAV\\Exception\\NotFound</s:exception></d:error>`;

		expect(extractErrorDetail(text, SECRETS)).toBe('Sabre\\DAV\\Exception\\NotFound');
	});

	it('returns only the message when the exception is missing', () => {
		const text = `<d:error xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns"><s:message>Something went wrong</s:message></d:error>`;

		expect(extractErrorDetail(text, SECRETS)).toBe('Something went wrong');
	});

	it('returns undefined when neither exception nor message is present', () => {
		const text = `<d:error xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns"><s:header>If-Match</s:header></d:error>`;

		expect(extractErrorDetail(text, SECRETS)).toBeUndefined();
	});

	it('finds the elements by namespace, not by prefix', () => {
		const text = `<D:error xmlns:D="DAV:" xmlns:x="http://sabredav.org/ns">
  <x:exception>Sabre\\DAV\\Exception\\MethodNotAllowed</x:exception>
  <x:message>The resource you tried to create already exists</x:message>
</D:error>`;

		expect(extractErrorDetail(text, SECRETS)).toBe(
			'Sabre\\DAV\\Exception\\MethodNotAllowed: The resource you tried to create already exists',
		);
	});

	it('returns undefined for an XML document whose root is not DAV:error', () => {
		const text = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:"><d:response><d:status>HTTP/1.1 200 OK</d:status></d:response></d:multistatus>`;

		expect(extractErrorDetail(text, SECRETS)).toBeUndefined();
	});
});

describe('extractErrorDetail: bodies without a server reason', () => {
	it('returns undefined for an HTML error page', () => {
		expect(extractErrorDetail('<html><body>Internal Server Error</body></html>', SECRETS)).toBeUndefined();
	});

	it('returns undefined for plain text', () => {
		expect(extractErrorDetail('Internal Server Error', SECRETS)).toBeUndefined();
	});

	it('returns undefined for an empty string', () => {
		expect(extractErrorDetail('', SECRETS)).toBeUndefined();
	});

	it('returns undefined for JSON without an OCS message', () => {
		expect(extractErrorDetail(JSON.stringify({ error: 'boom' }), SECRETS)).toBeUndefined();
	});

	it('returns undefined for malformed JSON without throwing', () => {
		expect(() => extractErrorDetail('{"ocs":{"meta":', SECRETS)).not.toThrow();
		expect(extractErrorDetail('{"ocs":{"meta":', SECRETS)).toBeUndefined();
	});

	it('returns undefined for malformed XML without throwing', () => {
		const text = '<d:error xmlns:d="DAV:"><s:exception>Sabre';

		expect(() => extractErrorDetail(text, SECRETS)).not.toThrow();
		expect(extractErrorDetail(text, SECRETS)).toBeUndefined();
	});
});

describe('extractErrorDetail: cleanup', () => {
	it('collapses newlines and runs of spaces into one space and trims the result', () => {
		expect(extractErrorDetail(ocsBody('\n  Tag\n\n   already    exists \n'), SECRETS)).toBe('Tag already exists');
	});

	it('replaces the password and the username with ***', () => {
		const text = ocsBody(`Login for alice failed with ${PASSWORD} and ${PASSWORD}`);

		const detail = extractErrorDetail(text, SECRETS);

		expect(detail).toBe('Login for *** failed with *** and ***');
		expect(detail).not.toContain(PASSWORD);
		expect(detail).not.toContain(USERNAME);
	});

	it('ignores a secret shorter than three characters', () => {
		expect(extractErrorDetail(ocsBody('ab cab'), ['ab'])).toBe('ab cab');
	});

	it('cuts a message longer than MAX_DETAIL_LENGTH to exactly that length, ending with an ellipsis', () => {
		const detail = extractErrorDetail(ocsBody('a'.repeat(300)), SECRETS);

		expect(MAX_DETAIL_LENGTH).toBe(200);
		expect(detail).toHaveLength(MAX_DETAIL_LENGTH);
		expect(detail).toBe('a'.repeat(MAX_DETAIL_LENGTH - 1) + '…');
	});

	it('keeps a message of exactly MAX_DETAIL_LENGTH characters unchanged', () => {
		const message = 'b'.repeat(MAX_DETAIL_LENGTH);

		expect(extractErrorDetail(ocsBody(message), SECRETS)).toBe(message);
	});
});
