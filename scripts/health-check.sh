#!/bin/bash
# Health Check Service with Email Alert
# Monitors website availability and sends email if offline

set -e

CHECK_URL="http://127.0.0.1:3000"
MAX_RETRIES=3
RETRY_INTERVAL=5
EMAIL_TO="${ALERT_EMAIL:-riotshielder21@gmail.com}"
HOSTNAME=$(hostname)

# Colors for logging
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1"
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARN:${NC} $1"
}

send_alert() {
    local subject="ðŸš¨ FCC Website Down - $HOSTNAME"
    local body="Website is unreachable at $CHECK_URL\n\nTime: $(date)\nHost: $HOSTNAME\n\nPlease check the server immediately."
    
    echo -e "$body" | mail -s "$subject" "$EMAIL_TO" 2>/dev/null || warn "Failed to send email alert"
}

check_website() {
    local retry=0
    
    while [ $retry -lt $MAX_RETRIES ]; do
        if curl -sf "$CHECK_URL" > /dev/null 2>&1; then
            log "Website is UP âœ“"
            return 0
        fi
        
        retry=$((retry + 1))
        if [ $retry -lt $MAX_RETRIES ]; then
            warn "Attempt $retry failed, retrying in ${RETRY_INTERVAL}s..."
            sleep $RETRY_INTERVAL
        fi
    done
    
    error "Website DOWN after $MAX_RETRIES attempts"
    send_alert
    return 1
}

# Main loop
log "Starting health check service..."
log "Monitoring: $CHECK_URL"
log "Alert email: $EMAIL_TO"
log "Check interval: ${CHECK_INTERVAL:-300}s"

while true; do
    check_website || true
    sleep "${CHECK_INTERVAL:-300}"
done
