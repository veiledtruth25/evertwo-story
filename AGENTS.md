# AGENTS.md — panduan untuk AI agent dan pengembang

EverTwo Story adalah aplikasi web (server Node + React + TypeScript, dijalankan di Docker) yang mengubah ide cerita menjadi video YouTube:
AI menulis naskah dan rencana visual, Higgsfield membuat gambar dan video, Gemini atau ElevenLabs membuat suara
narator, lalu semuanya dirangkai di editor timeline dan diekspor jadi MP4 dengan FFmpeg.

Baca file ini dulu sebelum mengubah kode. Detail lengkapnya ada di folder [`docs/`](docs/README.md).

## Perintah

```bash
docker compose up -d --build   # bangun image (typecheck + build ikut berjalan) dan jalankan di :8787
npm install            # hanya untuk pengembangan tanpa Docker (Node 22 + FFmpeg)
npm run dev            # server (:8787, tanpa login) + Vite (:5173)
npm run typecheck      # wajib bersih sebelum selesai: tsconfig.node.json + tsconfig.web.json
npm run build          # out/web (browser) + out/server/index.cjs (server)
```

Tidak ada framework unit test. Verifikasi dilakukan dengan `npm run typecheck`, `npm run build`, dan menjalankan
container lalu memeriksanya di browser (lihat [docs/pengembangan.md](docs/pengembangan.md)).

## Peta kode

```
src/
  main/            server Node: HTTP, database, AI, FFmpeg, file
    index.ts       startup server
    server.ts      Express: /api/rpc, /api/events (SSE), /api/upload, /media, /download, aplikasi web
    auth.ts        login satu kata sandi (APP_PASSWORD), cookie bertanda tangan
    ipc.ts         tabel RPC (nama lama dipertahankan): semua handler window.api
    repo.ts        akses SQLite (proyek, klip, pemeran, aset, job)
    db/index.ts    skema + migrasi (PRAGMA user_version)
    story.ts       naskah, rencana visual, prompt musik (LLM)
    generation.ts  gambar/video Higgsfield, lembar karakter, TTS per klip, estimasi kredit
    narration.ts   narasi satu rekaman utuh lalu dipotong per adegan; sinkron caption
    whisper.ts     whisper.cpp lokal (unduh model, kenali kata)
    align.ts, cuts.ts  cocokkan kata naskah ke hasil Whisper; pilih titik potong antar-adegan
    editing.ts     potong (split) klip, lepas suara klip
    exporter.ts    render MP4 dengan FFmpeg ke folder exports/
    fontMetrics.ts lebar teks dari file TTF (untuk kotak caption di ekspor)
    jobs.ts, events.ts  antrean job + event SSE ke browser
    paths.ts       folder data (DATA_DIR), URL aset, biner FFmpeg
    secrets.ts     kunci API terenkripsi AES-256-GCM
    services/      klien API: gemini, elevenlabs, higgsfield, llm (OpenAI-compatible), audio, http
  shared/          kode yang dipakai server DAN browser (tipe, aturan gerak, caption, timeline)
  renderer/src/    tampilan React + Tailwind v4 + Zustand
    lib/webApi.ts  window.api di browser: fetch ke /api/rpc + EventSource
    pages/project/  langkah Ide, Naskah, Storyboard, Editor
    pages/project/editor/  pratinjau (Player), Timeline, Inspector (panel kanan), engine pemutaran
resources/         font caption (fonts/), whisper-cli.exe lama (tidak dipakai di Docker), file lisensi
Dockerfile, docker-compose.yml   image produksi (Node + FFmpeg + whisper.cpp Linux)
docs/              dokumentasi pengembang
```

## Aturan yang tidak boleh dilanggar

1. **Pratinjau dan ekspor harus sama.** Semua aturan yang memengaruhi gambar atau suara final ditulis sekali di
   `src/shared/` lalu dipakai pratinjau (renderer) dan ekspor (main):
   `motion.ts` (gerak kamera, transisi), `captions.ts` (gaya, font, pemenggalan baris caption),
   `timeline.ts` (potongan suara/musik, kata caption per klip), `overlays.ts`, `higgsfield.ts`.
   Jangan menghitung ulang aturan itu di satu sisi saja.
