import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stdin, stdout, stderr } from 'node:process';
import { PDFDocument } from 'pdf-lib';
import { addFooterLabel } from './pdf-footer.mjs';
import {
    autoScrollReader,
    openReader,
    readerDomSummary,
    readerSessionIsValid,
    scraperDirectory,
    safeFileStem,
    isBrowserProfileBusyError,
} from './playwright-browser.mjs';

console.log = (...values) => stderr.write(`${values.join(' ')}\n`);

function failure(error) {
    return { success: false, error };
}

function classifyError(error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'URL_NOT_ALLOWED') return 'URL_NOT_ALLOWED';
    if (isBrowserProfileBusyError(message)) {
        return 'BROWSER_BUSY';
    }
    if (/timeout|timed out/i.test(message)) return 'TIMEOUT';
    if (/net::ERR_(?:NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|CONNECTION_TIMED_OUT|CONNECTION_RESET|ADDRESS_UNREACHABLE|NETWORK_CHANGED)/i.test(message)) {
        return 'NETWORK_ERROR';
    }
    return 'BROWSER_UNAVAILABLE';
}

async function getThumbnail(page) {
    const canvas = page.locator('canvas[id^="page-canvas-"]').first();
    if (await canvas.count() === 0) return null;

    try {
        const screenshot = await canvas.screenshot({
            type: 'jpeg',
            quality: 55,
            scale: 'css',
            timeout: 10000,
        });
        if (screenshot.byteLength > 1024 * 1024) return null;
        return `data:image/jpeg;base64,${screenshot.toString('base64')}`;
    } catch {
        return null;
    }
}

async function runPreview(input) {
    const session = await openReader(input.url, input.allowed_host, input.edge_executable);

    try {
        const { page, navigationStatus, waitForReaderPdf, wasExternalNavigationBlocked } = session;
        if (navigationStatus === 404) return failure('READER_NOT_FOUND');
        if (!await readerSessionIsValid(page, wasExternalNavigationBlocked(), input.allowed_host)) {
            return failure('AUTH_REQUIRED');
        }

        await waitForReaderPdf();
        await page.waitForTimeout(500);
        const summary = await readerDomSummary(page);
        if (summary.slideCount < 1) return failure('SLIDES_NOT_FOUND');

        const thumbnail = await getThumbnail(page);
        return {
            success: true,
            url: page.url(),
            title: await page.title(),
            slides_count: summary.slideCount,
            slides: thumbnail ? [{ number: 1, thumbnail }] : [],
        };
    } finally {
        await session.context.close();
    }
}

async function runDownload(input) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.download_id ?? '')) {
        return failure('DOWNLOAD_FAILED');
    }

    const session = await openReader(input.url, input.allowed_host, input.edge_executable);

    try {
        const { page, navigationStatus, waitForReaderPdf, wasExternalNavigationBlocked } = session;
        if (navigationStatus === 404) return failure('READER_NOT_FOUND');
        if (!await readerSessionIsValid(page, wasExternalNavigationBlocked(), input.allowed_host)) {
            return failure('AUTH_REQUIRED');
        }

        let resource = await waitForReaderPdf();
        if (!resource) {
            await autoScrollReader(page);
            resource = Array.from(session.responses.values()).find((item) =>
                item.extension === 'pdf'
                && item.status >= 200
                && item.status < 300
            ) ?? null;
        }
        if (!resource || resource.extension !== 'pdf' || !resource.bodyPromise) {
            return failure('SLIDES_NOT_FOUND');
        }

        const capturedBody = await resource.bodyPromise;
        if ('error' in capturedBody) return failure('DOWNLOAD_FAILED');

        const source = capturedBody.body;
        if (source.subarray(0, 5).toString('ascii') !== '%PDF-') {
            return failure('DOWNLOAD_FAILED');
        }

        const pdfInfo = await PDFDocument.load(source);
        const pageCount = pdfInfo.getPageCount();
        const labeledPdf = await addFooterLabel(source, 'banksoalut2026');
        const outputPath = path.join(scraperDirectory, `${input.download_id}.pdf`);
        await mkdir(scraperDirectory, { recursive: true });
        await writeFile(outputPath, labeledPdf.bytes, { flag: 'wx' });

        return {
            success: true,
            path: outputPath,
            filename: `${safeFileStem(await page.title())}.pdf`,
            slides_count: pageCount,
        };
    } finally {
        await session.context.close();
    }
}

async function main() {
    let input;
    try {
        const rawInput = await new Promise((resolve, reject) => {
            let data = '';
            stdin.setEncoding('utf8');
            stdin.on('data', (chunk) => {
                data += chunk;
                if (data.length > 8192) reject(new Error('Input is too large.'));
            });
            stdin.on('end', () => resolve(data));
            stdin.on('error', reject);
        });
        input = JSON.parse(rawInput);
    } catch {
        return failure('INVALID_URL');
    }

    try {
        if (!input || typeof input.url !== 'string' || typeof input.allowed_host !== 'string') {
            return failure('INVALID_URL');
        }

        const mode = input.mode;
        if (mode === 'preview') return await runPreview(input);
        if (mode === 'download') return await runDownload(input);
        return failure('READER_UNAVAILABLE');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[error] Browser automation failed: ${message}`);
        return failure(classifyError(error));
    }
}

const result = await main();
stdout.write(`${JSON.stringify(result)}\n`);
