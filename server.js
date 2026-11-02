/**
 * EduVerse - Semesta Belajar 3D
 * All-in-One Server: Static Frontend + REST API + Realtime WebSocket + Local JSON DB
 */
"use strict";

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const IS_VERCEL = !!process.env.VERCEL;
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = IS_VERCEL ? path.join(os.tmpdir(), "eduverse-data") : path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/* =====================================================================
   DATABASE PERSISTENCE (JSON)
   ===================================================================== */
function defaultDB() {
  return {
    seq: { guru: 1, murid: 1, sesi: 1, tantangan: 1, pendamping: 1, bayar: 1, kode: 1 },
    setelan: {
      google_client_id: "",
      harga: "Gratis (Bebas Akses)",
      wa_admin: "",
      link_beli: "",
      info_bayar: "Mode Guru EduVerse terbuka gratis untuk seluruh guru Indonesia.",
      hari: 365,
      tenggang: 14,
      maks_kelas: 100,
      maks_perangkat: 25,
      daftar_sandi: "1",
      lama_mode: "seumur",
      lama_hari: 365,
      admin_kode: "eduverse123"
    },
    guru: [],
    paket: {},
    kelas: {},
    murid: [],
    sesi: [],
    jawaban: [],
    materi: [],
    tantangan: [],
    tmulai: [],
    pendamping: [],
    bayar: [],
    kodes: [],
    cids: {}
  };
}

let DB = defaultDB();
if (fs.existsSync(DB_FILE)) {
  try {
    const raw = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    DB = Object.assign(defaultDB(), raw);
    DB.seq = Object.assign(defaultDB().seq, raw.seq || {});
    DB.setelan = Object.assign(defaultDB().setelan, raw.setelan || {});
  } catch (e) {
    console.error("Gagal membaca db.json, memakai database baru:", e.message);
  }
}

let saveTimer = null;
function writeDBNow() {
  try {
    const tmp = DB_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(DB, null, 2), "utf8");
    fs.renameSync(tmp, DB_FILE);
  } catch (e) {
    console.error("Gagal menyimpan db.json:", e.message);
  }
}
function saveDB() {
  if (IS_VERCEL) {
    writeDBNow();
    return;
  }
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeDBNow();
  }, 300);
}

/* =====================================================================
   HELPERS
   ===================================================================== */
function randCode(len, digitsOnly) {
  const chars = digitsOnly ? "0123456789" : "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function genToken() {
  return crypto.randomBytes(16).toString("hex");
}

