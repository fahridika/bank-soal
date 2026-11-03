<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\ReaderController;

Route::get('/', [ReaderController::class, 'index'])->name('scraper.index');
Route::post('/preview', [ReaderController::class, 'preview'])->name('scraper.preview');
Route::post('/download', [ReaderController::class, 'download'])->name('scraper.download');
