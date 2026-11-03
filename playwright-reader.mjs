import {
    openReader,
    readerDomSummary,
    readerSessionIsValid,
    waitForUser,
} from './playwright-browser.mjs';

const [readerUrl, allowedHost] = process.argv.slice(2);
if (!readerUrl || !allowedHost) {
    console.error('Usage: php playwright-reader.php <reader-url> <allowed-host>');
    process.exit(1);
}

const session = await openReader(readerUrl, allowedHost);
let exitCode = 0;

try {
    const { page, wasExternalNavigationBlocked } = session;
    if (!await readerSessionIsValid(page, wasExternalNavigationBlocked(), allowedHost)) {
        console.error('[expired] The dedicated Edge profile cannot access the reader. Close Edge and run: php playwright-login.php');
        exitCode = 2;
    } else {
        console.log('[success] The dedicated Edge profile can access the reader.');
        console.log(`[page] Title: ${await page.title()}`);
        console.log(`[page] URL: ${page.url()}`);
        await waitForUser('[debug] Scroll or advance through accessible slides normally, then press ENTER here.\n');

        const summary = await readerDomSummary(page);
        console.log(`[debug] Detected slide count: ${summary.slideCount}`);
        console.log('[debug] Reader DOM and resource element summary (URLs omit query strings):');
        console.log(JSON.stringify(summary, null, 2));
    }
} finally {
    await session.context.close();
}

process.exitCode = exitCode;