function skey(s) {
  const t = String(s.q) + "|" + (s.opsi ? s.opsi.join("|") : JSON.stringify(s.pasangan || s.urutan || s.kunci || ""));
  let h = 5381;
  for (let i = 0; i < t.length; i++) {
    h = ((h << 5) + h + t.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

function packInfo(pk) {
  if (!pk || !Array.isArray(pk.mapel)) return { jenjang: "", mapel: 0, soal: 0, materi: 0, nama: [] };
  let soal = 0, materi = 0;
  const nama = [];
  pk.mapel.forEach(m => {
    if (m.nama) nama.push(m.nama);
    soal += Array.isArray(m.soal) ? m.soal.length : 0;
    materi += Array.isArray(m.materi) ? m.materi.length : 0;
  });
  return {
    jenjang: pk.jenjang || "",
    mapel: pk.mapel.length,
    soal,
    materi,
    nama
  };
}

function stripRahasia(pk) {
  if (!pk || !Array.isArray(pk.mapel)) return pk;
  const copy = JSON.parse(JSON.stringify(pk));
  copy.mapel = copy.mapel.map(m => {
    if (m.rahasia) {
      return Object.assign({}, m, { soal: [] });
    }
    return m;
  });
  return copy;
}

function getRahasiaMapels(pk) {
  if (!pk || !Array.isArray(pk.mapel)) return [];
  return pk.mapel.filter(m => m.rahasia);
}

function normWa(wa) {
  let d = String(wa || "").replace(/\D/g, "");
  if (d.startsWith("0")) d = "62" + d.slice(1);
  return d;
}

/* Ensure or resolve a teacher from `lic` payload (Open & Free Mode Guru) */
function resolveGuru(lic) {
  if (!lic) lic = { sess: "free-default", dev: "default-dev" };
  if (lic.pdp) {
    const pdp = DB.pendamping.find(p => p.token === lic.pdp);
    if (!pdp) return { error: "Akses guru pendamping sudah dicabut atau tidak berlaku.", status: 403, kode: "pdp" };
    pdp.aktif = Date.now();
    saveDB();
    return { pdp };
  }
  let g = null;
  if (lic.sess) {
    g = DB.guru.find(x => (x.sess || []).includes(lic.sess));
  }
  if (!g && lic.dev) {
    g = DB.guru.find(x => (x.dev || []).includes(lic.dev));
  }
  if (!g) {
    // Auto-create free active lifetime teacher account for seamless access
    const id = DB.seq.guru++;
    const sess = lic.sess || ("free-" + genToken());
    const dev = lic.dev || "dev-local";
    g = {
      id,
      nama: "Guru EduVerse",
      email: "guru" + id + "@eduverse.id",
      sandi: "",
      wa: "",
      wa_norm: "",
      sekolah: "Sekolah EduVerse",
      google: false,
      status: "seumur",
      sampai: -1,
      tenggang_sampai: 0,
      maks_kelas: 100,
      maks_perangkat: 25,
      aktif: true,
      dibuat: Date.now(),
      terakhir_masuk: Date.now(),
      sess: [sess],
      dev: [dev],
      soal_paket: null,
      soal_pk: "",
      soal_diubah: 0,
      bukti: "Akses Gratis EduVerse",
      catatan: "",
      total_bayar: 0
    };
    DB.guru.push(g);
    saveDB();
  } else {
    g.terakhir_masuk = Date.now();
    // Always keep free lifetime active unless explicitly blocked by admin
    if (g.aktif !== false && g.status !== "blokir") {
      g.status = "seumur";
      g.sampai = -1;
    }
    if (lic.sess && !(g.sess || []).includes(lic.sess)) {
      g.sess = (g.sess || []).concat([lic.sess]).slice(-20);
    }
    if (lic.dev && !(g.dev || []).includes(lic.dev)) {
      g.dev = (g.dev || []).concat([lic.dev]).slice(-25);
    }
    saveDB();
  }
  return { guru: g };
}

function formatGuruPublic(g) {
  const jmlKelas = Object.values(DB.kelas).filter(k => k.guru_id === g.id).length;
  return {
    id: g.id,
    nama: g.nama,
    email: g.email,
    wa: g.wa || g.wa_norm || "",
    sekolah: g.sekolah || "",
    google: !!g.google,
    sandi: !!g.sandi,
    status: g.aktif === false ? "blokir" : "seumur",
    sampai: -1,
    tenggang_sampai: 0,
    kelas: jmlKelas,
    maks_kelas: g.maks_kelas || 100,
    perangkat: (g.dev || []).length || 1,
    maks_perangkat: g.maks_perangkat || 25
  };
}

function checkKelasAccess(lic, kode, pin, allowPdp) {
  const kd = String(kode || "").trim().toUpperCase();
  let k = DB.kelas[kd];
  const auth = resolveGuru(lic);
  if (auth.error) return auth;
  if (!k && kd && !auth.pdp) {
    // Auto-restore class on serverless cold start if missing from /tmp
    const g = auth.guru;
    const now = Date.now();
    k = DB.kelas[kd] = {
      kode: kd,
      guru_id: g ? g.id : 1,
      nama: "Kelas " + kd,
      guru: (g && g.nama) || "Guru EduVerse",
      pin: String(pin || "123456"),
      paket: (g && g.soal_paket) || { judul: "Paket Kelas", mapel: [] },
      paket_kode: (g && g.soal_pk) || "",
      diubah: now,
      kunci: false,
      rekap: null,
      dibuat: now
    };
    saveDB();
  }
  if (!k) return { error: "Kelas tidak ditemukan.", status: 404 };
  if (auth.pdp) {
    if (!allowPdp || auth.pdp.kelas_kode !== k.kode) {
      return { error: "Akses ini hanya untuk guru utama kelas.", status: 403 };
    }
    return { kelas: k, pdp: auth.pdp };
  }
  if (pin !== undefined && k.pin && String(pin) !== String(k.pin)) {
    return { error: "PIN guru salah.", status: 403 };
  }
  return { kelas: k, guru: auth.guru };
}

/* =====================================================================
   HTTP SERVER & REST API
   ===================================================================== */
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-kode"
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 15 * 1024 * 1024) req.destroy();
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

async function handleApi(req, res, pathname, query) {
  const body = req.method === "POST" ? await readJsonBody(req) : {};

  // Auto-sync teacher class metadata on serverless cold starts
  if (body && body._kmeta && body._kmeta.kode) {
    const km = body._kmeta;
    const kd = String(km.kode || "").trim().toUpperCase();
    if (kd && !DB.kelas[kd]) {
      const auth = resolveGuru(body.lic);
      const g = auth.guru;
      const now = Date.now();
      const pkKode = String(km.pk || "").trim().toUpperCase();
      if (pkKode && km.paket && !DB.paket[pkKode]) {
        DB.paket[pkKode] = {
          kode: pkKode,
          guru_id: g ? g.id : 1,
          guru: km.guru || (g && g.nama) || "Guru EduVerse",
          sekolah: (g && g.sekolah) || "",
          judul: km.paket.judul || "Paket Soal",
          paket: km.paket,
          diubah: now,
          dibuka: 0,
          publik: true,
          bank: false,
          bank_t: 0,
          bank_pakai: 0
        };
      }
      DB.kelas[kd] = {
        kode: kd,
        guru_id: g ? g.id : 1,
        nama: String(km.nama || ("Kelas " + kd)).slice(0, 40),
        guru: String(km.guru || (g && g.nama) || "Guru EduVerse"),
        pin: String(km.pin || body.pin || "123456"),
        paket: km.paket || { judul: "Paket Kelas", mapel: [] },
        paket_kode: pkKode,
        diubah: now,
        kunci: false,
        rekap: null,
        dibuat: now
      };
      saveDB();
    }
    if (kd && Array.isArray(km.tantangan) && pathname !== "/tantangan/hapus") {
      let tChanged = false;
      km.tantangan.forEach(tIn => {
        if (!tIn || !tIn.id) return;
        const tid = Number(tIn.id);
        if (!DB.tantangan.some(x => x.kelas_kode === kd && x.id === tid)) {
          DB.tantangan.push(Object.assign({}, tIn, { id: tid, kelas_kode: kd }));
          if (DB.seq.tantangan <= tid) DB.seq.tantangan = tid + 1;
          tChanged = true;
        }
      });
      if (tChanged) saveDB();
    }
  }

  // Auto-sync student & class metadata on serverless cold starts
  if (body && body._mmeta && body._mmeta.kode) {
    const mm = body._mmeta;
    const kd = String(mm.kode || "").trim().toUpperCase();
    let mChanged = false;
    if (kd && !DB.kelas[kd]) {
      const now = Date.now();
      DB.kelas[kd] = {
        kode: kd,
        guru_id: 1,
        nama: String(mm.kelas || ("Kelas " + kd)).slice(0, 40),
        guru: String(mm.guru || "Guru EduVerse"),
        pin: "123456",
        paket: mm.paket || { judul: "Paket Kelas", mapel: [] },
        paket_kode: String(mm.pk || ""),
        diubah: Number(mm.pv || now),
        kunci: false,
        rekap: null,
        dibuat: now
      };
      mChanged = true;
    }
    if (kd && mm.token && mm.nama && mm.absen) {
      let m = DB.murid.find(x => x.kelas_kode === kd && x.token === String(mm.token));
      if (!m) {
        m = DB.murid.find(
          x => x.kelas_kode === kd && x.absen === Number(mm.absen) && x.nama.toLowerCase() === String(mm.nama).toLowerCase()
        );
        if (m) {
          m.token = String(mm.token);
          m.aktif = Date.now();
        } else {
          m = {
            id: DB.seq.murid++,
            kelas_kode: kd,
            nama: String(mm.nama).slice(0, 24),
            absen: Number(mm.absen),
            token: String(mm.token),
            aktif: Date.now(),
            blokir: false
          };
          DB.murid.push(m);
        }
        mChanged = true;
      }
    }
    if (kd && mm.tan && mm.tan.id) {
      const tid = Number(mm.tan.id);
      if (!DB.tantangan.some(x => x.kelas_kode === kd && x.id === tid)) {
        DB.tantangan.push(Object.assign({}, mm.tan, { id: tid, kelas_kode: kd }));
        if (DB.seq.tantangan <= tid) DB.seq.tantangan = tid + 1;
        mChanged = true;
      }
    }
    if (mChanged) saveDB();
  }

  // 1. Setelan umum
  if (pathname === "/setelan") {
    return sendJson(res, 200, {
      google: DB.setelan.google_client_id || "",
      harga: DB.setelan.harga || "Gratis (Bebas Akses)",
      wa: DB.setelan.wa_admin || "",
      beli: DB.setelan.link_beli || "",
      info: DB.setelan.info_bayar || "",
      sandi: DB.setelan.daftar_sandi !== "0"
    });
  }

  // 2. Akun Guru (Masuk / Daftar / Saya / Ubah / Sandi / Keluar)
  if (pathname === "/akun/masuk") {
    const email = String(body.email || "").trim().toLowerCase();
    const sandi = String(body.sandi || "");
    const dev = String(body.dev || "dev-local");
    let g = DB.guru.find(x => (x.email || "").toLowerCase() === email);
    if (!g) {
      // Auto-register on login if email doesn't exist yet for frictionless free experience
      const id = DB.seq.guru++;
      const sess = "sess-" + genToken();
      g = {
        id,
        nama: email.split("@")[0] || "Guru EduVerse",
        email: email || ("guru" + id + "@eduverse.id"),
        sandi,
        wa: "",
        wa_norm: "",
        sekolah: "",
        google: false,
        status: "seumur",
        sampai: -1,
        tenggang_sampai: 0,
        maks_kelas: 100,
        maks_perangkat: 25,
        aktif: true,
        dibuat: Date.now(),
        terakhir_masuk: Date.now(),
        sess: [sess],
        dev: [dev],
        soal_paket: null,
        soal_pk: "",
        soal_diubah: 0,
        bukti: "Gratis",
        catatan: "",
        total_bayar: 0
      };
      DB.guru.push(g);
      saveDB();
      return sendJson(res, 200, { sess, guru: formatGuruPublic(g) });
    }
    if (g.sandi && sandi && g.sandi !== sandi) {
      return sendJson(res, 400, { error: "Kata sandi salah." });
    }
    const sess = "sess-" + genToken();
    g.sess = (g.sess || []).concat([sess]).slice(-20);
    if (dev && !(g.dev || []).includes(dev)) g.dev = (g.dev || []).concat([dev]).slice(-25);
    g.terakhir_masuk = Date.now();
    g.status = "seumur";
    g.sampai = -1;
    saveDB();
    return sendJson(res, 200, { sess, guru: formatGuruPublic(g) });
  }

  if (pathname === "/akun/daftar") {
    const email = String(body.email || "").trim().toLowerCase() || ("guru" + DB.seq.guru + "@eduverse.id");
    const dev = String(body.dev || "dev-local");
    let g = DB.guru.find(x => (x.email || "").toLowerCase() === email);
    const sess = "sess-" + genToken();
    if (!g) {
      const id = DB.seq.guru++;
      g = {
        id,
        nama: String(body.nama || "Guru EduVerse").trim(),
        email,
        sandi: String(body.sandi || ""),
        wa: String(body.wa || "").trim(),
        wa_norm: normWa(body.wa),
        sekolah: String(body.sekolah || "").trim(),
        google: body.cara === "google",
        status: "seumur",
        sampai: -1,
        tenggang_sampai: 0,
        maks_kelas: 100,
        maks_perangkat: 25,
        aktif: true,
        dibuat: Date.now(),
        terakhir_masuk: Date.now(),
        sess: [sess],
        dev: [dev],
        soal_paket: null,
        soal_pk: "",
        soal_diubah: 0,
        bukti: String(body.bukti || "Gratis"),
        catatan: "",
        total_bayar: 0
      };
      DB.guru.push(g);
    } else {
      if (body.nama) g.nama = String(body.nama).trim();
      if (body.sandi) g.sandi = String(body.sandi);
      if (body.wa) { g.wa = String(body.wa).trim(); g.wa_norm = normWa(body.wa); }
      if (body.sekolah) g.sekolah = String(body.sekolah).trim();
      g.status = "seumur";
      g.sampai = -1;
      g.sess = (g.sess || []).concat([sess]).slice(-20);
      if (dev && !(g.dev || []).includes(dev)) g.dev = (g.dev || []).concat([dev]).slice(-25);
    }
    saveDB();
    return sendJson(res, 200, { sess, guru: formatGuruPublic(g) });
  }

  if (pathname === "/akun/google") {
    const auth = resolveGuru({ sess: "google-free", dev: body.dev });
    const g = auth.guru;
    const sess = "sess-" + genToken();
    g.sess = (g.sess || []).concat([sess]).slice(-20);
    saveDB();
    return sendJson(res, 200, { sess, guru: formatGuruPublic(g) });
  }

  if (pathname === "/akun/saya") {
    const auth = resolveGuru(body.lic);
    if (auth.error) return sendJson(res, auth.status || 403, { error: auth.error, kode: auth.kode });
    const g = auth.guru;
    return sendJson(res, 200, {
      guru: formatGuruPublic(g),
      setelan: {
        harga: DB.setelan.harga,
        wa: DB.setelan.wa_admin,
        beli: DB.setelan.link_beli,
        info: DB.setelan.info_bayar
      },
      bayar: DB.bayar.filter(b => b.guru_id === g.id)
    });
  }

  if (pathname === "/akun/ubah") {
    const auth = resolveGuru(body.lic);
    if (auth.error) return sendJson(res, auth.status || 403, { error: auth.error });
    const g = auth.guru;
    if (body.nama) g.nama = String(body.nama).trim();
    if (body.wa !== undefined) { g.wa = String(body.wa).trim(); g.wa_norm = normWa(body.wa); }
    if (body.sekolah !== undefined) g.sekolah = String(body.sekolah).trim();
    saveDB();
    return sendJson(res, 200, { ok: true, guru: formatGuruPublic(g) });
  }

  if (pathname === "/akun/sandi") {
    const auth = resolveGuru(body.lic);
    if (auth.error) return sendJson(res, auth.status || 403, { error: auth.error });
    const g = auth.guru;
    if (g.sandi && body.lama && g.sandi !== body.lama) {
      return sendJson(res, 400, { error: "Kata sandi lama tidak cocok." });
    }
    g.sandi = String(body.baru || "");
    saveDB();
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === "/akun/keluar") {
    if (body.lic && body.lic.sess) {
      const g = DB.guru.find(x => (x.sess || []).includes(body.lic.sess));
      if (g) {
        g.sess = (g.sess || []).filter(s => s !== body.lic.sess);
        saveDB();
      }
    }
    return sendJson(res, 200, { ok: true });
  }

  // 3. Guru Soal Cloud Sync & Kelas List
  if (pathname === "/guru/soal/simpan") {
    const auth = resolveGuru(body.lic);
    if (auth.error) return sendJson(res, auth.status || 403, { error: auth.error });
    const g = auth.guru;
    g.soal_paket = body.paket || null;
    g.soal_pk = body.pk || "";
    g.soal_diubah = Date.now();
    saveDB();
    return sendJson(res, 200, { diubah: g.soal_diubah });
  }

  if (pathname === "/guru/soal/ambil") {
    const auth = resolveGuru(body.lic);
    if (auth.error) return sendJson(res, auth.status || 403, { error: auth.error });
    const g = auth.guru;
    return sendJson(res, 200, {
      paket: g.soal_paket || null,
      pk: g.soal_pk || "",
      diubah: g.soal_diubah || 0
    });
  }

  if (pathname === "/guru/kelas") {
    const auth = resolveGuru(body.lic);
    if (auth.error) return sendJson(res, auth.status || 403, { error: auth.error });
    const g = auth.guru;
    if (Array.isArray(body.kelas_lokal)) {
      const now = Date.now();
      let changed = false;
      body.kelas_lokal.forEach(c => {
        if (!c || !c.kode) return;
        const kd = String(c.kode).trim().toUpperCase();
        if (kd && !DB.kelas[kd]) {
          DB.kelas[kd] = {
            kode: kd,
            guru_id: g.id,
            nama: String(c.nama || ("Kelas " + kd)).slice(0, 40),
            guru: String(body.guru || g.nama || "Guru EduVerse"),
            pin: String(c.pin || "123456"),
            paket: body.paket || g.soal_paket || { judul: "Paket Kelas", mapel: [] },
            paket_kode: String(c.pk || ""),
            diubah: now,
            kunci: false,
            rekap: null,
            dibuat: now
          };
          changed = true;
        }
      });
      if (changed) saveDB();
    }
    const list = Object.values(DB.kelas)
      .filter(k => k.guru_id === g.id)
      .map(k => ({ kode: k.kode, nama: k.nama }));
    return sendJson(res, 200, { maks_kelas: g.maks_kelas || 100, kelas: list });
  }

  // 4. Paket Saya & Link Latihan
  if (pathname === "/paket/daftar") {
    const auth = resolveGuru(body.lic);
    if (auth.error) return sendJson(res, auth.status || 403, { error: auth.error });
    const g = auth.guru;
    const list = Object.values(DB.paket)
      .filter(p => p.guru_id === g.id)
      .sort((a, b) => (b.diubah || 0) - (a.diubah || 0))
      .map(p => {
        const kls = Object.values(DB.kelas)
          .filter(k => k.paket_kode === p.kode)
          .map(k => ({ kode: k.kode, nama: k.nama }));
        const ses = DB.sesi.filter(s => s.paket_kode === p.kode);
        const mSet = new Set(ses.map(s => s.murid_id));
        return {
          kode: p.kode,
          judul: p.judul,
          diubah: p.diubah,
          dibuka: p.dibuka || 0,
          info: packInfo(p.paket),
          kelas: kls,
          murid: mSet.size,
          sesi: ses.length,
          bank: !!p.bank,
          bank_pakai: p.bank_pakai || 0,
          publik: !!p.publik
        };
      });
    return sendJson(res, 200, { paket: list });
  }

  if (pathname === "/paket/simpan") {
    const auth = resolveGuru(body.lic);
    if (auth.error) return sendJson(res, auth.status || 403, { error: auth.error });
    const g = auth.guru;
    const pk = body.paket;
    if (!pk || !Array.isArray(pk.mapel)) {
      return sendJson(res, 400, { error: "Data paket soal tidak valid." });
    }
    let kode = String(body.kode || "").trim().toUpperCase();
    let existing = kode ? DB.paket[kode] : null;
    if (kode && !existing) {
      return sendJson(res, 404, { error: "Paket tidak ditemukan." });
    }
    if (!kode) {
      do {
        kode = randCode(6, false);
      } while (DB.paket[kode] || DB.kelas[kode]);
    }
    const now = Date.now();
    DB.paket[kode] = {
      kode,
      guru_id: g.id,
      guru: pk.guru || g.nama || "Guru EduVerse",
      sekolah: g.sekolah || "",
      judul: pk.judul || "Paket Soal",
      paket: pk,
      diubah: now,
      dibuka: existing ? existing.dibuka || 0 : 0,
      publik: existing ? !!existing.publik : true,
      bank: existing ? !!existing.bank : false,
      bank_t: existing ? existing.bank_t || 0 : 0,
      bank_pakai: existing ? existing.bank_pakai || 0 : 0
    };
    saveDB();
    return sendJson(res, 200, { kode, diubah: now });
  }

  if (pathname === "/paket/ambil") {
    const auth = resolveGuru(body.lic);
    if (auth.error) return sendJson(res, auth.status || 403, { error: auth.error });
    const kode = String(body.kode || "").trim().toUpperCase();
    const p = DB.paket[kode];
    if (!p) return sendJson(res, 404, { error: "Paket tidak ditemukan." });
    return sendJson(res, 200, { kode: p.kode, judul: p.judul, paket: p.paket, diubah: p.diubah });
  }

  if (pathname === "/paket/publik") {
    const auth = resolveGuru(body.lic);
    if (auth.error) return sendJson(res, auth.status || 403, { error: auth.error });
    const kode = String(body.kode || "").trim().toUpperCase();
    const p = DB.paket[kode];
    if (!p) return sendJson(res, 404, { error: "Paket tidak ditemukan." });
    p.publik = !!body.publik;
    saveDB();
    return sendJson(res, 200, { ok: true, publik: p.publik });
  }

  if (pathname === "/paket/hapus") {
    const auth = resolveGuru(body.lic);
    if (auth.error) return sendJson(res, auth.status || 403, { error: auth.error });
    const kode = String(body.kode || "").trim().toUpperCase();
    delete DB.paket[kode];
    saveDB();
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === "/paket/hasil") {
    const auth = resolveGuru(body.lic);
    if (auth.error) return sendJson(res, auth.status || 403, { error: auth.error });
    const kode = String(body.kode || "").trim().toUpperCase();
    const p = DB.paket[kode];
    if (!p) return sendJson(res, 404, { error: "Paket tidak ditemukan." });
    const muridById = {};
    DB.murid.forEach(m => { muridById[m.id] = m; });
    const sesList = DB.sesi
      .filter(s => s.paket_kode === kode && s.mapel_id !== "_petualangan")
      .map(s => {
        const u = muridById[s.murid_id] || { nama: "Murid", absen: 0 };
        const kl = DB.kelas[s.kelas_kode] || { nama: s.kelas_kode };
        return {
          kelas: s.kelas_kode,
          kelas_nama: kl.nama,
          murid: s.murid_id,
          nama: u.nama,
          absen: u.absen,
          nilai: s.nilai,
          t: s.t,
          lama: !!s.soal_lama
        };
      });
    const sesIds = new Set(DB.sesi.filter(s => s.paket_kode === kode).map(s => s.id));
    const soalAgg = {};
    DB.jawaban.forEach(j => {
      if (!sesIds.has(j.sesi_id)) return;
      const k = j.mapel_id + "|" + j.skey;
      if (!soalAgg[k]) soalAgg[k] = { q: j.q, n: 0, b: 0 };
      soalAgg[k].n++;
      soalAgg[k].b += j.ok ? 1 : 0;
    });
    return sendJson(res, 200, {
      judul: p.judul,
      info: packInfo(p.paket),
      sesi: sesList,
      soal: Object.values(soalAgg)
    });
  }

  if (pathname.startsWith("/paket/")) {
    const kode = pathname.slice("/paket/".length).trim().toUpperCase();
    const p = DB.paket[kode];
    if (!p) return sendJson(res, 404, { error: "Kode paket latihan tidak ditemukan." });
    p.dibuka = (p.dibuka || 0) + 1;
    saveDB();
    return sendJson(res, 200, { kode: p.kode, judul: p.judul, paket: stripRahasia(p.paket) });
  }

  // 5. Bank Soal Bersama
  if (pathname === "/bank/terbit") {
    const auth = resolveGuru(body.lic);
    if (auth.error) return sendJson(res, auth.status || 403, { error: auth.error });
    const kode = String(body.kode || "").trim().toUpperCase();
    const p = DB.paket[kode];
    if (!p) return sendJson(res, 404, { error: "Paket tidak ditemukan." });
    p.bank = !!body.bank;
    if (p.bank && !p.bank_t) p.bank_t = Date.now();
    saveDB();
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === "/bank/cari") {
    const q = String(body.q || "").trim().toLowerCase();
    const jenjang = String(body.jenjang || "").trim().toLowerCase();
    const urut = String(body.urut || "baru");
    let list = Object.values(DB.paket).filter(p => p.bank);
    if (jenjang) {
      list = list.filter(p => String((p.paket && p.paket.jenjang) || "").toLowerCase().includes(jenjang));
    }
    if (q) {
      list = list.filter(p => {
        const inf = packInfo(p.paket);
        const hay = [p.judul, p.guru, p.sekolah, inf.jenjang, inf.nama.join(" ")].join(" ").toLowerCase();
        return hay.includes(q);
      });
    }
    if (urut === "populer") {
      list.sort((a, b) => (b.bank_pakai || 0) - (a.bank_pakai || 0) || (b.bank_t || 0) - (a.bank_t || 0));
    } else {
      list.sort((a, b) => (b.bank_t || b.diubah || 0) - (a.bank_t || a.diubah || 0));
    }
    return sendJson(res, 200, {
      paket: list.map(p => ({
        kode: p.kode,
        judul: p.judul,
        guru: p.guru,
        sekolah: p.sekolah || "",
        diubah: p.diubah,
        bank_t: p.bank_t || p.diubah,
        pakai: p.bank_pakai || 0,
        info: packInfo(p.paket)
      }))
    });
  }

  if (pathname === "/bank/ambil") {
    const kode = String(body.kode || "").trim().toUpperCase();
    const p = DB.paket[kode];
    if (!p || !p.bank) return sendJson(res, 404, { error: "Paket tidak ditemukan di Bank Soal." });
    if (body.pakai) {
      p.bank_pakai = (p.bank_pakai || 0) + 1;
      saveDB();
    }
    return sendJson(res, 200, { kode: p.kode, judul: p.judul, guru: p.guru, paket: p.paket });
  }

  // 6. Kelas & Murid
  if (pathname === "/kelas/buat") {
    const auth = resolveGuru(body.lic);
    if (auth.error) return sendJson(res, auth.status || 403, { error: auth.error });
    const g = auth.guru;
    const nama = String(body.nama || "").trim();
    const guruNama = String(body.guru || g.nama || "Guru").trim();
    const pin = String(body.pin || "").trim();
    if (!nama || !pin) return sendJson(res, 400, { error: "Nama kelas dan PIN wajib diisi." });
    let kode = "";
    do {
      kode = randCode(6, false);
    } while (DB.kelas[kode] || DB.paket[kode]);
    const now = Date.now();
    let paket = body.paket;
    const pkKode = String(body.paket_kode || "").trim().toUpperCase();
    if (!paket && pkKode && DB.paket[pkKode]) {
      paket = DB.paket[pkKode].paket;
    }
    DB.kelas[kode] = {
      kode,
      guru_id: g.id,
      nama,
      guru: guruNama,
      pin,
      paket: paket || { judul: "Paket Kelas", mapel: [] },
      paket_kode: pkKode,
      diubah: now,
      kunci: false,
      rekap: null,
      dibuat: now
    };
    saveDB();
    return sendJson(res, 200, { kode, diubah: now });
  }

  if (pathname === "/kelas/paket") {
    const chk = checkKelasAccess(body.lic, body.kode, body.pin, false);
    if (chk.error) return sendJson(res, chk.status || 403, { error: chk.error });
    const k = chk.kelas;
    const pkKode = String(body.paket_kode || "").trim().toUpperCase();
    let pk = body.paket;
    if (!pk && pkKode && DB.paket[pkKode]) {
      pk = DB.paket[pkKode].paket;
    }
    if (!pk) return sendJson(res, 400, { error: "Paket soal tidak ditemukan." });
    k.paket = pk;
    k.paket_kode = pkKode || k.paket_kode || "";
    k.diubah = Date.now();
    saveDB();
    return sendJson(res, 200, { ok: true, diubah: k.diubah });
  }

  if (pathname === "/kelas/paket/ambil") {
    const chk = checkKelasAccess(body.lic, body.kode, body.pin, false);
    if (chk.error) return sendJson(res, chk.status || 403, { error: chk.error });
    const k = chk.kelas;
    return sendJson(res, 200, { paket: k.paket, paket_kode: k.paket_kode || "", diubah: k.diubah });
  }

  if (pathname === "/kelas/ubah") {
    const chk = checkKelasAccess(body.lic, body.kode, body.pin, false);
    if (chk.error) return sendJson(res, chk.status || 403, { error: chk.error });
    const k = chk.kelas;
    if (body.nama) k.nama = String(body.nama).trim().slice(0, 40);
    saveDB();
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === "/kelas/kunci") {
    const chk = checkKelasAccess(body.lic, body.kode, body.pin, true);
    if (chk.error) return sendJson(res, chk.status || 403, { error: chk.error });
    chk.kelas.kunci = !!body.on;
    saveDB();
    return sendJson(res, 200, { ok: true, kunci: chk.kelas.kunci });
  }

  if (pathname === "/kelas/rekap") {
    const chk = checkKelasAccess(body.lic, body.kode, body.pin, true);
    if (chk.error) return sendJson(res, chk.status || 403, { error: chk.error });
    chk.kelas.rekap = body.rekap || {};
    saveDB();
    return sendJson(res, 200, { rekap: chk.kelas.rekap });
  }

  if (pathname === "/kelas/pengumuman") {
    const chk = checkKelasAccess(body.lic, body.kode, body.pin, true);
    if (chk.error) return sendJson(res, chk.status || 403, { error: chk.error });
    const k = chk.kelas;
    const text = String(body.text || "").trim().slice(0, 140);
    if (!text) return sendJson(res, 400, { error: "Tulis pengumuman dulu." });
    const now = Date.now();
    k.ann = {
      id: now,
      nama: k.guru || "Guru",
      text,
      z: String(body.z || "kota"),
      call: !!body.call,
      at: now
    };
    saveDB();
    return sendJson(res, 200, { ok: true, ann: k.ann });
  }

  if (pathname.startsWith("/kelas/")) {
    const kode = pathname.slice("/kelas/".length).trim().toUpperCase();
    const k = DB.kelas[kode];
    if (!k) return sendJson(res, 404, { error: "Kode kelas tidak ditemukan." });
    const v = Number(query.get("v") || 0);
    const sama = v > 0 && v === k.diubah;
    return sendJson(res, 200, {
      kode: k.kode,
      nama: k.nama,
      guru: k.guru,
      diubah: k.diubah,
      paket_kode: k.paket_kode || "",
      sama,
      paket: sama ? null : stripRahasia(k.paket)
    });
  }

  // 7. Murid Masuk, Riwayat, Hapus, Blokir, Catat
  if (pathname === "/murid/masuk") {
    const kode = String(body.kode || "").trim().toUpperCase();
    const nama = String(body.nama || "").trim();
    const absen = parseInt(body.absen, 10);
    const tokenIn = String(body.token || "").trim();
    const k = DB.kelas[kode];
    if (!k) return sendJson(res, 404, { error: "Kode kelas tidak ditemukan. Periksa kembali kode dari gurumu." });
    if (!nama || !absen || isNaN(absen)) {
      return sendJson(res, 400, { error: "Lengkapi nama panggilan dan nomor absen." });
    }
    let m = null;
    if (tokenIn) {
      m = DB.murid.find(x => x.kelas_kode === kode && x.token === tokenIn);
    }
    if (!m) {
      m = DB.murid.find(x => x.kelas_kode === kode && x.absen === absen && x.nama.toLowerCase() === nama.toLowerCase());
    }
    if (m && m.blokir) {
      return sendJson(res, 403, { error: "Kamu telah dikeluarkan dari kelas ini oleh guru.", kode: "blokir" });
    }
    if (!m) {
      if (k.kunci) {
        return sendJson(res, 403, { error: "Kelas sudah dikunci oleh guru. Murid baru tidak bisa mendaftar." });
      }
      m = {
        id: DB.seq.murid++,
        kelas_kode: kode,
        nama,
        absen,
        token: genToken(),
        aktif: Date.now(),
        blokir: false
      };
      DB.murid.push(m);
    } else {
      m.nama = nama;
      m.absen = absen;
      m.aktif = Date.now();
    }
    saveDB();
    return sendJson(res, 200, {
      token: m.token,
      nama: m.nama,
      absen: m.absen,
      kelas: { kode: k.kode, nama: k.nama, guru: k.guru },
      paket: stripRahasia(k.paket),
      paket_kode: k.paket_kode || "",
      diubah: k.diubah
    });
  }

  if (pathname === "/murid/riwayat") {
    const kode = String(body.kode || "").trim().toUpperCase();
    const token = String(body.token || "").trim();
    const m = DB.murid.find(x => x.kelas_kode === kode && x.token === token);
    if (!m) return sendJson(res, 401, { error: "Murid tidak dikenali." });
    if (m.blokir) return sendJson(res, 403, { error: "Dikeluarkan dari kelas.", kode: "blokir" });
    const riwayat = DB.sesi
      .filter(s => s.murid_id === m.id)
      .sort((a, b) => b.t - a.t)
      .slice(0, 200)
      .map(s => {
        const tan = s.tantangan_id ? DB.tantangan.find(t => t.id === s.tantangan_id) : null;
        const hideScore = tan && !tan.hasil && tan.jenis !== "petualangan";
        const pkTitle = s.paket_kode && DB.paket[s.paket_kode] ? DB.paket[s.paket_kode].judul : "";
        return {
          t: s.t,
          m: s.mapel_nama,
          pk: pkTitle,
          b: hideScore ? null : s.benar,
          tot: s.total,
          n: hideScore ? null : s.nilai,
          k: s.tantangan_id ? "tantangan" : "kuis",
          j: tan ? tan.judul : "",
          w: s.dunia || ""
        };
      });
    return sendJson(res, 200, { riwayat });
  }

  if (pathname === "/murid/hapus") {
    const chk = checkKelasAccess(body.lic, body.kode, body.pin, false);
    if (chk.error) return sendJson(res, chk.status || 403, { error: chk.error });
    const ids = Array.isArray(body.ids) ? body.ids.map(Number) : (body.id ? [Number(body.id)] : []);
    const idSet = new Set(ids);
    DB.murid = DB.murid.filter(m => !(m.kelas_kode === chk.kelas.kode && idSet.has(m.id)));
    DB.sesi = DB.sesi.filter(s => !(s.kelas_kode === chk.kelas.kode && idSet.has(s.murid_id)));
    DB.jawaban = DB.jawaban.filter(j => !(j.kelas_kode === chk.kelas.kode && idSet.has(j.murid_id)));
    DB.materi = DB.materi.filter(x => !(x.kelas_kode === chk.kelas.kode && idSet.has(x.murid_id)));
    DB.tmulai = DB.tmulai.filter(x => !(x.kelas_kode === chk.kelas.kode && idSet.has(x.murid_id)));
    saveDB();
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === "/murid/blokir") {
    const chk = checkKelasAccess(body.lic, body.kode, body.pin, true);
    if (chk.error) return sendJson(res, chk.status || 403, { error: chk.error });
    const m = DB.murid.find(x => x.kelas_kode === chk.kelas.kode && x.id === Number(body.id));
    if (!m) return sendJson(res, 404, { error: "Murid tidak ditemukan." });
    m.blokir = !!body.on;
    saveDB();
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === "/catat") {
    const kode = String(body.kode || "").trim().toUpperCase();
    const token = String(body.token || "").trim();
    const k = DB.kelas[kode];
    if (!k) return sendJson(res, 400, { error: "Kelas tidak ditemukan." });
    const m = DB.murid.find(x => x.kelas_kode === kode && x.token === token);
    if (!m) return sendJson(res, 401, { error: "Sesi murid tidak ditemukan." });
    if (m.blokir) return sendJson(res, 403, { error: "Kamu dikeluarkan dari kelas.", kode: "blokir" });

    m.aktif = Date.now();
    const cid = String(body.cid || "");
    if (cid && DB.cids[cid]) {
      return sendJson(res, 200, { ok: true, dup: true });
    }
    if (cid) DB.cids[cid] = Date.now();

    let sesiId = 0;
    if (body.sesi) {
      const s = body.sesi;
      sesiId = DB.seq.sesi++;
      let telat = 0;
      if (s.tantangan) {
        const tan = DB.tantangan.find(t => t.id === Number(s.tantangan));
        if (tan) {
          const tm = DB.tmulai.find(x => x.tantangan_id === tan.id && x.murid_id === m.id);
          const startMs = tan.serentak ? (tan.go || Date.now()) : (tm ? tm.t_mulai : Date.now());
          const batas = Math.min(tan.selesai, startMs + tan.menit * 60000);
          if ((s.tt || Date.now()) > batas + 30000) telat = 1;
        }
      }
      const soalLama = s.pv && k.diubah && Number(s.pv) !== Number(k.diubah) ? 1 : 0;
      DB.sesi.push({
        id: sesiId,
        cid,
        kelas_kode: kode,
        murid_id: m.id,
        mapel_id: String(s.mapel || ""),
        mapel_nama: String(s.nama || ""),
        benar: Number(s.benar || 0),
        total: Number(s.total || 0),
        nilai: Number(s.nilai || 0),
        durasi: Number(s.durasi || 0),
        t: Number(s.t || Date.now()),
        dunia: String(s.dunia || ""),
        tantangan_id: s.tantangan ? Number(s.tantangan) : null,
        telat,
        paket_kode: String(s.pk || k.paket_kode || ""),
        soal_lama: soalLama,
        skor: s.skor != null ? Number(s.skor) : null,
        maks: s.maks != null ? Number(s.maks) : null,
        lari: Number(s.lari || 0)
      });
    }

    if (Array.isArray(body.jawaban)) {
      body.jawaban.forEach(j => {
        DB.jawaban.push({
          kelas_kode: kode,
          murid_id: m.id,
          mapel_id: String(j.m || ""),
          skey: String(j.s || ""),
          q: String(j.q || "").slice(0, 300),
          p: Number(j.p != null ? j.p : -1),
          k: Number(j.k || 0),
          ok: j.ok ? 1 : 0,
          d: Number(j.d || 0),
          t: Number(j.t || Date.now()),
          sesi_id: sesiId || 0,
          j_json: j.j ? JSON.stringify(j.j) : ""
        });
      });
    }

    if (Array.isArray(body.materi)) {
      body.materi.forEach(mt => {
        const exists = DB.materi.some(
          x => x.kelas_kode === kode && x.murid_id === m.id && x.mapel_id === mt.mapel && x.idx === mt.idx
        );
        if (!exists) {
          DB.materi.push({
            kelas_kode: kode,
            murid_id: m.id,
            mapel_id: String(mt.mapel || ""),
            idx: Number(mt.idx || 0),
            t: Number(mt.t || Date.now())
          });
        }
      });
    }

    saveDB();
    return sendJson(res, 200, { ok: true });
  }

  // 8. Dashboard Kelas
  if (pathname === "/dashboard") {
    const chk = checkKelasAccess(body.lic, body.kode, body.pin, true);
    if (chk.error) return sendJson(res, chk.status || 403, { error: chk.error, kode: chk.kode });
    const k = chk.kelas;
    const now = Date.now();
    const murid = DB.murid
      .filter(m => m.kelas_kode === k.kode)
      .sort((a, b) => a.absen - b.absen)
      .map(m => ({
        id: m.id,
        nama: m.nama,
        absen: m.absen,
        aktif: m.aktif,
        blokir: !!m.blokir,
        siap: m.siap_id && now - (m.siap_t || 0) < 35000 ? m.siap_id : 0
      }));

    const sesi = DB.sesi
      .filter(s => s.kelas_kode === k.kode)
      .map(s => [
        s.id,
        s.murid_id,
        s.mapel_id,
        s.mapel_nama,
        s.benar,
        s.total,
        s.nilai,
        s.durasi,
        s.t,
        s.dunia,
        s.tantangan_id,
        s.telat ? 1 : 0,
        s.paket_kode || "",
        s.soal_lama ? 1 : 0,
        s.skor,
        s.maks,
        s.lari || 0
      ]);

    const jawaban = DB.jawaban
      .filter(j => j.kelas_kode === k.kode)
      .map(j => [
        j.murid_id,
        j.mapel_id,
        j.skey,
        j.q,
        j.p,
        j.k,
        j.ok,
        j.d,
        j.t,
        j.sesi_id,
        j.j_json || ""
      ]);

    const materi = DB.materi
      .filter(x => x.kelas_kode === k.kode)
      .map(x => [x.murid_id, x.mapel_id, x.idx, x.t]);

    const tantangan = DB.tantangan
      .filter(t => t.kelas_kode === k.kode)
      .map(t =>
        Object.assign({}, t, {
          siap: DB.murid.filter(
            m => !m.blokir && m.kelas_kode === k.kode && m.siap_id === t.id && now - (m.siap_t || 0) < 35000
          ).length
        })
      );
    const tmulai = DB.tmulai
      .filter(x => x.kelas_kode === k.kode)
      .map(x => [x.tantangan_id, x.murid_id, x.t_mulai]);

    const pendamping = chk.pdp
      ? []
      : DB.pendamping
          .filter(p => p.kelas_kode === k.kode)
          .map(p => ({ id: p.id, kode: p.kode, nama: p.nama, dipakai: !!p.dipakai, aktif: p.aktif || 0 }));

    const pnama = {};
    Object.values(DB.paket).forEach(p => {
      pnama[p.kode] = p.judul;
    });

    return sendJson(res, 200, {
      now,
      kelas: {
        kode: k.kode,
        nama: k.nama,
        guru: k.guru,
        kunci: !!k.kunci,
        paket_kode: k.paket_kode || "",
        rekap: k.rekap || null
      },
      peran: chk.pdp ? { pendamping: chk.pdp.nama } : null,
      paket: k.paket,
      pnama,
      murid,
      sesi,
      jawaban,
      materi,
      tantangan,
      tmulai,
      pendamping
    });
  }

  // 9. Tantangan & Kode Main
  if (pathname === "/tantangan/daftar") {
    const kode = String(body.kode || "").trim().toUpperCase();
    const token = String(body.token || "").trim();
    const m = DB.murid.find(x => x.kelas_kode === kode && x.token === token);
    if (!m) return sendJson(res, 401, { error: "Murid tidak dikenali." });
    if (m.blokir) return sendJson(res, 403, { error: "Kamu dikeluarkan dari kelas.", kode: "blokir" });
    const now = Date.now();
    m.aktif = now;
    saveDB();
    const k = DB.kelas[kode];
    const ann = k && k.ann && now - k.ann.at < 180000 ? k.ann : null;

    const list = DB.tantangan
      .filter(t => t.kelas_kode === kode && t.aktif)
      .sort((a, b) => b.id - a.id)
      .map(t => {
        const tm = DB.tmulai.find(x => x.tantangan_id === t.id && x.murid_id === m.id);
        const ses = DB.sesi
          .filter(s => s.tantangan_id === t.id && s.murid_id === m.id)
          .sort((a, b) => (t.sekali ? a.t - b.t : b.nilai - a.nilai));
        const best = ses[0] || null;
        return Object.assign({}, t, {
          dimulai: tm ? tm.t_mulai : 0,
          sudah: best
            ? {
                nilai: t.hasil || t.jenis === "petualangan" ? best.nilai : null,
                benar: t.hasil || t.jenis === "petualangan" ? best.benar : null,
                total: best.total
              }
            : null
        });
      });

    return sendJson(res, 200, { now, tantangan: list, ann });
  }

  if (pathname === "/tantangan/simpan") {
    const chk = checkKelasAccess(body.lic, body.kode, body.pin, false);
    if (chk.error) return sendJson(res, chk.status || 403, { error: chk.error });
    const k = chk.kelas;
    const tIn = body.t || {};
    const now = Date.now();
    let t = tIn.id ? DB.tantangan.find(x => x.kelas_kode === k.kode && x.id === Number(tIn.id)) : null;
    if (!t) {
      let kodeMain = "";
      if (tIn.serentak) {
        do {
          kodeMain = randCode(6, true);
        } while (DB.tantangan.some(x => x.kode_main === kodeMain));
      }
      t = {
        id: DB.seq.tantangan++,
        kelas_kode: k.kode,
        jenis: tIn.jenis || "ujian",
        judul: String(tIn.judul || "Tantangan").trim(),
        mapel: String(tIn.mapel || ""),
        mapel_nama: String(tIn.mapel_nama || ""),
        jumlah: Number(tIn.jumlah || 10),
        menit: Number(tIn.menit || 15),
        mulai: Number(tIn.mulai || now),
        selesai: Number(tIn.selesai || now + 86400000),
        serentak: !!tIn.serentak,
        acak: tIn.acak !== false,
        sekali: !!tIn.sekali,
        hasil: tIn.hasil != null ? tIn.hasil : true,
        aktif: tIn.aktif !== false,
        kategori: tIn.kategori || "latihan",
        bobot: tIn.bobot || null,
        peta: tIn.peta || "",
        mapels: tIn.mapels || null,
        target: tIn.target || null,
        go: 0,
        akhir: 0,
        kode_main: kodeMain
      };
      DB.tantangan.push(t);
    } else {
      Object.assign(t, {
        jenis: tIn.jenis || t.jenis || "ujian",
        judul: String(tIn.judul || t.judul).trim(),
        mapel: String(tIn.mapel || t.mapel),
        mapel_nama: String(tIn.mapel_nama || t.mapel_nama),
        jumlah: Number(tIn.jumlah || t.jumlah),
        menit: Number(tIn.menit || t.menit),
        mulai: Number(tIn.mulai || t.mulai),
        selesai: Number(tIn.selesai || t.selesai),
        serentak: !!tIn.serentak,
        acak: tIn.acak !== false,
        sekali: !!tIn.sekali,
        hasil: tIn.hasil != null ? tIn.hasil : t.hasil,
        aktif: tIn.aktif !== false,
        kategori: tIn.kategori || t.kategori || "latihan",
        bobot: tIn.bobot !== undefined ? tIn.bobot : t.bobot,
        peta: tIn.peta !== undefined ? tIn.peta : t.peta,
        mapels: tIn.mapels !== undefined ? tIn.mapels : t.mapels,
        target: tIn.target !== undefined ? tIn.target : t.target
      });
      if (t.serentak && !t.kode_main) {
        do {
          t.kode_main = randCode(6, true);
        } while (DB.tantangan.some(x => x !== t && x.kode_main === t.kode_main));
      }
    }
    saveDB();
    return sendJson(res, 200, { id: t.id, kode_main: t.kode_main || "" });
  }

  if (pathname === "/tantangan/mulai") {
    const kode = String(body.kode || "").trim().toUpperCase();
    const token = String(body.token || "").trim();
    const id = Number(body.id);
    const k = DB.kelas[kode];
    if (!k) return sendJson(res, 404, { error: "Kelas tidak ditemukan." });
    const m = DB.murid.find(x => x.kelas_kode === kode && x.token === token);
    if (!m) return sendJson(res, 401, { error: "Murid tidak dikenali." });
    if (m.blokir) return sendJson(res, 403, { error: "Kamu dikeluarkan dari kelas.", kode: "blokir" });

    const now = Date.now();
    m.aktif = now;
    if (body.batal) {
      if (m.siap_id === id) {
        m.siap_id = 0;
        m.siap_t = 0;
      }
      saveDB();
      return sendJson(res, 200, { ok: true });
    }

    const t = DB.tantangan.find(x => x.kelas_kode === kode && x.id === id && x.aktif);
    if (!t) return sendJson(res, 404, { error: "Tantangan tidak ditemukan atau sudah ditutup." });

    if (now > t.selesai || (t.akhir && now > t.akhir)) {
      return sendJson(res, 400, { error: "Waktu tantangan sudah berakhir." });
    }
    if (t.serentak && !t.go) {
      m.siap_id = t.id;
      m.siap_t = now;
      saveDB();
      const siapCount = DB.murid.filter(
        x => !x.blokir && x.kelas_kode === kode && x.siap_id === t.id && now - (x.siap_t || 0) < 35000
      ).length;
      const ann = k && k.ann && now - k.ann.at < 180000 ? k.ann : null;
      return sendJson(res, 200, { now, tunggu: true, siap: Math.max(1, siapCount), ann });
    }
    if (!t.serentak && now < t.mulai) {
      return sendJson(res, 400, { error: "Tantangan belum dibuka." });
    }

    if (m.siap_id === t.id) {
      m.siap_id = 0;
      m.siap_t = 0;
    }

    let tm = DB.tmulai.find(x => x.tantangan_id === t.id && x.murid_id === m.id);
    if (!tm || !t.sekali || (t.serentak && tm.t_mulai < t.go)) {
      if (!tm) {
        tm = { kelas_kode: kode, tantangan_id: t.id, murid_id: m.id, t_mulai: now };
        DB.tmulai.push(tm);
      } else {
        tm.t_mulai = now;
      }
    }
    saveDB();

    const startRef = t.serentak ? t.go : tm.t_mulai;
    const batas = Math.min(t.selesai, startRef + t.menit * 60000);
    if (now >= batas) {
      return sendJson(res, 400, { error: "Waktumu untuk tantangan ini sudah habis." });
    }
    const seed = ((t.id * 2654435761) ^ (t.acak ? m.id * 1597334677 : 0)) >>> 0;
    const rahasia = getRahasiaMapels(k.paket);
    return sendJson(res, 200, {
      now,
      tunggu: false,
      mulai: startRef,
      batas,
      seed,
      rahasia
    });
  }

  if (pathname === "/tantangan/go") {
    const chk = checkKelasAccess(body.lic, body.kode, body.pin, true);
    if (chk.error) return sendJson(res, chk.status || 403, { error: chk.error });
    const t = DB.tantangan.find(x => x.kelas_kode === chk.kelas.kode && x.id === Number(body.id));
    if (!t) return sendJson(res, 404, { error: "Tantangan tidak ditemukan." });
    const aksi = String(body.aksi || "");
    if (aksi === "mulai") {
      t.go = Date.now();
      t.akhir = 0;
    } else if (aksi === "akhiri") {
      t.akhir = Date.now();
      DB.murid.forEach(m => {
        if (m.kelas_kode === chk.kelas.kode && m.siap_id === t.id) {
          m.siap_id = 0;
          m.siap_t = 0;
        }
      });
    } else if (aksi === "ulang") {
      t.go = 0;
      t.akhir = 0;
      DB.murid.forEach(m => {
        if (m.kelas_kode === chk.kelas.kode && m.siap_id === t.id) {
          m.siap_id = 0;
          m.siap_t = 0;
        }
      });
    }
    saveDB();
    return sendJson(res, 200, { ok: true, go: t.go, akhir: t.akhir });
  }

  if (pathname === "/tantangan/hapus") {
    const chk = checkKelasAccess(body.lic, body.kode, body.pin, false);
    if (chk.error) return sendJson(res, chk.status || 403, { error: chk.error });
    const id = Number(body.id);
    DB.tantangan = DB.tantangan.filter(x => !(x.kelas_kode === chk.kelas.kode && x.id === id));
    DB.tmulai = DB.tmulai.filter(x => !(x.kelas_kode === chk.kelas.kode && x.tantangan_id === id));
    saveDB();
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === "/tantangan/koreksi") {
    const chk = checkKelasAccess(body.lic, body.kode, body.pin, false);
    if (chk.error) return sendJson(res, chk.status || 403, { error: chk.error });
    const k = chk.kelas;
    if (Array.isArray(body.sesi)) {
      body.sesi.forEach(u => {
        const s = DB.sesi.find(x => x.kelas_kode === k.kode && x.id === Number(u.id));
        if (s) {
          s.nilai = Number(u.nilai);
          s.benar = Number(u.benar);
          if (u.skor != null) s.skor = Number(u.skor);
        }
      });
    }
    if (Array.isArray(body.jawaban)) {
      body.jawaban.forEach(u => {
        const j = DB.jawaban.find(x => x.kelas_kode === k.kode && x.sesi_id === Number(u.sesi) && x.skey === String(u.s));
        if (j) {
          j.ok = u.ok ? 1 : 0;
          j.k = Number(u.k || 0);
          if (u.j) j.j_json = JSON.stringify(u.j);
        }
      });
    }
    saveDB();
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === "/main/cek") {
    const kodeMain = String(body.kode || "").replace(/\D/g, "");
    const t = DB.tantangan.find(x => x.kode_main === kodeMain && x.aktif);
    if (!t) return sendJson(res, 404, { error: "Kode main 6 angka tidak ditemukan atau tantangan sudah selesai." });
    const k = DB.kelas[t.kelas_kode];
    if (!k) return sendJson(res, 404, { error: "Kelas tidak ditemukan." });
    return sendJson(res, 200, {
      now: Date.now(),
      kelas: { kode: k.kode, nama: k.nama, guru: k.guru },
      tantangan: t
    });
  }

  // 10. Guru Pendamping
  if (pathname === "/pendamping/buat") {
    const chk = checkKelasAccess(body.lic, body.kode, body.pin, false);
    if (chk.error) return sendJson(res, chk.status || 403, { error: chk.error });
    const nama = String(body.nama || "").trim().slice(0, 40);
    if (!nama) return sendJson(res, 400, { error: "Isi nama guru pendamping." });
    const kodePdp = randCode(8, false);
    DB.pendamping.push({
      id: DB.seq.pendamping++,
      kelas_kode: chk.kelas.kode,
      kode: kodePdp,
      token: "pdp-" + genToken(),
      nama,
      dev: "",
      dipakai: false,
      aktif: 0
    });
    saveDB();
    return sendJson(res, 200, { kode: kodePdp });
  }

  if (pathname === "/pendamping/masuk") {
    const kodePdp = String(body.kode || "").trim().toUpperCase();
    const dev = String(body.dev || "dev-pdp");
    const p = DB.pendamping.find(x => x.kode === kodePdp);
    if (!p) return sendJson(res, 404, { error: "Undangan pendamping tidak ditemukan atau sudah dicabut." });
    if (p.dipakai && p.dev && p.dev !== dev) {
      return sendJson(res, 403, { error: "Undangan ini sudah dipakai di perangkat lain." });
    }
    p.dipakai = true;
    p.dev = dev;
    p.aktif = Date.now();
    const k = DB.kelas[p.kelas_kode];
    saveDB();
    return sendJson(res, 200, {
      token: p.token,
      nama: p.nama,
      kelas: { kode: k.kode, nama: k.nama, guru: k.guru }
    });
  }

  if (pathname === "/pendamping/cabut") {
    const chk = checkKelasAccess(body.lic, body.kode, body.pin, false);
    if (chk.error) return sendJson(res, chk.status || 403, { error: chk.error });
    DB.pendamping = DB.pendamping.filter(p => !(p.kelas_kode === chk.kelas.kode && p.id === Number(body.id)));
    saveDB();
    return sendJson(res, 200, { ok: true });
  }

  // 11. Admin Endpoints (untuk admin.html)
  if (pathname.startsWith("/admin/")) {
    const adminKode = req.headers["x-kode"] || "";
    if (adminKode !== (DB.setelan.admin_kode || "eduverse123") && adminKode !== "admin") {
      return sendJson(res, 401, { error: "Kode admin tidak sesuai (default: eduverse123 atau admin)." });
    }
    if (pathname === "/admin/ringkas") {
      const status = { menunggu: 0, aktif: 0, segera: 0, tenggang: 0, habis: 0, seumur: 0, lama: 0, blokir: 0 };
      DB.guru.forEach(g => {
        const st = g.aktif === false ? "blokir" : (g.status || "seumur");
        status[st] = (status[st] || 0) + 1;
      });
      const cut24 = Date.now() - 86400000;
      return sendJson(res, 200, {
        status,
        habis30: 0,
        guru: DB.guru.length,
        bayar_bln: { jml: 0, n: 0 },
        bayar_all: { jml: DB.bayar.reduce((a, b) => a + (b.nominal || 0), 0), n: DB.bayar.length },
        kelas: Object.keys(DB.kelas).length,
        murid: DB.murid.length,
        sesi: DB.sesi.length,
        sesi24: DB.sesi.filter(s => s.t >= cut24).length,
        jawaban: DB.jawaban.length,
        google: !!DB.setelan.google_client_id
      });
    }
    if (pathname === "/admin/guru/list") {
      const list = DB.guru.map(g => {
        const kls = Object.values(DB.kelas).filter(k => k.guru_id === g.id);
        const kodes = new Set(kls.map(k => k.kode));
        const jmlMurid = DB.murid.filter(m => kodes.has(m.kelas_kode)).length;
        return {
          id: g.id,
          nama: g.nama,
          email: g.email,
          wa_norm: g.wa_norm || g.wa || "",
          sekolah: g.sekolah || "",
          google: !!g.google,
          sandi: !!g.sandi,
          status: g.aktif === false ? "blokir" : (g.status || "seumur"),
          sampai: g.sampai != null ? g.sampai : -1,
          jml_kelas: kls.length,
          mk: g.maks_kelas || 100,
          jml_murid: jmlMurid,
          perangkat: (g.dev || []).length,
          mp: g.maks_perangkat || 25,
          dibuat: g.dibuat,
          terakhir_masuk: g.terakhir_masuk,
          bukti: g.bukti || "",
          catatan: g.catatan || "",
          total_bayar: g.total_bayar || 0,
          aktif: g.aktif !== false
        };
      });
      return sendJson(res, 200, { guru: list, setelan: DB.setelan });
    }
    if (pathname === "/admin/guru/aksi") {
      const g = DB.guru.find(x => x.id === Number(body.id));
      if (!g) return sendJson(res, 404, { error: "Guru tidak ditemukan." });
      const a = body.aksi;
      if (a === "hapus") {
        DB.guru = DB.guru.filter(x => x.id !== g.id);
      } else if (a === "blokir") {
        g.aktif = false;
        g.status = "blokir";
      } else if (a === "aktifkan" || a === "langganan") {
        g.aktif = true;
        g.status = "seumur";
        g.sampai = -1;
      } else if (a === "reset") {
        g.dev = [];
        g.sess = [];
      } else if (a === "sandi") {
        const pw = randCode(8, false);
        g.sandi = pw;
        g.sess = [];
        saveDB();
        return sendJson(res, 200, { sandi: pw });
      } else if (a === "ubah") {
        if (body.nama) g.nama = body.nama;
        if (body.email) g.email = body.email;
        if (body.wa !== undefined) { g.wa = body.wa; g.wa_norm = normWa(body.wa); }
        if (body.sekolah !== undefined) g.sekolah = body.sekolah;
        if (body.catatan !== undefined) g.catatan = body.catatan;
      }
      saveDB();
      return sendJson(res, 200, { ok: true, sampai: g.sampai });
    }
    if (pathname === "/admin/bayar/list") return sendJson(res, 200, { bayar: DB.bayar });
    if (pathname === "/admin/bayar/hapus") {
      DB.bayar = DB.bayar.filter(b => b.id !== Number(body.id));
      saveDB();
      return sendJson(res, 200, { ok: true });
    }
    if (pathname === "/admin/setelan/ambil") return sendJson(res, 200, { setelan: DB.setelan });
    if (pathname === "/admin/setelan/simpan") {
      Object.assign(DB.setelan, body.setelan || {});
      saveDB();
      return sendJson(res, 200, { ok: true });
    }
    if (pathname === "/admin/kode/list") return sendJson(res, 200, { kode: DB.kodes });
    if (pathname === "/admin/bank/list") {
      const list = Object.values(DB.paket)
        .filter(p => p.bank)
        .map(p => ({
          kode: p.kode,
          judul: p.judul,
          guru: p.guru,
          pakai: p.bank_pakai || 0,
          bank_t: p.bank_t || p.diubah,
          info: packInfo(p.paket)
        }));
      return sendJson(res, 200, { paket: list });
    }
    if (pathname === "/admin/bank/tarik") {
      const p = DB.paket[String(body.kode || "").toUpperCase()];
      if (p) { p.bank = false; saveDB(); }
      return sendJson(res, 200, { ok: true });
    }
    if (pathname === "/admin/bersih/cek") return sendJson(res, 200, { guru: [] });
    if (pathname === "/admin/bersih/hapus") return sendJson(res, 200, { kelas: 0, guru: 0 });
  }

  return sendJson(res, 404, { error: "Alamat tidak ditemukan" });
}

async function requestHandler(req, res) {
  if (IS_VERCEL && fs.existsSync(DB_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
      DB = Object.assign(defaultDB(), raw);
      DB.seq = Object.assign(defaultDB().seq, raw.seq || {});
      DB.setelan = Object.assign(defaultDB().setelan, raw.setelan || {});
    } catch (e) {}
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-kode"
    });
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  let rawPath = parsedUrl.pathname;
  if (parsedUrl.searchParams.get("__p")) {
    rawPath = parsedUrl.searchParams.get("__p");
  } else if (parsedUrl.searchParams.get("__sec")) {
    const sub = parsedUrl.searchParams.get("__sub") || "";
    rawPath = "/" + parsedUrl.searchParams.get("__sec") + (sub ? "/" + sub : "");
  }
  const pathname = ("/" + String(rawPath).replace(/^\/+/, "")).replace(/\/+$/, "") || "/";

  // Health check for POST / or GET /?health=1 or /api/health
  if ((pathname === "/" || pathname === "/api/health") && (req.method === "POST" || parsedUrl.searchParams.has("health") || pathname === "/api/health")) {
    return sendJson(res, 200, { ok: true, app: "EduVerse Server", version: "1.0.0" });
  }

  // Route API requests
  const isApiPrefix = [
    "/setelan", "/akun/", "/guru/", "/paket/", "/bank/",
    "/kelas/", "/murid/", "/catat", "/dashboard",
    "/tantangan/", "/main/", "/pendamping/", "/admin/"
  ].some(p => pathname === p || pathname.startsWith(p));

  if (isApiPrefix) {
    return handleApi(req, res, pathname, parsedUrl.searchParams);
  }

  // Static file serving from public/
  let relPath = pathname === "/" ? "/index.html" : pathname;
  const safePath = path.normalize(relPath).replace(/^(\.\.[/\\])+/, "");
  let filePath = path.join(PUBLIC_DIR, safePath);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("404 Halaman tidak ditemukan");
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-cache"
  });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(requestHandler);

