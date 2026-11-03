import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { chromium } from 'playwright';

export const projectDirectory = path.dirname(fileURLToPath(import.meta.url));
export const profileDirectory = path.join(projectDirectory, 'storage', 'playwright', 'edge-profile');
export const slidesDirectory = path.join(projectDirectory, 'storage', 'app', 'slides');
export const scraperDirectory = path.join(projectDirectory, 'storage', 'app', 'scraper');

export function isBrowserProfileBusyError(message) {
    return /profile(?:\s+directory)?(?:\s+(?:is|appears to be))?\s+(?:already\s+(?:in use|open)|in use|locked)|user data directory.{0,80}(?:in use|locked)|opening in existing browser session|process did exit: exitCode=21|ProcessSingleton/i.test(message);
}

export async function openReader(readerUrl, allowedHost, edgeExecutable) {
    const targetUrl = new URL(readerUrl);
    if (targetUrl.protocol !== 'https:' || targetUrl.hostname.toLowerCase() !== allowedHost.toLowerCase()) {
        throw new Error('URL_NOT_ALLOWED');
    }

    await mkdir(profileDirectory, { recursive: true });

    console.log('[info] Opening Microsoft Edge with the dedicated project profile.');
    console.log('[info] Google sign-in is blocked from top-level external redirects during automation.');

    let context;
    try {
        const launchOptions = { headless: false };
        if (edgeExecutable) {
            launchOptions.executablePath = edgeExecutable;
        } else {
            launchOptions.channel = 'msedge';
        }
        context = await chromium.launchPersistentContext(profileDirectory, launchOptions);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isBrowserProfileBusyError(message)) {
            throw new Error(
                'The project Edge profile is already open. Close every Edge window opened with this project profile, '
                + 'press ENTER or Ctrl+C to finish any other playwright-reader.php/playwright-download.php command, '
                + 'then rerun this command. If Edge has no visible project window, inspect processes with this exact '
                + '--user-data-dir path and stop only that profile process. Do not delete profile lock files or '
                + 'stop every msedge.exe process.',
            );
        }

        throw error;
    }

    const page = await context.newPage();
    let blockedExternalNavigation = false;
    const capturedPdfBodies = new Map();

    await context.route('**/*', async (route) => {
        const request = route.request();
        if (request.isNavigationRequest() && request.frame().parentFrame() === null) {
            const host = new URL(request.url()).hostname.toLowerCase();
            if (host !== allowedHost.toLowerCase()) {
                blockedExternalNavigation = true;
                console.log(`[blocked] Top-level redirect to ${host || '[unknown host]'} was stopped.`);
                await route.abort();
                return;
            }
        }

        const requestUrl = new URL(request.url());
        if (request.method() === 'GET'
            && request.resourceType() === 'fetch'
            && requestUrl.hostname.toLowerCase() === allowedHost.toLowerCase()
            && /^\/reader\/proxy\/[^/]+$/.test(requestUrl.pathname)) {
            const upstream = await route.fetch();
            const headers = await upstream.headers();
            const contentType = headers['content-type'] ?? '';
            if (contentType.split(';', 1)[0].trim().toLowerCase() === 'application/pdf') {
                capturedPdfBodies.set(request.url(), {
                    body: await upstream.body(),
                    status: upstream.status(),
                    contentLength: headers['content-length'] ?? 'unknown',
                });
            }
            await route.fulfill({ response: upstream });
            return;
        }

        await route.continue();
    });

    const responses = new Map();
    let resolveReaderPdf;
    const readerPdfPromise = new Promise((resolve) => {
        resolveReaderPdf = resolve;
    });
    page.on('request', (request) => {
        const type = request.resourceType();
        if (['document', 'image', 'media', 'xhr', 'fetch'].includes(type)) {
            console.log(`[network] ${type} request ${request.method()} ${safeUrl(request.url())}`);
        }
    });
    page.on('response', (response) => {
        const request = response.request();
        const type = request.resourceType();
        const contentType = response.headers()['content-type'] ?? 'unknown';
        if (['document', 'image', 'media', 'xhr', 'fetch'].includes(type)) {
            console.log(`[network] ${type} response ${response.status()} ${contentType} ${safeUrl(response.url())}`);
        }
        if (isDownloadableContent(contentType)) {
            const extension = extensionForMime(contentType);
            const capturedPdf = extension === 'pdf' ? capturedPdfBodies.get(response.url()) : undefined;
            const resource = {
                response,
                status: response.status(),
                contentType,
                extension,
                contentLength: capturedPdf?.contentLength ?? response.headers()['content-length'] ?? 'unknown',
                bodyPromise: extension === 'pdf' && capturedPdf
                    ? Promise.resolve({ body: capturedPdf.body })
                    : extension === 'pdf'
                        ? response.body().then(
                        (body) => ({ body }),
                        (error) => ({ error }),
                    )
                    : null,
            };
            responses.set(response.url(), resource);
            if (extension === 'pdf') {
                resolveReaderPdf(resource);
            }
        }
    });

    let navigationStatus = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const navigationResponse = await page.goto(readerUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            navigationStatus = navigationResponse?.status() ?? null;
            break;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!blockedExternalNavigation && /net::ERR_NAME_NOT_RESOLVED/i.test(message) && attempt < 2) {
                console.log(`[retry] Host lookup failed; retrying navigation (${attempt + 1}/2).`);
                await page.waitForTimeout(1000 * (attempt + 1));
                continue;
            }

            if (!blockedExternalNavigation) {
                await context.close();
                throw error;
            }
        }
    }

    return {
        context,
        page,
        responses,
        navigationStatus,
        waitForReaderPdf: async () => {
            const existing = Array.from(responses.values()).find((resource) => resource.extension === 'pdf');
            if (existing) return existing;

            return Promise.race([
                readerPdfPromise,
                page.waitForTimeout(15000).then(() => null),
            ]);
        },
        wasExternalNavigationBlocked: () => blockedExternalNavigation,
    };
}