2. **Kunci API milik pengguna (BYOK).** Kunci hanya disimpan terenkripsi lewat `secrets.ts` (AES-256-GCM), hanya dikirim ke
   layanannya masing-masing, dan tidak pernah dicetak ke log, error, atau file.
3. **Migrasi database hanya ditambah di akhir** array `MIGRATIONS` di `src/main/db/index.ts`. Jangan mengubah
   migrasi lama; `PRAGMA user_version` menghitung berapa yang sudah dijalankan.
4. **Kolom klip baru** harus ditambahkan di semua tempat: tipe `Clip` (`shared/types.ts`), migrasi, `toClip`,
   upsert di `saveSnapshot`, `duplicateProject`, `insertClipAfter`, `CLIP_COLS` (kalau di-patch dari main), dan
   nilai bawaan `addClip` di `renderer/src/store/project.ts`. Detail: [docs/data-model.md](docs/data-model.md).
5. **Panggilan baru dari browser** butuh tiga tempat: `handle(...)` di `main/ipc.ts`, tipe di `shared/api.ts`, dan
   `call(...)` di `renderer/src/lib/webApi.ts`. Rute yang tidak berbentuk RPC (unggah, media) ada di `main/server.ts`.
6. **Teks antarmuka berbahasa Indonesia** (santai, pakai "kamu"); **komentar dan nama di kode berbahasa Inggris**.
   Komentar menjelaskan *kenapa*, bukan *apa*.
7. **TypeScript strict** dengan `noUnusedLocals`/`noUnusedParameters`: hapus impor dan variabel yang tidak dipakai.
8. Jangan memakai `<select>` bawaan browser; pakai komponen `Select`/`Popover`. Aturan UI lain ada di
   [docs/konvensi.md](docs/konvensi.md).
9. Jangan mengulang bug yang sudah diperbaiki. Baca [docs/keputusan-teknis.md](docs/keputusan-teknis.md) sebelum
   mengubah ekspor, narasi, Whisper, caption, atau pratinjau video.

## Cara menguji perubahan

- Selalu: `npm run typecheck` lalu `npm run build` (build image Docker menjalankan keduanya).
- Perubahan tampilan atau alur: jalankan container, buka di browser, dan periksa halamannya.
- Perubahan ekspor: ekspor proyek, unduh MP4-nya (atau ambil dari `/data/exports`), lalu periksa dengan ffmpeg
  (durasi video vs audio, cuplikan frame).
- Gunakan `DATA_DIR`/volume terpisah untuk uji agar data dan kunci pengguna tidak tersentuh.
- Server mewajibkan `APP_PASSWORD`; `AUTH_DISABLED=1` hanya untuk uji lokal, jangan dibuka ke internet.

## Dokumentasi lanjutan

| Topik | File |
|---|---|
| Arsitektur, proses, IPC, penyimpanan | [docs/arsitektur.md](docs/arsitektur.md) |
| Skema database dan tipe data | [docs/data-model.md](docs/data-model.md) |
| Alur produksi (naskah → visual → suara → caption) | [docs/alur-produksi.md](docs/alur-produksi.md) |
| Editor, timeline, pratinjau, ekspor | [docs/editor-dan-ekspor.md](docs/editor-dan-ekspor.md) |
| Layanan AI dan kunci API | [docs/layanan-ai.md](docs/layanan-ai.md) |
| Setup, dev harness, build, rilis | [docs/pengembangan.md](docs/pengembangan.md) |
| Gaya kode dan aturan UI | [docs/konvensi.md](docs/konvensi.md) |
| Keputusan teknis dan alasannya | [docs/keputusan-teknis.md](docs/keputusan-teknis.md) |
| Masalah yang diketahui dan ide lanjutan | [docs/masalah-diketahui.md](docs/masalah-diketahui.md) |
