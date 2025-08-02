// public/script.js
import confetti from "https://cdn.skypack.dev/canvas-confetti";

const API_BASE_URL = "https://mail-sender-hwq9.onrender.com";

document.addEventListener("DOMContentLoaded", async () => {
  const googleSigninBtn = document.getElementById("google-signin-btn");
  const logoutBtn = document.getElementById("logout-btn");
  const authSection = document.getElementById("auth-section");
  const userInfoDiv = document.getElementById("user-info");
  const userNameSpan = document.getElementById("user-name");
  const userEmailSpan = document.getElementById("user-email");
  const authStatusMessage = document.getElementById("auth-status-message");

  const subjectInput = document.getElementById("subject");
  const emailBodyEditor = new Quill("#email-body-editor", {
    theme: "snow",
  });

  const csvFileInput = document.getElementById("csv-file");
  const sendEmailsBtn = document.getElementById("send-emails-btn");
  const recipientCountSpan = document.getElementById("recipient-count");

  const statusResultsSection = document.getElementById("status-results-section");
  const currentStatusMessage = document.getElementById("current-status-message");
  const progressDetails = document.getElementById("progress-details");
  const processedCount = document.getElementById("processed-count");
  const totalCount = document.getElementById("total-count");
  const sentCount = document.getElementById("sent-count");
  const failedCount = document.getElementById("failed-count");

  const mailComposerSection = document.getElementById("mail-composer-section");

  // OAuth flow
  googleSigninBtn.addEventListener("click", () => {
    window.location.href = `${API_BASE_URL}/auth/google`;
  });

  logoutBtn.addEventListener("click", () => {
    localStorage.removeItem("user");
    location.reload();
  });

  // Handle OAuth redirect
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get("code");

  if (code && !localStorage.getItem("user")) {
    authStatusMessage.innerText = "Authenticating...";
    fetch(`${API_BASE_URL}/auth/google/callback?code=${code}`, {
      method: "GET",
    })
      .then((res) => res.json())
      .then((data) => {
        localStorage.setItem("user", JSON.stringify(data));
        window.history.replaceState({}, document.title, "/");
        location.reload();
      })
      .catch(() => {
        authStatusMessage.innerText = "Authentication failed!";
      });
  }

  const user = JSON.parse(localStorage.getItem("user"));
  if (user) {
    userInfoDiv.classList.remove("hidden");
    userNameSpan.innerText = user.name;
    userEmailSpan.innerText = user.email;
    mailComposerSection.classList.remove("hidden");
    googleSigninBtn.classList.add("hidden");
  }

  let recipients = [];

  csvFileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const lines = e.target.result.split("\n");
      recipients = lines
        .map((line) => line.trim())
        .filter((email) => email.length > 0);
      recipientCountSpan.innerText = `${recipients.length} recipients loaded`;
    };
    reader.readAsText(file);
  });

  sendEmailsBtn.addEventListener("click", async () => {
    const subject = subjectInput.value.trim();
    const body = emailBodyEditor.root.innerHTML;

    if (!subject || !body || recipients.length === 0) {
      alert("Please fill subject, body, and upload CSV.");
      return;
    }

    sendEmailsBtn.disabled = true;
    statusResultsSection.classList.remove("hidden");
    progressDetails.classList.remove("hidden");
    currentStatusMessage.innerText = "Sending emails...";

    processedCount.innerText = "0";
    totalCount.innerText = recipients.length;
    sentCount.innerText = "0";
    failedCount.innerText = "0";

    let sent = 0;
    let failed = 0;

    for (let i = 0; i < recipients.length; i++) {
      const email = recipients[i];

      try {
        const res = await fetch(`${API_BASE_URL}/send-emails`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            to: email,
            subject,
            body,
            access_token: user.access_token,
          }),
        });

        const result = await res.json();
        if (res.ok) {
          sent++;
          sentCount.innerText = sent;
        } else {
          failed++;
          failedCount.innerText = failed;
        }
      } catch (err) {
        failed++;
        failedCount.innerText = failed;
      }

      processedCount.innerText = i + 1;
    }

    currentStatusMessage.innerText = `Emails sent: ${sent}, Failed: ${failed}`;
    sendEmailsBtn.disabled = false;

    if (sent > 0) {
      confetti({
        particleCount: 200,
        spread: 100,
        origin: { y: 0.6 },
      });
    }
  });
});
