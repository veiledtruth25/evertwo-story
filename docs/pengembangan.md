# Pengembangan dan deploy

EverTwo Story berjalan sebagai aplikasi web di dalam container Docker. Pengembangan boleh memakai Docker saja,
tanpa Node.js di komputer.

## Menjalankan dengan Docker

```bash
cp .env.example .env        # isi APP_PASSWORD dan SECRETS_KEY
docker compose up -d --build
```

Buka `http://<alamat-mesin>:8787` dan masuk dengan `APP_PASSWORD`. Data ada di volume `bang-story-data`
(`/data` di dalam container). Build pertama lama karena whisper.cpp dikompilasi. Untuk melewatinya (caption
Whisper tidak tersedia):

```bash
docker compose build --build-arg WITH_WHISPER=0
```

Build image menjalankan `npm run typecheck` dan `npm run build`, jadi image tidak jadi kalau ada error tipe.

### Variabel lingkungan

| Variabel | Fungsi | Bawaan |
|---|---|---|
| `APP_PASSWORD` | kata sandi login (wajib) | |
| `SECRETS_KEY` | kunci enkripsi API key; kalau kosong dibuat otomatis di `/data/.secret-key` | |
| `SESSION_SECRET` | penanda tangan cookie login; kalau kosong diturunkan dari `APP_PASSWORD` | |
| `PORT`, `HOST` | alamat server | `8787`, `0.0.0.0` |
| `DATA_DIR` | folder data | `./data` (di image: `/data`) |
| `RESOURCES_DIR` | folder `resources/` (font caption) | `./resources` |
| `WEB_DIR` | hasil build web | `./out/web` |
| `FFMPEG_PATH` | biner FFmpeg | `ffmpeg` dari PATH |
| `WHISPER_BIN` | biner `whisper-cli` | `resources/whisper/whisper-cli` |
| `STUDIO_HF_BASE` | base URL Higgsfield tiruan, untuk uji tanpa kredit | API asli |
| `STUDIO_WHISPER_URL` | URL model Whisper alternatif, untuk uji unduhan | Hugging Face |
| `AUTH_DISABLED=1` | matikan login, hanya untuk uji lokal | |

## Di belakang Nginx Proxy Manager

1. Container harus bisa dijangkau NPM: satu jaringan Docker dengan NPM (hapus `ports`, tambahkan
   `networks` ke jaringan NPM), atau lewat `IP:8787` kalau beda mesin.
2. Proxy Host: domain `storyboard.evertwo.id`, forward ke `bang-story:8787` (atau `IP:8787`), aktifkan
   **Block Common Exploits**, tab SSL: minta sertifikat Let's Encrypt, aktifkan **Force SSL**.
3. Tab **Advanced**, isi:

```nginx
client_max_body_size 300m;      # unggah musik dan gambar
proxy_read_timeout 3600s;       # job panjang dan aliran event
proxy_send_timeout 3600s;
proxy_buffering off;            # aliran event (SSE) tidak boleh ditahan
```

4. DNS: A record `storyboard.evertwo.id` → IP publik server NPM.

## Mengembangkan tanpa Docker

Butuh Node.js 22 dan FFmpeg di PATH.

```bash
npm install
npm run dev          # server di :8787 (tanpa login) + Vite di :5173, buka http://localhost:5173
npm run typecheck    # wajib bersih: tsconfig.node.json (server) + tsconfig.web.json (browser)
npm run build        # out/web (browser) + out/server/index.cjs (server)
npm start            # jalankan hasil build
```

Alias impor: `@shared/*` → `src/shared/*` (server dan browser), `@renderer/*` → `src/renderer/src/*`.

`npm run dev` memakai `AUTH_DISABLED=1` dan folder data `./data`. Pakai `DATA_DIR` lain supaya data asli tidak
tersentuh.

## Menguji perubahan

Belum ada unit test.

- Selalu: `npm run typecheck` lalu `npm run build` (atau build image Docker, yang menjalankan keduanya).
- Tampilan dan alur: jalankan container, buka di browser, periksa. Untuk uji otomatis gunakan browser headless
  (misalnya Playwright) yang diarahkan ke `http://localhost:8787`.
- Ekspor: buat proyek, ekspor, unduh MP4-nya (atau ambil dari `/data/exports`), lalu periksa dengan ffmpeg.
- Tanpa kredit: arahkan `STUDIO_HF_BASE` ke server tiruan.

Dev harness lama (skrip JSON untuk Electron) sudah dihapus bersama Electron.

## Menguji modul bersama tanpa aplikasi

Modul `src/shared/*` murni TypeScript dan bisa dijalankan di Node:

```bash
npx esbuild src/shared/captions.ts --bundle --platform=node --format=cjs --outfile=tmp/captions.cjs
node -e "const c = require('./tmp/captions.cjs'); console.log(c.chunkWords([{text:'Halo',start:0,end:0.4}]))"
```

## Memeriksa hasil ekspor

```bash
# durasi video dan audio harus sama dengan jumlah durasi klip
ffmpeg -i hasil.mp4 -map 0:v -c copy -f null -
ffmpeg -i hasil.mp4 -map 0:a -c copy -f null -
# cuplikan frame di detik tertentu
ffmpeg -ss 3.5 -i hasil.mp4 -frames:v 1 frame.png
```

Graph filter terakhir ditulis ke `/data/tmp/export-<id>/graph.txt` selama ekspor berjalan.

## Debugging

- Log server: `docker compose logs -f bang-story`.
- DevTools browser (F12) untuk sisi tampilan.
- Error dari RPC muncul sebagai toast; pesannya berasal dari `throw new Error('...')` di server.
- Cek kesehatan: `GET /healthz` menjawab `ok` tanpa login.

## Backup dan pindah server

Salin volume data (`docker run --rm -v bang-story-data:/data -v $PWD:/b alpine tar czf /b/data.tgz -C /data .`).
Kunci API hanya bisa dibuka lagi kalau `SECRETS_KEY` (atau `.secret-key`) ikut dibawa.

## Versi dan rilis

1. Naikkan versi: `npm version 1.1.0 --no-git-tag-version`. Halaman About membaca versi dari `package.json`.
2. Catat perubahan di `CHANGELOG.md`.
3. `docker compose build` (menjalankan typecheck dan build), lalu `docker compose up -d`.

Image untuk mesin lain (misalnya VPS amd64 dari STB arm64): `docker buildx build --platform linux/amd64 -t bang-story .`
atau build langsung di mesin tujuan.
