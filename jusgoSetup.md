Setting up JustGo Sync on Local Linux

Follow these steps to migrate the automation from GitHub to your local machine.

1. Install System Dependencies

Ensure your Linux system has Python and the necessary libraries for Playwright (browser engines).

# Update and install python/pip
sudo apt update
sudo apt install python3-python3-pip -y

# Install Python libraries
pip install playwright firebase-admin

# Install Playwright browser engines and their system dependencies
playwright install chromium
sudo playwright install-deps


2. Prepare the Files

Create a folder for the project: mkdir ~/justgo-sync && cd ~/justgo-sync

Place your justgo_sync.py and serviceAccountKey.json in this folder.

Create a .env file or export your credentials (see crontab below).

3. Configure the Cronjob

Open your user's crontab editor:

crontab -e


Add the following line to the bottom of the file (this runs every day at 4:00 AM).

Note: We provide the full paths and environment variables directly in the cron string to ensure it has the correct context.

0 4 * * * export JUSTGO_USER="your_email@example.com" && export JUSTGO_PASS="your_password" && /usr/bin/python3 /home/yourusername/justgo-sync/justgo_sync.py >> /home/yourusername/justgo-sync/sync.log 2>&1


4. Verification

Logs: Check ~/justgo-sync/sync.log to see the output.

Manual Test: Run the command once manually to ensure permissions are correct:
python3 ~/justgo-sync/justgo_sync.py

5. Security Tip

Since you are storing your password in the crontab or a script, ensure the permissions are restricted:

chmod 600 ~/justgo-sync/serviceAccountKey.json
chmod 700 ~/justgo-sync/justgo_sync.py
