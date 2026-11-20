# Arsitektur

## Teknologi

| Bagian | Teknologi |
|---|---|
| Server | Node.js 22, Express 5 (satu proses: API, file media, aplikasi web) |
| Build | Vite 7 (web), esbuild (bundel server), Docker |
| Tampilan | React 19, Tailwind CSS v4 (token di `@theme`), Zustand untuk state |
| Bahasa | TypeScript strict |
| Database | SQLite lewat better-sqlite3 |
| Video/audio | FFmpeg sistem (dipasang di image Docker), libass untuk caption |
| Pengenal suara | whisper.cpp untuk Linux (dibangun di Dockerfile) + model Whisper Small |
| AI | Gemini (`@google/genai`), API OpenAI-compatible (OpenRouter, Groq, custom), ElevenLabs, Higgsfield |

Aplikasi ini dulu berupa aplikasi desktop Electron. Sekarang aplikasi web: logika di `src/main` tetap sama,
hanya lapisan Electron (IPC, preload, protokol `studio://`, dialog file, `safeStorage`) diganti HTTP.

## Server dan browser

```
┌──────────────── server (Node, src/main) ────────────────────────┐
│ database, file proyek, kunci API, panggilan AI, FFmpeg, Whisper │
│ server.ts: POST /api/rpc/:kanal   ◄── fetch ── lib/webApi.ts    │
│ events.ts: GET /api/events (SSE)  ──► EventSource ──► store     │
│ server.ts: /media/*, /download/*  ──► <img>, <video>, <audio>   │
└──────────────────────────────────────────────────────────────────┘
┌─ browser (src/renderer, React) ───────────────────────────────┐
│ window.api (lib/webApi.ts), halaman, editor, pratinjau         │
└────────────────────────────────────────────────────────────────┘
```

- **Browser** tidak punya akses disk atau kunci. Semua lewat `window.api` (tipe di `src/shared/api.ts`),
  yang dibuat di `renderer/src/lib/webApi.ts`.
- **Panggilan**: `call('kanal')` → `POST /api/rpc/<kanal>` dengan body `{ "args": [...] }`; balasan `{ "result": ... }`
  atau `{ "error": "pesan" }` dengan status 500. Pesan error berbahasa Indonesia langsung tampil sebagai toast.
- **Handler** didaftarkan di `src/main/ipc.ts` (nama file dipertahankan; isinya tabel RPC).
- **Event** server → browser lewat Server-Sent Events (`/api/events`), dengan `ping` tiap 25 detik agar proxy
  tidak memutus koneksi.
- **Login**: satu kata sandi (`APP_PASSWORD`), cookie bertanda tangan 30 hari (`src/main/auth.ts`). Semua rute
  kecuali `/login` dan `/healthz` butuh login.

## RPC (ringkasan)

| Kelompok | Kanal | Fungsi |
|---|---|---|
| `projects:*` | list, create, get, save, remove, duplicate | proyek dan snapshot |
| `story:*` | script, visuals, musicPrompt | LLM: naskah, rencana visual, prompt musik |
| `generate:*` | clipImage, clipVideo, clipTts, characterSheet, missingImages, missingVideos, missingTts, narration, syncCaptions, cancel, estimate | job AI dan estimasi kredit |
| `clips:*` | split, detachVoice | edit timeline yang menyentuh file |
| `assets:*` | setActive, setWords | aset klip dan caption |
| `settings:*` | get, set, keys, setKey, setCustom, clearKey, revealKey, testKey, voices | pengaturan dan kunci API |
| `models:list` | | daftar model live dari penyedia (dicache) |
| `export:start` | | ekspor MP4 ke folder `exports/` di server |
| `whisper:*` | status, download, cancel, remove | model Whisper lokal |
| `app:version` | | versi aplikasi |

Rute di luar RPC: `POST /api/upload/music` dan `/api/upload/image` (isi file sebagai body, `?projectId=&name=`),
`GET /media/asset/<id-proyek>/<path>`, `GET /media/fonts/<file>`, `GET /download/export/<file>`.
`openExternal` dan `copyText` dikerjakan langsung di browser.

