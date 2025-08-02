// server.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const multer = require('multer');
const csv = require('csv-parser');
const { Readable } = require('stream');
// Add the express-session library for per-user session management
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3000;

// IMPORTANT: Validate environment variables before initializing the client
if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REDIRECT_URI || !process.env.SESSION_SECRET) {
    console.error('ERROR: Missing required environment variables.');
    console.error('Please ensure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, and SESSION_SECRET are set.');
    process.exit(1);
}

// --- Session Middleware ---
app.use(session({
    secret: process.env.SESSION_SECRET, // A strong secret for session signing
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: 'auto', // 'auto' sets secure flag in production but not on http locally
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000 // Session lasts for 24 hours
    }
}));

// --- CORS Middleware ---
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://mail-sender-ecru.vercel.app';
app.use(cors({
    origin: FRONTEND_URL,
    credentials: true,
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// --- Google OAuth Routes ---

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
  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();

    // Store user info and tokens in the session object, not a global variable
    req.session.user = {
      tokens: tokens,
      email: userInfo.data.email,
      id: userInfo.data.id,
    };

    res.redirect(FRONTEND_URL);
  } catch (error) {
    console.error('OAuth callback error:', error.message);
    res.status(500).send('Authentication failed.');
  }
});

app.get('/api/auth/status', (req, res) => {
  const isAuthenticated = !!req.session.user;
  const userEmail = isAuthenticated ? req.session.user.email : null;
  res.json({ isAuthenticated, userEmail });
});

app.post('/api/auth/logout', (req, res) => {
  // Destroy the session to log out the user
  req.session.destroy(err => {
      if (err) {
          return res.status(500).json({ message: 'Logout failed.' });
      }
      res.json({ message: 'Logged out successfully.' });
  });
});

// --- File Upload and Email Sending ---

const upload = multer();

app.post('/api/send-emails', upload.single('csvFile'), async (req, res) => {
  // Check for user in the session
  if (!req.session.user || !req.session.user.tokens) {
    return res.status(401).json({ message: 'User not authenticated.' });
  }

  oauth2Client.setCredentials(req.session.user.tokens);

  const { subject, emailBody } = req.body;
  if (!subject || !emailBody || !req.file) {
    return res.status(400).json({ message: 'Missing required fields.' });
  }

  // Parse recipients
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
      
      // Store campaign status in the user's session
      req.session.emailCampaignStatus = {
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
          await new Promise((resolve) => setTimeout(resolve, 500));
          await sendEmail(oauth2Client, to, subject, emailBody);
          // Update campaign status in the session
          req.session.emailCampaignStatus.sent++;
        } catch (err) {
          console.error(`Failed to send to ${to}:`, err.message);
          // Update campaign status in the session
          req.session.emailCampaignStatus.failed++;
        }

        req.session.emailCampaignStatus.message = `Processed ${req.session.emailCampaignStatus.sent + req.session.emailCampaignStatus.failed} of ${req.session.emailCampaignStatus.total}`;
      }

      req.session.emailCampaignStatus.inProgress = false;
      req.session.emailCampaignStatus.message = 'Bulk email sending completed.';
    })
    .on('error', (err) => {
      console.error('CSV parsing error:', err.message);
      res.status(500).json({ message: 'Error parsing CSV file.' });
    });
});

app.get('/api/status', (req, res) => {
    // Return campaign status from the user's session
    const status = req.session.emailCampaignStatus || {
        total: 0,
        sent: 0,
        failed: 0,
        inProgress: false,
        message: 'No email campaign in progress.',
    };
    res.json(status);
});

// --- Helper Functions ---

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

app.listen(PORT, () => {
  console.log(`🚀 Server listening at http://localhost:${PORT}`);
});
