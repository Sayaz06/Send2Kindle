// ═══════════════════════════════════════════════════
// Kindle Queue Manager
// Firebase Auth + Storage + Firestore + Gmail API
// Background queue via Cloud Functions
// ═══════════════════════════════════════════════════

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth, signInWithPopup, signOut,
  GoogleAuthProvider, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore, collection, doc, onSnapshot, getDoc,
  setDoc, updateDoc, deleteDoc, query, orderBy
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  getStorage, ref as storageRef,
  uploadBytesResumable, getDownloadURL, deleteObject
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

const firebaseConfig = {
  apiKey:            "AIzaSyAGLX_xxH_dQ06epX4XCXtuSHN0DwZFMjA",
  authDomain:        "stress-auti-action.firebaseapp.com",
  projectId:         "stress-auti-action",
  storageBucket:     "stress-auti-action.firebasestorage.app",
  messagingSenderId: "792580618622",
  appId:             "1:792580618622:web:f0efb1d630e795584d5b2f"
};

const GOOGLE_CLIENT_ID = "792580618622-totif96rt8cd66dnlosaao7tg7ns22is.apps.googleusercontent.com";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";

const firebaseApp = initializeApp(firebaseConfig, 'kindle-queue');
const auth        = getAuth(firebaseApp);
const db          = getFirestore(firebaseApp);
const storage     = getStorage(firebaseApp);

const QUEUE_COL   = 'kindle_queue';
const STORAGE_KEY = 'kindle_queue_settings';

let currentUser     = null;
let accessToken     = null;
let isRunning       = false;
let clientWorker    = false;
let queueItems      = [];
let queueTimer      = null;
let countdownInterval = null;
let nextSendAt      = null;
let unsubscribeQueue = null;
let unsubscribeSettings = null;
let kindleAddresses = [];
let unsubscribeAddresses = null;
let tokenClient     = null;
let gmailReady      = false;

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

let toastTimer;
function showToast(msg, type = '', dur = 3500) {
  elToast.textContent = msg;
  elToast.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elToast.classList.remove('show'), dur);
}

// ── Kindle Address Manager ──

function kindleAddressCol() {
  return collection(db, 'users', currentUser.uid, 'kindle_addresses');
}

function subscribeAddresses() {
  if (!currentUser) return;
  if (unsubscribeAddresses) unsubscribeAddresses();
  unsubscribeAddresses = onSnapshot(
    query(kindleAddressCol(), orderBy('createdAt', 'asc')),
    snap => {
      kindleAddresses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderAddressList();
      renderAddressDropdown();
    },
    () => {}
  );
}

function renderAddressList() {
  const container = document.getElementById('kindle-address-list');
  if (!container) return;
  if (kindleAddresses.length === 0) {
    container.innerHTML = '<div style="font-size:0.75rem;color:var(--ink-faint);">Tiada alamat disimpan lagi.</div>';
    return;
  }
  container.innerHTML = kindleAddresses.map(addr => `
    <div class="kindle-address-item">
      <div class="kindle-address-info">
        <div class="kindle-address-label">${addr.label}</div>
        <div class="kindle-address-email">${addr.email}</div>
      </div>
      <button class="kindle-address-use" onclick="useKindleAddress('${addr.email}')">Guna</button>
      <button class="kindle-address-delete" onclick="deleteKindleAddress('${addr.id}')">✕</button>
    </div>
  `).join('');
}

function renderAddressDropdown() {
  const select = document.getElementById('kindle-select');
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">-- Pilih alamat --</option>';
  kindleAddresses.forEach(addr => {
    const opt = document.createElement('option');
    opt.value = addr.email;
    opt.textContent = `${addr.label} — ${addr.email}`;
    if (addr.email === current) opt.selected = true;
    select.appendChild(opt);
  });
}

window.useKindleAddress = function(email) {
  document.getElementById('kindle-email').value = email;
  const select = document.getElementById('kindle-select');
  if (select) select.value = email;
  showToast(`✅ Alamat dipilih: ${email}`, 'ok');
};

window.deleteKindleAddress = async function(id) {
  try {
    await deleteDoc(doc(kindleAddressCol(), id));
    showToast('🗑️ Alamat dipadam.', '');
  } catch (e) {
    showToast('❌ Gagal padam.', 'error');
  }
};

