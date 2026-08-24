/**
 * Map the run outcomes onto an exit code.
 *
 * Precedence is not monotonic: a refused session (2) outranks a missing job (3), which outranks
 * any other error (1). A clean run is 0.
 * @param {boolean} raisedInvalidCookie
 * @param {boolean} invalidSession
 * @param {boolean} notFound
 * @param {boolean} raisedOther
 * @returns {number}
 */
export const computeExitCode = (
    raisedInvalidCookie: boolean,
    invalidSession: boolean,
    notFound: boolean,
    raisedOther: boolean,
): number => {
    if (raisedInvalidCookie || invalidSession) {
        return 2;
    }
    if (notFound) {
        return 3;
    }
    if (raisedOther) {
        return 1;
    }
    return 0;
};
