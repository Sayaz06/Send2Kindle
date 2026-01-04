// auth.js
import { auth, provider, onAuthStateChanged, signInWithPopup, signOut } from "./firebase-config.js";
import { showPage, showStatus, initAppAfterAuth, clearAppStateOnLogout } from "./app.js";

const btnLoginGoogle = document.getElementById("btn-login-google");
const btnHeaderLogout = document.getElementById("btn-header-logout");
const headerLogBtn = document.getElementById("btn-header-log");

btnLoginGoogle?.addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    console.error(err);
    showStatus("Gagal log masuk. Sila cuba lagi.", "error");
  }
});

btnHeaderLogout?.addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (err) {
    console.error(err);
    showStatus("Gagal log keluar. Sila cuba lagi.", "error");
  }
});

onAuthStateChanged(auth, (user) => {
  if (user) {
    // Logged in
    btnHeaderLogout.classList.remove("hidden");
    headerLogBtn.classList.add("hidden"); // kita guna log di page 2 & 4
    initAppAfterAuth(user);

    // Aktifkan butang Import/Export hanya untuk admin
    const btnExport = document.getElementById("btn-export");
    const btnImport = document.getElementById("btn-import");
    if (user.email === "adha86614@gmail.com") {
      if (btnExport) {
        btnExport.disabled = false;
      }
      if (btnImport) {
        btnImport.disabled = false;
      }
    }

    showPage("page-bahasa");   // pastikan dalam blok if (user)
  } else {
    // Logged out
    btnHeaderLogout.classList.add("hidden");
    clearAppStateOnLogout();
    showPage("page-login");
  }
});
