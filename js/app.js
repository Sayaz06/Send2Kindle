// ═══════════════════════════════════════════════════
// Kindle Queue Manager
// Firebase Auth (Google) + Firebase Storage + Firestore + Gmail API
// ═══════════════════════════════════════════════════

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth, signInWithPopup, signOut,
  GoogleAuthProvider, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore, collection, doc, onSnapshot,
  setDoc, updateDoc, deleteDoc, query, orderBy
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  getStorage, ref as storageRef,
  uploadBytesResumable, getDownloadURL, deleteObject
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

// ─── Firebase Config ───
const firebaseConfig = {
  apiKey:            "AIzaSyAGLX_xxH_dQ06epX4XCXtuSHN0DwZFMjA",
  authDomain:        "stress-auti-action.firebaseapp.com",
  projectId:         "stress-auti-action",
  storageBucket:     "stress-auti-action.firebasestorage.app",
  messagingSenderId: "792580618622",
  appId:             "1:792580618622:web:f0efb1d630e795584d5b2f"
};

// ─── Google OAuth Client ID ───
const GOOGLE_CLIENT_ID = "792580618622-totif96rt8cd66dnlosaao7tg7ns22is.apps.googleusercontent.com";

// ─── Gmail API Scope ───
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";

const firebaseApp = initializeApp(firebaseConfig, 'kindle-queue');
const auth        = getAuth(firebaseApp);
const db          = getFirestore(firebaseApp);
const storage     = getStorage(firebaseApp);

const QUEUE_COL   = 'kindle_queue';
const STORAGE_KEY = 'kindle_queue_settings';

// ─── State ───
let currentUser     = null;
let accessToken     = null;   // Gmail API token
let isRunning       = false;
let queueItems      = [];
let queueTimer      = null;
let countdownInterval = null;
let nextSendAt      = null;
let unsubscribeQueue = null;

// ─── DOM ───
const $ = id => document.getElementById(id);

const elLoginScreen   = $('login-screen');
const elMainApp       = $('main-app');
const elUserInfo      = $('user-info');
const elUserAvatar    = $('user-avatar');
const elUserName      = $('user-name');
const elBtnSignin     = $('btn-signin');
const elBtnSignout    = $('btn-signout');

const elKindleEmail   = $('kindle-email');
const elDelayMinutes  = $('delay-minutes');
const elBtnSave       = $('btn-save-settings');
const elBtnToggleSet  = $('btn-toggle-settings');
const elSettingsBody  = $('settings-body');
const elGmailInfo     = $('gmail-info');
const elGmailSender   = $('gmail-sender');

const elBtnStart      = $('btn-start');
const elBtnStop       = $('btn-stop');
const elBtnClearSent  = $('btn-clear-sent');

const elCountdownPanel = $('countdown-panel');
const elCountdownDisp  = $('countdown-display');
const elCountdownFile  = $('countdown-file');

const elNumPending    = $('num-pending');
const elNumSending    = $('num-sending');
const elNumSent       = $('num-sent');
const elNumFailed     = $('num-failed');

const elDropzone      = $('dropzone');
const elFileInput     = $('file-input');
const elUploadProgress = $('upload-progress');
const elUploadFill    = $('upload-fill');
const elUploadText    = $('upload-text');

const elQueueEmpty    = $('queue-empty');
const elQueueList     = $('queue-list');
const elQueueCount    = $('queue-count');
const elToast         = $('toast');

// ═══════════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════════
let toastTimer;
function showToast(msg, type = '', dur = 3500) {
  elToast.textContent = msg;
  elToast.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elToast.classList.remove('show'), dur);
}

// ═══════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    elKindleEmail.value  = s.kindleEmail  || '';
    elDelayMinutes.value = s.delayMinutes || 5;
  } catch (_) {}
}

