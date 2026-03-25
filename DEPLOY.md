# FCC Website - Deployment Guide

Quick reference for common deployment tasks.

---

## One-Line Deploy

From a fresh Ubuntu server:

```bash
curl -sSL https://raw.githubusercontent.com/Riotshielder21/FCCWebsite/main/scripts/deploy.sh \
  | bash -s riotshielder21@gmail.com fccwebsite.gg-edi.co.uk
```

Or locally:
```bash
sudo ./scripts/deploy.sh riotshielder21@gmail.com fccwebsite.gg-edi.co.uk
```

Then configure (see [SETUP.md](SETUP.md) Part 2).

---

## Pre-Deployment Checklist

- [ ] Domain name pointing to server IP
- [ ] Cloudflare API token ready
- [ ] Firebase serviceAccountKey.json downloaded
- [ ] Email address for alerts
- [ ] SSH access confirmed
- [ ] Ubuntu 22.04+ running

---

## What Gets Deployed

### Services (Auto-Restart on Boot & Crash)

1. **fcc-web** - Node.js website
   - Port: 3000 (internal)
   - User: fcc-web
   - Restart: Always

2. **fcc-health-check** - Email downtime alerts
   - Check interval: 5 minutes (configurable)
   - Email on failure: 3 retries
   - Requires: fcc-web running

3. **fcc-sync.timer** - JustGo member sync
   - Schedule: Daily at 4 AM
   - Requires: serviceAccountKey.json

4. **nginx** - Reverse proxy + SSL
   - Ports: 80 (HTTP) â†’ 443 (HTTPS)
   - SSL: Let's Encrypt (auto-renewal)
   - Security headers: Enabled

5. **ddclient** - Dynamic DNS updater
   - Updates: Cloudflare DNS every 10 min
   - Requires: /etc/ddclient.conf configured

---

## Deployment Architecture

```
Internet (HTTPS on 443)
    â†“
Nginx (SSL termination + reverse proxy)
    â†“
Node.js App (Internal port 3000)
    â†“
Firebase (Firestore database)

Parallel Monitoring:
Health Check Service
    â†’ HTTP GET /health every 5 min
    â†’ Send email if offline
    â†’ 3 retries before alert
```

---

## Configuration Files

Created/modified during deployment:

| File | Location | Purpose |
|------|----------|---------|
| nginx.conf | `/etc/nginx/sites-available/fcc-web` | Reverse proxy config |
| fcc-web.service | `/etc/systemd/system/` | Website auto-start |
| fcc-health-check.service | `/etc/systemd/system/` | Health check service |
| fcc-sync.service | `/etc/systemd/system/` | JustGo sync job |
| fcc-sync.timer | `/etc/systemd/system/` | Sync job schedule |
| ddclient.conf | `/etc/` | Dynamic DNS config |
| Nginx SSL | `/etc/letsencrypt/live/` | SSL certificates |

---

## Updating Deployment

### Deploy New Code

```bash
cd /home/fcc-web/FCCWebsite
git pull origin main
npm run build
sudo systemctl restart fcc-web
```

### Redeploy Everything

```bash
sudo ./scripts/deploy.sh riotshielder21@gmail.com fccwebsite.gg-edi.co.uk
```

### Update Single Service

```bash
# Restart website only
sudo systemctl restart fcc-web

# Restart health check
sudo systemctl restart fcc-health-check

# Restart all FCC services
sudo systemctl restart fcc-web fcc-health-check nginx
```

---

## Health Check System

Your website is monitored automatically:

**How it works:**
1. Health check runs every 5 minutes
2. Makes HTTP GET to `http://127.0.0.1:3000/health`
3. Waits 5 seconds for response
4. Retries 3 times if fails
5. Sends email alert if all retries fail

**Health endpoint response:**
```json
{
  "status": "ok",
  "timestamp": "2026-03-25T10:30:00.000Z"
}
```

**Customize check interval:**
```bash
sudo systemctl edit fcc-health-check.service
# Change: Environment="CHECK_INTERVAL=300"
# (time in seconds)
```

**Customize alert email:**
```bash
sudo systemctl edit fcc-health-check.service
# Change: Environment="ALERT_EMAIL=riotshielder21@gmail.com"
```

---

## Services Status

View all at once:
```bash
sudo systemctl status fcc-web fcc-health-check fcc-sync.timer nginx ddclient
```

Expected output for each:
```
â— fcc-web.service - FCC Website Service
     Loaded: loaded (/etc/systemd/system/fcc-web.service; enabled; vendor preset: enabled)
     Active: active (running) since...
```

---

## Logs & Debugging

### Website Errors

```bash
# Real-time logs
sudo journalctl -u fcc-web -f

# Last 100 lines
sudo journalctl -u fcc-web -n 100

# With timestamps
sudo journalctl -u fcc-web --no-pager
```

### Health Check Issues

```bash
sudo journalctl -u fcc-health-check -f
```

### Nginx Issues

```bash
# Check config is valid
sudo nginx -t

# View access log
sudo tail -f /var/log/nginx/fcc_access.log

# View error log
sudo tail -f /var/log/nginx/fcc_error.log
```

### System Issues

