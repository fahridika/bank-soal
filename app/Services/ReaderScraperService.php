<?php

declare(strict_types=1);

namespace App\Services;

use Illuminate\Support\Facades\Log;
use Symfony\Component\Process\Exception\ProcessTimedOutException;
use Symfony\Component\Process\Process;
use Throwable;

class ReaderScraperService
{
    /**
     * @return array{success: bool, error?: string, url?: string, title?: string, slides_count?: int, slides?: array}
     */
    public function scrapePreview(string $url): array
    {
        $validationError = $this->urlError($url);
        if ($validationError !== null) {
            return ['success' => false, 'error' => $validationError];
        }

        $result = $this->runBrowser([
            'mode' => 'preview',
            'url' => $url,
            'allowed_host' => (string) config('scraper.allowed_host'),
        ], 'preview');

        if (! ($result['success'] ?? false)) {
            return $result;
        }

        return [
            'success' => true,
            'url' => $result['url'],
            'title' => $result['title'],
            'slides_count' => $result['slides_count'],
            'slides' => $result['slides'] ?? [],
        ];
    }

    /**
     * @return array{success: bool, error?: string, path?: string, filename?: string}
     */
    public function download(string $url, string $downloadId): array
    {
        $validationError = $this->urlError($url);
        if ($validationError !== null) {
            return ['success' => false, 'error' => $validationError];
        }

        if (! preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $downloadId)) {
            return ['success' => false, 'error' => 'DOWNLOAD_FAILED'];
        }

        $directory = storage_path('app/scraper');
        if (! is_dir($directory) && ! mkdir($directory, 0700, true) && ! is_dir($directory)) {
            return $this->failure('DOWNLOAD_FAILED', 'download', new \RuntimeException('Output directory could not be created.'));
        }

        $result = $this->runBrowser([
            'mode' => 'download',
            'url' => $url,
            'allowed_host' => (string) config('scraper.allowed_host'),
            'download_id' => $downloadId,
        ], 'download');

        if (! ($result['success'] ?? false)) {
            return $result;
        }

        $path = $directory.DIRECTORY_SEPARATOR.$downloadId.'.pdf';
        if (! is_file($path) || filesize($path) === 0) {
            return $this->failure('DOWNLOAD_FAILED', 'download', new \RuntimeException('The browser did not produce the expected PDF.'));
        }

