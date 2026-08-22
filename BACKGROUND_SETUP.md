# Background Queue Setup (Cloud Functions)

Supaya queue terus jalan **walaupun tab ditutup**.

## Keperluan

1. Firebase project: `stress-auti-action`
2. **Blaze plan** (pay as you go) — Cloud Functions perlukan ni
3. Node.js 20 + Firebase CLI di PC anda
4. Google OAuth **Client Secret** (Web client)

## Langkah 1 — Upgrade Firebase ke Blaze

1. Buka https://console.firebase.google.com → project `stress-auti-action`
2. Upgrade ke **Blaze** (ada free tier, biasanya murah untuk penggunaan peribadi)

## Langkah 2 — Dapatkan Client Secret

1. https://console.cloud.google.com/apis/credentials
2. Pilih OAuth 2.0 Client ID yang sama dengan app (Web client)
3. Copy **Client ID** dan **Client Secret**

Pastikan Authorized redirect URIs include:
- `https://stress-auti-action.firebaseapp.com/__/auth/handler`
- `http://localhost`

Enable **Gmail API** dalam Google Cloud Console.

## Langkah 3 — Deploy Functions

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login
firebase login

# Di folder repo Send2Kindle
cd Send2Kindle
firebase use stress-auti-action

# Set secrets
firebase functions:secrets:set GOOGLE_CLIENT_ID
# paste Client ID

firebase functions:secrets:set GOOGLE_CLIENT_SECRET
# paste Client Secret

# Install & deploy
cd functions
npm install
cd ..
firebase deploy --only functions
```

## Langkah 4 — Firestore Index

Bila function jalan pertama kali, mungkin minta composite index untuk:
- Collection group `settings`: `queueRunning` ASC
- Collection `kindle_queue`: `status` ASC + `addedAt` ASC

Klik link dalam error log Firebase, create index automatik.

## Langkah 5 — Refresh Token (Gmail offline)

Cloud Function perlukan **refresh token** Gmail anda.

Cara mudah (sekali je):

1. Buka https://developers.google.com/oauthplayground
2. Settings (gear) → centang **Use your own OAuth credentials** → masukkan Client ID + Secret
3. Di kiri, pilih scope: `https://www.googleapis.com/auth/gmail.send`
4. Authorize → Exchange authorization code for tokens
5. Copy **Refresh token**

Simpan dalam Firestore (via Firebase Console atau script):

```
Collection: users
Document:   {YOUR_FIREBASE_UID}
  Subcollection: secrets
  Document: gmail
  Fields:
    refreshToken: "1//0g..."
    email: "anda@gmail.com"
```

UID Firebase boleh nampak dalam Authentication console, atau di app (user.uid).

## Cara guna dalam app

Selepas setup:
1. Upload fail
2. Isi e-mel Kindle + delay
3. Tekan **Mula Queue (Background)** — flag `queueRunning` diset
4. **Boleh tutup tab** — function hantar setiap ~2 minit mengikut delay anda

## Kos anggaran

- Function setiap 2 minit: sangat rendah
- Free tier Blaze biasanya cukup untuk 1 user

## Troubleshooting

| Masalah | Fix |
|---------|-----|
| Function tak deploy | Pastikan Blaze plan |
| "No refresh token" | Step 5 belum dibuat |
| Gmail 401 | Refresh token invalid — authorize semula di OAuth Playground |
| Index error | Create index dari link dalam logs |
