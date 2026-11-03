<?php

declare(strict_types=1);

require __DIR__.'/playwright-common.php';

playwrightEnsureProfileDirectory();

$edgePath = playwrightFindEdge();

echo "[info] Opening Microsoft Edge normally with the project's dedicated profile.\n";
echo "[info] No Playwright automation or remote-debugging option is used in this login step.\n";
echo "[info] Sign in to Soalut manually. Google credentials are entered only in the normal Edge window.\n";
echo "[info] After the reader is accessible, close every window using this dedicated profile.\n";
echo "[info] Then run: php playwright-reader.php <reader-url>\n";

playwrightStartNormalEdge($edgePath, [
    '--user-data-dir='.EDGE_PROFILE_DIRECTORY,
    'https://'.playwrightAllowedHost(),
]);

echo "[success] Normal Edge opened. The login session stays in the dedicated local profile.\n";
