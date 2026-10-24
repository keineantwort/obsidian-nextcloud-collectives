// Bundle options shared by esbuild.config.mjs and the bundle test (tests/unit/bundle.test.ts).
/** @type {import('esbuild').BuildOptions} */
export const bundleOptions = {
	bundle: true,
	format: 'cjs',
	target: 'es2021',
	treeShaking: true,
	// Error classes take their name from the class (src/util/errors.ts), and the log shows that name: minifying must not
	// rename them, or the log reads "error=Q".
	keepNames: true,
};
