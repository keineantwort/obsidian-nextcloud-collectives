import { Notice } from 'obsidian';
import type { SyncNoticeSpec } from './syncNotices';

/** Shows a notice; one block per line. 'info' uses Obsidian's default duration, everything else stays until dismissed. */
export function showSyncNotice(spec: SyncNoticeSpec): Notice {
	const fragment = createFragment((f) => {
		for (const line of spec.lines) f.createDiv({ text: line });
	});
	return new Notice(fragment, spec.level === 'info' ? undefined : 0);
}
