# 🎮 EduVerse - Semesta Belajar 3D

Game edukasi 3D interaktif untuk jenjang SD, SMP, dan SMA/SMK. Murid menjelajahi 6 dunia & 21 wilayah 3D sambil mempelajari materi dan menjawab soal buatan guru. Dilengkapi **Mode Guru (Bebas Akses / Gratis)**, **Kelas Online**, **Tantangan Serentak (Lobi 3D & Terjun Parasut)**, **Lari Kilat**, **Jatuh Bangun**, **Jembatan Juara**, **Dashboard Analisis Nilai**, serta **Multiplayer Real-time**.

## ✨ Fitur Utama

- **6 Dunia & 21 Wilayah 3D**: Kota Ilmu, Samudra, Angkasa, Rimba, Nusantara, dan Mancanegara.
- **Mode Permainan Seru**: Jelajah Dunia, Lari Kilat (4 lajur), Jatuh Bangun (Menara 4 Lantai), dan Jembatan Juara.
- **Mode Guru (Gratis & Terbuka)**:
  - Buat soal manual, dengan bantuan AI (ChatGPT/Gemini/Claude), atau impor dari Word & Excel.
  - 5 jenis soal: Pilihan Ganda, Benar/Salah, Isian Singkat, Menjodohkan, dan Mengurutkan.
  - Ruang Materi di setiap gedung (Video YouTube, Google Drive, Gambar, Ringkasan Teks).
  - Kelas Online, Rekap Nilai Rapor, Analisis Butir Soal, Rapor Cetak, & Sertifikat Penghargaan.
  - Pantau pengerjaan murid secara *Live* dan masuk ke dalam dunia 3D bersama murid.

## 🚀 Cara Menjalankan

### 1. Menjalankan dengan Server Penuh (Node.js + WebSocket)
Mendukung seluruh fitur termasuk Kelas Online, Dashboard Nilai, Bank Soal, dan Multiplayer Real-time:

```bash
npm install
npm start
```

- **Game & Mode Guru**: `http://localhost:3000`
- **Panduan Guru**: `http://localhost:3000/guru.html`
- **Dashboard Admin**: `http://localhost:3000/admin.html` (Kode default: `eduverse123`)

### 2. Menjalankan di GitHub Pages (Mode Statis)
Repositori ini juga menyertakan file statis di *root* sehingga dapat langsung diaktifkan melalui **Settings → Pages → Branch: `main` / `(root)`**.