        return [
            'success' => true,
            'path' => $path,
            'filename' => $result['filename'],
        ];
    }

    private function urlError(string $url): ?string
    {
        $allowedHost = strtolower(trim((string) config('scraper.allowed_host')));
        $parts = parse_url($url);

        if ($allowedHost === '' || ! is_array($parts)) {
            return 'INVALID_URL';
        }

        $host = strtolower((string) ($parts['host'] ?? ''));
        if ($host !== $allowedHost) {
            return 'DOMAIN_NOT_ALLOWED';
        }

        if (strtolower((string) ($parts['scheme'] ?? '')) !== 'https'
            || isset($parts['user'])
            || isset($parts['pass'])
            || (isset($parts['port']) && $parts['port'] !== 443)) {
            return 'INVALID_URL';
        }

        return null;
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    private function runBrowser(array $input, string $operation): array
    {
        $script = base_path('playwright-service.mjs');
        if (! is_file($script)) {
            return $this->failure('BROWSER_UNAVAILABLE', $operation, new \RuntimeException('Playwright service script is missing.'));
        }

        if (DIRECTORY_SEPARATOR === '\\') {
            $edgeExecutable = $this->findEdgeExecutable();
            if ($edgeExecutable === null) {
                return $this->failure('BROWSER_UNAVAILABLE', $operation, new \RuntimeException(
                    'Microsoft Edge was not found. Install Edge or set SCRAPER_EDGE_BINARY to its executable path.'
                ));
            }
            $input['edge_executable'] = $edgeExecutable;

        }

        $process = new Process([(string) config('scraper.node_binary', 'node'), $script], base_path());
        $tempDirectory = sys_get_temp_dir();
        if (! is_dir($tempDirectory) || ! is_writable($tempDirectory)) {
            return $this->failure(
                'BROWSER_UNAVAILABLE',
                $operation,
                new \RuntimeException('The system temporary directory is missing or not writable.')
            );
        }

        $windowsRoot = getenv('SystemRoot')
            ?: getenv('WINDIR')
            ?: ($_SERVER['SystemRoot'] ?? $_SERVER['WINDIR'] ?? null);
        if (DIRECTORY_SEPARATOR === '\\' && ! is_string($windowsRoot)) {
            $drive = preg_match('/^[A-Za-z]:/', PHP_BINARY, $matches) === 1 ? $matches[0] : 'C:';
            $windowsRoot = $drive.'\\Windows';
        }

        $process->setEnv([
            'TEMP' => $tempDirectory,
            'TMP' => $tempDirectory,
            'OPENSSL_CONF' => false,
            'OPENSSL_MODULES' => false,
            ...(is_string($windowsRoot) ? ['SystemRoot' => $windowsRoot, 'WINDIR' => $windowsRoot] : []),
        ]);
        $process->setInput(json_encode($input, JSON_THROW_ON_ERROR));
        $process->setTimeout($operation === 'download' ? 240 : 90);

        try {
            $process->run();
        } catch (ProcessTimedOutException $exception) {
            return $this->failure('TIMEOUT', $operation, $exception);
        } catch (Throwable $exception) {
            return $this->failure('BROWSER_UNAVAILABLE', $operation, $exception);
        }

        $output = trim($process->getOutput());
        $result = json_decode($output, true);
        if (! is_array($result)) {
            $stderr = $this->safeDiagnostic($process->getErrorOutput());
            $exitCode = $process->getExitCode();
            $diagnostic = sprintf(
                'The browser returned an invalid response (exit code: %s).%s',
                $exitCode === null ? 'unknown' : (string) $exitCode,
                $stderr === '' ? '' : ' Process stderr: '.$stderr
            );

            return $this->failure(
                $process->isSuccessful() ? 'READER_UNAVAILABLE' : 'BROWSER_UNAVAILABLE',
                $operation,
                new \RuntimeException($diagnostic)
            );
        }

        if (! ($result['success'] ?? false)) {
            $error = is_string($result['error'] ?? null) ? $result['error'] : 'READER_UNAVAILABLE';
            $context = [
                'operation' => $operation,
                'failure_code' => $error,
            ];
            $stderr = $this->safeDiagnostic($process->getErrorOutput());
            if ($stderr !== '') {
                $context['diagnostic'] = $stderr;
            }
            $this->logFailure($context);

            return ['success' => false, 'error' => $error];
        }

        if (! $process->isSuccessful()) {
            return $this->failure(
                'READER_UNAVAILABLE',
                $operation,
                new \RuntimeException('The browser process exited unsuccessfully.')
            );
        }

        return $result;
    }

    private function findEdgeExecutable(): ?string
    {
        $configuredPath = trim((string) config('scraper.edge_binary', ''));
        if ($configuredPath !== '') {
            return is_file($configuredPath) ? $configuredPath : null;
        }

        $drive = preg_match('/^[A-Za-z]:/', PHP_BINARY, $matches) === 1 ? $matches[0] : 'C:';
        $programFiles = getenv('ProgramW6432') ?: getenv('ProgramFiles') ?: $drive.'\\Program Files';
        $programFilesX86 = getenv('ProgramFiles(x86)') ?: $drive.'\\Program Files (x86)';
        $localAppData = getenv('LOCALAPPDATA');
        if (! $localAppData) {
            $temporaryDirectory = sys_get_temp_dir();
            $localAppData = strcasecmp(basename($temporaryDirectory), 'Temp') === 0
                ? dirname($temporaryDirectory)
                : '';
        }

        $candidates = [
            $programFiles.'\\Microsoft\\Edge\\Application\\msedge.exe',
            $programFilesX86.'\\Microsoft\\Edge\\Application\\msedge.exe',
        ];
        if ($localAppData !== '') {
            $candidates[] = $localAppData.'\\Microsoft\\Edge\\Application\\msedge.exe';
        }

        foreach ($candidates as $candidate) {
            if (is_file($candidate)) {
                return $candidate;
            }
        }

        return null;
    }

    private function failure(string $code, string $operation, Throwable $exception): array
    {
        $this->logFailure([
            'operation' => $operation,
            'failure_code' => $code,
            'exception_class' => $exception::class,
            'diagnostic' => $this->safeDiagnostic($exception->getMessage()),
        ]);

        return ['success' => false, 'error' => $code];
    }

    /**
     * @param  array<string, string>  $context
     */
    private function logFailure(array $context): void
    {
        Log::warning('Reader browser operation failed', $context);
        Log::channel('stderr')->warning('Reader browser operation failed', $context);
    }

    private function safeDiagnostic(string $message): string
    {
        $message = preg_replace('~https?://\S+~i', '[URL]', $message) ?? $message;

        return substr(trim(preg_replace('/[\r\n\t]+/', ' ', $message) ?? $message), 0, 1500);
    }
}