function saveSettings() {
  const s = getSettings();
  if (!s.kindleEmail) {
    showToast('⚠️ Sila isi e-mel Kindle.', 'error');
    return false;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  showToast('✅ Tetapan disimpan.', 'ok');
  return true;
}

function getSettings() {
  return {
    kindleEmail:  elKindleEmail.value.trim(),
    delayMinutes: parseInt(elDelayMinutes.value) || 5,
  };
}

// ═══════════════════════════════════════════════════
// GOOGLE AUTH + GMAIL TOKEN
// ═══════════════════════════════════════════════════
const provider = new GoogleAuthProvider();
provider.addScope(GMAIL_SCOPE);
provider.setCustomParameters({ access_type: 'online', prompt: 'consent' });

async function signIn() {
  try {
    const result = await signInWithPopup(auth, provider);
    // Ambil access token untuk Gmail API
    const credential = GoogleAuthProvider.credentialFromResult(result);
    accessToken = credential.accessToken;
    showToast('✅ Log masuk berjaya!', 'ok');
  } catch (err) {
    if (err.code === 'auth/popup-closed-by-user') return;
    showToast(`❌ Gagal log masuk: ${err.message}`, 'error', 5000);
  }
}

async function signOutUser() {
  stopQueue(false);
  if (unsubscribeQueue) { unsubscribeQueue(); unsubscribeQueue = null; }
  accessToken = null;
  await signOut(auth);
  showToast('👋 Sudah log keluar.', '');
}

// Refresh token bila hampir tamat
async function ensureToken() {
  if (!accessToken || !currentUser) {
    // Re-sign in untuk dapat token baru
    try {
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      accessToken = credential.accessToken;
    } catch (_) {
      throw new Error('Token Gmail tamat. Sila log masuk semula.');
    }
  }
  return accessToken;
}

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  if (user) {
    // Tunjuk app
    elLoginScreen.style.display = 'none';
    elMainApp.style.display = 'grid';
    elUserInfo.style.display = 'flex';
    elUserAvatar.src = user.photoURL || '';
    elUserName.textContent = user.displayName || user.email;
    elGmailInfo.style.display = 'block';
    elGmailSender.textContent = user.email;
    loadSettings();
    subscribeQueue();
  } else {
    // Tunjuk login
    elLoginScreen.style.display = 'flex';
    elMainApp.style.display = 'none';
    elUserInfo.style.display = 'none';
    elGmailInfo.style.display = 'none';
    queueItems = [];
  }
});