export function safeUrl(url) {
    try {
        const parsed = new URL(url);
        return `${parsed.host}${parsed.pathname}`;
    } catch {
        return '[unparseable URL]';
    }
}

export function extensionForMime(contentType) {
    const mime = contentType.split(';', 1)[0].trim().toLowerCase();
    return new Map([
        ['image/jpeg', 'jpg'],
        ['image/jpg', 'jpg'],
        ['image/png', 'png'],
        ['image/webp', 'webp'],
        ['image/gif', 'gif'],
        ['image/avif', 'avif'],
        ['image/bmp', 'bmp'],
        ['application/pdf', 'pdf'],
    ]).get(mime) ?? null;
}

function isDownloadableContent(contentType) {
    return extensionForMime(contentType) !== null;
}

export async function readerSessionIsValid(page, externalNavigationBlocked, allowedHost) {
    const currentUrl = new URL(page.url());
    const title = (await page.title()).toLowerCase();
    const hasVisiblePasswordField = await page.locator('input[type="password"]:visible').count() > 0;

    return !externalNavigationBlocked
        && currentUrl.hostname.toLowerCase() === allowedHost.toLowerCase()
        && !/(^|\/)(login|signin|sign-in|auth)(\/|$)/i.test(currentUrl.pathname)
        && !title.includes('login')
        && !title.includes('sign in')
        && !hasVisiblePasswordField;
}

export async function readerDomSummary(page) {
    return page.evaluate(() => {
        const slideSelector = '[class*="slide" i], [id*="slide" i], [data-testid*="slide" i], [data-slide]';
        const candidateSelector = `img, canvas, svg, iframe, video, embed, object, ${slideSelector}`;
        const elements = Array.from(document.querySelectorAll(candidateSelector));
        const pageCanvasIds = document.querySelectorAll('canvas[id^="page-canvas-"]').length;
        const pageCanvases = Array.from(document.querySelectorAll('canvas')).filter((canvas) => {
            const rect = canvas.getBoundingClientRect();
            return canvas.width >= 300
                && canvas.height >= 300
                && rect.width >= 150
                && rect.height >= 150;
        });
        const slideImages = Array.from(document.images).filter((image) => {
            const rect = image.getBoundingClientRect();
            const isInSiteChrome = image.closest('header, nav, footer, [role="banner"], [role="navigation"]') !== null;
            const source = image.currentSrc || image.src || '';
            const looksLikeBranding = /(?:logo|icon|favicon|avatar|brand)/i.test(source);

            return !isInSiteChrome
                && !looksLikeBranding
                && image.naturalWidth >= 500
                && image.naturalHeight >= 500
                && rect.width >= 150
                && rect.height >= 150;
        });
        const candidates = elements.slice(0, 100).map((element) => {
            const source = element.currentSrc || element.src || element.data || '';
            let safeSource = '';
            if (source) {
                try {
                    const parsed = new URL(source, location.href);
                    safeSource = `${parsed.origin}${parsed.pathname}`;
                } catch {
                    safeSource = '[unparseable source URL]';
                }
            }

            const rect = element.getBoundingClientRect();
            return {
                tag: element.tagName.toLowerCase(),
                id: element.id || '',
                className: element.getAttribute('class') || '',
                role: element.getAttribute('role') || '',
                width: element.naturalWidth || element.width || Math.round(rect.width),
                height: element.naturalHeight || element.height || Math.round(rect.height),
                source: safeSource,
            };
        });

        const slideCount = document.querySelectorAll(slideSelector).length;

        return {
            readyState: document.readyState,
            slideCount: Math.max(slideCount, pageCanvasIds || pageCanvases.length, slideImages.length),
            counts: {
                slideLike: slideCount,
                image: document.images.length,
                canvas: document.querySelectorAll('canvas').length,
                pageCanvases: pageCanvasIds || pageCanvases.length,
                svg: document.querySelectorAll('svg').length,
                iframe: document.querySelectorAll('iframe').length,
                video: document.querySelectorAll('video').length,
                embed: document.querySelectorAll('embed').length,
                object: document.querySelectorAll('object').length,
                slideImages: slideImages.length,
            },
            candidates,
            candidatesTruncated: elements.length > candidates.length,
        };
    });
}

