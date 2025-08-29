// IMPORTANT:
// Before running, ensure you have the required packages installed:
// npm install express cors googleapis multer csv-parser dotenv
// And ensure your .env file is configured correctly.

require('dotenv').config();

const express = require('express');
const path = require('path');
const cors = require('cors');
const { google } = require('googleapis');
const multer = require('multer');
const csv = require('csv-parser');
const { Readable } = require = require('stream');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Validate environment variables ---
if (
  !process.env.GOOGLE_CLIENT_ID ||
  !process.env.GOOGLE_CLIENT_SECRET ||
  !process.env.GOOGLE_REDIRECT_URI ||
  !process.env.FRONTEND_URL
) {
  console.error('ERROR: Missing required environment variables.');
  console.error('Please ensure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, and FRONTEND_URL are set.');
  process.exit(1);
}

const FRONTEND_URL = process.env.FRONTEND_URL;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

// --- CORS configuration ---
app.use(cors({
  origin: FRONTEND_URL,
  credentials: true,
}));

// --- Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Serve static files from a dedicated 'public' directory ---
// Create a 'public' folder and place your HTML, CSS, JS, and Google verification file inside.
app.use(express.static(path.join(__dirname, 'public')));

// --- Google OAuth setup ---
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI // Using the configured redirect URI
);

// Stores tokens per userId. WARNING: This is for single-user testing only.
// For production, use a proper session management system.
let userTokens = {}; 

let emailCampaignStatus = {
  total: 0,
  sent: 0,
  failed: 0,
  inProgress: false,
  message: '',
};

// --- Google OAuth routes ---
app.get('/auth/google', (req, res) => {
  const scopes = [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/gmail.send',
  ];

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
  });

  res.redirect(authUrl);
});

app.get('/oauth2callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).send('Authorization code missing.');
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const userId = userInfo.data.id;

    userTokens[userId] = {
      ...tokens,
      email: userInfo.data.email,
    };

    // Redirect to the frontend after successful authentication
    res.redirect(FRONTEND_URL);
  } catch (error) {
    console.error('OAuth callback error:', error.message);
    res.status(500).send('Authentication failed.');
  }
});

// Check auth status and get authenticated user's email
app.get('/api/auth/status', (req, res) => {
  const isAuthenticated = Object.keys(userTokens).length > 0;
  const userEmail = isAuthenticated ? Object.values(userTokens)[0].email : null;
  res.json({ isAuthenticated, userEmail });
});

app.post('/api/auth/logout', (req, res) => {
  userTokens = {};
  res.json({ message: 'Logged out successfully.' });
});

// --- File upload and email sending ---
const upload = multer();

app.post('/api/send-emails', upload.single('csvFile'), async (req, res) => {
  const userId = Object.keys(userTokens)[0];

  if (!userId || !userTokens[userId]) {
    return res.status(401).json({ message: 'User not authenticated.' });
  }

  oauth2Client.setCredentials(userTokens[userId]);

  const { subject, emailBody } = req.body;
  if (!subject || !emailBody || !req.file) {
    return res.status(400).json({ message: 'Missing required fields.' });
  }

  const recipients = [];
  const csvStream = Readable.from(req.file.buffer.toString());

  csvStream
    .pipe(csv())
    .on('data', (row) => {
      const email = row.email || Object.values(row)[0];
      if (email && validateEmail(email.trim())) {
        recipients.push(email.trim());
      }
    })
    .on('end', async () => {
      if (recipients.length === 0) {
        return res.status(400).json({ message: 'No valid recipients found.' });
      }

      emailCampaignStatus = {
        total: recipients.length,
        sent: 0,
        failed: 0,
        inProgress: true,
        message: `Sending ${recipients.length} emails...`,
      };

      // Acknowledge the request immediately
      res.status(202).json({ message: 'Started sending emails. Check status endpoint for progress.' });

      // Process emails in the background
      for (let i = 0; i < recipients.length; i++) {
        const to = recipients[i];
        try {
          // A more robust rate limit can be implemented here
          await new Promise((resolve) => setTimeout(resolve, 500)); 
          await sendEmail(oauth2Client, to, subject, emailBody);
          emailCampaignStatus.sent++;
        } catch (err) {
          console.error(`Failed to send to ${to}:`, err.message);
          emailCampaignStatus.failed++;
        }

        emailCampaignStatus.message = `Processed ${emailCampaignStatus.sent + emailCampaignStatus.failed} of ${emailCampaignStatus.total}`;
      }

      emailCampaignStatus.inProgress = false;
      emailCampaignStatus.message = 'Bulk email sending completed.';
    })
    .on('error', (err) => {
      console.error('CSV parsing error:', err.message);
      // Since response was already sent, this error won't be sent to client
    });
});

app.get('/api/status', (req, res) => {
  res.json(emailCampaignStatus);
});

// --- Helper functions ---
function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

async function sendEmail(auth, to, subject, htmlBody) {
  const gmail = google.gmail({ version: 'v1', auth });
  const rawMessage = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="UTF-8"',
    '',
    htmlBody,
  ].join('\n');

  const encodedMessage = Buffer.from(rawMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encodedMessage,
    },
  });
}

// --- Start the server ---
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
