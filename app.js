// app.js
import {
  db,
  auth,
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  deleteDoc,
  serverTimestamp
} from "./firebase-config.js";

let currentUser = null;

// State semasa
let currentBahasa = null;   // { id, nama }
let currentHuruf = null;    // "A", "B", ...
let currentPerkataan = null; // { id, perkataan }

// Simpan dari mana kita datang sebelum masuk page log
let lastPageBeforeLog = null;

// DOM helpers
const pages = {
  login: document.getElementById("page-login"),
  bahasa: document.getElementById("page-bahasa"),
  huruf: document.getElementById("page-huruf"),
  perkataan: document.getElementById("page-perkataan"),
  elemen: document.getElementById("page-elemen"),
  ayatBiasa: document.getElementById("page-ayat-biasa"),
  dialog: document.getElementById("page-dialog"),
  dialogBubble: document.getElementById("page-dialog-bubble"),
  log: document.getElementById("page-log")
};

const statusBar = document.getElementById("status-bar");

// Exported util untuk auth.js
export function showPage(pageId) {
  Object.values(pages).forEach(p => p.classList.add("hidden"));
  const el = pages[pageId.replace("page-", "")] || document.getElementById(pageId);
  if (el) el.classList.remove("hidden");
}

export function showStatus(msg, type = "info", timeout = 3000, progress = null) {
  if (!statusBar) return;

  // pastikan ada elemen teks & progress bar
  let textEl = document.getElementById("status-text");
  let progressWrap = document.getElementById("status-progress");
  let progressBar = document.getElementById("status-progress-bar");

  if (textEl) textEl.textContent = msg;
  else statusBar.textContent = msg;

  statusBar.className = "";
  statusBar.classList.add(type, "visible");
  statusBar.classList.remove("hidden");

  if (progress !== null && progressWrap && progressBar) {
    progressWrap.classList.remove("hidden");
    progressBar.style.width = progress + "%";
  } else if (progressWrap) {
    progressWrap.classList.add("hidden");
  }

  if (timeout) {
    setTimeout(() => {
      statusBar.classList.add("hidden");
    }, timeout);
  }
}


export function initAppAfterAuth(user) {
  currentUser = user;
  loadBahasa();
}

export function clearAppStateOnLogout() {
  currentUser = null;
  currentBahasa = null;
  currentHuruf = null;
  currentPerkataan = null;
  lastPageBeforeLog = null;
}

// ================== BAHASA (PAGE 2) =================

const inputSearchBahasa = document.getElementById("search-bahasa");
const btnTambahBahasa = document.getElementById("btn-tambah-bahasa");
const senaraiBahasaEl = document.getElementById("senarai-bahasa");
const btnBahasaLog = document.getElementById("btn-bahasa-log");

// BUTANG BARU: Kamus & TTS
const btnKeKamus = document.getElementById("btn-ke-kamus");

btnBahasaLog?.addEventListener("click", () => {
  lastPageBeforeLog = "page-bahasa";
  openLogPage();
});

btnTambahBahasa?.addEventListener("click", async () => {
  const nama = prompt("Masukkan nama bahasa:");
  if (!nama || !nama.trim()) return;
  try {
    await addDoc(collection(db, "languages"), {
      userId: currentUser.uid,
      name: nama.trim(),
      createdAt: serverTimestamp()
    });
    showStatus("Bahasa berjaya ditambah.", "success");
    loadBahasa();
  } catch (err) {
    console.error(err);
    showStatus("Gagal tambah bahasa.", "error");
  }
});

// Wiring untuk butang Kamus & TTS
btnKeKamus?.addEventListener("click", () => {
  showPage("page-kamus");
});

inputSearchBahasa?.addEventListener("input", () => {
  renderBahasaList(cacheBahasa, inputSearchBahasa.value);
});

let cacheBahasa = [];

async function loadBahasa() {
  if (!currentUser) return;
  const q = query(
    collection(db, "languages"),
    where("userId", "==", currentUser.uid),
    orderBy("name", "asc")
  );
  const snap = await getDocs(q);
  cacheBahasa = snap.docs.map(docSnap => ({
    id: docSnap.id,
    ...docSnap.data()
  }));
  renderBahasaList(cacheBahasa, inputSearchBahasa.value);
}