export async function readerResourceUrls(page) {
    return page.evaluate(() => {
        const slideSelector = '[class*="slide" i], [id*="slide" i], [data-testid*="slide" i], [data-slide]';
        return Array.from(document.querySelectorAll('img, iframe, embed, object'))
            .filter((element) => {
                const source = element.currentSrc || element.src || element.data || '';
                if (!source) return false;
                if (element.matches('iframe, embed, object')) {
                    return /\.pdf(?:$|[?#])/i.test(source);
                }

                const rect = element.getBoundingClientRect();
                const isInSiteChrome = element.closest('header, nav, footer, [role="banner"], [role="navigation"]') !== null;
                const looksLikeBranding = /(?:logo|icon|favicon|avatar|brand)/i.test(source);
                const isSlideImage = !isInSiteChrome
                    && !looksLikeBranding
                    && element.naturalWidth >= 500
                    && element.naturalHeight >= 500
                    && rect.width >= 150
                    && rect.height >= 150;

                return isSlideImage || element.closest(slideSelector) !== null;
            })
            .map((element) => element.currentSrc || element.src || element.data || '');
    });
}

export async function autoScrollReader(page) {
    const maximumSteps = 120;
    const idleLimit = 3;
    let idleSteps = 0;
    let movedSteps = 0;
    const observedResourceUrls = new Set();

    console.log(`[scroll] Automatically scrolling the reader to trigger lazy-loaded slides (limit: ${maximumSteps} steps).`);

    for (let step = 0; step < maximumSteps && idleSteps < idleLimit; step += 1) {
        const result = await page.evaluate(() => {
            const root = document.scrollingElement;
            if (!root) {
                return { moved: false, remaining: 0, scrollables: 0 };
            }

            const elements = [root, ...document.querySelectorAll('*')];
            const scrollables = elements.filter((element) => {
                if (element.clientHeight < 120 || element.scrollHeight <= element.clientHeight + 2) {
                    return false;
                }

                if (element === root) {
                    return true;
                }

                const overflowY = window.getComputedStyle(element).overflowY;
                return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
            });
            const slideSelector = '[class*="slide" i], [id*="slide" i], [data-testid*="slide" i], [data-slide]';
            const resourceUrls = Array.from(document.querySelectorAll('img, iframe, embed, object'))
                .filter((element) => {
                    const source = element.currentSrc || element.src || element.data || '';
                    if (!source) return false;
                    if (element.matches('iframe, embed, object')) {
                        return /\.pdf(?:$|[?#])/i.test(source);
                    }

                    const rect = element.getBoundingClientRect();
                    return (element.naturalWidth >= 300 && element.naturalHeight >= 200)
                        || (rect.width >= 300 && rect.height >= 200)
                        || element.closest(slideSelector) !== null;
                })
                .map((element) => element.currentSrc || element.src || element.data || '');

            const candidates = scrollables.map((element) => ({
                element,
                remaining: Math.max(0, element.scrollHeight - element.clientHeight - element.scrollTop),
            })).sort((left, right) => right.remaining - left.remaining);

            const target = candidates.find((candidate) => candidate.remaining > 2);
            if (!target) {
                return { moved: false, remaining: 0, scrollables: scrollables.length, resourceUrls };
            }

            const previousTop = target.element.scrollTop;
            const distance = Math.max(200, Math.floor(target.element.clientHeight * 0.8));
            target.element.scrollTop = Math.min(
                previousTop + distance,
                target.element.scrollHeight - target.element.clientHeight
            );

            return {
                moved: target.element.scrollTop > previousTop,
                remaining: Math.max(0, target.element.scrollHeight - target.element.clientHeight - target.element.scrollTop),
                scrollables: scrollables.length,
                resourceUrls,
            };
        });

        for (const url of result.resourceUrls) {
            observedResourceUrls.add(url);
        }

        if (result.moved) {
            movedSteps += 1;
            idleSteps = 0;
            await page.waitForTimeout(450);
        } else {
            idleSteps += 1;
            await page.waitForTimeout(700);
        }

        if ((step + 1) % 20 === 0) {
            console.log(`[scroll] ${step + 1}/${maximumSteps} steps; moved ${movedSteps} times; active scroll areas: ${result.scrollables}.`);
        }
    }

    console.log(`[scroll] Finished after ${movedSteps} scroll steps.`);
    return [...observedResourceUrls];
}

export async function waitForUser(message) {
    const prompt = createInterface({ input: stdin, output: stdout });
    try {
        return await prompt.question(message);
    } finally {
        prompt.close();
    }
}

export function printableUrlForPath(filePath) {
    return path.relative(projectDirectory, filePath).split(path.sep).join('/');
}

export function safeFileStem(title) {
    const stem = title
        .normalize('NFC')
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/[. ]+$/g, '')
        .trim()
        .slice(0, 150)
        .replace(/[. ]+$/g, '');

    if (!stem || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) {
        return 'reader';
    }

    return stem;
}

export function fileUrl(filePath) {
    return pathToFileURL(filePath).href;
}
