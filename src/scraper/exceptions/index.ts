/**
 * Raised when LinkedIn refuses every session available and none can be reissued.
 * Emitted alongside the invalidSession event, it aborts the run rather than continuing
 * with a session that will never render results.
 */
export class InvalidCookieException extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InvalidCookieException";
        Object.setPrototypeOf(this, InvalidCookieException.prototype);
    }
}

/**
 * Wraps an error thrown inside a user event callback, so it propagates out of the run
 * as an identifiable failure instead of corrupting it.
 */
export class CallbackException extends Error {
    constructor(message: string) {
        super(message);
        this.name = "CallbackException";
        Object.setPrototypeOf(this, CallbackException.prototype);
    }
}