Event server ke browser (`src/main/events.ts`): `event:job`, `event:clip` (patch kolom klip),
`event:character`, `event:asset`, `event:whisper`. `App.tsx` meneruskannya ke store.

## Antrean job

`src/main/jobs.ts` menjalankan pekerjaan panjang sebagai **job** yang tersimpan di tabel `jobs` dan dikirim ke
renderer lewat `event:job` (progres, pesan, error).

| Antrean | Batas paralel | Dipakai untuk |
|---|---|---|
| `higgsfield` | 3 | gambar, lembar karakter, video |
| `tts` | 2 | narasi, TTS per klip |
| `whisper` | 1 | sinkron caption (Whisper memakai banyak core CPU) |
| `export` | 1 | ekspor MP4 |

Setiap job punya `AbortController` sehingga bisa dibatalkan (`generate:cancel`). Saat aplikasi dibuka lagi,
`resumeJobs()` melanjutkan permintaan Higgsfield yang sudah terkirim; job lain yang terputus ditandai gagal.

## Penyimpanan

Semua data ada di satu folder, `DATA_DIR` (di Docker: `/data`, sebuah volume). Backup cukup menyalin folder ini.

```
/data/
  studio.db                 SQLite: proyek, klip, pemeran, aset, job, pengaturan, kunci terenkripsi, cache
  .secret-key               kunci enkripsi API key (kalau SECRETS_KEY tidak diisi)
  projects/<id-proyek>/
    images/  videos/  audio/  music/  overlays/     file hasil generate dan unggahan
  exports/                                          MP4 hasil ekspor (diunduh lewat browser)
  models/whisper/ggml-small.bin                     model Whisper (diunduh dari Pengaturan)
  tmp/                                              file sementara render/Whisper (dihapus setelah selesai)
```

- Nama folder proyek dan file berupa ID acak; judul hanya ada di database.
- Path aset disimpan **relatif** terhadap folder proyek (`assets.local_path`), sehingga proyek bisa disalin utuh.
- Menghapus proyek menghapus foldernya.

### Rute `/media`

Aset dan font disajikan oleh `server.ts` lewat `res.sendFile`, yang mendukung HTTP Range (audio dan video
bisa di-seek) dan menolak path di luar folder asalnya:

- `/media/asset/<id-proyek>/<path-relatif>`, dibuat oleh `assetUrl()` di `paths.ts`
- `/media/fonts/<file>.ttf`, font caption untuk `@font-face` di `styles.css`

## Simpan otomatis

Renderer menyimpan perubahan proyek sebagai **snapshot** (`projects:save` → `saveSnapshot` di `repo.ts`):
proyek, pemeran, dan klip. Penyimpanan berjalan 1,2 detik setelah perubahan terakhir, atau langsung dengan Ctrl+S
atau `flush()`.

Kolom aset klip (`image_asset_id`, `video_asset_id`, `audio_asset_id`) **tidak** ikut snapshot. Kolom itu milik
proses utama (hasil job, `setActive`, `split`) dan diubah dengan `patchClip` + `emit.clip`. Panggil `flush()`
sebelum IPC yang membaca klip dari database (generate, split, ekspor), supaya main melihat versi terbaru.

## Keamanan

- **Login wajib**: server menolak start tanpa `APP_PASSWORD` (kecuali `AUTH_DISABLED=1` untuk uji lokal).
  Percobaan login gagal dibatasi per IP. Cookie `HttpOnly`, `SameSite=Lax`, dan `Secure` saat lewat HTTPS.
- **CSP** di `src/renderer/index.html`: skrip hanya dari aplikasi sendiri; gambar/media dari `blob:`, `https:`;
  iframe hanya `https://www.youtube.com` (video tutorial di halaman About).
- **Kunci API** dienkripsi AES-256-GCM di tabel `secrets`; kuncinya dari `SECRETS_KEY` atau file `.secret-key`
  di folder data. Lihat [layanan-ai.md](layanan-ai.md#kunci-api-byok).
- **Path file**: rute `/media` dan `/download` hanya membaca dari folder proyek, folder font, dan `exports/`.
- **Di belakang proxy**: `trust proxy` aktif (satu lapis) supaya IP klien dan HTTPS terbaca dari `X-Forwarded-*`.
