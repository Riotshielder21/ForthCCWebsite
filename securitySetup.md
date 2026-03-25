# âš ï¸ Documentation Moved

Security documentation has been consolidated into [SECURITY.md](SECURITY.md).

See [INDEX.md](INDEX.md) for all guides.

---

**Quick secure deployment:**
```bash
sudo ./scripts/deploy.sh riotshielder21@gmail.com fccwebsite.gg-edi.co.uk
```

The script includes security hardening by default!


## 1. System Updates & Hardening

### Keep System Updated
```bash
sudo apt update && sudo apt upgrade -y
sudo apt autoremove -y
```

### Install Security Tools
```bash
sudo apt install ufw fail2ban unattended-upgrades -y
```

## 2. Firewall Configuration (UFW)

### Enable UFW and Set Defaults
```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
```

### Allow Only Necessary Ports
```bash
# SSH (change default port 22 to something else for security)
sudo ufw allow 22/tcp

# Web server (adjust port based on your setup)
sudo ufw allow 3000/tcp  # or 80/tcp and 443/tcp if using nginx

# Enable firewall
sudo ufw enable
```

### Check Status
```bash
sudo ufw status
```

## 3. SSH Hardening

### Edit SSH Config
```bash
sudo nano /etc/ssh/sshd_config
```

Key changes:
```
Port 22  # Change to non-standard port (e.g., 2222)
PermitRootLogin no
PasswordAuthentication no  # Force key-based auth
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys
PermitEmptyPasswords no
ChallengeResponseAuthentication no
UsePAM yes
X11Forwarding no
PrintMotd no
AcceptEnv LANG LC_*
Subsystem sftp /usr/lib/openssh/sftp-server
```

### Restart SSH
```bash
sudo systemctl restart ssh
sudo systemctl enable ssh
```

### Update Firewall for New SSH Port
```bash
sudo ufw allow 2222/tcp  # if changed from 22
sudo ufw delete allow 22/tcp
```

## 4. Fail2Ban for SSH Protection

### Configure Fail2Ban
```bash
sudo nano /etc/fail2ban/jail.local
```

Add:
```
[sshd]
enabled = true
port = 22  # or your custom port
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 3600
```

### Restart Fail2Ban
```bash
sudo systemctl restart fail2ban
sudo systemctl enable fail2ban
```

## 5. Web Server Security

### If Using Node.js Directly (Port 3000)
- Ensure the web app binds only to localhost if behind reverse proxy
- In your main.jsx/server config, set host to '127.0.0.1'

### Recommended: Nginx Reverse Proxy with SSL

#### Install Nginx
```bash
sudo apt install nginx certbot python3-certbot-nginx -y
```

#### Configure Nginx Site
```bash
sudo nano /etc/nginx/sites-available/fcc-app
```

Paste:
```
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

#### Enable Site
```bash
sudo ln -s /etc/nginx/sites-available/fcc-app /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

#### Get SSL Certificate
```bash
sudo certbot --nginx -d yourdomain.com
```

#### Update Firewall
```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw delete allow 3000/tcp  # if no longer needed
```

## 6. User & File Permissions

### Create Dedicated User for App
```bash
sudo useradd -m -s /bin/bash fccuser
sudo usermod -aG www-data fccuser  # if using nginx
```

### Secure Sensitive Files
```bash
# In ~/FCCWebsite
chmod 600 serviceAccountKey.json
chmod 600 .env  # if you have one
chmod 700 venv/  # restrict venv access
```

### Restrict Cron Access
- Only root and fccuser should have cron access
```bash
sudo nano /etc/cron.allow
# Add: fccuser
```

## 7. Monitoring & Logging

### System Monitoring
```bash
sudo apt install htop iotop -y
```

### Log Rotation
```bash
sudo nano /etc/logrotate.d/fcc-app
```

Add:
```
/home/fccuser/FCCWebsite/*.log {
    daily
    missingok
    rotate 7
    compress
    notifempty
    create 644 fccuser fccuser
}
```

### Check Logs Regularly
```bash
sudo journalctl -u fcc-web -f
tail -f ~/FCCWebsite/sync.log
sudo tail -f /var/log/auth.log
```

## 8. Backup Strategy

### Automate Backups
```bash
# Install rsync for backups
sudo apt install rsync -y

# Create backup script
sudo nano /usr/local/bin/backup-fcc.sh
```

Script content:
```bash
#!/bin/bash
BACKUP_DIR="/home/fccuser/backups"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR

# Backup app directory (exclude venv and logs)
rsync -av --exclude='venv/' --exclude='*.log' /home/fccuser/FCCWebsite/ $BACKUP_DIR/FCCWebsite_$DATE/

# Backup database if applicable
# Add Firebase export commands here

# Clean old backups (keep last 7)
find $BACKUP_DIR -name "FCCWebsite_*" -type d -mtime +7 -exec rm -rf {} \;
```

```bash
sudo chmod +x /usr/local/bin/backup-fcc.sh
```

### Add to Cron
```bash
# Daily backup at 2 AM
0 2 * * * /usr/local/bin/backup-fcc.sh
```

## 9. Additional Security Measures

### Disable Unnecessary Services
```bash
sudo systemctl disable bluetooth.service  # if not needed
sudo systemctl disable cups.service       # if no printer
```

### Kernel Hardening
```bash
sudo nano /etc/sysctl.conf
```

Add:
```
# IP Spoofing protection
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1

# Ignore ICMP broadcast requests
net.ipv4.icmp_echo_ignore_broadcasts = 1

# Disable source packet routing
net.ipv4.conf.all.accept_source_route = 0
net.ipv6.conf.all.accept_source_route = 0

# Ignore send redirects
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0

# Block SYN attacks
net.ipv4.tcp_syncookies = 1

# Log Martians
net.ipv4.conf.all.log_martians = 1
```

```bash
sudo sysctl -p
```

### Regular Security Audits
```bash
# Check for open ports
sudo netstat -tlnp

# Check running services
sudo systemctl list-units --type=service --state=active

# Check for security updates
sudo apt list --upgradable
```

## 10. Emergency Response

### If Compromised
1. Disconnect from network immediately
2. Change all passwords
3. Regenerate SSH keys
4. Check logs for suspicious activity
5. Restore from clean backup
6. Update all software

### Contact Info
- Keep emergency contact numbers handy
- Have backup access method (phone hotspot if internet down)

## Summary

By following this guide, your home server will:
- Only expose SSH and web ports
- Use key-based authentication
- Have automatic updates and monitoring
- Include SSL encryption for web traffic
- Have regular backups and log rotation

Remember: Security is ongoing. Regularly review logs and apply updates!