async function addKindleAddress() {
  const label = document.getElementById('new-kindle-label').value.trim();
  const email = document.getElementById('new-kindle-email').value.trim();
  if (!label) { showToast('⚠️ Sila isi label.', 'error'); return; }
  if (!email || !email.includes('@kindle.com')) { showToast('⚠️ Sila isi e-mel @kindle.com yang sah.', 'error'); return; }
  try {
    await setDoc(doc(kindleAddressCol()), {
      label,
      email,
      createdAt: Date.now(),
    });
    document.getElementById('new-kindle-label').value = '';
    document.getElementById('new-kindle-email').value = '';
    showToast('✅ Alamat ditambah!', 'ok');
  } catch (e) {
    showToast('❌ Gagal tambah alamat.', 'error');
  }
}

async function loadSettings() {
  try {
    if (currentUser) {
      const snap = await getDoc(doc(db, 'users', currentUser.uid, 'settings', 'queue'));
      if (snap.exists()) {
        const s = snap.data();
        elKindleEmail.value  = s.kindleEmail  || '';
        elDelayMinutes.value = s.delayMinutes || 1;
        return;
      }
    }
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    elKindleEmail.value  = s.kindleEmail  || '';
    elDelayMinutes.value = s.delayMinutes || 1;
  } catch (_) {}
}

function saveSettings() {
  const s = getSettings();
  if (!s.kindleEmail) {
    showToast('⚠️ Sila isi e-mel Kindle.', 'error');
    return false;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  if (currentUser) {
    setDoc(doc(db, 'users', currentUser.uid, 'settings', 'queue'), {
      kindleEmail: s.kindleEmail,
      delayMinutes: s.delayMinutes,
      senderEmail: currentUser.email || null,
      updatedAt: Date.now(),
    }, { merge: true }).catch(() => {});
  }
  showToast('✅ Tetapan disimpan.', 'ok');
  return true;
}

function getSettings() {
  return {
    kindleEmail:  elKindleEmail.value.trim(),
    delayMinutes: parseInt(elDelayMinutes.value) || 1,
  };
}

async function setQueueRunning(running) {
  if (!currentUser) return;
  const s = getSettings();
  try {
    await setDoc(doc(db, 'users', currentUser.uid, 'settings', 'queue'), {
      kindleEmail: s.kindleEmail,
      delayMinutes: s.delayMinutes,
      senderEmail: currentUser.email || null,
      queueRunning: running,
      nextSendAt: running ? Date.now() : null,
      updatedAt: Date.now(),
    }, { merge: true });

    // Flag untuk Cloud Function (elak collectionGroup index)
    if (running) {
      await setDoc(doc(db, 'active_queues', currentUser.uid), {
        running: true,
        updatedAt: Date.now(),
      });
    } else {
      await deleteDoc(doc(db, 'active_queues', currentUser.uid)).catch(() => {});
    }
  } catch (e) {
    console.warn('setQueueRunning failed', e);
  }
}

async function restoreQueueState() {
  if (!currentUser) return;
  try {
    const snap = await getDoc(doc(db, 'users', currentUser.uid, 'settings', 'queue'));
    if (snap.exists() && snap.data().queueRunning === true) {
      isRunning = true;
      clientWorker = false;
      updateStatusUI(true);
      showToast('▶ Queue masih aktif di background.', 'ok', 4000);
    } else {
      isRunning = false;
      clientWorker = false;
      updateStatusUI(false);
    }
  } catch (e) {
    console.warn('restoreQueueState', e);
  }
}

function subscribeSettings() {
  if (!currentUser) return;
  if (unsubscribeSettings) unsubscribeSettings();
  unsubscribeSettings = onSnapshot(
    doc(db, 'users', currentUser.uid, 'settings', 'queue'),
    (snap) => {
      if (!snap.exists()) return;
      const running = snap.data().queueRunning === true;
      if (clientWorker) return;
      if (running !== isRunning) {
        isRunning = running;
        updateStatusUI(running);
        if (!running) {
          clearCountdown();
          showToast('✅ Queue background selesai / dihentikan.', 'ok', 4000);
        }
      }
    },
    () => {}
  );
}

const provider = new GoogleAuthProvider();
provider.addScope(GMAIL_SCOPE);
provider.setCustomParameters({ access_type: 'online', prompt: 'select_account' });

function waitForGis(timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const start = Date.now();
    const t = setInterval(() => {
      if (window.google?.accounts?.oauth2) {
        clearInterval(t);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(t);
        reject(new Error('Google Identity Services tak load'));
      }
    }, 50);
  });
}