function renderBahasaList(list, filterText = "") {
  if (!senaraiBahasaEl) return;
  senaraiBahasaEl.innerHTML = "";
  const ft = (filterText || "").toLowerCase();

  list
    .filter(b => !ft || (b.name || "").toLowerCase().includes(ft))
    .forEach(b => {
      const li = document.createElement("li");
      const main = document.createElement("div");
      main.className = "item-main";
      main.textContent = b.name;
      main.addEventListener("click", () => {
        currentBahasa = { id: b.id, name: b.name };
        openHurufPage();
      });

      const actions = document.createElement("div");
      actions.className = "item-actions";

      const btnEdit = document.createElement("button");
      btnEdit.className = "btn small secondary";
      btnEdit.textContent = "Sunting";
      btnEdit.addEventListener("click", async (e) => {
        e.stopPropagation();
        const baru = prompt("Sunting nama bahasa:", b.name);
        if (!baru || !baru.trim()) return;
        try {
          await setDoc(doc(db, "languages", b.id), {
            ...b,
            name: baru.trim()
          });
          showStatus("Bahasa dikemaskini.", "success");
          loadBahasa();
        } catch (err) {
          console.error(err);
          showStatus("Gagal sunting bahasa.", "error");
        }
      });

      const btnPadam = document.createElement("button");
      btnPadam.className = "btn small danger";
      btnPadam.textContent = "Padam";
      btnPadam.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm("Padam bahasa ini beserta semua data di bawahnya?")) return;
        try {
          await deleteDoc(doc(db, "languages", b.id));
          showStatus("Bahasa dipadam.", "success");
          loadBahasa();
        } catch (err) {
          console.error(err);
          showStatus("Gagal padam bahasa.", "error");
        }
      });

      actions.appendChild(btnEdit);
      actions.appendChild(btnPadam);

      li.appendChild(main);
      li.appendChild(actions);
      senaraiBahasaEl.appendChild(li);
    });
}

// ================== HURUF (PAGE 3) =================

const btnKembaliKeBahasa = document.getElementById("btn-kembali-ke-bahasa");
const tajukHurufBahasa = document.getElementById("tajuk-huruf-bahasa");
const labelBahasaTerpilih = document.getElementById("label-bahasa-terpilih");
const senaraiHurufEl = document.getElementById("senarai-huruf");
const searchPerkataanDariHuruf = document.getElementById("search-perkataan-dari-huruf");

btnKembaliKeBahasa?.addEventListener("click", () => {
  showPage("page-bahasa");
});

function openHurufPage() {
  if (!currentBahasa) return;
  tajukHurufBahasa.textContent = "Huruf";
  labelBahasaTerpilih.textContent = "Bahasa: " + currentBahasa.name;
  renderHurufGrid();
  showPage("page-huruf");
}

function renderHurufGrid() {
  if (!senaraiHurufEl) return;
  senaraiHurufEl.innerHTML = "";
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  alphabet.forEach(h => {
    const btn = document.createElement("button");
    btn.className = "btn secondary";
    btn.textContent = h;
    btn.addEventListener("click", () => {
      currentHuruf = h;
      openPerkataanPage();
    });
    senaraiHurufEl.appendChild(btn);
  });
}

searchPerkataanDariHuruf?.addEventListener("input", () => {
  // Optional: boleh nanti link direct cari perkataan merentasi huruf
  // Untuk sekarang, kita tak fully implement global search kat sini.
});

// ================== PERKATAAN (PAGE 4) =================

const btnKembaliKeHuruf = document.getElementById("btn-kembali-ke-huruf");
const btnPerkataanLog = document.getElementById("btn-perkataan-log");
const tajukPerkataanHuruf = document.getElementById("tajuk-perkataan-huruf");
const labelPerkataanBahasaHuruf = document.getElementById("label-perkataan-bahasa-huruf");
const inputSearchPerkataan = document.getElementById("search-perkataan");
const btnTambahPerkataan = document.getElementById("btn-tambah-perkataan");
const senaraiPerkataanEl = document.getElementById("senarai-perkataan");

// butang baru untuk padam banyak
const btnPadamPilih = document.getElementById("btn-padampilih");

// butang Export Mod Tambah Pantas
const btnExport = document.getElementById("btn-export");

let cachePerkataan = [];

btnKembaliKeHuruf?.addEventListener("click", () => {
  showPage("page-huruf");
});

btnPerkataanLog?.addEventListener("click", () => {
  lastPageBeforeLog = "page-perkataan";
  openLogPage();
});

function openPerkataanPage() {
  if (!currentBahasa || !currentHuruf) return;
  tajukPerkataanHuruf.textContent = "Perkataan huruf " + currentHuruf;
  labelPerkataanBahasaHuruf.textContent = "Bahasa: " + currentBahasa.name + " | Huruf: " + currentHuruf;
  loadPerkataan();
  showPage("page-perkataan");
}