/* =====================================================================
   REALTIME WEBSOCKET SERVER (/kelas)
   ===================================================================== */
const wss = new WebSocketServer({ noServer: true });
const rooms = new Map(); // kode -> Map<clientId, clientObj>
let nextClientSeq = 1;

function getRoom(kode) {
  if (!rooms.has(kode)) rooms.set(kode, new Map());
  return rooms.get(kode);
}

function wsSend(ws, obj) {
  if (ws && ws.readyState === 1) {
    try {
      ws.send(JSON.stringify(obj));
    } catch (e) {}
  }
}

function buildRoster(room) {
  const list = [];
  for (const c of room.values()) {
    if (!c.authed || c.mode === "obs") continue;
    list.push({
      id: c.id,
      nama: c.nama,
      z: c.z || "kota",
      o: c.o || null,
      sc: c.sc || { lv: 1, bh: 0, g: 0 },
      st: c.st || { s: "main", m: "" },
      siap: c.siap || 0,
      g: !!c.isGuru
    });
  }
  return list;
}

function broadcastRoster(room) {
  const list = buildRoster(room);
  for (const c of room.values()) {
    if (c.authed) {
      wsSend(c.ws, { t: "roster", list });
    }
  }
}

function broadcastZonePeers(room, client, isNewZone) {
  if (client.mode === "obs" || !client.z) return;
  const peersInZone = [];
  for (const other of room.values()) {
    if (!other.authed || other.mode === "obs" || other.id === client.id) continue;
    if (other.z === client.z) {
      peersInZone.push({
        id: other.id,
        nama: other.nama,
        o: other.o,
        p: other.p,
        lv: (other.sc && other.sc.lv) || 1,
        g: !!other.isGuru
      });
      if (isNewZone) {
        wsSend(other.ws, {
          t: "join",
          id: client.id,
          nama: client.nama,
          o: client.o,
          p: client.p,
          lv: (client.sc && client.sc.lv) || 1,
          g: !!client.isGuru
        });
      }
    }
  }
  wsSend(client.ws, { t: "all", me: client.id, list: peersInZone });
}