function initTokenClient() {
  if (tokenClient) return tokenClient;
  if (!window.google?.accounts?.oauth2) return null;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: GMAIL_SCOPE,
    callback: () => {},
  });
  return tokenClient;
}

function requestGmailToken(prompt = '') {
  return new Promise(async (resolve, reject) => {
    try {
      await waitForGis();
      const client = initTokenClient();
      if (!client) return reject(new Error('Token client gagal init'));
      client.callback = (resp) => {
        if (resp.error) {
          accessToken = null;
          gmailReady = false;
          reject(new Error(resp.error));
          return;
        }
        accessToken = resp.access_token;
        gmailReady = true;
        resolve(accessToken);
      };
      client.requestAccessToken({ prompt });
    } catch (err) {
      reject(err);
    }
  });
}

async function trySilentGmailToken() {
  if (accessToken) { gmailReady = true; return true; }
  try {
    await requestGmailToken('');
    showToast('✅ Gmail ready.', 'ok', 2000);
    return true;
  } catch (_) {
    gmailReady = false;
    return false;
  }
}

async function signIn() {
  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (credential?.accessToken) {
      accessToken = credential.accessToken;
      gmailReady = true;
    }
    if (!accessToken) {
      try { await requestGmailToken('consent'); } catch (_) {}
    }
    showToast('✅ Log masuk berjaya!', 'ok');
  } catch (err) {
    if (err.code === 'auth/popup-closed-by-user') return;
    showToast(`❌ Gagal log masuk: ${err.message}`, 'error', 5000);
  }
}

async function signOutUser() {
  stopQueue(false);
  if (unsubscribeQueue) { unsubscribeQueue(); unsubscribeQueue = null; }
  if (unsubscribeSettings) { unsubscribeSettings(); unsubscribeSettings = null; }
  if (unsubscribeAddresses) { unsubscribeAddresses(); unsubscribeAddresses = null; }
  accessToken = null;
  gmailReady = false;
  await signOut(auth);
  showToast('👋 Sudah log keluar.', '');
}

async function ensureToken() {
  if (accessToken) return accessToken;
  try {
    return await requestGmailToken('');
  } catch (_) {
    try {
      return await requestGmailToken('consent');
    } catch (err) {
      throw new Error('Token Gmail diperlukan. Sila authorize Gmail.');
    }
  }
}

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    elLoginScreen.style.display = 'none';
    elMainApp.style.display = 'grid';
    elUserInfo.style.display = 'flex';
    elUserAvatar.src = user.photoURL || '';
    elUserName.textContent = user.displayName || user.email;
    elGmailInfo.style.display = 'block';
    elGmailSender.textContent = user.email;
    await loadSettings();
    subscribeQueue();
    subscribeSettings();
    subscribeAddresses();
    await restoreQueueState();
    if (!accessToken) await trySilentGmailToken();
  } else {
    elLoginScreen.style.display = 'flex';
    elMainApp.style.display = 'none';
    elUserInfo.style.display = 'none';
    elGmailInfo.style.display = 'none';
    queueItems = [];
    accessToken = null;
    gmailReady = false;
    isRunning = false;
    clientWorker = false;
  }
});

async function sendViaGmailAPI(toEmail, fileName, fileBlob) {
  const token = await ensureToken();
  const fileBase64 = await blobToBase64(fileBlob);
  const mimeType   = getMimeType(fileName);
  const boundary = `boundary_${Date.now()}`;
  const emailLines = [
    `To: ${toEmail}`,
    `Subject: `,
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
    const err = await response.json().catch(() => ({}));
    if (response.status === 401) {
      accessToken = null;
      gmailReady = false;
      throw new Error('Token Gmail tamat tempoh. Cuba semula.');
    }
    throw new Error(err.error?.message || `Gmail API error ${response.status}`);
  }
  return await response.json();
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
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
    if (isRunning && clientWorker) checkAndSchedule();
  });
}

