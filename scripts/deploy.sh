#!/bin/bash
# FCC Website Application Deployment Script
# 🚀 Application setup and configuration (system dependencies must be installed manually)

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${GREEN}[v]${NC} $1"; }
warn() { echo -e "${YELLOW}[w]${NC} $1"; }
error() { echo -e "${RED}[x]${NC} $1"; exit 1; }
info() { echo -e "${BLUE}[i]${NC} $1"; }

# Configuration
APP_HOME="/home/fcc-web/FCCWebsite"
APP_USER="fcc-web"
ALERT_EMAIL="${1:-riotshielder21@gmail.com}"
DOMAIN="${2:-fccwebsite.gg-edi.co.uk}"

# Ensure we're running from the correct directory
if [ ! -d "$APP_HOME" ]; then
    error "Application home directory $APP_HOME not found"
fi

# Step 1: System Validation
info "Step 1: Validating System Dependencies"
REQUIRED_PACKAGES="curl wget git nginx certbot python3-certbot-nginx nodejs npm mailutils ddclient python3 python3-pip python3-venv"
MISSING_PACKAGES=""

for pkg in $REQUIRED_PACKAGES; do
    if ! dpkg -l | grep -q "^ii  $pkg "; then
        MISSING_PACKAGES="$MISSING_PACKAGES $pkg"
    fi
done

if [ -n "$MISSING_PACKAGES" ]; then
    error "Missing required packages:$MISSING_PACKAGES\n\nPlease install manually:\n  sudo apt-get update\n  sudo apt-get install -y$MISSING_PACKAGES"
else
    log "All system dependencies are installed"
fi

# Step 2: Create App User
info "Step 2: Creating App User"
if ! id "$APP_USER" &>/dev/null; then
    sudo useradd -m -s /bin/bash "$APP_USER"
    log "User '$APP_USER' created"
else
    log "User '$APP_USER' already exists"
fi

# Step 3: Update Repository
info "Step 3: Updating Application from main"
cd "$APP_HOME"
if [ -d ".git" ]; then
    if sudo -u "$APP_USER" git pull origin main; then
        log "Repository updated from main"
    else
        warn "Failed to pull from git, continuing with existing code"
    fi
else
    warn "No git repository found, skipping update"
fi

# Step 4: Node.js Setup
info "Step 4: Building Node.js Application"
cd "$APP_HOME"

# Check if node and npm are available
if ! sudo -u "$APP_USER" which node >/dev/null 2>&1; then
    error "Node.js not found for user $APP_USER"
fi

if ! sudo -u "$APP_USER" which npm >/dev/null 2>&1; then
    error "npm not found for user $APP_USER"
fi

if sudo -u "$APP_USER" npm install; then
    log "Dependencies installed"
else
    error "Failed to install dependencies"
fi

if sudo -u "$APP_USER" npm run build; then
    log "Application built"
else
    error "Failed to build application"
fi

# Step 5: Python Setup (for JustGo Sync)
info "Step 5: Setting up Python Environment"
cd "$APP_HOME"
if [ ! -d "venv" ]; then
    sudo -u "$APP_USER" python3 -m venv venv
    sudo -u "$APP_USER" ./venv/bin/pip install -r requirements.txt
    sudo -u "$APP_USER" ./venv/bin/playwright install chromium
    log "Python environment ready"
else
    log "Python environment already configured"
fi

# Step 6: Install Health Check Script
info "Step 6: Installing Health Check Service"
sudo cp scripts/health-check.sh /usr/local/bin/fcc-health-check.sh
sudo chmod +x /usr/local/bin/fcc-health-check.sh
log "Health check script installed"

# Step 7: Configure Systemd Services
info "Step 7: Configuring Systemd Services"
sudo tee /etc/systemd/system/fcc-web.service > /dev/null << 'EOF'
[Unit]
Description=FCC Website Service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=fcc-web
WorkingDirectory=/home/fcc-web/FCCWebsite
ExecStart=/usr/bin/node /home/fcc-web/FCCWebsite/server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
Environment="NODE_ENV=production"
Environment="PORT=3000"

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/fcc-health-check.service > /dev/null << EOF
[Unit]
Description=FCC Health Check & Email Alerts
After=fcc-web.service
Requires=fcc-web.service

