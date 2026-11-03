<!doctype html>
<html lang="id">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>BankSoal Reader Downloader</title>
    <style>
        :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: #172033; background: #f3f6fb; }
        * { box-sizing: border-box; }
        body { margin: 0; min-height: 100vh; padding: 48px 18px; }
        main { width: min(860px, 100%); margin: 0 auto; }
        .card { padding: clamp(22px, 5vw, 40px); border: 1px solid #e1e7f0; border-radius: 18px; background: #fff; box-shadow: 0 18px 55px rgb(23 32 51 / 8%); }
        h1 { margin: 0 0 8px; font-size: clamp(1.6rem, 4vw, 2rem); letter-spacing: -.03em; }
        .intro { margin: 0 0 28px; color: #61708a; line-height: 1.6; }
        label { display: block; margin-bottom: 8px; font-weight: 650; }
        input[type=url] { width: 100%; min-height: 48px; padding: 12px 14px; border: 1px solid #cbd4e1; border-radius: 10px; font: inherit; }
        input[type=url]:focus { outline: 3px solid rgb(48 102 213 / 18%); border-color: #3269d1; }
        button { min-height: 44px; padding: 10px 18px; border: 0; border-radius: 10px; color: #fff; background: #245bc2; font: inherit; font-weight: 650; cursor: pointer; }
        button:hover { background: #19499f; }
        button:disabled { opacity: .65; cursor: wait; }
        .actions { display: flex; justify-content: flex-end; margin-top: 16px; }
        .message { margin: 20px 0 0; padding: 13px 15px; border-radius: 10px; line-height: 1.55; }
        .error { color: #8e2525; background: #fff0ef; border: 1px solid #ffd2cf; }
        .hint { color: #57440a; background: #fff8df; border: 1px solid #f1e2a8; }
        .result { margin-top: 30px; padding-top: 25px; border-top: 1px solid #e7ebf2; }
        .result h2 { margin: 0 0 18px; font-size: 1.25rem; }
        dl { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 10px 16px; margin: 0 0 22px; line-height: 1.5; }
        dt { color: #61708a; font-weight: 600; }
        dd { margin: 0; overflow-wrap: anywhere; }
        .slides { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 14px; }
        figure { margin: 0; padding: 10px; border: 1px solid #e1e7f0; border-radius: 12px; background: #f8faff; }
        figure img { display: block; width: 100%; height: auto; aspect-ratio: 0.78; object-fit: contain; background: #fff; }
        figcaption { padding-top: 8px; color: #61708a; font-size: .9rem; }
        .download { display: flex; justify-content: flex-end; margin-top: 20px; }
        .spinner { display: none; width: 17px; height: 17px; margin-right: 9px; vertical-align: -3px; border: 2px solid rgb(255 255 255 / 45%); border-top-color: #fff; border-radius: 50%; animation: spin .75s linear infinite; }
        button[aria-busy=true] .spinner { display: inline-block; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (max-width: 520px) { body { padding: 20px 12px; } dl { grid-template-columns: 1fr; gap: 4px; } dd { margin-bottom: 8px; } }
    </style>
</head>
<body>
<main>
    <section class="card">
        <h1>BankSoal Reader Downloader</h1>
        <p class="intro">Masukkan URL reader yang dapat diakses melalui profil Edge khusus proyek. Login Google tidak dilakukan oleh aplikasi ini.</p>

        @if ($errors->any())
            <div class="message error" role="alert">{{ $errors->first() }}</div>
        @endif
        @if (isset($errorMessage))
            <div class="message error" role="alert">
                {{ $errorMessage }}
                @if (str_contains($errorMessage, 'Session browser'))
                    <br>Untuk autentikasi manual, jalankan <code>php playwright-login.php</code>, login melalui Edge, lalu tutup jendela Edge khusus proyek sebelum Preview lagi.
                @endif
            </div>
        @endif

        <form method="POST" action="{{ route('scraper.preview') }}" data-loading-form>
            @csrf
            <label for="reader-url">Reader URL</label>
            <input
                id="reader-url"
                name="url"
                type="url"
                inputmode="url"
                autocomplete="url"
                maxlength="2048"
                placeholder="Paste URL reader di sini"
                value="{{ old('url', $url ?? '') }}"
                required
            >
            <div class="actions">
                <button type="submit"><span class="spinner" aria-hidden="true"></span><span data-button-label>Preview</span></button>
            </div>
        </form>

        @isset($preview)
            <section class="result" aria-live="polite">
                <h2>Preview berhasil</h2>
                <dl>
                    <dt>Title</dt>
                    <dd>{{ $preview['title'] }}</dd>
                    <dt>URL</dt>
                    <dd><a href="{{ $preview['url'] }}" target="_blank" rel="noopener noreferrer">{{ $preview['url'] }}</a></dd>
                    <dt>Jumlah slide</dt>
                    <dd>{{ $preview['slides_count'] }}</dd>
                </dl>

                @if (count($preview['slides']) > 0)
                    <div class="slides">
                        @foreach ($preview['slides'] as $slide)
                            <figure>
                                <img src="{{ $slide['thumbnail'] }}" alt="Preview slide {{ $slide['number'] }}" loading="lazy">
                                <figcaption>Slide {{ $slide['number'] }}</figcaption>
                            </figure>
                        @endforeach
                    </div>
                @else
                    <p class="intro">Thumbnail belum tersedia; file PDF reader tetap dapat diunduh.</p>
                @endif

                <form method="POST" action="{{ route('scraper.download') }}" class="download" data-loading-form>
                    @csrf
                    <input type="hidden" name="token" value="{{ $previewToken }}">
                    <button type="submit"><span class="spinner" aria-hidden="true"></span><span data-button-label>Download PDF</span></button>
                </form>
            </section>
        @endisset
    </section>
</main>
<script>
    document.querySelectorAll('[data-loading-form]').forEach((form) => {
        form.addEventListener('submit', () => {
            const button = form.querySelector('button[type="submit"]');
            if (!button) return;
            button.disabled = true;
            button.setAttribute('aria-busy', 'true');
            const label = button.querySelector('[data-button-label]');
            if (label) label.textContent = form.action.endsWith('/download') ? 'Menyiapkan PDF…' : 'Memuat preview…';
        });
    });
</script>
</body>
</html>
