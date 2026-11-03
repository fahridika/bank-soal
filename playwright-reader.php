<?php

declare(strict_types=1);

require __DIR__.'/playwright-common.php';

$url = $argv[1] ?? '';
$host = playwrightAllowedHost();
if ($url === '') {
    fwrite(STDERR, "Usage: php playwright-reader.php <reader-url>\n");
    exit(1);
}

playwrightRunNodeScript('playwright-reader.mjs', [$url, $host]);
