Forth Canoe Club - Home Server Setup Guide

This guide details how to set up the JustGo Sync automation and the web portal on a fresh Linux home server (e.g., Ubuntu/Debian).

1. Initial System Preparation

Update the system and install essential tools.

sudo apt update && sudo apt upgrade -y
sudo apt install python3-pip python3-venv git curl ufw openssh-client -y

Set up SSH credentials for GitHub (if repo is private):

ssh-keygen -t ed25519 -C "riotshielder21@gmail.com"
cat ~/.ssh/id_ed25519.pub
# Add the public key to GitHub: Settings > SSH and GPG keys > New SSH key

# If using custom key name, create SSH config
echo "Host github.com
    User git
    IdentityFile ~/.ssh/id_ed25519" >> ~/.ssh/config
chmod 600 ~/.ssh/config

# Start SSH agent and add key
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519

Test SSH connection:

ssh -T git@github.com


2. JustGo Sync Setup (Automation)

The script that pulls data from JustGo and updates Firebase.

Clone the Repository:

git clone git@github.com:yourusername/yourrepo.git ~/fcc-server
cd ~/fcc-server

Create and Activate Virtual Environment:

python3 -m venv venv
source venv/bin/activate

Install Playwright & Dependencies:

pip install playwright firebase-admin
playwright install chromium

# Try automatic deps install (may fail on unsupported Ubuntu versions)
sudo playwright install-deps

# If above fails with libicu errors, install manually:
sudo apt-get install libnss3-dev libatk-bridge2.0-dev libdrm2 libxkbcommon-dev libxcomposite-dev libxdamage-dev libxrandr-dev libgbm-dev libxss1 libasound2-dev libgtk-3-dev libicu-dev

Add Credentials:

Place your JustGoSync.py, serviceAccountKey.json, and update_repo.sh in this folder.

Restrict permissions:

chmod 600 serviceAccountKey.json
chmod +x update_repo.sh


3. Cloudflare Dynamic DNS (DDNS)

Since home IPs change, we need a script to update your Cloudflare DNS record every 20 minutes.

Install ddclient (or use a simple bash script):

sudo apt install ddclient -y


Alternative: Simple Bash Cron
Create update_ip.sh:

#!/bin/bash
# Replace with your Cloudflare Details
ZONE_ID="your_zone_id"
RECORD_ID="your_record_id"
API_TOKEN="your_api_token"
IP=$(curl -s [https://api.ipify.org](https://api.ipify.org))

curl -X PUT "[https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$RECORD_ID](https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$RECORD_ID)" \
     -H "Authorization: Bearer $API_TOKEN" \
     -H "Content-Type: application/json" \
     --data "{\"type\":\"A\",\"name\":\"club.yourdomain.com\",\"content\":\"$IP\",\"ttl\":120,\"proxied\":true}"


Add to crontab: */20 * * * * bash /home/user/fcc-server/update_ip.sh

4. Resilience & Auto-Restart

To ensure everything stays up after a power cut or machine restart.

A. The Web Service (Systemd)

Create a service file to keep your web app running and point to the correct port (e.g., 3000).

sudo nano /etc/systemd/system/fcc-web.service


Paste this configuration:

[Unit]
Description=Forth Canoe Club Web Portal
After=network.target

[Service]
User=yourusername
WorkingDirectory=/home/yourusername/fcc-server
ExecStart=/usr/bin/npm start
Restart=always
Environment=PORT=3000

[Install]
WantedBy=multi-user.target


Enable it: sudo systemctl enable fcc-web && sudo systemctl start fcc-web

B. The Sync Cronjob

Add your daily sync to the crontab:

crontab -e


Add:

# Sync JustGo daily at 4 AM
0 4 * * * export JUSTGO_USER="..." && export JUSTGO_PASS="..." && /usr/bin/python3 /home/user/fcc-server/justgo_sync.py >> /home/user/fcc-server/sync.log 2>&1

# Update repo weekly on Sundays at 3 AM
0 3 * * 0 bash /home/user/fcc-server/update_repo.sh


5. Network & Port Forwarding

Firewall: Allow traffic to your web port:

sudo ufw allow 3000/tcp
sudo ufw enable


Router: Log into your home router and forward Port 80/443 (or 3000) to the internal IP of this Linux machine.

6. Troubleshooting

Logs: journalctl -u fcc-web -f

Sync Logs: tail -f ~/fcc-server/sync.log

IP Status: cat /var/log/syslog | grep ddclient