btnTambahPerkataan?.addEventListener("click", async () => {
  const perk = prompt("Masukkan perkataan (contoh: Aardvark):");
  if (!perk || !perk.trim()) return;
  try {
    await addDoc(collection(db, "words"), {
      userId: currentUser.uid,
      bahasaId: currentBahasa.id,
      bahasaName: currentBahasa.name,
      huruf: currentHuruf,
      word: perk.trim(),
      createdAt: serverTimestamp()
    });
    showStatus("Perkataan ditambah.", "success");
    loadPerkataan();
  } catch (err) {
    console.error(err);
    showStatus("Gagal tambah perkataan.", "error");
  }
});

inputSearchPerkataan?.addEventListener("input", () => {
  renderPerkataanList(cachePerkataan, inputSearchPerkataan.value);
});

async function loadPerkataan() {
  if (!currentUser || !currentBahasa || !currentHuruf) return;
  const q = query(
    collection(db, "words"),
    where("userId", "==", currentUser.uid),
    where("bahasaId", "==", currentBahasa.id),
    where("huruf", "==", currentHuruf),
    orderBy("word", "asc")
  );
  const snap = await getDocs(q);
  cachePerkataan = snap.docs.map(d => ({
    id: d.id,
    ...d.data()
  }));
  renderPerkataanList(cachePerkataan, inputSearchPerkataan.value);
}

function renderPerkataanList(list, filterText = "") {
  if (!senaraiPerkataanEl) return;
  senaraiPerkataanEl.innerHTML = "";
  const ft = (filterText || "").toLowerCase();

  list
    .filter(p => !ft || (p.word || "").toLowerCase().includes(ft))
    .forEach(p => {
      const li = document.createElement("li");

      // checkbox untuk pilih banyak
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "select-word";
      checkbox.dataset.id = p.id;

      const main = document.createElement("div");
      main.className = "item-main";
      main.textContent = p.word;
      main.addEventListener("click", () => {
        currentPerkataan = { id: p.id, word: p.word, data: p };
        openElemenPage();
      });

      const actions = document.createElement("div");
      actions.className = "item-actions";

      const btnLog = document.createElement("button");
      btnLog.className = "btn small secondary";
      btnLog.textContent = "Simpan ke log";
      btnLog.addEventListener("click", async (e) => {
        e.stopPropagation();
        await simpanKeLog(p);
      });

      const btnEdit = document.createElement("button");
      btnEdit.className = "btn small secondary";
      btnEdit.textContent = "Sunting";
      btnEdit.addEventListener("click", async (e) => {
        e.stopPropagation();
        const baru = prompt("Sunting perkataan:", p.word);
        if (!baru || !baru.trim()) return;
        try {
          await setDoc(doc(db, "words", p.id), {
            ...p,
            word: baru.trim()
          });
          showStatus("Perkataan dikemaskini.", "success");
          loadPerkataan();
        } catch (err) {
          console.error(err);
          showStatus("Gagal sunting perkataan.", "error");
        }
      });

      const btnPadam = document.createElement("button");
      btnPadam.className = "btn small danger";
      btnPadam.textContent = "Padam";
      btnPadam.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm("Padam perkataan ini beserta semua elemen di bawahnya?")) return;
        try {
          await deleteDoc(doc(db, "words", p.id));
          showStatus("Perkataan dipadam.", "success");
          loadPerkataan();
        } catch (err) {
          console.error(err);
          showStatus("Gagal padam perkataan.", "error");
        }
      });

      actions.appendChild(btnLog);
      actions.appendChild(btnEdit);
      actions.appendChild(btnPadam);

      li.appendChild(checkbox);
      li.appendChild(main);
      li.appendChild(actions);
      senaraiPerkataanEl.appendChild(li);
    });
}

// event listener untuk padam banyak
btnPadamPilih?.addEventListener("click", async () => {
  const checked = document.querySelectorAll("#senarai-perkataan .select-word:checked");
  if (checked.length === 0) {
    alert("Tiada perkataan dipilih.");
    return;
  }
  if (!confirm(`Padam ${checked.length} perkataan terpilih?`)) return;

  try {
    const deletes = Array.from(checked).map(ch =>
      deleteDoc(doc(db, "words", ch.dataset.id))
    );
    await Promise.all(deletes);
    showStatus(`${checked.length} perkataan dipadam.`, "success");
    loadPerkataan();
  } catch (err) {
    console.error(err);
    showStatus("Gagal padam perkataan terpilih.", "error");
  }
});

async function simpanKeLog(wordObj) {
  try {
    await addDoc(collection(db, "logs"), {
      userId: currentUser.uid,
      bahasaId: wordObj.bahasaId,
      bahasaName: wordObj.bahasaName,
      huruf: wordObj.huruf,
      wordId: wordObj.id,
      word: wordObj.word,
      createdAt: serverTimestamp()
    });
    showStatus("Perkataan disimpan ke log.", "success");
  } catch (err) {
    console.error(err);
    showStatus("Gagal simpan ke log.", "error");
  }
}

