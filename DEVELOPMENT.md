# FCC Website - Local Development Guide

Complete guide for local development, testing, and live editing of the Forth Canoe Club website.

## Prerequisites

**One-time system setup:**

```bash
sudo apt update
sudo apt install -y nodejs npm python3 python3-pip python3-venv
```

Verify installation:
```bash
node --version    # Should be v18+
npm --version     # Should be v9+
python3 --version # Should be v3.12+
```

## Quick Start

### 1. Install Dependencies

Navigate to the project directory and install all Node.js and Python packages:

```bash
cd /path/to/FCCWebsite
npm install
pip install -r requirements.txt
playwright install chromium
```

This installs:
- **Node.js**: React 18.2, Vite, Tailwind CSS, Firebase, Express
- **Python**: JustGo sync automation, Playwright browser automation

### 2. Start Development Server

```bash
npm run dev
```

Output will show:
```
  ➜  Local:   http://127.0.0.1:5173/
  ➜  Press h to show help
```

**Access from:**
- **Local machine**: `http://127.0.0.1:5173` or `http://localhost:5173`
- **Windows (from WSL)**: `http://localhost:5173` (WSL 2 default) or `http://<wsl-ip>:5173`
- **Network**: `http://<your-machine-ip>:5173`

## Development Workflow

### Live Editing

Any changes to files in `src/` automatically reload in the browser:

```
src/
├── main.jsx            # React app entry point
├── index.css           # Global styles
├── components/         # React components (ListSubmissionForm, etc.)
├── constants/          # Static data (products.js)
└── utils/              # Helpers (Firebase integration)
```

**Example:** Edit `src/components/ListSubmissionForm.jsx`, save, and see changes instantly in your browser.

### Available Commands

| Command | Purpose | Output |
|---------|---------|--------|
| `npm run dev` | Start dev server with hot reload | http://127.0.0.1:5173 |
| `npm run build` | Build for production | `dist/` folder |
| `npm run preview` | Preview production build locally | http://127.0.0.1:4173 |
| `npm start` | Run production server (Node.js) | http://127.0.0.1:3000 |

## Testing Locally

### Frontend Testing

1. **Component-level testing:**
   - Edit a component in `src/components/`
   - Watch live changes in the browser
   - Use browser DevTools (F12) to inspect

2. **Full page testing:**
   ```bash
   npm run dev
   ```
   Visit http://127.0.0.1:5173 and interact with forms, products, and checkout

3. **Responsive design testing:**
   - Open DevTools (F12)
   - Toggle device toolbar (Ctrl+Shift+M)
   - Test on mobile/tablet sizes

### Production Build Testing

Build and test the production bundle locally:

```bash
npm run build        # Create optimized production build
npm run preview      # Serve the production build
```

Visit http://127.0.0.1:4173 — this is how the site performs in production.

**Or run the full Node.js server:**

```bash
npm start            # Runs server.js on port 3000
```

Visit http://127.0.0.1:3000

### Testing Firebase Integration

1. Ensure `src/utils/firebase.js` is configured with your Firebase project credentials
2. Test authentication and database operations through the UI
3. Check browser console (F12) for Firebase errors

### Testing Form Submissions

1. The `ListSubmissionForm` component sends data to Google Sheets
2. Fill out any list submission form and submit
3. Check the target Google Sheet for new entries
4. View network requests in DevTools (F12 → Network tab)

## Python Development (JustGo Sync)

### Setup Virtual Environment

```bash
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium
```

### Run JustGo Sync Script

```bash
source venv/bin/activate
python3 scripts/justgo-sync.py
```

Monitors and syncs JustGo data to your database.

### Deactivate Virtual Environment

```bash
deactivate
```

## Development Server Features

✅ **Hot Module Reloading (HMR)** - Changes appear instantly without refresh  
✅ **Source Maps** - Debug original source code in DevTools  
✅ **Auto-restart** - Server restarts if it crashes  
✅ **CSS Hot Reload** - Tailwind CSS changes without page reload  
✅ **Network tab** - Monitor API calls and Firebase requests  

## Troubleshooting

### "Cannot find module" errors

```bash
# Clear and reinstall
rm -rf node_modules package-lock.json
npm install
```

### Dev server won't start

Check if port 5173 is in use:
```bash
# macOS/Linux
lsof -i :5173

# Kill the process using it
kill -9 <PID>
```

Then restart: `npm run dev`

### Firebase not working

1. Verify credentials in `src/utils/firebase.js`
2. Check browser console for Firebase errors (F12)
3. Ensure Firebase project allows your origin (localhost)

### Changes not appearing in browser

1. Check if dev server is running (`npm run dev` in terminal)
2. Hard refresh browser (Ctrl+Shift+R or Cmd+Shift+R)
3. Check browser console for errors (F12)

### Build fails

```bash
# Clean and rebuild
npm run build  # Check error messages
npm run preview  # Test the build output
```

## Project Structure Overview

```
FCCWebsite/
├── src/
│   ├── main.jsx                    # React app entry
│   ├── index.css                   # Global styles
│   ├── components/
│   │   └── ListSubmissionForm.jsx   # Form component
│   ├── constants/
│   │   └── products.js             # Product data
│   └── utils/
│       └── firebase.js             # Firebase config
├── server.js                        # Express server (production)
├── index.html                       # HTML template
├── vite.config.js                   # Vite configuration
├── tailwind.config.js               # Tailwind CSS config
├── postcss.config.js                # PostCSS config
├── requirements.txt                 # Python dependencies
├── scripts/
│   ├── deploy.sh                    # Production deployment
│   ├── health-check.sh              # Health monitoring
│   └── justgo-sync.py               # JustGo automation
└── package.json                     # Node.js dependencies
```

## Performance Tips

- Use React DevTools extension in Firefox/Chrome
- Check bundle size: `npm run build` and inspect `dist/`
- Use browser DevTools Performance tab to profile
- Monitor console for warnings during development

## Next Steps

- **Change the website?** → Edit `src/` files, save, and see live updates
- **Deploy to production?** → See [DEPLOY.md](DEPLOY.md)
- **Need help?** → Check specific component files or [README.md](README.md)

---

**Happy coding! 🚀**
