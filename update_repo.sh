#!/bin/bash
# Update repo script - pulls latest changes from main branch
# Run this periodically via cron to keep the server code up to date

cd /home/fcc-web/FCCWebsite

# Stash any local changes to avoid conflicts
git stash

# Pull latest changes
git pull origin main

# Restore stashed changes if any
git stash pop

echo "$(date): Repo updated" >> update_repo.log