// ================== MOD TAMBAH PANTAS ==================
const btnModTambah = document.getElementById("btn-mod-tambah");
const bulkAddContainer = document.getElementById("bulk-add-container");
const bulkWords = document.getElementById("bulk-words");
const btnTambahSemua = document.getElementById("btn-tambah-semua");

// Toggle paparan container bila klik butang
btnModTambah?.addEventListener("click", () => {
  console.log("Butang Mod Tambah Pantas ditekan"); // debug log
  bulkAddContainer.classList.toggle("hidden");
  btnModTambah.classList.toggle("active");
});

btnTambahSemua?.addEventListener("click", async () => {
  const raw = bulkWords.value.trim();
  if (!raw) return;

  let blocks = raw.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);

  let prefix = "";
  if (blocks[0].toLowerCase().startsWith("setting")) {
    const code = blocks[0].substring("setting".length).trim();
    prefix = code;
    blocks = blocks.slice(1);
  }

  // status mula + progress kosong
  showStatus(`Sedang menambah ${blocks.length} perkataan...`, "info", 0, 0);

  let count = 0;
  for (const block of blocks) {
    const lines = block.split("\n").map(l => l.trim()).filter(Boolean);
    let word = lines[0];
    const meaning = lines.slice(1).join(" ");

    if (prefix) {
      word = `${prefix}-${word}`;
    }

    await addDoc(collection(db, "words"), {
      userId: currentUser.uid,
      bahasaId: currentBahasa.id,
      bahasaName: currentBahasa.name,
      huruf: currentHuruf,
      word: word,
      meaning: meaning,
      createdAt: serverTimestamp()
    });

    count++;
    const percent = Math.round((count / blocks.length) * 100);
    showStatus(`Sedang menambah... ${count}/${blocks.length}`, "info", 0, percent);
  }

  showStatus(`${blocks.length} perkataan ditambah.`, "success", 3000);
  bulkWords.value = "";
  loadPerkataan();
});


// ================== ELEMEN PERKATAAN (PAGE 5) =================

const btnKembaliKePerkataan = document.getElementById("btn-kembali-ke-perkataan");
const tajukElemenPerkataan = document.getElementById("tajuk-elemen-perkataan");
const labelElemenBahasaHurufPerkataan = document.getElementById("label-elemen-bahasa-huruf-perkataan");
const btnElemenAyatBiasa = document.getElementById("btn-elemen-ayat-biasa");
const btnElemenDialog = document.getElementById("btn-elemen-dialog");

btnKembaliKePerkataan?.addEventListener("click", () => {
  showPage("page-perkataan");
});

function openElemenPage() {
  if (!currentBahasa || !currentHuruf || !currentPerkataan) return;
  tajukElemenPerkataan.textContent = "Elemen: " + currentPerkataan.word;
  labelElemenBahasaHurufPerkataan.textContent =
    "Bahasa: " + currentBahasa.name +
    " | Huruf: " + currentHuruf +
    " | Perkataan: " + currentPerkataan.word;
  showPage("page-elemen");
}

btnElemenAyatBiasa?.addEventListener("click", () => {
  openAyatBiasaPage();
});

btnElemenDialog?.addEventListener("click", () => {
  openDialogPage();
});

// ================== AYAT BIASA & KARANGAN =================

const btnKembaliKeElemenDariAyatBiasa = document.getElementById("btn-kembali-ke-elemen-dari-ayat-biasa");
const tajukAyatBiasa = document.getElementById("tajuk-ayat-biasa");
const labelAyatBiasa = document.getElementById("label-ayat-biasa");
const btnTambahAyatBiasa = document.getElementById("btn-tambah-ayat-biasa");
const senaraiAyatBiasaEl = document.getElementById("senarai-ayat-biasa");

btnKembaliKeElemenDariAyatBiasa?.addEventListener("click", () => {
  showPage("page-elemen");
});

let cacheAyatBiasa = [];

function openAyatBiasaPage() {
  if (!currentPerkataan) return;
  tajukAyatBiasa.textContent = "Ayat biasa & karangan: " + currentPerkataan.word;
  labelAyatBiasa.textContent =
    "Bahasa: " + currentBahasa.name +
    " | Huruf: " + currentHuruf;
  loadAyatBiasa();
  showPage("page-ayat-biasa");
}

btnTambahAyatBiasa?.addEventListener("click", async () => {
  try {
    await addDoc(collection(db, "sentences"), {
      userId: currentUser.uid,
      wordId: currentPerkataan.id,
      text: "",
      createdAt: serverTimestamp()
    });
    loadAyatBiasa();
  } catch (err) {
    console.error(err);
    showStatus("Gagal tambah ayat.", "error");
  }
});

