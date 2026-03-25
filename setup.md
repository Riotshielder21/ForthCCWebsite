# FCC Website - Setup & Deployment

Complete setup guide from fresh Ubuntu to production website.

---

## Prerequisites

- **Ubuntu 22.04 LTS** or later
- **SSH access** to server
- **Domain name** (optional, for HTTPS)
- **Email address** (for downtime alerts)

---

## Part 1: Initial Setup

### 1.1 Connect to Server

```bash
ssh user@your-server-ip
mkdir ~/app && cd ~/app
```

### 1.2 Install System Dependencies

Update your system and install required packages:

```bash
sudo apt-get update
sudo apt-get install -y curl wget git nginx certbot python3-certbot-nginx nodejs npm mailutils ddclient python3 python3-pip python3-venv
```

**Required packages:**
- `curl wget git` - Download and version control tools
- `nginx` - Web server and reverse proxy
- `certbot python3-certbot-nginx` - SSL certificate automation
- `nodejs npm` - JavaScript runtime and package manager
- `mailutils` - Email sending for alerts
- `ddclient` - Dynamic DNS client
- `python3 python3-pip python3-venv` - Python environment for automation

### 1.3 Clone Repository

**SSH (recommended):**
```bash
git clone git@github.com:Riotshielder21/FCCWebsite.git .
```

**HTTPS (if SSH fails):**
```bash
git clone https://github.com/Riotshielder21/FCCWebsite.git .
```

### 1.4 Run Deploy Script

This automates application setup (assumes system dependencies are already installed):

```bash
chmod +x scripts/deploy.sh
sudo ./scripts/deploy.sh riotshielder21@gmail.com fccwebsite.gg-edi.co.uk
```

**Handles:**
- App user & directory setup
- Node.js build & dependencies
- Python virtualenv + Playwright
- Systemd services (auto-restart)
- Health check scripts
- Nginx configuration
- SSL certificates
- Dynamic DNS
- Firewall rules

**Time:** 5-10 minutes

---

## Part 2: Configuration

After script completes, configure these 3 things:

### 2.1 Cloudflare Dynamic DNS

Edit:
```bash
sudo nano /etc/ddclient.conf
```

Update:
```
login=your_email@cloudflare.com
password='your_cloudflare_api_token'
zone=fccwebsite.gg-edi.co.uk
fccwebsite.gg-edi.co.uk,www.fccwebsite.gg-edi.co.uk
```

Restart:
```bash
sudo systemctl restart ddclient
```

### 2.2 Firebase Credentials

Add serviceAccountKey.json:

```bash
# Get from Firebase Console > Project Settings > Service Accounts
sudo nano /home/fcc-web/FCCWebsite/serviceAccountKey.json
# Paste JSON key (Ctrl+X > Y > Enter)

sudo chmod 600 /home/fcc-web/FCCWebsite/serviceAccountKey.json
sudo chown fcc-web:fcc-web /home/fcc-web/FCCWebsite/serviceAccountKey.json
```

### 2.4 Google Sheets Integration (NEW)

