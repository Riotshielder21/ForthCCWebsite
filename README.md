# Forth Canoe Club - Website & Shop Portal

A modern, fast React website for managing memberships, subscriptions, and equipment rental.

**Live Demo** → https://forthcanoeclub.com (coming soon)

## Features

- 🛍️ Shop with cart & checkout
- 📝 List submissions to Google Sheets
- 💳 Monthly & annual billing
- 🎟️ Promo code support
- 📱 Fully responsive design
- 🚀 Lightning-fast performance
- 🔐 Firebase integration

## 🖥️ System Requirements

**Ubuntu 22.04 LTS or later** with these packages:

```bash
sudo apt-get update
sudo apt-get install -y curl wget git nginx certbot python3-certbot-nginx nodejs npm mailutils ddclient python3 python3-pip python3-venv
```

## 📦 One-Line Deploy

**Prerequisites:** Ubuntu 22.04+ with system dependencies installed (see [SETUP.md](SETUP.md))

```bash
curl -sSL https://raw.githubusercontent.com/Riotshielder21/FCCWebsite/main/scripts/deploy.sh \
  | bash -s riotshielder21@gmail.com fccwebsite.gg-edi.co.uk
```

Or locally:
```bash
sudo ./scripts/deploy.sh riotshielder21@gmail.com fccwebsite.gg-edi.co.uk
```

**What it does:** Application setup, services, and configuration ✨

**Safe to Re-run:** Yes! Script cleans build artifacts but preserves all data, credentials, and configuration. Perfect for updates or recovery from network issues.

## 🚀 Local Development

```bash
# Node.js setup
npm install        # Install dependencies
npm run dev        # Start dev server →  http://127.0.0.1:5173
npm run build      # Build for production
npm start          # Run production server → http://127.0.0.1:3000

# Python setup (for JustGo sync)
pip install -r requirements.txt  # Install Python dependencies
playwright install chromium     # Install browser for automation
```

## 📖 Documentation

| Guide | Purpose |
|-------|---------|
| **[SETUP.md](SETUP.md)** | 👈 Start here! Quick 10-minute setup |
| [DEPLOY.md](DEPLOY.md) | Complete deployment walkthrough |
| [SECURITY.md](SECURITY.md) | Hardening & best practices |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Local development guide |

## 🏗️ What's Included

After deployment, you get:

- ✅ **Website** running on port 3000
- ✅ **Nginx** reverse proxy with SSL
- ✅ **Health checks** with email alerts
- ✅ **Auto-restart** on crash or reboot
- ✅ **Dynamic DNS** auto-updater
- ✅ **Let's Encrypt** HTTPS certificates
- ✅ **Firewall** pre-configured

## 📋 Tech Stack

- React 18.2 • Vite • Tailwind CSS
- Node.js • Express • Firebase
- Nginx • Systemd • Docker-ready

## 🎯 Commands

```bash
# Website status
sudo systemctl status fcc-web

# View logs
sudo journalctl -u fcc-web -f

# Restart
sudo systemctl restart fcc-web

# Deploy updates
cd /home/fcc-web/FCCWebsite
git pull && npm run build && sudo systemctl restart fcc-web
```

## 🔧 Configuration

All configuration happens in 3 steps (see [SETUP.md](SETUP.md)):

1. Run deployment script
2. Add Firebase credentials
3. Configure email alerts

## 📧 Email Alerts

You'll receive notifications if:
- Website goes offline
- Service crashes
- Health check fails

Powered by systemd + health-check.sh

## 🌐 Access Points

| Endpoint | Purpose |
|----------|---------|
| `http://fccwebsite.gg-edi.co.uk` | Public website (HTTPS) |
| `http://127.0.0.1:3000/health` | Health check endpoint |
| Nginx logs | `/var/log/nginx/fcc_*.log` |
| Service logs | `journalctl -u fcc-web` |

## 🛠️ Troubleshooting

```bash
# Website not loading?
sudo systemctl restart fcc-web
sudo journalctl -u fcc-web -f

# Not getting email alerts?
sudo systemctl restart fcc-health-check
echo "test" | mail -s "test" riotshielder21@gmail.com

# SSL certificate issues?
sudo certbot renew --dry-run
```

More help → [DEPLOY.md](DEPLOY.md#troubleshooting)

## 📦 Project Structure

```
/home/fcc-web/FCCWebsite/
├── src/               # React source
├── dist/              # Built files (deployed)
├── server.js          # Express server
├── scripts/
│   ├── deploy.sh      # Master deployment
│   ├── health-check.sh
│   └── justgo-sync.py
└── config/
    ├── nginx.conf     # Reverse proxy
    └── *.service      # Systemd services
```

## 🔒 Security

- HTTPS/TLS encryption
- Security headers enabled
- Firewall pre-configured
- Email alerts for downtime
- Auto-backup ready

See [SECURITY.md](SECURITY.md) for hardening.

## 🤝 Contributing

Bug reports → Issues section
Feature requests → Discussions

## 📝 License

© 2024 Forth Canoe Club SCIO (Charity SC015020)

---

**Ready?** → [SETUP.md](SETUP.md)

**Questions?** → Check specific guides above