async function loadAyatBiasa() {
  if (!currentPerkataan) return;
  const q = query(
    collection(db, "sentences"),
    where("userId", "==", currentUser.uid),
    where("wordId", "==", currentPerkataan.id),
    orderBy("createdAt", "asc")
  );
  const snap = await getDocs(q);
  cacheAyatBiasa = snap.docs.map(d => ({
    id: d.id,
    ...d.data()
  }));
  renderAyatBiasa();
}

function renderAyatBiasa() {
  if (!senaraiAyatBiasaEl) return;
  senaraiAyatBiasaEl.innerHTML = "";
  cacheAyatBiasa.forEach(a => {
    const wrap = document.createElement("div");
    wrap.className = "ayat-item";

    const textarea = document.createElement("textarea");
    textarea.value = a.text || "";
    textarea.placeholder = "Tulis ayat di sini...";
    textarea.addEventListener("change", async () => {
      try {
        await setDoc(doc(db, "sentences", a.id), {
          ...a,
          text: textarea.value
        });
      } catch (err) {
        console.error(err);
        showStatus("Gagal simpan ayat.", "error");
      }
    });

    const actions = document.createElement("div");
    actions.style.textAlign = "right";

    const btnPadam = document.createElement("button");
    btnPadam.className = "btn small danger";
    btnPadam.textContent = "Padam";
    btnPadam.addEventListener("click", async () => {
      if (!confirm("Padam ayat ini?")) return;
      try {
        await deleteDoc(doc(db, "sentences", a.id));
        loadAyatBiasa();
      } catch (err) {
        console.error(err);
        showStatus("Gagal padam ayat.", "error");
      }
    });

    actions.appendChild(btnPadam);
    wrap.appendChild(textarea);
    wrap.appendChild(actions);
    senaraiAyatBiasaEl.appendChild(wrap);
  });
}

// ================== DIALOG (SENARAI TAJUK) =================

const btnKembaliKeElemenDariDialog = document.getElementById("btn-kembali-ke-elemen-dari-dialog");
const tajukDialog = document.getElementById("tajuk-dialog");
const labelDialog = document.getElementById("label-dialog");
const btnTambahDialog = document.getElementById("btn-tambah-dialog");
const senaraiDialogEl = document.getElementById("senarai-dialog");

let cacheDialog = [];
let currentDialog = null;

btnKembaliKeElemenDariDialog?.addEventListener("click", () => {
  showPage("page-elemen");
});

function openDialogPage() {
  if (!currentPerkataan) return;
  tajukDialog.textContent = "Ayat dialog: " + currentPerkataan.word;
  labelDialog.textContent =
    "Bahasa: " + currentBahasa.name +
    " | Huruf: " + currentHuruf;
  loadDialogList();
  showPage("page-dialog");
}

btnTambahDialog?.addEventListener("click", async () => {
  const tajuk = prompt("Masukkan tajuk dialog (contoh: Menari):");
  if (!tajuk || !tajuk.trim()) return;
  try {
    await addDoc(collection(db, "dialogs"), {
      userId: currentUser.uid,
      wordId: currentPerkataan.id,
      title: tajuk.trim(),
      createdAt: serverTimestamp()
    });
    showStatus("Dialog ditambah.", "success");
    loadDialogList();
  } catch (err) {
    console.error(err);
    showStatus("Gagal tambah dialog.", "error");
  }
});

async function loadDialogList() {
  if (!currentPerkataan) return;
  const q = query(
    collection(db, "dialogs"),
    where("userId", "==", currentUser.uid),
    where("wordId", "==", currentPerkataan.id),
    orderBy("createdAt", "asc")
  );
  const snap = await getDocs(q);
  cacheDialog = snap.docs.map(d => ({
    id: d.id,
    ...d.data()
  }));
  renderDialogList();
}

