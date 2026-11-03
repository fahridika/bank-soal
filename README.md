<p align="center"><a href="https://laravel.com" target="_blank"><img src="https://raw.githubusercontent.com/laravel/art/master/logo-lockup/5%20SVG/2%20CMYK/1%20Full%20Color/laravel-logolockup-cmyk-red.svg" width="400" alt="Laravel Logo"></a></p>

<p align="center">
<a href="https://github.com/laravel/framework/actions"><img src="https://github.com/laravel/framework/workflows/tests/badge.svg" alt="Build Status"></a>
<a href="https://packagist.org/packages/laravel/framework"><img src="https://img.shields.io/packagist/dt/laravel/framework" alt="Total Downloads"></a>
<a href="https://packagist.org/packages/laravel/framework"><img src="https://img.shields.io/packagist/v/laravel/framework" alt="Latest Stable Version"></a>
<a href="https://packagist.org/packages/laravel/framework"><img src="https://img.shields.io/packagist/l/laravel/framework" alt="License"></a>
</p>

## About Laravel

Laravel is a web application framework with expressive, elegant syntax. We believe development must be an enjoyable and creative experience to be truly fulfilling. Laravel takes the pain out of development by easing common tasks used in many web projects, such as:

- [Simple, fast routing engine](https://laravel.com/docs/routing).
- [Powerful dependency injection container](https://laravel.com/docs/container).
- Multiple back-ends for [session](https://laravel.com/docs/session) and [cache](https://laravel.com/docs/cache) storage.
- Expressive, intuitive [database ORM](https://laravel.com/docs/eloquent).
- Database agnostic [schema migrations](https://laravel.com/docs/migrations).
- [Robust background job processing](https://laravel.com/docs/queues).
- [Real-time event broadcasting](https://laravel.com/docs/broadcasting).

Laravel is accessible, powerful, and provides tools required for large, robust applications.

## Banksoalut reader automation

Composer provides `playwright-php/playwright` 1.5.0, and npm provides Playwright 1.64.1. The PHP package version here does not expose a persistent-context launch API, so the PHP reader/downloader commands delegate to Node Playwright's persistent Edge context; this reuses the manually authorized profile without exporting cookies. They do not touch the regular Edge/Chrome profile or save cookies to an `auth.json` file. Node.js 20+ and Microsoft Edge are required; a separate Playwright browser download is not needed. Set `SCRAPER_NODE_BINARY` in `.env` if the server should use a specific Node executable instead of `node` from its `PATH`, or `SCRAPER_EDGE_BINARY` if Edge is installed outside its standard paths. The PHP service resolves and passes Edge's executable path directly, rather than relying on environment variables that may be missing in a web server process. The Node child process receives PHP's system temporary directory and Windows `SystemRoot` explicitly, and does not inherit system `OPENSSL_CONF` or `OPENSSL_MODULES` settings.

1. Start Laravel locally when needed:

```powershell
php artisan serve
```

2. Open normal Edge using the project's dedicated local profile and sign in manually:

```powershell
php playwright-login.php
```

Complete Google sign-in only in this normal Edge window. Once the reader is accessible, close all windows using this dedicated profile before starting a reader or downloader command. Do not run two project reader/downloader commands at the same time: they use the same profile, and Edge locks it while open. The profile lives in `storage/playwright/edge-profile/`; it is excluded from Git.

3. Open and inspect the reader using that already-authorized profile:

```powershell
php playwright-reader.php
```

The reader command reuses the dedicated profile with Playwright, without running a Google login flow. It blocks top-level navigation away from Soalut, reports the title, final URL, slide-like DOM count, element types, and normal browser resource requests with query strings omitted. If the session is no longer authorized, it stops instead of proceeding through Google sign-in. Finish the command (press ENTER at its terminal prompt) before starting another command that uses this profile.

If the app reports that the Edge profile is in use, close the project's Edge window and finish any running reader/downloader command before retrying. If there is no visible window, inspect only Edge processes launched with this project's `--user-data-dir`; do not delete profile lock files or stop every `msedge.exe` process. If it reports that browser automation cannot start, verify that Edge, Node.js 20+, and the installed npm dependencies are available, then restart the Laravel server. Temporary DNS resolution failures are retried twice; if the site remains unreachable, the app reports a network error separately from browser startup errors. The automation window closes after each attempt to release the dedicated profile lock; this does not stop the Laravel server.

4. Download only image/PDF resources observed in normal browser responses:

```powershell
php playwright-download.php
```

The downloader creates `storage/app/slides/` when it starts and prints its absolute path. It automatically detects and saves the PDF document already loaded by the reader, when available. It adds a small `banksoalut2026` footer to every PDF page while retaining the original page contents and attribution. It does not treat the site's logo or navigation images as slides. Otherwise, it scrolls up to 120 viewport-sized steps to trigger lazy-loaded slide images and combines detected images into a PDF with the same footer. Filenames are based on the reader's page title (for example, `Membaca - STSI4305 - Etika Profesi.pdf` and `Membaca - STSI4305 - Etika Profesi - slide-001.png`); conflicting names receive a numbered suffix. Limits are 100 resources, 30 MiB per file, and 300 MiB total per run. No query strings or credentials are printed. Existing files are not overwritten. If the reader renders only canvas without a PDF response, the DOM summary reports the canvas page count for diagnosing that format.

5. Clear the dedicated profile when you want to sign out. First close its Edge windows, then run:

```powershell
Remove-Item -LiteralPath .\storage\playwright\edge-profile -Recurse -Force
```

To clear downloaded slides separately, run:

```powershell
Remove-Item -LiteralPath .\storage\app\slides -Recurse -Force
```

The profile grants access to your account, so keep it private and do not copy it. Do not enable remote debugging on your main Edge/Chrome profile. If Google or Soalut refuses access, stop and use an access method supported by the service; do not bypass CAPTCHA, DRM, paywalls, access controls, or anti-bot/security checks.

## Learning Laravel

Laravel has the most extensive and thorough [documentation](https://laravel.com/docs) and video tutorial library of all modern web application frameworks, making it a breeze to get started with the framework. You can also check out [Laravel Learn](https://laravel.com/learn), where you will be guided through building a modern Laravel application.

If you don't feel like reading, [Laracasts](https://laracasts.com) can help. Laracasts contains thousands of video tutorials on a range of topics including Laravel, modern PHP, unit testing, and JavaScript. Boost your skills by digging into our comprehensive video library.

## Laravel Sponsors

We would like to extend our thanks to the following sponsors for funding Laravel development. If you are interested in becoming a sponsor, please visit the [Laravel Partners program](https://partners.laravel.com).

### Premium Partners

- **[Vehikl](https://vehikl.com)**
- **[Tighten Co.](https://tighten.co)**
- **[Kirschbaum Development Group](https://kirschbaumdevelopment.com)**
- **[64 Robots](https://64robots.com)**
- **[Curotec](https://www.curotec.com/services/technologies/laravel)**
- **[DevSquad](https://devsquad.com/hire-laravel-developers)**
- **[Redberry](https://redberry.international/laravel-development)**
- **[Active Logic](https://activelogic.com)**

## Contributing

Thank you for considering contributing to the Laravel framework! The contribution guide can be found in the [Laravel documentation](https://laravel.com/docs/contributions).

## Code of Conduct

In order to ensure that the Laravel community is welcoming to all, please review and abide by the [Code of Conduct](https://laravel.com/docs/contributions#code-of-conduct).

## Security Vulnerabilities

If you discover a security vulnerability within Laravel, please send an e-mail to Taylor Otwell via [taylor@laravel.com](mailto:taylor@laravel.com). All security vulnerabilities will be promptly addressed.

## License

The Laravel framework is open-sourced software licensed under the [MIT license](https://opensource.org/licenses/MIT).
