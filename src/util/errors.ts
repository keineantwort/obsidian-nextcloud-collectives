/** Options for NcError and its subclasses. */
export interface NcErrorOptions {
	cause?: unknown;
	/** The server's own reason, cleaned by extractErrorDetail (ADR 0028). */
	detail?: string;
}

/** Base class for all plugin errors. */
export class NcError extends Error {
	// ES2021 lib has no `cause` on Error; declare it here.
	declare cause?: unknown;
	/** The server's own reason (extractErrorDetail, ADR 0028); only set for errors built from an HTTP response. */
	declare readonly detail?: string;

	constructor(message: string, options?: NcErrorOptions) {
		super(message);
		this.name = new.target.name;
		if (options && 'cause' in options) this.cause = options.cause;
		if (options?.detail !== undefined) this.detail = options.detail;
	}
}
/** 401: credentials rejected. */
export class AuthError extends NcError { constructor(readonly status: number, message = `Authentication failed (HTTP ${status})`, options?: NcErrorOptions) { super(message, options); } }
/** 403: authenticated, but not allowed to access this resource (e.g. deleting a collective as a plain member). */
export class ForbiddenError extends NcError { constructor(message = 'Access denied (HTTP 403)', options?: NcErrorOptions) { super(message, options); } }
/** 404: endpoint or resource not found. */
export class NotFoundError extends NcError {}
/** 412: precondition failed (ETag mismatch). */
export class ConflictError extends NcError {}
/** Request did not reach the server or timed out. */
export class NetworkError extends NcError {}
/** 5xx or other unexpected non-2xx status. */
export class ServerError extends NcError { constructor(readonly status: number, message = `Server error (HTTP ${status})`, options?: NcErrorOptions) { super(message, options); } }
/** Response structure does not match the expected API shape. */
export class ApiChangedError extends NcError {}
/** Invalid or missing user configuration. */
export type ConfigField = 'serverUrl' | 'username' | 'appPassword';
export type ConfigProblem = 'missing' | 'invalid';
export class ConfigError extends NcError {
	constructor(readonly field: ConfigField, readonly problem: ConfigProblem) { super(`Config ${field} is ${problem}`); }
}

/** Errors that end the whole run: the connection or the server contract is broken, so no partial result is trusted. */
export function isRunFatal(err: unknown): boolean {
	return err instanceof AuthError || err instanceof ApiChangedError || err instanceof NetworkError;
}

/** Log fields for a caught error: the class name and, for an NcError, the server's detail. Never the message (may contain URLs). */
export function errorLogFields(err: unknown): { error: string; detail?: string } {
	if (!(err instanceof Error)) return { error: 'unknown' };
	if (err instanceof NcError && err.detail !== undefined) return { error: err.name, detail: err.detail };
	return { error: err.name };
}