function renderDialogList() {
  if (!senaraiDialogEl) return;
  senaraiDialogEl.innerHTML = "";
  cacheDialog.forEach(dg => {
    const li = document.createElement("li");

    const main = document.createElement("div");
    main.className = "item-main";
    main.textContent = dg.title;
    main.addEventListener("click", () => {
      currentDialog = { id: dg.id, title: dg.title, data: dg };
      openDialogBubblePage();
    });

    const actions = document.createElement("div");
    actions.className = "item-actions";

    const btnEdit = document.createElement("button");
    btnEdit.className = "btn small secondary";
    btnEdit.textContent = "Sunting";
    btnEdit.addEventListener("click", async (e) => {
      e.stopPropagation();
      const baru = prompt("Sunting tajuk dialog:", dg.title);
      if (!baru || !baru.trim()) return;
      try {
        await setDoc(doc(db, "dialogs", dg.id), {
          ...dg,
          title: baru.trim()
        });
        showStatus("Dialog dikemaskini.", "success");
        loadDialogList();
      } catch (err) {
        console.error(err);
        showStatus("Gagal sunting dialog.", "error");
      }
    });

    const btnPadam = document.createElement("button");
    btnPadam.className = "btn small danger";
    btnPadam.textContent = "Padam";
    btnPadam.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Padam dialog ini beserta semua bubble chat di dalamnya?")) return;
      try {
        await deleteDoc(doc(db, "dialogs", dg.id));
        // Nota: kalau nak bersih, padam semua bubbles juga
        showStatus("Dialog dipadam.", "success");
        loadDialogList();
      } catch (err) {
        console.error(err);
        showStatus("Gagal padam dialog.", "error");
      }
    });

    actions.appendChild(btnEdit);
    actions.appendChild(btnPadam);

    li.appendChild(main);
    li.appendChild(actions);
    senaraiDialogEl.appendChild(li);
  });
}

// ================== DIALOG BUBBLE (PAGE SIMPANAN DIALOG) =================

const btnKembaliKeSenaraiDialog = document.getElementById("btn-kembali-ke-senarai-dialog");
const tajukDialogBubble = document.getElementById("tajuk-dialog-bubble");
const labelDialogBubble = document.getElementById("label-dialog-bubble");
const btnTambahBubble = document.getElementById("btn-tambah-bubble");
const senaraiBubbleEl = document.getElementById("senarai-bubble");

let cacheBubble = [];
let nextBubblePosition = "left"; // bergilir: left -> right -> left...

btnKembaliKeSenaraiDialog?.addEventListener("click", () => {
  showPage("page-dialog");
});

function openDialogBubblePage() {
  if (!currentDialog) return;
  tajukDialogBubble.textContent = "Dialog: " + currentDialog.title;
  labelDialogBubble.textContent =
    "Bahasa: " + currentBahasa.name +
    " | Huruf: " + currentHuruf +
    " | Perkataan: " + currentPerkataan.word;
  nextBubblePosition = "left"; // reset pattern bila buka
  loadBubbleList();
  showPage("page-dialog-bubble");
}

btnTambahBubble?.addEventListener("click", async () => {
  if (!currentDialog) return;
  try {
    await addDoc(collection(db, "bubbles"), {
      userId: currentUser.uid,
      dialogId: currentDialog.id,
      text: "",
      position: nextBubblePosition,
      createdAt: serverTimestamp()
    });
    // Toggle posisi
    nextBubblePosition = nextBubblePosition === "left" ? "right" : "left";
    loadBubbleList();
  } catch (err) {
    console.error(err);
    showStatus("Gagal tambah bubble.", "error");
  }
});

async function loadBubbleList() {
  if (!currentDialog) return;
  const q = query(
    collection(db, "bubbles"),
    where("userId", "==", currentUser.uid),
    where("dialogId", "==", currentDialog.id),
    orderBy("createdAt", "asc")
  );
  const snap = await getDocs(q);
  cacheBubble = snap.docs.map(d => ({
    id: d.id,
    ...d.data()
  }));
  renderBubbleList();
}

function renderBubbleList() {
  if (!senaraiBubbleEl) return;
  senaraiBubbleEl.innerHTML = "";
  cacheBubble.forEach(b => {
    const row = document.createElement("div");
    row.className = "bubble-row";

    const bubble = document.createElement("div");
    bubble.className = "bubble " + (b.position || "left");

    const textarea = document.createElement("textarea");
    textarea.value = b.text || "";
    textarea.placeholder = "Tulis dialog di sini...";
    textarea.addEventListener("change", async () => {
      try {
        await setDoc(doc(db, "bubbles", b.id), {
          ...b,
          text: textarea.value
        });
      } catch (err) {
        console.error(err);
        showStatus("Gagal simpan bubble.", "error");
      }
    });

    const actions = document.createElement("div");
    actions.className = "bubble-actions";

    const btnPadam = document.createElement("button");
    btnPadam.className = "btn small danger";
    btnPadam.textContent = "Padam";
    btnPadam.addEventListener("click", async () => {
      if (!confirm("Padam bubble ini?")) return;
      try {
        await deleteDoc(doc(db, "bubbles", b.id));
        loadBubbleList();
      } catch (err) {
        console.error(err);
        showStatus("Gagal padam bubble.", "error");
      }
    });

    actions.appendChild(btnPadam);
    bubble.appendChild(textarea);
    bubble.appendChild(actions);
    row.appendChild(bubble);
    senaraiBubbleEl.appendChild(row);
  });
}

