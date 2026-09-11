/**
 * One-time interactive login into a Chrome profile the scraper reuses across runs.
 *
 * Opens a visible browser on the sign-in page and waits for the session to appear, then prints
 * copy-paste ready commands for reusing it. The password is typed by the person running the
 * command, into the browser: nothing here reads, stores or transmits it.
 */
import { ISessionCredentials, ensureSession } from "../../scraper/auth";
import { CliConfig } from "../cli-config";
import { Colorizer, colorEnabled } from "../color";

const LOGIN_TIMEOUT_SECONDS = 600;

/** POSIX single-quote a value so it survives being pasted into a shell. */
const shellQuote = (value: string): string => {
    if (value === "") {
        return "''";
    }
    if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) {
        return value;
    }
    return "'" + value.replace(/'/g, "'\"'\"'") + "'";
};

const printLine = (text = ""): void => {
    process.stdout.write(text + "\n");
};

/** Print copy-paste ready commands for reusing the session a fresh sign-in produced. */
const printCredentials = (
    chromeUserDataDir: string,
    credentials: ISessionCredentials,
    colorizer: Colorizer,
): void => {
    const { green, yellow, dim, cyan, orange } = colorizer;
    const profile = shellQuote(chromeUserDataDir);

    printLine();
    printLine(green("✅ Signed in. The profile now carries the session."));

    printLine();
    printLine(dim("# Search jobs"));
    printLine(
        `${cyan("lijs")} ${orange("jobs")} "Software Engineer" --location "Worldwide" --limit 5 \\`,
    );
    printLine(`  --chrome-user-data-dir ${profile}`);

    printLine();
    printLine(dim("# Look up a single job"));
    printLine(`${cyan("lijs")} ${orange("job")} 123456789 --chrome-user-data-dir ${profile}`);

    if (credentials.liRm && credentials.bcookie) {
        // The remember-me pair is the remote-friendly path: LinkedIn issues a fresh session for
        // it, so a host with no display never has to be handed a session cookie that will be
        // retired. The values are single-quoted so they copy cleanly and are left uncoloured.
        printLine();
        printLine(
            dim(
                "# Instead of --chrome-user-data-dir, you can export these environment variables:",
            ),
        );
        printLine(`${cyan("LI_RM_COOKIE")}${orange("=")}'${credentials.liRm}'`);
        printLine(`${cyan("LI_BCOOKIE")}${orange("=")}'${credentials.bcookie}'`);
    } else {
        printLine();
        printLine(
            yellow(
                'No remember me cookie was issued, so this session cannot renew itself: ' +
                    'sign in again with "Keep me logged in" ticked.',
            ),
        );
    }
};

/** Run the login subcommand, returning the process exit code. */
export const runLogin = async (config: CliConfig): Promise<number> => {
    const colorizer = new Colorizer(colorEnabled(config.noColor, process.stdout));
    const userDataDir = config.chromeUserDataDir ?? "";

    printLine(`Chrome profile: ${userDataDir}`);
    printLine(
        colorizer.dim('A browser window will open. Sign in there, ticking "Keep me logged in".'),
    );
    printLine(
        colorizer.dim(
            `Waiting up to ${LOGIN_TIMEOUT_SECONDS}s for the session to be established...`,
        ),
    );

    let credentials: ISessionCredentials | null = null;
    try {
        credentials = await ensureSession(userDataDir, { timeoutMs: LOGIN_TIMEOUT_SECONDS * 1000 });
    } catch (err) {
        credentials = null;
        console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    }

    if (!credentials || !credentials.liAt) {
        printLine(
            "❌ " +
                colorizer.red(
                    "No session was established. The profile is unchanged. " +
                        "If a detail was printed above, that is the underlying error; " +
                        "otherwise the login timed out.",
                ),
        );
        return 1;
    }

    printCredentials(userDataDir, credentials, colorizer);
    return 0;
};