function checkAndSchedule() {
  if (!isRunning || !clientWorker) return;
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
  if (!isRunning || !clientWorker) return;
  clearCountdown();

  const next = queueItems.find(i => i.status === 'pending');
  if (!next) return;

  const s = getSettings();
  await updateQueueItem(next.id, { status: 'sending' });

  try {
    showToast(`⬇️ Memuat turun ${next.originalName}...`, '');
    const blob = await downloadBlob(next.url);
    showToast(`📤 Menghantar ${next.originalName}...`, '');
    await sendViaGmailAPI(s.kindleEmail, next.originalName, blob);
    await updateQueueItem(next.id, { status: 'sent', sentAt: Date.now(), error: null });
    showToast(`✅ Dihantar: ${next.originalName}`, 'ok');
  } catch (err) {
    const msg = err?.message || 'Ralat tidak diketahui';
    await updateQueueItem(next.id, { status: 'failed', error: msg });
    showToast(`❌ Gagal: ${next.originalName}`, 'error', 5000);
  }

  if (isRunning && clientWorker) { nextSendAt = null; checkAndSchedule(); }
}

function startQueue() {
  isRunning = true;
  clientWorker = true;
  nextSendAt = null;
  updateStatusUI(true);
  setQueueRunning(true);
  checkAndSchedule();
}

function stopQueue(showMsg = true) {
  isRunning = false;
  clientWorker = false;
  clearTimeout(queueTimer);
  queueTimer = null;
  clearCountdown();
  updateStatusUI(false);
  setQueueRunning(false);
  if (showMsg) showToast('⏹ Queue dihentikan.', '');
}

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
  el.dataset.id = item.id;
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
  btnNow.style.display = (item.status === 'pending' && isRunning && clientWorker) ? 'inline-flex' : 'none';
}

function setupItemEvents(el, item) {
  el.querySelector('.btn-remove').addEventListener('click', async () => {
    if (item.status === 'sending') return;
    await deleteQueueItem(item.id);
    if (item.storagePath) await deleteFromStorage(item.storagePath);
  });
  el.querySelector('.btn-retry').addEventListener('click', async () => {
    await updateQueueItem(item.id, { status: 'pending', error: null });
    if (isRunning && clientWorker && !nextSendAt) checkAndSchedule();
  });
  el.querySelector('.btn-send-now').addEventListener('click', async () => {
    if (!isRunning || !clientWorker) return;
    clearTimeout(queueTimer);
    clearCountdown();
    nextSendAt = null;
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

elBtnSignin.addEventListener('click', signIn);
document.getElementById('btn-add-kindle').addEventListener('click', addKindleAddress);
document.getElementById('kindle-select').addEventListener('change', function() {
  if (this.value) {
    document.getElementById('kindle-email').value = this.value;
  }
});
elBtnSignout.addEventListener('click', signOutUser);
elBtnSave.addEventListener('click', saveSettings);

elBtnToggleSet.addEventListener('click', () => {
  const c = elSettingsBody.classList.toggle('collapsed');
  elBtnToggleSet.textContent = c ? '▸' : '▾';
});

elBtnStart.addEventListener('click', async () => {
  const s = getSettings();
  if (!s.kindleEmail) { showToast('⚠️ Sila isi e-mel Kindle dahulu.', 'error'); return; }
  const pending = queueItems.filter(i => i.status === 'pending').length;
  if (pending === 0) { showToast('⚠️ Tiada fail dalam queue.', 'error'); return; }

  if (!accessToken) {
    showToast('🔐 Mengambil kebenaran Gmail...', '');
    try {
      await ensureToken();
    } catch (_) {
      showToast('⚠️ Perlu authorize Gmail untuk menghantar.', 'error', 5000);
      return;
    }
  }

  saveSettings();
  startQueue();
  showToast(`▶ Queue dimulakan (boleh tutup tab). Selang: ${s.delayMinutes} min.`, 'ok', 5000);
});

elBtnStop.addEventListener('click', () => stopQueue(true));

document.getElementById('btn-sort-az').addEventListener('click', async () => {
  const pending = queueItems.filter(i => i.status === 'pending');
  if (pending.length === 0) { showToast('⚠️ Tiada fail pending untuk disusun.', 'error'); return; }
  const sorted = [...pending].sort((a, b) => a.originalName.localeCompare(b.originalName, undefined, { numeric: true, sensitivity: 'base' }));
  const baseTime = Date.now();
  for (let i = 0; i < sorted.length; i++) {
    await updateQueueItem(sorted[i].id, { addedAt: baseTime + i });
  }
  showToast('✅ Queue disusun A-Z!', 'ok');
});

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
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
