# Forth Canoe Club

A modern, fast React website for managing memberships, subscriptions, and equipment rental.

**Live Demo** → https://forthcanoeclub.co.uk (coming soon)

## Features

- 🛍️ Shop with cart & checkout
- 📝 Forms with links to Google drive
- 💳 Monthly & annual billing
- 🎟️ Promo code support
- 📱 Fully responsive design
- 🚀 Lightning-fast performance
- 🔐 Firebase integration
- ⚡ Live development with instant reloading
- 🔄 JustGo automation & sync
- User verification, logins and invoice generation for committee to send to organisations

## 📖 Getting Started

| Guide | Purpose |
|-------|---------|
| **[DEVELOPMENT.md](DEVELOPMENT.md)** | 👈 Local development & testing |
| [SETUP.md](SETUP.md) | Initial setup guide |

## 📋 Tech Stack

React 18.2 • Vite • Tailwind CSS • Node.js • Express • Firebase

## 📦 Project Structure

```
src/                  # React source code
├── components/       # React components
├── constants/        # Static data
├── utils/            # Utilities (Firebase, helpers)
scripts/              # Deployment & automation
├── deploy.sh         # Production deployment
└── justgo-sync.py    # JustGo synchronization
config/               # System configuration
server.js             # Production Express server
```

## 🎯 Quick Commands

```bash
npm install           # Install dependencies (one-time)
npm run dev          # Start development server with live reload
npm run build        # Build for production
npm run preview      # Preview production build
npm start            # Run production server
```

**See [DEVELOPMENT.md](DEVELOPMENT.md) for detailed commands and troubleshooting.**

## 🚀 Deploying to Production

```bash
sudo ./scripts/deploy.sh email@example.com domain.com
```

The deployment script:
- ✅ Validates system dependencies
- ✅ Installs Node.js packages
- ✅ Builds the application
- ✅ Configures Nginx with SSL
- ✅ Sets up systemd services
- ✅ Enables health checks & email alerts

**See [DEPLOY.md](DEPLOY.md) for complete deployment walkthrough.**

## 🌐 Access Points

| Endpoint | Purpose |
|----------|---------|
| `http://127.0.0.1:5173` | Development server (with hot reload) |
| `http://127.0.0.1:4173` | Production build preview |
| `http://127.0.0.1:3000` | Production server |
| `https://forthcanoeclub.com` | Live website (when deployed) |

## 🔍 Monitoring

Once deployed:

```bash
# Check website status
sudo systemctl status fcc-web

# View live logs
sudo journalctl -u fcc-web -f

# Restart service
sudo systemctl restart fcc-web
```

See [DEPLOY.md](DEPLOY.md) for more monitoring commands.

