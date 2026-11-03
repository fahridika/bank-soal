<?php

namespace Tests\Feature;

use App\Services\ReaderScraperService;
use Tests\TestCase;

class ReaderControllerTest extends TestCase
{
    public function test_homepage_shows_reader_url_form(): void
    {
        $this->get('/')
            ->assertOk()
            ->assertSee('BankSoal Reader Downloader')
            ->assertSee('name="url"', false)
            ->assertSee('Preview');
    }

    public function test_preview_rejects_an_invalid_url(): void
    {
        $this->post('/preview', ['url' => 'not a URL'])
            ->assertRedirect('/')
            ->assertSessionHasErrors('url');
    }

    public function test_preview_rejects_a_host_outside_the_configured_allowlist(): void
    {
        config(['scraper.allowed_host' => 'banksoalut.web.id']);

        $this->post('/preview', ['url' => 'https://example.com/reader'])
            ->assertOk()
            ->assertSee('Domain tidak diizinkan.');
    }

    public function test_preview_explains_how_to_resolve_a_busy_edge_profile(): void
    {
        config(['scraper.allowed_host' => 'banksoalut.web.id']);
        $this->mock(ReaderScraperService::class)
            ->shouldReceive('scrapePreview')
            ->once()
            ->andReturn(['success' => false, 'error' => 'BROWSER_BUSY']);

        $this->post('/preview', ['url' => 'https://banksoalut.web.id/reader/example'])
            ->assertOk()
            ->assertSee('Profil Edge khusus proyek sedang digunakan.')
            ->assertSee('jangan hapus file lock profil.');
    }

    public function test_preview_explains_missing_browser_automation_requirements(): void
    {
        config(['scraper.allowed_host' => 'banksoalut.web.id']);
        $this->mock(ReaderScraperService::class)
            ->shouldReceive('scrapePreview')
            ->once()
            ->andReturn(['success' => false, 'error' => 'BROWSER_UNAVAILABLE']);

        $this->post('/preview', ['url' => 'https://banksoalut.web.id/reader/example'])
            ->assertOk()
            ->assertSee('Edge automation tidak dapat dimulai.')
            ->assertSee('dependensi Playwright tersedia');
    }

    public function test_preview_explains_network_errors_separately_from_browser_errors(): void
    {
        config(['scraper.allowed_host' => 'banksoalut.web.id']);
        $this->mock(ReaderScraperService::class)
            ->shouldReceive('scrapePreview')
            ->once()
            ->andReturn(['success' => false, 'error' => 'NETWORK_ERROR']);

        $this->post('/preview', ['url' => 'https://banksoalut.web.id/reader/example'])
            ->assertOk()
            ->assertSee('Tidak dapat terhubung ke situs reader.')
            ->assertSee('DNS tidak perlu diubah');
    }
}