// ================== LOG PAGE =================

const pageLog = document.getElementById("page-log");
const btnKembaliDariLog = document.getElementById("btn-kembali-dari-log");
const inputSearchLog = document.getElementById("search-log");
const senaraiLogEl = document.getElementById("senarai-log");
const btnPadamSemuaLog = document.getElementById("btn-padamlah-semua-log");

let cacheLog = [];

btnKembaliDariLog?.addEventListener("click", () => {
  if (lastPageBeforeLog) {
    showPage(lastPageBeforeLog);
  } else {
    showPage("page-bahasa");
  }
});

btnPadamSemuaLog?.addEventListener("click", async () => {
  if (!confirm("Padam semua log?")) return;
  try {
    const q = query(
      collection(db, "logs"),
      where("userId", "==", currentUser.uid)
    );
    const snap = await getDocs(q);
    const batchDeletes = snap.docs.map(d => deleteDoc(doc(db, "logs", d.id)));
    await Promise.all(batchDeletes);
    showStatus("Semua log dipadam.", "success");
    loadLog();
  } catch (err) {
    console.error(err);
    showStatus("Gagal padam semua log.", "error");
  }
});

inputSearchLog?.addEventListener("input", () => {
  renderLogList(cacheLog, inputSearchLog.value);
});

function openLogPage() {
  loadLog();
  showPage("page-log");
}

async function loadLog() {
  if (!currentUser) return;
  const q = query(
    collection(db, "logs"),
    where("userId", "==", currentUser.uid),
    orderBy("createdAt", "desc")
  );
  const snap = await getDocs(q);
  cacheLog = snap.docs.map(d => ({
    id: d.id,
    ...d.data()
  }));
  renderLogList(cacheLog, inputSearchLog.value);
}

function renderLogList(list, filterText = "") {
  if (!senaraiLogEl) return;
  senaraiLogEl.innerHTML = "";
  const ft = (filterText || "").toLowerCase();

  list
    .filter(l => !ft || (l.word || "").toLowerCase().includes(ft))
    .forEach(l => {
      const li = document.createElement("li");
      const main = document.createElement("div");
      main.className = "item-main";

      const title = document.createElement("div");
      title.textContent = l.word;

      const info = document.createElement("div");
      info.style.fontSize = "0.8rem";
      info.style.color = "#6b7280";
      info.textContent = `Bahasa: ${l.bahasaName} | Huruf: ${l.huruf}`;

      main.appendChild(title);
      main.appendChild(info);

      main.addEventListener("click", async () => {
        await bukaPerkataanDariLog(l);
      });

      const actions = document.createElement("div");
      actions.className = "item-actions";

      const btnPadam = document.createElement("button");
      btnPadam.className = "btn small danger";
      btnPadam.textContent = "Padam";
      btnPadam.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm("Padam log ini?")) return;
        try {
          await deleteDoc(doc(db, "logs", l.id));
          loadLog();
        } catch (err) {
          console.error(err);
          showStatus("Gagal padam log.", "error");
        }
      });

      actions.appendChild(btnPadam);

      li.appendChild(main);
      li.appendChild(actions);
      senaraiLogEl.appendChild(li);
    });
}

// Bila user tekan log → terus ke Page 5 (Elemen Perkataan)
async function bukaPerkataanDariLog(logItem) {
  try {
    const wordRef = doc(db, "words", logItem.wordId);
    const wordSnap = await getDoc(wordRef);
    if (!wordSnap.exists()) {
      showStatus("Perkataan dalam log sudah tiada.", "error");
      return;
    }
    const wdata = wordSnap.data();

    // Set state berdasarkan data
    currentBahasa = {
      id: wdata.bahasaId,
      name: wdata.bahasaName
    };
    currentHuruf = wdata.huruf;
    currentPerkataan = {
      id: logItem.wordId,
      word: wdata.word,
      data: wdata
    };

    // Terus ke Elemen (Page 5)
    openElemenPage();
  } catch (err) {
    console.error(err);
    showStatus("Gagal buka perkataan dari log.", "error");
  }
}

