# Server prerequisites

Run on the Ubuntu server:

```bash
sudo apt update
sudo apt install -y curl git nginx certbot python3-certbot-nginx nodejs npm python3 python3-pip python3-venv
```

Set up the app:

```bash
cd /home/fcc-web/FCCWebsite
npm install
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Provide these before deployment:

- `.env`
- `google-service-account.json`
- Firebase rules
- Stripe test or live keys

Deploy:

```bash
sudo ./scripts/deploy.sh email@example.com example.org
```
