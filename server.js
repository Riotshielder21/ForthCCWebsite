import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import compression from 'compression';
import cors from 'cors';
import { google } from 'googleapis';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(compression());
app.use(cors());
app.use(express.json());
app.use(express.static('dist'));

// Google Sheets API Setup
let sheets;
try {
  const credentialsPath = join(__dirname, 'google-service-account.json');
  if (fs.existsSync(credentialsPath)) {
    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    sheets = google.sheets({ version: 'v4', auth });
    console.log('âœ… Google Sheets API initialized');
  } else {
    console.warn('âš ï¸  Google service account key not found. Google Sheets integration disabled.');
  }
} catch (error) {
  console.error('âŒ Error initializing Google Sheets API:', error.message);
}

// API Routes
app.post('/api/lists', async (req, res) => {
  try {
    const { name, email, listType, items, notes } = req.body;

    // Validate required fields
    if (!name || !email || !listType || !items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Store in Firebase (optional backup)
    const { db, addDoc, collection, serverTimestamp, verifyMember, generateDiscountCode, saveDiscountCode } = await import('./src/utils/firebase.js');
    await addDoc(collection(db, 'lists'), {
      name,
      email,
      listType,
      items,
      notes: notes || '',
      timestamp: serverTimestamp(),
      status: 'pending'
    });

    // Handle volunteer verification and discount code generation
    let verificationResult = { verified: false };
    let discountCode = null;

    if (listType === 'Volunteer Sign-ups') {
      verificationResult = await verifyMember(name);
      if (verificationResult.verified) {
        discountCode = generateDiscountCode();
        await saveDiscountCode(name, email, discountCode);
      }
    }

    // Add to Google Sheets if available
    if (sheets) {
      const spreadsheetId = process.env.GOOGLE_SHEET_ID;
      if (spreadsheetId) {
        const values = [
          [
            new Date().toISOString(),
            name,
            email,
            listType,
            items.join('; '),
            notes || '',
            verificationResult.verified ? 'VERIFIED' : 'UNVERIFIED',
            discountCode || ''
          ]
        ];

        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: 'Lists!A:H',
          valueInputOption: 'RAW',
          resource: { values }
        });
      }
    }

    res.json({
      success: true,
      message: 'List submitted successfully',
      verification: verificationResult,
      discountCode: discountCode
    });
  } catch (error) {
    console.error('Error submitting list:', error);
    res.status(500).json({ error: 'Failed to submit list' });
  }
});

// Health check endpoint (for monitoring)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve index.html for all routes (SPA routing)
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '127.0.0.1', () => {
  console.log(`ðŸŽ¯ FCC Website running at http://127.0.0.1:${PORT}`);
  console.log(`ðŸ“ Serving from: ${__dirname}/dist`);
  console.log(`ðŸ›‘ To stop the server, press Ctrl+C`);
});
