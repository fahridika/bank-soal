<?php

declare(strict_types=1);

const EDGE_PROFILE_DIRECTORY = __DIR__.'/storage/playwright/edge-profile';

require_once __DIR__.'/vendor/autoload.php';

function playwrightAllowedHost(): string
{
    Dotenv\Dotenv::createImmutable(__DIR__)->safeLoad();

    $host = getenv('SCRAPER_ALLOWED_HOST') ?: ($_ENV['SCRAPER_ALLOWED_HOST'] ?? '');
    if (!is_string($host) || $host === '') {
        throw new RuntimeException('SCRAPER_ALLOWED_HOST is not configured in .env.');
    }

    return strtolower($host);
}

function playwrightFindEdge(): string
{
    $candidates = array_filter([
        getenv('ProgramFiles').'\\Microsoft\\Edge\\Application\\msedge.exe',
        getenv('ProgramFiles(x86)').'\\Microsoft\\Edge\\Application\\msedge.exe',
        getenv('LOCALAPPDATA').'\\Microsoft\\Edge\\Application\\msedge.exe',
    ], static fn (string $path): bool => is_file($path));

    foreach ($candidates as $candidate) {
        return $candidate;
    }

    throw new RuntimeException('Microsoft Edge was not found. Install Edge or use its standard installation path.');
}

function playwrightPowerShellQuote(string $value): string
{
    return "'".str_replace("'", "''", $value)."'";
}

function playwrightStartNormalEdge(string $edgePath, array $arguments): void
{
    $quotedArguments = implode(', ', array_map(
        static fn (string $argument): string => playwrightPowerShellQuote('"'.$argument.'"'),
        $arguments
    ));
    $command = sprintf(
        'Start-Process -FilePath %s -ArgumentList @(%s)',
        playwrightPowerShellQuote($edgePath),
        $quotedArguments
    );

    $process = proc_open(
        ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', $command],
        [
            0 => ['pipe', 'r'],
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ],
        $pipes
    );

    if (!is_resource($process)) {
        throw new RuntimeException('Could not start PowerShell to open Microsoft Edge.');
    }

    fclose($pipes[0]);
    $stdout = stream_get_contents($pipes[1]);
    $stderr = stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    $exitCode = proc_close($process);

    if ($exitCode !== 0) {
        throw new RuntimeException(sprintf(
            "Could not start Microsoft Edge. PowerShell output: %s%s",
            trim((string) $stdout),
            trim((string) $stderr)
        ));
    }
}

function playwrightEnsureProfileDirectory(): void
{
    if (!is_dir(EDGE_PROFILE_DIRECTORY)
        && !mkdir(EDGE_PROFILE_DIRECTORY, 0700, true)
        && !is_dir(EDGE_PROFILE_DIRECTORY)) {
        throw new RuntimeException(sprintf('Could not create dedicated Edge profile: %s', EDGE_PROFILE_DIRECTORY));
    }
}

function playwrightRunNodeScript(string $scriptName, array $arguments = []): never
{
    $scriptPath = __DIR__.'/'.$scriptName;
    if (!is_file($scriptPath)) {
        throw new RuntimeException(sprintf('Playwright script is missing: %s', $scriptPath));
    }

    $command = escapeshellarg('node').' '.escapeshellarg($scriptPath);
    foreach ($arguments as $argument) {
        $command .= ' '.escapeshellarg($argument);
    }
    passthru($command, $exitCode);
    exit($exitCode);
}