// ================== EXPORT MOD TAMBAH PANTAS ==================
btnExport?.addEventListener("click", async () => {
  if (!currentBahasa || !currentHuruf) {
    showStatus("Sila pilih bahasa & huruf sebelum export.", "error");
    return;
  }
  try {
    showStatus("Sedang export...", "info", 0);

    const q = query(
      collection(db, "words"),
      where("userId", "==", currentUser.uid),
      where("bahasaId", "==", currentBahasa.id),
      where("huruf", "==", currentHuruf),
      orderBy("word", "asc")
    );
    const snap = await getDocs(q);

    let output = "";
    snap.docs.forEach((d, idx) => {
      const data = d.data();

      // buang semua jenis enter (CRLF, CR, LF) dalam satu elemen
      const cleanWord = (data.word || "")
        .replace(/\r\n|\r|\n/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      const cleanMeaning = (data.meaning || "")
        .replace(/\r\n|\r|\n/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      output += cleanWord + "\n";
      if (cleanMeaning) {
        output += cleanMeaning + "\n";
      }

      if (idx < snap.docs.length - 1) {
        output += "\n"; // sempadan antara elemen
      }
    });

    const blob = new Blob([output], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${currentBahasa.name}-${currentHuruf}.txt`;
    a.click();
    URL.revokeObjectURL(url);

    showStatus("Export Mod Tambah Pantas berjaya.", "success");
  } catch (err) {
    console.error(err);
    showStatus("Gagal export.", "error");
  }
});

// ================== KAMUS + TTS =================

pages.kamus = document.getElementById("page-kamus");

const btnKembaliDariKamus = document.getElementById("btn-kembali-dari-kamus");
const inputKamus = document.getElementById("input-kamus");
const btnCariKamus = document.getElementById("btn-cari-kamus");
const hasilKamusEl = document.getElementById("hasil-kamus");
const btnTambahKeNota = document.getElementById("btn-tambah-ke-nota");
const textareaNota = document.getElementById("textarea-nota");
const btnBacaNota = document.getElementById("btn-baca-nota");
const btnHentiBaca = document.getElementById("btn-henti-baca");

btnKembaliDariKamus?.addEventListener("click", () => {
  showPage("page-bahasa"); // balik ke page bahasa
});

// carian dalam log (longgar, partial match)
btnCariKamus?.addEventListener("click", () => {
  const q = inputKamus.value.trim().toLowerCase();
  hasilKamusEl.innerHTML = "";
  btnTambahKeNota.classList.add("hidden");
  if (!q) return;

  const matches = cacheLog.filter(l => (l.word || "").toLowerCase().includes(q));

  if (matches.length > 0) {
    hasilKamusEl.innerHTML = matches.map(m => {
      // highlight perkataan yang match
      const highlighted = m.word.replace(
        new RegExp(q, "gi"),
        match => `<mark>${match}</mark>`
      );
      return `
        <div><strong>${highlighted}</strong></div>
        <div>Bahasa: ${m.bahasaName} | Huruf: ${m.huruf}</div>
      `;
    }).join("<hr/>");
    btnTambahKeNota.classList.remove("hidden");
  } else {
    hasilKamusEl.textContent = "Perkataan tidak ditemui dalam log.";
  }
});

btnTambahKeNota?.addEventListener("click", () => {
  const q = inputKamus.value.trim();
  if (!q) return;
  textareaNota.value = (textareaNota.value + "\n" + q).trim();
});

// ================== TTS ==================
const selectVoice = document.getElementById("select-voice");
const selectRate = document.getElementById("select-rate");
const labelRate = document.getElementById("label-rate");

// populate voices bila available
function populateVoices() {
  const voices = speechSynthesis.getVoices();
  selectVoice.innerHTML = voices.map((v, i) =>
    `<option value="${i}">${v.name} (${v.lang})</option>`
  ).join("");
}
speechSynthesis.onvoiceschanged = populateVoices;
populateVoices();

function speakText(text) {
  // hentikan bacaan lama kalau ada
  speechSynthesis.cancel();

  const utter = new SpeechSynthesisUtterance(text);

  // pilih suara dari dropdown
  const voices = speechSynthesis.getVoices();
  const selectedIndex = parseInt(selectVoice.value, 10);
  if (voices[selectedIndex]) {
    utter.voice = voices[selectedIndex];
    utter.lang = voices[selectedIndex].lang;
  }

  // kelajuan dari slider
  utter.rate = parseFloat(selectRate.value);
  utter.pitch = 1;   // nada normal
  utter.volume = 1;  // kuat penuh

  speechSynthesis.speak(utter);
}

btnBacaNota?.addEventListener("click", () => {
  const note = textareaNota.value.trim();
  if (note) {
    speakText(note);
  }
});

btnHentiBaca?.addEventListener("click", () => {
  speechSynthesis.cancel();
});

// update label kelajuan bila slider gerak
selectRate?.addEventListener("input", () => {
  labelRate.textContent = `${selectRate.value}x`;
});

// butang dari Log page ke Kamus
const btnKeKamusDariLog = document.getElementById("btn-ke-kamus-dari-log");
btnKeKamusDariLog?.addEventListener("click", () => {
  showPage("page-kamus");
});