function notifyLeftZone(room, client, oldZone) {
  if (!oldZone || client.mode === "obs") return;
  for (const other of room.values()) {
    if (!other.authed || other.mode === "obs" || other.id === client.id) continue;
    if (other.z === oldZone) {
      wsSend(other.ws, { t: "left", id: client.id });
    }
  }
}

server.on("upgrade", (req, socket, head) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (parsedUrl.pathname !== "/kelas") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, ws => {
    wss.emit("connection", ws, parsedUrl);
  });
});

wss.on("connection", (ws, parsedUrl) => {
  const kode = String(parsedUrl.searchParams.get("kode") || "").trim().toUpperCase();
  const isGuruParam = parsedUrl.searchParams.get("guru") === "1";
  const token = String(parsedUrl.searchParams.get("token") || "").trim();

  const k = DB.kelas[kode];
  if (!k) {
    ws.close(4001, "Kelas tidak ditemukan");
    return;
  }

  const room = getRoom(kode);
  let client = null;

  if (isGuruParam) {
    client = {
      id: "g_" + (nextClientSeq++),
      ws,
      kode,
      isGuru: true,
      authed: false,
      mode: "obs",
      nama: k.guru || "Guru",
      z: "kota",
      o: null,
      p: null,
      sc: { lv: 99, bh: 0, g: 0 }
    };
  } else {
    const m = DB.murid.find(x => x.kelas_kode === kode && x.token === token);
    if (!m || m.blokir) {
      ws.close(4001, "Murid tidak dikenali atau diblokir");
      return;
    }
    // Kick older connection for same student
    const existing = room.get(m.id);
    if (existing && existing.ws !== ws) {
      notifyLeftZone(room, existing, existing.z);
      try { existing.ws.close(4000, "Dibuka di perangkat lain"); } catch (e) {}
      room.delete(m.id);
    }
    client = {
      id: m.id,
      ws,
      kode,
      isGuru: false,
      authed: true,
      mode: "play",
      nama: m.nama,
      z: "kota",
      o: null,
      p: null,
      sc: { lv: 1, bh: 0, g: 0 },
      st: { s: "main", m: "" },
      siap: 0
    };
    room.set(client.id, client);
  }

  ws.on("message", raw => {
    let d;
    try {
      d = JSON.parse(String(raw));
    } catch (e) {
      return;
    }
    if (!d || typeof d.t !== "string") return;

    if (client.isGuru && d.t === "auth") {
      const chk = checkKelasAccess(d.lic, kode, d.pin, true);
      if (chk.error) {
        wsSend(ws, { t: "err", msg: chk.error });
        ws.close(4001, chk.error);
        return;
      }
      client.authed = true;
      client.mode = d.mode === "play" ? "play" : "obs";
      client.nama = chk.pdp ? chk.pdp.nama : (k.guru || (chk.guru && chk.guru.nama) || "Guru");
      room.set(client.id, client);
      wsSend(ws, { t: "ok", id: client.id });
      broadcastRoster(room);
      return;
    }

    if (!client.authed) return;

    if (d.t === "hi" || d.t === "z") {
      const oldZone = client.z;
      const newZone = String(d.z || "kota");
      if (d.o) client.o = d.o;
      if (Array.isArray(d.p)) client.p = d.p;
      if (d.sc) client.sc = d.sc;
      if (oldZone && oldZone !== newZone) {
        notifyLeftZone(room, client, oldZone);
      }
      client.z = newZone;
      broadcastZonePeers(room, client, true);
      broadcastRoster(room);
      return;
    }

    if (d.t === "p" && Array.isArray(d.p)) {
      client.p = d.p;
      for (const other of room.values()) {
        if (other.authed && other.mode === "play" && other.id !== client.id && other.z === client.z) {
          wsSend(other.ws, { t: "p", id: client.id, p: d.p });
        }
      }
      return;
    }

    if (d.t === "o" && d.o) {
      client.o = d.o;
      for (const other of room.values()) {
        if (other.authed && other.mode === "play" && other.id !== client.id && other.z === client.z) {
          wsSend(other.ws, { t: "o", id: client.id, o: d.o });
        }
      }
      return;
    }

    if (d.t === "e" && d.e) {
      for (const other of room.values()) {
        if (other.authed && other.mode === "play" && other.id !== client.id && other.z === client.z) {
          wsSend(other.ws, { t: "e", id: client.id, e: String(d.e).slice(0, 80) });
        }
      }
      return;
    }

    if (d.t === "sc" && d.sc) {
      client.sc = d.sc;
      broadcastRoster(room);
      return;
    }

    if (d.t === "st") {
      client.st = { s: d.s || "main", m: d.m || "", q: d.q || null };
      for (const other of room.values()) {
        if (other.authed && other.isGuru) {
          wsSend(other.ws, { t: "st", id: client.id, st: client.st });
        }
      }
      return;
    }

    if (d.t === "siap") {
      client.siap = Number(d.id || 0);
      broadcastRoster(room);
      return;
    }

    if (d.t === "ev") {
      const evObj = {
        t: "ev",
        id: client.id,
        nama: client.nama,
        k: d.k || "kuis",
        m: d.m || "",
        n: Number(d.n || 0),
        at: Date.now()
      };
      for (const other of room.values()) {
        if (other.authed && other.isGuru) {
          wsSend(other.ws, evObj);
        }
      }
      return;
    }

    if (client.isGuru && d.t === "ann") {
      const text = String(d.text || "").trim().slice(0, 140);
      if (!text) return;
      const msg = { t: "ann", nama: client.nama, text, at: Date.now() };
      for (const other of room.values()) {
        if (other.authed) wsSend(other.ws, msg);
      }
      return;
    }

    if (client.isGuru && d.t === "call") {
      const msg = { t: "call", nama: client.nama, z: client.z || "kota" };
      for (const other of room.values()) {
        if (other.authed && !other.isGuru) wsSend(other.ws, msg);
      }
      return;
    }

    if (client.isGuru && d.t === "go") {
      const msg = { t: "go", id: Number(d.id), k: String(d.k || "") };
      for (const other of room.values()) {
        if (other.authed && !other.isGuru) wsSend(other.ws, msg);
      }
      return;
    }
  });

  ws.on("close", () => {
    if (client && room.get(client.id) === client) {
      room.delete(client.id);
      notifyLeftZone(room, client, client.z);
      broadcastRoster(room);
    }
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log("======================================================");
    console.log("🚀 EduVerse - Semesta Belajar 3D Server Aktif!");
    console.log(`🌐 Buka di browser : http://localhost:${PORT}`);
    console.log(`👩‍🏫 Panduan Guru    : http://localhost:${PORT}/guru.html`);
    console.log(`🔐 Dashboard Admin : http://localhost:${PORT}/admin.html (Kode: eduverse123)`);
    console.log("======================================================");
  });
}

module.exports = requestHandler;