**Create Google Sheet:**
1. Go to [sheets.google.com](https://sheets.google.com)
2. Create new spreadsheet
3. Rename first tab to "Lists"
4. Add headers: `Timestamp | Name | Email | List Type | Items | Notes`

**Setup Service Account:**
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create/select project
3. Enable "Google Sheets API"
4. Create Service Account (IAM > Service Accounts)
5. Generate JSON key, download it

**Configure on Server:**
```bash
# Place key file
sudo nano /home/fcc-web/FCCWebsite/google-service-account.json
# Paste JSON content (Ctrl+X > Y > Enter)

sudo chmod 600 /home/fcc-web/FCCWebsite/google-service-account.json
sudo chown fcc-web:fcc-web /home/fcc-web/FCCWebsite/google-service-account.json

# Share Google Sheet with service account email
# (email found in JSON: "client_email" field)

# Add Sheet ID to environment
sudo nano /home/fcc-web/FCCWebsite/.env
# Add: GOOGLE_SHEET_ID=your_sheet_id_from_url
```

### 2.5 Email Alerts

Configure who gets notified:

```bash
sudo systemctl edit fcc-health-check.service
```

Update:
```
Environment="ALERT_EMAIL=riotshielder21@gmail.com"
Environment="CHECK_INTERVAL=300"
```

Save (Ctrl+X > Y > Enter):
```bash
sudo systemctl daemon-reload
sudo systemctl restart fcc-health-check
```

### 2.4 JustGo Sync (Optional)

If syncing membership data:

```bash
sudo systemctl edit fcc-sync.service
```

Add:
```
Environment="JUSTGO_USER=your_email@justgo.com"
Environment="JUSTGO_PASS=your_password"
```

Reload:
```bash
sudo systemctl daemon-reload
```

---

## Part 3: Verification

### 3.1 Check Services

```bash
sudo systemctl status fcc-web fcc-health-check fcc-sync.timer nginx ddclient
```

All should show: **active (running)**

### 3.2 Test Locally

```bash
curl http://127.0.0.1:3000/health
```

Should return: `{"status":"ok","timestamp":"..."}`

### 3.3 Test Remotely

```bash
curl -I https://fccwebsite.gg-edi.co.uk
```

Should show: `HTTP/2 200`

### 3.4 Test Email Alerts

```bash
# Stop website
sudo systemctl stop fcc-web

# Wait 5 minutes (default check interval)
# Check for alert email

# Restart
sudo systemctl start fcc-web
```

---

## Part 4: Daily Operations

### Check Status

```bash
sudo systemctl status fcc-web
```

### View Logs (Real-Time)

```bash
sudo journalctl -u fcc-web -f
```

Press Ctrl+C to exit.

### Restart Website

```bash
sudo systemctl restart fcc-web
```

### Deploy Code Updates

```bash
cd /home/fcc-web/FCCWebsite
git pull
npm run build
sudo systemctl restart fcc-web
```

### View Health Check Logs

```bash
sudo journalctl -u fcc-health-check -f
```

### View Nginx Errors

```bash
sudo tail -f /var/log/nginx/fcc_error.log
```

### Check Disk/Memory

```bash
df -h              # Disk usage
free -h            # Memory usage
```

---

## Part 5: Troubleshooting

### Website Not Loading

```bash
# Check service
sudo systemctl status fcc-web -l

# View recent errors
sudo journalctl -u fcc-web -n 30

# Restart
sudo systemctl restart fcc-web
```

### No Email Alerts

```bash
# Check health check
sudo systemctl status fcc-health-check -l

# View logs
sudo journalctl -u fcc-health-check -f

# Test mail
echo "test" | mail -s "test" riotshielder21@gmail.com
```

### SSL Certificate Issues

```bash
# Check status
sudo certbot certificates

# Force renewal
sudo certbot renew --force-renewal

# Reload nginx
sudo systemctl reload nginx
```

### Port Already in Use

```bash
sudo lsof -i :80    # HTTP
sudo lsof -i :443   # HTTPS
sudo lsof -i :3000  # App
```

### Can't Connect to Domain

```bash
# Check DNS
nslookup fccwebsite.gg-edi.co.uk

# Check firewall
sudo ufw status

# Check listening ports
sudo netstat -tlnp | grep -E ':(80|443|3000)'
```

### Website Restarting Constantly

```bash
# Check errors
sudo journalctl -u fcc-web -n 50 --all

# Check disk
df -h

# Check memory
free -h
```

---

## Part 6: Security Hardening (Optional)

### Change SSH Port

```bash
sudo nano /etc/ssh/sshd_config

# Uncomment and change:
# Port 2222
# PermitRootLogin no
# PasswordAuthentication no

sudo systemctl restart ssh
sudo ufw allow 2222/tcp
sudo ufw delete allow 22/tcp
```

### Install Fail2Ban

```bash
sudo apt-get install fail2ban
sudo systemctl enable fail2ban
```

### Add Rate Limiting

```bash
sudo nano /etc/nginx/sites-available/fcc-web

# Add after upstream block:
# limit_req_zone $binary_remote_addr zone=fcc_limit:10m rate=10r/s;

# Add in location / block:
# limit_req zone=fcc_limit burst=20 nodelay;

sudo nginx -t && sudo systemctl reload nginx
```

### Enable Auto-Updates

```bash
sudo apt-get install unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

### Manual Backup

```bash
# Backup app
sudo tar -czf fcc-backup-$(date +%Y%m%d).tar.gz /home/fcc-web/FCCWebsite

# Backup certificates
sudo tar -czf fcc-certs-$(date +%Y%m%d).tar.gz /etc/letsencrypt
```

---

## Part 7: Monitoring

### Website Logs

```bash
# Real-time
sudo journalctl -u fcc-web -f

# Last 50 lines
sudo journalctl -u fcc-web -n 50

# Since 1 hour ago
sudo journalctl -u fcc-web --since "1 hour ago"
```

### Health Check Logs

```bash
sudo journalctl -u fcc-health-check -f
```

### Nginx Access Log

```bash
sudo tail -f /var/log/nginx/fcc_access.log
```

### Nginx Error Log

```bash
sudo tail -f /var/log/nginx/fcc_error.log
```

### System Health

```bash
# Disk usage
df -h

# Memory usage
free -h

# CPU usage  
top -b -n 1 | head -20

# Service uptime
systemctl show -p ActiveEnterTimestamp fcc-web
```

---

## Part 8: Service Management

### All Services

| Service | Command |
|---------|---------|
| Website | `sudo systemctl status fcc-web` |
| Health Check | `sudo systemctl status fcc-health-check` |
| JustGo Sync | `sudo systemctl status fcc-sync.timer` |
| Nginx | `sudo systemctl status nginx` |
| DDNS | `sudo systemctl status ddclient` |

### List All FCC Services

```bash
sudo systemctl list-units --type service | grep fcc
```

### Enable Service (Auto-Start)

```bash
sudo systemctl enable fcc-web
```

### Disable Service

```bash
sudo systemctl disable fcc-web
```

### Restart All

```bash
sudo systemctl restart fcc-web fcc-health-check nginx
```

### Stop Service

```bash
sudo systemctl stop fcc-web
```

### View Service Status Details

```bash
sudo systemctl status fcc-web -l
```

---

## Summary

**Your website now has:**
- âœ… Node.js app on port 3000 (internal)
- âœ… Nginx reverse proxy on 80/443
- âœ… SSL/HTTPS with Let's Encrypt
- âœ… Auto-start on server reboot
- âœ… Auto-restart on crash
- âœ… Email alerts for downtime
- âœ… Health checks every 5 min
- âœ… Auto-updating Dynamic DNS
- âœ… Firewall pre-configured
- âœ… Firebase integration

**Key locations:**
- Website: `/home/fcc-web/FCCWebsite/`
- Nginx: `/etc/nginx/sites-available/fcc-web`
- Services: `/etc/systemd/system/fcc-*.service`
- Logs: `journalctl -u fcc-web`
- SSL: `/etc/letsencrypt/live/fccwebsite.gg-edi.co.uk/`

**Quick commands:**
```bash
sudo systemctl status fcc-web                # Status
sudo journalctl -u fcc-web -f                # Logs
sudo systemctl restart fcc-web               # Restart
cd /home/fcc-web/FCCWebsite && git pull             # Update
```

---

**For local development:** See [DEVELOPMENT.md](DEVELOPMENT.md)

**Questions?** Check troubleshooting section or view logs:
```bash
sudo journalctl -xe
```
