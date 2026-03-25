# FCC Website - Local Development Guide

This guide will help you set up and run the Forth Canoe Club website locally for development and testing.

## Prerequisites

- Node.js 18+ (https://nodejs.org/)
- npm (comes with Node.js)
- Git

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

This installs all required packages:
- React 18.2 - UI framework
- Vite - Build tool & dev server
- Tailwind CSS - Styling
- Firebase - Backend services
- Lucide React - Icons

### 2. Development Server

Start the local development server:

```bash
npm run dev
```

The site will be available at:
- **Local**: http://127.0.0.1:5173 (Vite default)
- Watch your terminal for the exact URL

The dev server includes:
- Hot Module Replacement (HMR) - changes reload automatically
- Source maps for debugging
- Fast refresh

### 3. Build for Production

Create an optimized production build:

```bash
npm run build
```

This generates a `dist/` folder with minified assets ready for deployment.

### 4. Preview Production Build

Before deploying, preview the production build locally:

```bash
npm run preview
```

### 5. Run Production Server

To test the Express server that will run on your Linux server:

```bash
npm start
```

This runs: `npm run build && node server.js`

The server will start at: http://127.0.0.1:3000

## Project Structure

```
FCCWebsite/
├── src/
│   ├── main.jsx          # React app component
│   ├── App.jsx           # React entry point
│   └── index.css         # Global styles
├── index.html            # HTML entry point
├── vite.config.js        # Vite configuration
├── tailwind.config.js    # Tailwind CSS config
├── postcss.config.js     # PostCSS config
├── server.js             # Express server for production
├── package.json          # Dependencies & scripts
└── dist/                 # Build output (generated)
```

## Available Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start development server with HMR |
| `npm run build` | Create production build |
| `npm run preview` | Preview production build |
| `npm start` | Build and run production server |
| `npm run server` | Run server.js directly |

## Environment Variables

Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

Edit `.env` and fill in your Firebase credentials if needed.

## Firebase Integration

The app connects to Firebase for:
- User authentication (currently anonymous)
- Firestore database
- Real-time data syncing

Credentials are embedded in `src/main.jsx`:
```javascript
const firebaseConfig = {
  projectId: "forth-canoe-club",
  // ... other config
}
```

## Troubleshooting

### Port Already in Use

If port 3000 or 5173 is already in use:

```bash
# Windows - Find process using port 3000
netstat -ano | findstr :3000

# Kill the process (replace PID with actual process ID)
taskkill /PID <PID> /F

# Or use a different port
PORT=3001 npm start
```

### Node Modules Issues

If you get module errors:

```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

### Vite Cache Issues

```bash
# Clear Vite cache
rm -rf .vite
npm run dev
```

## Development Workflow

1. **Edit files** in `src/` folder
2. **See changes** instantly (HMR)
3. **Console** shows any errors/warnings
4. **Test** the full site in browser
5. **Build** when ready: `npm run build`
6. **Deploy** the `dist/` folder

## Testing the Full Stack

Before deploying to Linux:

```bash
# Terminal 1: Development
npm run dev

# Terminal 2 (after building): Production preview
npm start
```

Then visit:
- Dev: http://127.0.0.1:5173
- Prod: http://127.0.0.1:3000

## Linux Deployment

Once tested locally, deploy to your Ubuntu server:

```bash
# On your Ubuntu server
cd ~/FCCWebsite
npm install
npm run build
npm start
```

The website will be available at your server's IP on port 3000.

## Performance Tips

- **Tree shaking**: Vite automatically removes unused code
- **Code splitting**: Large components are split into separate bundles
- **Minification**: Production builds are minified
- **Gzip compression**: Server.js uses compression middleware

## Common Issues

### Firebase Auth Errors
- Check Firebase config in `src/main.jsx`
- Ensure serviceAccountKey.json is in the root (for backend)
- Check Firebase project permissions

### CSS Not Loading
- Rebuild: `npm run build`
- Clear browser cache (Ctrl+Shift+Delete)
- Check tailwind.config.js includes `src/**/*.{js,jsx}`

### Dependencies Installation Failed
```bash
npm install --legacy-peer-deps
# Or update all packages
npm update
```

## Need Help?

1. Check the [Vite Docs](https://vitejs.dev/)
2. Check the [React Docs](https://react.dev/)
3. Check the [Tailwind Docs](https://tailwindcss.com/)
4. Check the [Firebase Docs](https://firebase.google.com/docs)

## Next Steps

- [ ] Install dependencies: `npm install`
- [ ] Start dev server: `npm run dev`
- [ ] View in browser: http://127.0.0.1:5173
- [ ] Test all features locally
- [ ] Build: `npm run build`
- [ ] Test production: `npm start`
- [ ] Deploy to Linux server