// ═══════════════════════════════════════════════════
// GMAIL API — Hantar E-mel dengan Attachment
// ═══════════════════════════════════════════════════
async function sendViaGmailAPI(toEmail, fileName, fileBlob) {
  const token = await ensureToken();

  // Encode fail ke base64
  const fileBase64 = await blobToBase64(fileBlob);
  const mimeType   = getMimeType(fileName);

  // Bina e-mel MIME format
  const boundary = `boundary_${Date.now()}`;
  const emailLines = [
    `To: ${toEmail}`,
    `Subject: Convert`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    ``,
    `Fail: ${fileName}`,
    `Dihantar oleh Kindle Queue Manager.`,
    ``,
    `--${boundary}`,
    `Content-Type: ${mimeType}; name="${fileName}"`,
    `Content-Disposition: attachment; filename="${fileName}"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    fileBase64,
    `--${boundary}--`,
  ].join('\r\n');

  // Encode kepada base64url
  const encodedEmail = btoa(unescape(encodeURIComponent(emailLines)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const response = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: encodedEmail }),
    }
  );

  if (!response.ok) {
    const err = await response.json();
    // Token expired — clear dan throw
    if (response.status === 401) {
      accessToken = null;
      throw new Error('Token Gmail tamat tempoh. Cuba semula.');
    }
    throw new Error(err.error?.message || `Gmail API error ${response.status}`);
  }

  return await response.json();
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // Ambil bahagian base64 sahaja (buang prefix data:...)
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function getMimeType(fileName) {
  const ext = fileName.split('.').pop().toLowerCase();
  const map = {
    pdf:  'application/pdf',
    epub: 'application/epub+zip',
    mobi: 'application/x-mobipocket-ebook',
    azw3: 'application/vnd.amazon.ebook',
  };
  return map[ext] || 'application/octet-stream';
}

// ═══════════════════════════════════════════════════
// FIREBASE STORAGE — Upload & Download
// ═══════════════════════════════════════════════════
async function uploadFile(file, onProgress) {
  const ext  = file.name.split('.').pop().toLowerCase();
  const id   = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const path = `kindle_queue/${currentUser.uid}/${id}.${ext}`;
  const sRef = storageRef(storage, path);

  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(sRef, file);
    task.on('state_changed',
      snap => { if (onProgress) onProgress(Math.round(snap.bytesTransferred / snap.totalBytes * 100)); },
      reject,
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        resolve({ path, url });
      }
    );
  });
}

async function downloadBlob(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Gagal muat turun fail dari Storage.');
  return await res.blob();
}

async function deleteFromStorage(path) {
  try { await deleteObject(storageRef(storage, path)); } catch (_) {}
}

// ═══════════════════════════════════════════════════
// FIRESTORE — Queue CRUD
// ═══════════════════════════════════════════════════
function userQueueCol() {
  return collection(db, 'users', currentUser.uid, QUEUE_COL);
}

async function addQueueItem(item) {
  const ref = doc(userQueueCol());
  await setDoc(ref, { ...item, id: ref.id, status: 'pending', error: null, sentAt: null, addedAt: Date.now() });
}

async function updateQueueItem(id, data) {
  await updateDoc(doc(userQueueCol(), id), data);
}

async function deleteQueueItem(id) {
  await deleteDoc(doc(userQueueCol(), id));
}

function subscribeQueue() {
  if (!currentUser) return;
  if (unsubscribeQueue) unsubscribeQueue();
  const q = query(userQueueCol(), orderBy('addedAt', 'asc'));
  unsubscribeQueue = onSnapshot(q, snap => {
    queueItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderQueue();
    updateStats();
    if (isRunning) checkAndSchedule();
  });
}

// ═══════════════════════════════════════════════════
// QUEUE WORKER
// ═══════════════════════════════════════════════════
function checkAndSchedule() {
  if (!isRunning) return;
  const sending = queueItems.find(i => i.status === 'sending');
  if (sending) return;

  const next = queueItems.find(i => i.status === 'pending');
  if (!next) {
    stopQueue(false);
    showToast('✅ Semua fail telah dihantar!', 'ok', 5000);
    return;
  }

  if (!nextSendAt) {
    const delayMs = getSettings().delayMinutes * 60 * 1000;
    nextSendAt = Date.now() + delayMs;
    startCountdownDisplay(next);
    clearTimeout(queueTimer);
    queueTimer = setTimeout(() => processNext(), delayMs);
  }
}

async function processNext() {
  if (!isRunning) return;
  clearCountdown();

  const next = queueItems.find(i => i.status === 'pending');
  if (!next) return;

  const s = getSettings();
  await updateQueueItem(next.id, { status: 'sending' });

  try {
    // Muat turun fail dari Firebase Storage
    showToast(`⬇️ Memuat turun ${next.originalName}...`, '');
    const blob = await downloadBlob(next.url);

    // Hantar via Gmail API
    showToast(`📤 Menghantar ${next.originalName}...`, '');
    await sendViaGmailAPI(s.kindleEmail, next.originalName, blob);

    await updateQueueItem(next.id, { status: 'sent', sentAt: Date.now(), error: null });
    showToast(`✅ Dihantar: ${next.originalName}`, 'ok');

  } catch (err) {
    const msg = err?.message || 'Ralat tidak diketahui';
    await updateQueueItem(next.id, { status: 'failed', error: msg });
    showToast(`❌ Gagal: ${next.originalName}`, 'error', 5000);
  }

  if (isRunning) { nextSendAt = null; checkAndSchedule(); }
}

function startQueue() {
  isRunning = true;
  nextSendAt = null;
  updateStatusUI(true);
  checkAndSchedule();
}

function stopQueue(showMsg = true) {
  isRunning = false;
  clearTimeout(queueTimer);
  queueTimer = null;
  clearCountdown();
  updateStatusUI(false);
  if (showMsg) showToast('⏹ Queue dihentikan.', '');
}

// ═══════════════════════════════════════════════════
// COUNTDOWN
// ═══════════════════════════════════════════════════
function startCountdownDisplay(item) {
  elCountdownPanel.style.display = 'block';
  elCountdownFile.textContent = `Seterusnya: ${item?.originalName || ''}`;
  clearInterval(countdownInterval);
  tick();
  countdownInterval = setInterval(tick, 1000);
  function tick() {
    if (!nextSendAt) return;
    const diff = Math.max(0, nextSendAt - Date.now());
    const m = Math.floor(diff / 60000).toString().padStart(2, '0');
    const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
    elCountdownDisp.textContent = `${m}:${s}`;
    if (diff === 0) { clearInterval(countdownInterval); elCountdownDisp.textContent = '⏳'; }
  }
}

function clearCountdown() {
  clearInterval(countdownInterval);
  nextSendAt = null;
  elCountdownPanel.style.display = 'none';
}

// ═══════════════════════════════════════════════════
// UI
// ═══════════════════════════════════════════════════
function updateStatusUI(running) {
  elBtnStart.style.display = running ? 'none' : 'flex';
  elBtnStop.style.display  = running ? 'flex'  : 'none';
}

function updateStats() {
  elNumPending.textContent = queueItems.filter(i => i.status === 'pending').length;
  elNumSending.textContent = queueItems.filter(i => i.status === 'sending').length;
  elNumSent.textContent    = queueItems.filter(i => i.status === 'sent').length;
  elNumFailed.textContent  = queueItems.filter(i => i.status === 'failed').length;
}

function renderQueue() {
  const total = queueItems.length;
  elQueueCount.textContent = `${total} fail`;

  if (total === 0) {
    elQueueEmpty.style.display = 'flex';
    elQueueList.style.display = 'none';
    elQueueList.innerHTML = '';
    return;
  }

  elQueueEmpty.style.display = 'none';
  elQueueList.style.display = 'flex';

  const existingIds = new Set([...elQueueList.querySelectorAll('.q-item')].map(el => el.dataset.id));
  const newIds = new Set(queueItems.map(i => i.id));

  for (const id of existingIds) {
    if (!newIds.has(id)) elQueueList.querySelector(`.q-item[data-id="${id}"]`)?.remove();
  }

  queueItems.forEach((item, idx) => {
    let el = elQueueList.querySelector(`.q-item[data-id="${item.id}"]`);
    if (!el) { el = buildItemEl(item); elQueueList.appendChild(el); }
    else updateItemEl(el, item);
    if ([...elQueueList.children].indexOf(el) !== idx) {
      elQueueList.insertBefore(el, elQueueList.children[idx] || null);
    }
  });
}

function buildItemEl(item) {
  const el = document.createElement('div');
  el.className = 'q-item';
  el.innerHTML = `
    <div class="q-item-main">
      <div class="q-item-icon">📄</div>
      <div class="q-item-info">
        <div class="q-item-name"></div>
        <div class="q-item-meta">
          <span class="q-item-size"></span>
          <span class="q-item-dot">·</span>
          <span class="q-item-time"></span>
        </div>
      </div>
      <div class="q-item-right">
        <span class="q-badge"></span>
        <div class="q-item-actions">
          <button class="btn-send-now btn-icon-sm" title="Hantar Sekarang" style="display:none;">⚡</button>
          <button class="btn-retry btn-icon-sm" title="Cuba Semula" style="display:none;">🔄</button>
          <button class="btn-remove btn-icon-sm btn-icon-danger" title="Padam">✕</button>
        </div>
      </div>
    </div>
    <div class="q-item-error" style="display:none;"></div>
    <div class="q-item-progress" style="display:none;">
      <div class="q-item-progress-bar"><div class="q-item-progress-fill"></div></div>
    </div>`;
  updateItemEl(el, item);
  setupItemEvents(el, item);
  return el;
}

function updateItemEl(el, item) {
  el.dataset.id     = item.id;
  el.dataset.status = item.status;

  el.querySelector('.q-item-name').textContent = item.originalName;
  el.querySelector('.q-item-size').textContent = `${item.sizeMB} MB`;
  el.querySelector('.q-item-time').textContent = timeAgo(item.addedAt);

  const map = { pending:'Menunggu', sending:'Menghantar', sent:'Selesai', failed:'Gagal' };
  const badge = el.querySelector('.q-badge');
  badge.textContent = map[item.status] || item.status;
  badge.className = `q-badge badge-${item.status}`;

  const ext = item.originalName?.split('.').pop().toLowerCase();
  el.querySelector('.q-item-icon').textContent = ext === 'epub' ? '📗' : '📄';

  const errEl  = el.querySelector('.q-item-error');
  const progEl = el.querySelector('.q-item-progress');
  const btnRem = el.querySelector('.btn-remove');
  const btnRet = el.querySelector('.btn-retry');
  const btnNow = el.querySelector('.btn-send-now');

  errEl.style.display  = (item.status === 'failed' && item.error) ? 'block' : 'none';
  if (item.error) errEl.textContent = `⚠️ ${item.error}`;
  progEl.style.display = item.status === 'sending' ? 'block' : 'none';
  btnRem.style.display = item.status === 'sending' ? 'none' : 'inline-flex';
  btnRet.style.display = item.status === 'failed'  ? 'inline-flex' : 'none';
  btnNow.style.display = (item.status === 'pending' && isRunning) ? 'inline-flex' : 'none';
}

function setupItemEvents(el, item) {
  el.querySelector('.btn-remove').addEventListener('click', async () => {
    if (item.status === 'sending') return;
    await deleteQueueItem(item.id);
    if (item.storagePath) await deleteFromStorage(item.storagePath);
  });

  el.querySelector('.btn-retry').addEventListener('click', async () => {
    await updateQueueItem(item.id, { status: 'pending', error: null });
    if (isRunning && !nextSendAt) checkAndSchedule();
  });

  el.querySelector('.btn-send-now').addEventListener('click', async () => {
    if (!isRunning) return;
    clearTimeout(queueTimer);
    clearCountdown();
    nextSendAt = null;
    // Gerak ke depan
    const firstPending = queueItems.find(i => i.status === 'pending');
    if (firstPending && firstPending.id !== item.id) {
      await updateQueueItem(item.id, { addedAt: firstPending.addedAt - 1 });
    }
    setTimeout(() => processNext(), 300);
  });
}

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'baru sahaja';
  if (m < 60) return `${m} min lalu`;
  return `${Math.floor(m / 60)} jam lalu`;
}

// ═══════════════════════════════════════════════════
// UPLOAD
// ═══════════════════════════════════════════════════
async function uploadFiles(files) {
  if (!files || !files.length || !currentUser) return;

  const valid = [];
  for (const f of files) {
    const ext = f.name.split('.').pop().toLowerCase();
    if (!['pdf','epub','mobi','azw3'].includes(ext)) { showToast(`⚠️ Tidak disokong: ${f.name}`, 'error'); continue; }
    if (f.size > 20 * 1024 * 1024) { showToast(`⚠️ Terlalu besar (>20MB): ${f.name}`, 'error'); continue; }
    valid.push(f);
  }
  if (!valid.length) return;

  elUploadProgress.style.display = 'flex';
  let done = 0;

  for (const f of valid) {
    elUploadText.textContent = `Memuat naik ${f.name}...`;
    try {
      const { path, url } = await uploadFile(f, pct => {
        elUploadFill.style.width = `${pct}%`;
        elUploadText.textContent = `${f.name} — ${pct}%`;
      });
      await addQueueItem({
        originalName: f.name,
        sizeMB: parseFloat((f.size / 1024 / 1024).toFixed(2)),
        storagePath: path,
        url,
      });
      done++;
    } catch (err) {
      showToast(`❌ Gagal upload: ${f.name}`, 'error');
    }
  }

  elUploadProgress.style.display = 'none';
  elUploadFill.style.width = '0%';
  elFileInput.value = '';
  if (done > 0) showToast(`✅ ${done} fail ditambah ke queue.`, 'ok');
}

// ═══════════════════════════════════════════════════
// EVENT LISTENERS
// ═══════════════════════════════════════════════════
elBtnSignin.addEventListener('click', signIn);
elBtnSignout.addEventListener('click', signOutUser);
elBtnSave.addEventListener('click', saveSettings);

elBtnToggleSet.addEventListener('click', () => {
  const c = elSettingsBody.classList.toggle('collapsed');
  elBtnToggleSet.textContent = c ? '▸' : '▾';
});

elBtnStart.addEventListener('click', () => {
  if (!accessToken) {
    showToast('⚠️ Sila log masuk semula untuk refresh token Gmail.', 'error', 5000);
    signIn();
    return;
  }
  const s = getSettings();
  if (!s.kindleEmail) { showToast('⚠️ Sila isi e-mel Kindle dahulu.', 'error'); return; }
  const pending = queueItems.filter(i => i.status === 'pending').length;
  if (pending === 0) { showToast('⚠️ Tiada fail dalam queue.', 'error'); return; }
  saveSettings();
  startQueue();
  showToast(`▶ Queue dimulakan. Selang: ${s.delayMinutes} minit.`, 'ok');
});

elBtnStop.addEventListener('click', () => stopQueue(true));

elBtnClearSent.addEventListener('click', async () => {
  const toDelete = queueItems.filter(i => i.status === 'sent' || i.status === 'failed');
  for (const item of toDelete) {
    await deleteQueueItem(item.id);
    if (item.storagePath) await deleteFromStorage(item.storagePath);
  }
  showToast('🧹 Dibersihkan.', 'ok');
});

elFileInput.addEventListener('change', () => uploadFiles(elFileInput.files));

elDropzone.addEventListener('dragover', e => { e.preventDefault(); elDropzone.classList.add('drag-over'); });
elDropzone.addEventListener('dragleave', e => { if (!elDropzone.contains(e.relatedTarget)) elDropzone.classList.remove('drag-over'); });
elDropzone.addEventListener('drop', e => { e.preventDefault(); elDropzone.classList.remove('drag-over'); uploadFiles(e.dataTransfer.files); });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
