// IMPORTANT:
// To resolve the 'Error: Cannot find module 'cors'', run:
// npm install cors
// Also ensure 'cors' is listed in your package.json dependencies.

require('dotenv').config();

const express = require('express');
const cors = require('cors'); // Import CORS middleware
const { google } = require('googleapis');
const multer = require('multer');
const csv = require('csv-parser');
const { Readable } = require('stream');

const app = express();
const PORT = process.env.PORT || 3000;

// Validate required Google OAuth environment variables before initializing client
if (
  !process.env.GOOGLE_CLIENT_ID ||
  !process.env.GOOGLE_CLIENT_SECRET ||
  !process.env.GOOGLE_REDIRECT_URI
) {
  console.error('ERROR: Missing required Google OAuth environment variables.');
  console.error('Please ensure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI are set.');
  process.exit(1);
}

// CORS configuration - replace FRONTEND_URL with your frontend app URL or set it via environment variable
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://mail-sender-ecru.vercel.app';
app.use(cors({
  origin: FRONTEND_URL,
  credentials: true,
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Google OAuth2 client setup
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

let userTokens = {}; // Stores tokens per userId

let emailCampaignStatus = {
  total: 0,
  sent: 0,
  failed: 0,
  inProgress: false,
  message: '',
};

// --- Google OAuth routes ---

// Redirect to Google OAuth consent screen
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

// OAuth2 callback route
app.get('/oauth2callback', async (req, res) => {
  const { code } = req.query;

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

    // Redirect to frontend root after successful auth
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

// Logout and clear tokens
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

      res.json({ message: `Started sending ${recipients.length} emails.` });

      for (let i = 0; i < recipients.length; i++) {
        const to = recipients[i];
        try {
          await new Promise((resolve) => setTimeout(resolve, 500)); // Delay between emails
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
      res.status(500).json({ message: 'Error parsing CSV file.' });
    });
});

// Get current status of the email campaign
app.get('/api/status', (req, res) => {
  res.json(emailCampaignStatus);
});

// --- Helper functions ---

// Simple email validation regex
function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

// Function to send an email using Gmail API
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

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server listening at http://localhost:${PORT}`);
});
