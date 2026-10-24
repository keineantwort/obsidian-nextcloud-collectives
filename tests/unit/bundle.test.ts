import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { bundleOptions } from '../../esbuild.options.mjs';

interface BundledErrors {
	NcError: new (message: string) => Error;
	ServerError: new (status: number) => Error;
	NotFoundError: new (message: string) => Error;
	errorLogFields: (err: unknown) => { error: string };
}

/** Bundles src/util/errors.ts minified with the plugin's options, as `npm run build` does, and loads the result. */
async function minifiedErrors(): Promise<BundledErrors> {
	const result = await build({ ...bundleOptions, entryPoints: ['src/util/errors.ts'], minify: true, write: false });
	const sandbox = { module: { exports: {} as unknown } };
	runInNewContext(result.outputFiles[0]?.text ?? '', sandbox);
	return sandbox.module.exports as BundledErrors;
}

describe('production bundle', () => {
	it('keeps the error class names, so the log shows error=ServerError and not a minified name', async () => {
		const errors = await minifiedErrors();

		expect(new errors.ServerError(500).name).toBe('ServerError');
		expect(new errors.NotFoundError('x').name).toBe('NotFoundError');
		expect(errors.errorLogFields(new errors.ServerError(503))).toEqual({ error: 'ServerError' });
	});
});
