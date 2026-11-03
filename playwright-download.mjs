import { readdir, mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { addFooterLabel } from './pdf-footer.mjs';
import {
    fileUrl,
    autoScrollReader,
    openReader,
    printableUrlForPath,
    readerDomSummary,
    readerResourceUrls,
    readerSessionIsValid,
    safeFileStem,
    safeUrl,
    slidesDirectory,
} from './playwright-browser.mjs';

const maximumResourceBytes = 30 * 1024 * 1024;
const maximumTotalBytes = 300 * 1024 * 1024;
const maximumSelectionCount = 100;
const [readerUrl, allowedHost] = process.argv.slice(2);
if (!readerUrl || !allowedHost) {
    console.error('Usage: php playwright-download.php <reader-url> <allowed-host>');
    process.exit(1);
}
await mkdir(slidesDirectory, { recursive: true });
console.log(`[output] Slide files will be saved to: ${slidesDirectory}`);
const session = await openReader(readerUrl, allowedHost);

try {
    const { context, page, responses, waitForReaderPdf, wasExternalNavigationBlocked } = session;
    if (!await readerSessionIsValid(page, wasExternalNavigationBlocked(), allowedHost)) {
        console.error('[expired] The dedicated Edge profile cannot access the reader. Close Edge and run: php playwright-login.php');
        process.exitCode = 2;
    } else {
        const title = await page.title();
        const fileStem = safeFileStem(title);
        console.log(`[page] Title: ${title}`);
        console.log(`[page] URL: ${page.url()}`);
        console.log(`[output] Files will use this page title: ${fileStem}`);
        const capturedReaderPdf = await waitForReaderPdf();
        const loadedReaderPdf = capturedReaderPdf
            && capturedReaderPdf.status >= 200
            && capturedReaderPdf.status < 300
            ? capturedReaderPdf
            : null;
        const observedSlideUrls = new Set(
            loadedReaderPdf === undefined ? await autoScrollReader(page) : []
        );
        if (loadedReaderPdf !== undefined) {
            console.log('[info] The reader has already loaded its PDF document; using that browser-delivered resource instead of the site logo.');
        }

        const summary = await readerDomSummary(page);
        console.log(`[debug] Detected slide count: ${summary.slideCount}`);
        console.log('[debug] Reader DOM/resource summary (URLs omit query strings):');
        console.log(JSON.stringify(summary, null, 2));

        const visibleResourceUrls = new Set([
            ...observedSlideUrls,
            ...await readerResourceUrls(page),
        ]);
        const pdfResources = Array.from(responses.values()).filter((resource) =>
            resource.extension === 'pdf'
        );
        const resources = pdfResources.length > 0
            ? pdfResources
            : Array.from(responses.entries())
                .filter(([url, resource]) =>
                    resource.extension !== 'pdf'
                    && visibleResourceUrls.has(url)
                )
                .map(([, resource]) => resource);

        if (resources.length === 0) {
            console.log('[info] No slide image/PDF resource was detected. The reader may render slides on canvas without a browser-delivered PDF.');
        } else {
            console.log(`[download] Automatically saving ${resources.length} slide image/PDF resource(s) received by the reader.`);
            const existingNames = await readdir(slidesDirectory);
            let nextSlideNumber = existingNames.reduce((highest, name) => {
                const match = /^slide-(\d+)\./i.exec(name);
                return match ? Math.max(highest, Number.parseInt(match[1], 10)) : highest;
            }, 0) + 1;
            const savedImages = [];
            let savedPdf = null;
            let savedCount = 0;
            let totalBytes = 0;

            for (const [index, resource] of resources.slice(0, maximumSelectionCount).entries()) {
                if (resource.status < 200 || resource.status >= 300) {
                    console.log(`[skip] HTTP ${resource.status} resource ${index + 1} was not saved.`);
                    continue;
                }

                const statedSize = Number.parseInt(resource.contentLength, 10);
                if (Number.isFinite(statedSize) && statedSize > maximumResourceBytes) {
                    console.log(`[skip] Resource ${index + 1} exceeds the 30 MiB per-file limit.`);
                    continue;
                }

                let body;
                if (resource.extension === 'pdf' && resource.bodyPromise) {
                    const capturedBody = await resource.bodyPromise;
                    if ('error' in capturedBody) {
                        throw new Error(
                            'Could not save the PDF response before the reader navigated away. '
                            + 'Please rerun the downloader and do not close or navigate the Edge window.',
                            { cause: capturedBody.error },
                        );
                    }
                    body = capturedBody.body;
                } else {
                    body = await resource.response.body();
                }
                if (resource.extension === 'pdf') {
                    if (body.subarray(0, 5).toString('ascii') !== '%PDF-') {
                        throw new Error('The reader returned application/pdf, but the response is not a valid PDF file.');
                    }

                    const labeledPdf = await addFooterLabel(body, 'banksoalut2026');
                    body = Buffer.from(labeledPdf.bytes);
                    console.log(`[pdf] Added the banksoalut2026 footer to ${labeledPdf.pageCount} page(s); original page content and attribution are retained.`);
                }
                if (body.byteLength > maximumResourceBytes) {
                    console.log(`[skip] Resource ${index + 1} exceeds the 30 MiB per-file limit.`);
                    continue;
                }
                if (totalBytes + body.byteLength > maximumTotalBytes) {
                    console.log('[skip] The 300 MiB total download limit has been reached.');
                    break;
                }

                const slideBaseName = resource.extension === 'pdf'
                    ? fileStem
                    : `${fileStem} - slide-${String(nextSlideNumber).padStart(3, '0')}`;
                let fileName = `${slideBaseName}.${resource.extension}`;
                let duplicate = 2;
                while (existingNames.includes(fileName)) {
                    fileName = `${slideBaseName} (${duplicate}).${resource.extension}`;
                    duplicate += 1;
                }
                const filePath = path.join(slidesDirectory, fileName);
                await writeFile(filePath, body, { flag: 'wx' });
                existingNames.push(fileName);
                console.log(`[saved] ${printableUrlForPath(filePath)} <= ${safeUrl(resource.response.url())}`);

                if (resource.extension === 'pdf') {
                    if (body.subarray(0, 5).toString('ascii') !== '%PDF-') {
                        await unlink(filePath);
                        throw new Error('The reader returned application/pdf, but the response is not a valid PDF file.');
                    }
                    savedPdf = fileName;
                } else if (resource.contentType.split(';', 1)[0].trim().toLowerCase().startsWith('image/')) {
                    savedImages.push(fileName);
                }

                totalBytes += body.byteLength;
                nextSlideNumber += 1;
                savedCount += 1;
            }

            if (resources.length > maximumSelectionCount) {
                console.log(`[warning] Only the first ${maximumSelectionCount} resources were considered.`);
            }

            if (savedImages.length > 0) {
                const htmlPath = path.join(slidesDirectory, `.slides-print-${Date.now()}.html`);
                const images = savedImages.map((name) =>
                    `<figure><img src="${encodeURIComponent(name)}"></figure>`
                ).join('\n');
                const html = '<!doctype html><html><head><meta charset="utf-8"><style>'
                    + '@page{size:A4;margin:12mm}body{margin:0}figure{height:270mm;margin:0;'
                    + 'display:flex;align-items:center;justify-content:center;page-break-after:always}'
                    + 'figure:last-child{page-break-after:auto}img{max-width:100%;max-height:100%;object-fit:contain}'
                    + '</style></head><body>'
                    + images
                    + '</body></html>';

                await writeFile(htmlPath, html, { flag: 'wx' });
                try {
                    await context.unroute('**/*');
                    await page.goto(fileUrl(htmlPath), { waitUntil: 'load' });
                    await page.evaluate(async () => {
                        await Promise.all(Array.from(document.images, (image) => {
                            if (image.complete) return Promise.resolve();
                            return new Promise((resolve) => {
                                image.addEventListener('load', resolve, { once: true });
                                image.addEventListener('error', resolve, { once: true });
                            });
                        }));
                    });

                    const pdfBaseNameRoot = fileStem;
                    let pdfBaseName = `${pdfBaseNameRoot}.pdf`;
                    let duplicate = 2;
                    while (existingNames.includes(pdfBaseName)) {
                        pdfBaseName = `${pdfBaseNameRoot} (${duplicate}).pdf`;
                        duplicate += 1;
                    }
                    const pdfPath = path.join(slidesDirectory, pdfBaseName);
                    const generatedPdf = await page.pdf({ format: 'A4', printBackground: true });
                    const labeledPdf = await addFooterLabel(generatedPdf, 'banksoalut2026');
                    await writeFile(pdfPath, labeledPdf.bytes, { flag: 'wx' });
                    existingNames.push(pdfBaseName);
                    console.log(`[pdf] Combined ${savedImages.length} image(s), added the footer to ${labeledPdf.pageCount} page(s), and saved ${printableUrlForPath(pdfPath)}`);
                } finally {
                    await unlink(htmlPath);
                }
            }

            console.log(`[success] Saved ${savedCount} resource(s), ${totalBytes} bytes total.`);
            if (savedPdf !== null) {
                console.log(`[pdf] Saved the PDF already loaded by the reader: ${printableUrlForPath(path.join(slidesDirectory, savedPdf))}`);
            }
            if (savedCount === 0) {
                console.log('[info] No resources were saved. Check whether the image/PDF responses are accessible at the signed-in page URL.');
            }
        }
    }
} finally {
    await session.context.close();
}
