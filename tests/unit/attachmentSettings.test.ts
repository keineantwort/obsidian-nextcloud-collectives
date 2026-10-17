import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, isAttachmentFolderPattern, isMaxAttachmentSizeMb } from '../../src/settings/types';

describe('attachment settings', () => {
	it('has the defaults of PLAN §10.2', () => {
		expect(DEFAULT_SETTINGS.attachmentFolderPattern).toBe('_attachments/{title}');
		expect(DEFAULT_SETTINGS.maxAttachmentSizeMb).toBe(20);
		expect(DEFAULT_SETTINGS.deleteRemoteAttachments).toBe(true);
	});

	it.each(['_attachments/{title}', 'Anhänge', 'files/{title}/', '/a/b'])('accepts the folder pattern %j', (pattern) => {
		expect(isAttachmentFolderPattern(pattern)).toBe(true);
	});

	it.each(['', '  ', '../x', 'a/../b', '.hidden/{title}', 'a//b', 'a:b', 'a#b', 'a|b', 'a\\b', 42, null])('rejects the folder pattern %j', (pattern) => {
		expect(isAttachmentFolderPattern(pattern)).toBe(false);
	});

	it.each([1, 20, 1000])('accepts the size %j', (size) => {
		expect(isMaxAttachmentSizeMb(size)).toBe(true);
	});

	it.each([0, -1, 1001, 2.5, NaN, '20', null])('rejects the size %j', (size) => {
		expect(isMaxAttachmentSizeMb(size)).toBe(false);
	});
});
