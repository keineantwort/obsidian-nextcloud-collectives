// M8: the planner asks for the attachment step of idle pages that have attachments in the state.
import { describe, expect, it } from 'vitest';
import { asAttachmentId } from '../../src/api/types';
import { baseState, opsOf, planFor } from '../fakes/plannerFixtures';

const ATTACHMENT = { id: asAttachmentId(5), name: 'bild.png', etag: '"a"', localPath: 'Coll/_attachments/Seite/bild.png', hash: 'h' };

describe('planSync: attachments', () => {
	it('plans nothing for a page without attachments in the state', () => {
		expect(planFor().ops).toEqual([]);
	});

	it('plans the attachment step for an unchanged page with attachments, so server changes are noticed', () => {
		const state = baseState();
		state.pages['10'] = { ...state.pages['10']!, attachments: [ATTACHMENT] };

		const plan = planFor({ state });

		expect(plan.ops).toEqual([expect.objectContaining({ kind: 'attachments', path: 'Coll/Seite.md' })]);
	});

	it('does not add the step to an update or a push: the executor runs it after the content step', () => {
		const state = baseState();
		state.pages['10'] = { ...state.pages['10']!, attachments: [ATTACHMENT], localMtime: -1 };

		const plan = planFor({ state });

		expect(opsOf(plan, 'attachments')).toEqual([]);
		expect(opsOf(plan, 'push')).toHaveLength(1);
	});

	it('plans the step after updateMeta, at the same path', () => {
		const state = baseState();
		state.pages['10'] = { ...state.pages['10']!, attachments: [ATTACHMENT], metaHash: 'alt' };

		const plan = planFor({ state });

		expect(plan.ops.map((op) => op.kind)).toEqual(['updateMeta', 'attachments']);
	});

	it('leaves the attachments of a collision page alone', () => {
		const state = baseState();
		state.pages['10'] = { ...state.pages['10']!, attachments: [ATTACHMENT], status: 'collision' };

		expect(opsOf(planFor({ state }), 'attachments')).toEqual([]);
	});
});
