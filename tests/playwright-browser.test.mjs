import assert from 'node:assert/strict';
import test from 'node:test';
import { isBrowserProfileBusyError } from '../playwright-browser.mjs';

test('identifies Edge profile lock errors', () => {
    for (const message of [
        'The project Edge profile is already open.',
        'user data directory is already in use',
        'ProcessSingleton lock',
        'opening in existing browser session',
    ]) {
        assert.equal(isBrowserProfileBusyError(message), true, message);
    }
});

test('does not classify unrelated browser errors as profile locks', () => {
    assert.equal(isBrowserProfileBusyError('Microsoft Edge was not found.'), false);
});