[Service]
Type=simple
User=fcc-web
ExecStart=/usr/local/bin/fcc-health-check.sh
Restart=always
RestartSec=30
StandardOutput=journal
StandardError=journal
Environment="ALERT_EMAIL=$ALERT_EMAIL"
Environment="CHECK_INTERVAL=300"

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable fcc-web fcc-health-check
log "Systemd services configured"

# Step 8: Configure Nginx
info "Step 8: Configuring Nginx"
sudo cp config/nginx.conf /etc/nginx/sites-available/fcc-web
sudo sed -i "s/fccwebsite.gg-edi.co.uk/$DOMAIN/g" /etc/nginx/sites-available/fcc-web
sudo ln -sf /etc/nginx/sites-available/fcc-web /etc/nginx/sites-enabled/ 2>/dev/null || true
sudo rm -f /etc/nginx/sites-enabled/default

sudo nginx -t &>/dev/null && sudo systemctl reload nginx || error "Nginx configuration error"
log "Nginx configured"

# Step 9: SSL Certificate
info "Step 9: Setting up SSL Certificate"
if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    sudo certbot certonly --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos -m "$ALERT_EMAIL" || warn "SSL setup skipped"
else
    log "SSL certificate already installed"
fi
log "SSL configured"

# Step 10: Configure ddclient (Dynamic DNS)
info "Step 10: Configuring Dynamic DNS"
sudo tee /etc/ddclient.conf > /dev/null << 'EOF'
protocol=cloudflare
use=web, web=checkip.dyndns.com/
zone=gg-edi.co.uk
login=riotshielder21@gmail.com
password='your_cloudflare_api_token'
fccwebsite.gg-edi.co.uk,www.fccwebsite.gg-edi.co.uk
EOF
sudo chmod 600 /etc/ddclient.conf
sudo systemctl enable ddclient
log "Dynamic DNS configured (update /etc/ddclient.conf with your credentials)"

# Step 11: Setup Email Alerts
info "Step 11: Configuring Email"
if command -v postfix &> /dev/null; then
    log "Postfix mail service active"
else
    warn "Install mailutils: sudo apt-get install mailutils"
fi

# Step 12: Firewall
info "Step 12: Configuring Firewall"
sudo ufw default deny incoming &>/dev/null || true
sudo ufw default allow outgoing &>/dev/null || true
sudo ufw allow 22/tcp &>/dev/null || true
sudo ufw allow 80/tcp &>/dev/null || true
sudo ufw allow 443/tcp &>/dev/null || true
sudo ufw enable -y &>/dev/null || true
log "Firewall configured"

# Step 13: Start Services
info "Step 13: Starting Services"
sudo systemctl start fcc-web fcc-health-check
sleep 3

if sudo systemctl is-active --quiet fcc-web; then
    log "Website service running"
else
    error "Website service failed to start"
fi

# Summary
echo ""
echo -e "${BLUE}==============================================================================================${NC}"
echo -e "${GREEN}“ Deployment Complete!${NC}"
echo -e "${BLUE}=============================================================================================={NC}"
echo ""
echo "Website:"
echo "  Local: http://127.0.0.1:3000"
echo "  Public: https://$DOMAIN"
echo ""
echo "Email: $ALERT_EMAIL"
echo "Domain: $DOMAIN"
echo ""
echo "Services:"
echo "  fcc-web (Node.js app)"
echo "  fcc-health-check (Email alerts)"
echo "  nginx (Reverse proxy + SSL)"
echo "  ddclient (Dynamic DNS)"
echo ""
echo "Commands:"
echo "  sudo systemctl status fcc-web"
echo "  sudo systemctl logs -u fcc-web -f"
echo "  sudo systemctl restart fcc-web"
echo ""
echo "Next Steps:"
echo "  1. Update /etc/ddclient.conf with Cloudflare credentials"
echo "  2. Setup serviceAccountKey.json for JustGo sync"
echo "  3. Configure .env with Firebase credentials"
echo ""