```bash
# All recent errors
sudo journalctl -xe

# Boot messages
sudo dmesg | tail -20

# All services
sudo systemctl list-units --type service --failed
```

---

## Performance

### Check Resources

```bash
# Disk usage
df -h /home/fcc-web/FCCWebsite

# Memory usage
free -h

# CPU usage
top -b -n 1 | head -15

# File count
find /home/fcc-web/FCCWebsite -type f | wc -l
```

### Optimize Nginx

Nginx is pre-configured with:
- Gzip compression
- Connection keepalive
- Security headers
- Rate limiting (optional)

### Clear Cache

```bash
# Nginx cache (if enabled)
sudo rm -rf /var/cache/nginx/*

# Node.js cache
rm -rf /home/fcc-web/FCCWebsite/node_modules/.cache
```

---

## SSL Certificate

### Check Certificate

```bash
sudo certbot certificates
```

Shows:
- Domain
- Expiration date
- Certificate path

### Manual Renewal

```bash
sudo certbot renew
sudo systemctl reload nginx
```

### Auto-Renewal

Already enabled. Verify:
```bash
sudo systemctl list-timers | grep certbot
```

---

## Firewall

### Check Status

```bash
sudo ufw status
```

Should show:
```
To                         Action      From
--                         ------      ----
22/tcp                     ALLOW       Anywhere
80/tcp                     ALLOW       Anywhere
443/tcp                    ALLOW       Anywhere
```

### Add Rule

```bash
# Allow SSH on custom port
sudo ufw allow 2222/tcp

# Block IP
sudo ufw deny from 111.222.333.444
```

---

## Email Alerts Testing

### Manual Health Check

```bash
/usr/local/bin/fcc-health-check.sh
```

### Test Mail System

```bash
echo "test message" | mail -s "test" riotshielder21@gmail.com
```

Check spam folder if not received.

---

## Rollback Deployment

### Revert to Previous Code

```bash
cd /home/fcc-web/FCCWebsite
git log --oneline -5    # View recent commits
git revert <commit-id>  # Revert specific commit
git push

npm run build
sudo systemctl restart fcc-web
```

### Restore from Backup

```bash
# Check backups
ls -lh fcc-backup-*.tar.gz

# Restore
sudo tar -xzf fcc-backup-20260325.tar.gz -C /
```

---

## Database Migration

### Sync JustGo Data Now

```bash
# Run sync manually
/home/fcc-web/FCCWebsite/venv/bin/python /home/fcc-web/FCCWebsite/scripts/justgo-sync.py

# View logs
sudo journalctl -u fcc-sync -f
```

### Inspect Firebase Data

```bash
# Via Node.js shell
cd /home/fcc-web/FCCWebsite
node
> const admin = require('firebase-admin');
> const db = admin.firestore();
> db.collection('artifacts').get().then(snapshot => console.log(snapshot.docs.length));
```

---

## Disaster Recovery

### Complete Reinstall

```bash
# Backup current
sudo tar -czf fcc-backup-final.tar.gz /home/fcc-web/FCCWebsite

# Remove app
sudo rm -rf /home/fcc-web/FCCWebsite

# Redeploy
cd /home/fcc-web
git clone https://github.com/Riotshielder21/FCCWebsite.git app
cd app
sudo ./scripts/deploy.sh riotshielder21@gmail.com fccwebsite.gg-edi.co.uk
```

### Emergency Stop

```bash
sudo systemctl stop fcc-web fcc-health-check fcc-sync.timer
```

### Recovery

```bash
sudo systemctl restart fcc-web fcc-health-check fcc-sync.timer
```

---

## Performance Monitoring

### Setup Daily Report

```bash
# Create report script
sudo nano /usr/local/bin/fcc-report.sh

#!/bin/bash
echo "=== FCC Website Daily Report ===" | mail -s "Daily Report $(date +%Y-%m-%d)" riotshielder21@gmail.com
echo "Uptime: $(systemctl show -p ActiveEnterTimestamp fcc-web)" | mail -s "..." riotshielder21@gmail.com
echo "Services:" >> report.txt
sudo systemctl status fcc-web fcc-health-check nginx >> report.txt

# Make executable
sudo chmod +x /usr/local/bin/fcc-report.sh

# Add to cron (runs daily at 9 AM)
# 0 9 * * * /usr/local/bin/fcc-report.sh
```

---

## Quick Reference

```bash
# Deploy
sudo ./scripts/deploy.sh email@example.com domain.com

# Configure
sudo nano /etc/ddclient.conf          # DNS
sudo nano /home/fcc-web/FCCWebsite/serviceAccountKey.json  # Firebase
sudo systemctl edit fcc-health-check.service          # Alerts

# Check
sudo systemctl status fcc-web fcc-health-check nginx

# Log
sudo journalctl -u fcc-web -f

# Restart
sudo systemctl restart fcc-web

# Update
cd /home/fcc-web/FCCWebsite && git pull && npm run build && sudo systemctl restart fcc-web

# Monitor
df -h && free -h && sudo top -b -n 1
```

---

See [SETUP.md](SETUP.md) for complete setup guide.

See [DEVELOPMENT.md](DEVELOPMENT.md) for local development.
