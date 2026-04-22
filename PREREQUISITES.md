# FCC Website - Manual Installation Prerequisites

This document lists all dependencies you must install **before** running the deployment script.

⚠️ **IMPORTANT:** All commands below must run **ON YOUR UBUNTU SERVER**, not on your local machine.

## Initial Setup on Ubuntu Server

```bash
# Connect to your Ubuntu server
ssh user@your-server-ip

# Navigate to application directory
cd /home/fcc-web/FCCWebsite
```

## System Packages

Run this on your Ubuntu 22.04+ server:

```bash
sudo apt-get update
sudo apt-get install -y \
  curl \
  wget \
  git \
  nginx \
  certbot \
  python3-certbot-nginx \
  nodejs \
  npm \
  mailutils \
  ddclient \
  python3 \
  python3-pip \
  python3-venv
```

## Node.js Dependencies

**Run ON THE UBUNTU SERVER** in `/home/fcc-web/FCCWebsite`:

```bash
# First, fix script line endings if needed
sed -i 's/\r$//' scripts/deploy.sh
chmod +x scripts/deploy.sh

# Then install npm dependencies
npm install
```

**This will install:**

### Runtime Dependencies (Production)
- `react@18.2.0` - UI library
- `react-dom@18.2.0` - React DOM renderer
- `firebase@10.7.1` - Backend services (auth, database)
- `lucide-react@0.294.0` - Icon library
- `express@4.18.2` - Web server
- `compression@1.7.4` - Response compression
- `googleapis@126.0.1` - Google Sheets integration
- `cors@2.8.5` - Cross-origin resources
- `multer@2.0.1` - File upload handling

### Development Dependencies (Build-time only)
- `vite@5.0.8` - Build tool & dev server
- `@vitejs/plugin-react@4.2.1` - React support for Vite
- `tailwindcss@3.4.1` - Styling framework
- `postcss@8.4.32` - CSS processing
- `autoprefixer@10.4.16` - CSS autoprefixer

## Verification Checklist

- [ ] SSH connected to Ubuntu server
- [ ] In `/home/fcc-web/FCCWebsite` directory on server
- [ ] System packages installed (run `node --version`, should be 18+)
- [ ] `npm install` completed successfully (creates `node_modules/` folder)
- [ ] Scripts have LF line endings (`sed -i 's/\r$//' scripts/deploy.sh`)
- [ ] Run deployment script: `sudo ./scripts/deploy.sh riotshielder21@gmail.com fccwebsite.gg-edi.co.uk`

## Notes

- **npm install must complete before running deploy.sh**
- If npm install times out, re-run it (will resume from where it left off)
- The deploy script validates prerequisites but **will not** install npm dependencies
- All other setup (services, configuration, SSL) happens in deploy.sh
