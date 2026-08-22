# 📚 Kindle Queue Manager

Hantar PDF/EPUB ke Kindle secara beratur menggunakan **Gmail API + Firebase**.  
Deploy terus ke **GitHub Pages** — tiada server diperlukan.

---

## 📁 Struktur Fail

```
kindle-queue/
├── index.html
├── manifest.json
├── sw.js
├── css/style.css
├── js/app.js
└── icons/icon.svg
```

---

## 🚀 Cara Deploy ke GitHub Pages

1. Upload semua fail ke repo GitHub: `sayaz06/kindle-queue` (atau nama lain)
2. Settings → Pages → Branch: `main` → `/` (root) → Save
3. App live di: `https://sayaz06.github.io/kindle-queue/`

---

## ⚙️ Firebase Rules yang Perlu Ditetapkan

### Firebase Console → Firestore → Rules:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/kindle_queue/{docId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

### Firebase Console → Storage → Rules:
```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /kindle_queue/{userId}/{allPaths=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

### Firebase Console → Authentication → Sign-in method:
- Aktifkan **Google**

---

## 📧 Cara Benarkan E-mel ke Kindle

1. Pergi ke [amazon.com/hz/mycd/myx](https://www.amazon.com/hz/mycd/myx)
2. Settings → Personal Document Settings
3. Approved Personal Document E-mail List
4. Tambah alamat Gmail anda

---

## ⚠️ Nota "Unverified App"

Bila log masuk pertama kali, Google akan tunjuk amaran:  
**"Google hasn't verified this app"**

Klik → **Advanced** → **Go to Kindle Queue (unsafe)**

Ini normal untuk app peribadi yang belum diverifikasi Google.

---

## 🔄 Flow App

```
Log masuk Google (Firebase Auth + Gmail scope)
    ↓
Upload fail → Firebase Storage
    ↓
Queue disimpan → Firestore
    ↓
Timer countdown (selang yang ditetapkan)
    ↓
Muat turun fail dari Storage
    ↓
Hantar via Gmail API (attachment terus)
    ↓
Kindle terima fail
```
