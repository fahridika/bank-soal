<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Services\ReaderScraperService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\View\View;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class ReaderController extends Controller
{
    public function __construct(private readonly ReaderScraperService $scraper) {}

    public function index(): View
    {
        return view('scraper.index');
    }

    public function preview(Request $request): View|RedirectResponse
    {
        $validator = Validator::make($request->all(), [
            'url' => ['required', 'string', 'max:2048', 'url:https'],
        ]);

        if ($validator->fails()) {
            return redirect()->route('scraper.index')
                ->withErrors(['url' => 'URL tidak valid. Masukkan URL HTTPS reader yang benar.'])
                ->withInput($request->only('url'));
        }

        $url = trim((string) $request->input('url'));
        $result = $this->scraper->scrapePreview($url);
        if (! ($result['success'] ?? false)) {
            return view('scraper.index', [
                'url' => $url,
                'errorMessage' => $this->errorMessage((string) ($result['error'] ?? 'READER_UNAVAILABLE')),
            ]);
        }

        $token = (string) Str::uuid();
        $previews = $request->session()->get('reader_previews', []);
        $previews = is_array($previews) ? $previews : [];
        $previews[$token] = ['url' => $url];
        $request->session()->put('reader_previews', array_slice($previews, -5, null, true));

        return view('scraper.index', [
            'url' => $url,
            'preview' => $result,
            'previewToken' => $token,
        ]);
    }

    public function download(Request $request): BinaryFileResponse|RedirectResponse
    {
        $validator = Validator::make($request->all(), [
            'token' => ['required', 'uuid'],
        ]);

        if ($validator->fails()) {
            return redirect()->route('scraper.index')
                ->withErrors(['url' => 'Preview sudah tidak valid. Silakan jalankan Preview kembali.']);
        }

        $token = (string) $request->input('token');
        $previews = $request->session()->get('reader_previews', []);
        $preview = is_array($previews) ? ($previews[$token] ?? null) : null;
        if (! is_array($preview) || ! is_string($preview['url'] ?? null)) {
            return redirect()->route('scraper.index')
                ->withErrors(['url' => 'Preview sudah kedaluwarsa. Silakan jalankan Preview kembali.']);
        }

        $result = $this->scraper->download($preview['url'], (string) Str::uuid());
        if (! ($result['success'] ?? false)) {
            return redirect()->route('scraper.index')
                ->withErrors(['url' => $this->errorMessage((string) ($result['error'] ?? 'DOWNLOAD_FAILED'))]);
        }

        $request->session()->forget("reader_previews.{$token}");

        return response()->download(
            $result['path'],
            $result['filename'],
            ['Content-Type' => 'application/pdf']
        )->deleteFileAfterSend(true);
    }

    private function errorMessage(string $code): string
    {
        return match ($code) {
            'AUTH_REQUIRED' => 'Session browser sudah tidak valid. Silakan login kembali menggunakan browser authentication.',
            'URL_NOT_ALLOWED', 'DOMAIN_NOT_ALLOWED' => 'Domain tidak diizinkan. Gunakan host yang dikonfigurasi untuk scraper.',
            'INVALID_URL' => 'URL tidak valid. Masukkan URL HTTPS reader yang benar.',
            'TIMEOUT' => 'Waktu tunggu habis saat membuka reader. Silakan coba lagi.',
            'NETWORK_ERROR' => 'Tidak dapat terhubung ke situs reader. Periksa koneksi internet atau coba lagi beberapa saat; DNS tidak perlu diubah jika situs dapat dibuka normal.',
            'BROWSER_BUSY' => 'Profil Edge khusus proyek sedang digunakan. Tutup jendela Edge proyek dan pastikan tidak ada proses Preview atau Download lain yang masih berjalan. Jika tidak ada jendela, periksa proses Edge yang memakai profil proyek; jangan hapus file lock profil.',
            'BROWSER_UNAVAILABLE' => 'Edge automation tidak dapat dimulai. Pastikan Microsoft Edge, Node.js 20+, dan dependensi Playwright tersedia, lalu mulai ulang server Laravel.',
            'READER_NOT_FOUND' => 'Reader tidak ditemukan atau tidak dapat diakses.',
            'SLIDES_NOT_FOUND' => 'Slide tidak ditemukan pada halaman reader.',
            'DOWNLOAD_FAILED' => 'Download PDF gagal. Silakan coba lagi.',
            default => 'Reader tidak dapat diakses. Periksa session browser dan coba lagi.',
        };
    }
}
