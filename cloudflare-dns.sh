#!/bin/bash

# Cloudflare DNS Management Script
# Usage: ./cloudflare-dns.sh [environment] [cloudfront_domain]
# Example: ./cloudflare-dns.sh prod d2mpgwz50hual0.cloudfront.net

set -e

ENVIRONMENT=${1:-dev}
CLOUDFRONT_DOMAIN=${2}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🌐 Cloudflare DNS Configuration${NC}"
echo -e "${BLUE}Environment: ${ENVIRONMENT}${NC}"
echo -e "${BLUE}CloudFront Domain: ${CLOUDFRONT_DOMAIN}${NC}"
echo ""

# Check required environment variables
if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
    echo -e "${RED}❌ CLOUDFLARE_API_TOKEN environment variable is not set${NC}"
    echo -e "${YELLOW}💡 Add your Cloudflare API token to .env.local or export it${NC}"
    exit 1
fi

if [ -z "$CLOUDFLARE_ZONE_ID" ]; then
    echo -e "${RED}❌ CLOUDFLARE_ZONE_ID environment variable is not set${NC}"
    echo -e "${YELLOW}💡 Add your Cloudflare zone ID to .env.local or export it${NC}"
    exit 1
fi

if [ -z "$CLOUDFRONT_DOMAIN" ]; then
    echo -e "${RED}❌ CloudFront domain is required${NC}"
    echo -e "${YELLOW}Usage: $0 [environment] [cloudfront_domain]${NC}"
    exit 1
fi

# Set domain based on environment
if [ "$ENVIRONMENT" = "prod" ]; then
    DOMAIN_NAME="achievements.carlkibler.com"
else
    DOMAIN_NAME="achievements.dev.carlkibler.com"
fi

echo -e "${YELLOW}Setting up DNS record: ${DOMAIN_NAME} → ${CLOUDFRONT_DOMAIN}${NC}"

# Function to make Cloudflare API calls
cf_api_call() {
    local method=$1
    local endpoint=$2
    local data=$3
    
    if [ -n "$data" ]; then
        curl -s -X "$method" \
            "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records${endpoint}" \
            -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
            -H "Content-Type: application/json" \
            --data "$data"
    else
        curl -s -X "$method" \
            "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records${endpoint}" \
            -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
            -H "Content-Type: application/json"
    fi
}

# Check if DNS record already exists
echo -e "${YELLOW}Checking for existing DNS records...${NC}"
EXISTING_RECORD=$(cf_api_call "GET" "?name=${DOMAIN_NAME}&type=CNAME")

# Parse the response to check if record exists
RECORD_COUNT=$(echo "$EXISTING_RECORD" | grep -o '"count":[0-9]*' | cut -d':' -f2)
if [ -z "$RECORD_COUNT" ]; then
    RECORD_COUNT=0
fi

if [ "$RECORD_COUNT" -gt 0 ]; then
    echo -e "${YELLOW}📝 Existing CNAME record found, updating...${NC}"
    
    # Get the record ID
    RECORD_ID=$(echo "$EXISTING_RECORD" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
    
    # Update existing record
    UPDATE_DATA=$(cat <<EOF
{
  "type": "CNAME",
  "name": "${DOMAIN_NAME}",
  "content": "${CLOUDFRONT_DOMAIN}",
  "ttl": 300,
  "proxied": false
}
EOF
)
    
    RESULT=$(cf_api_call "PUT" "/${RECORD_ID}" "$UPDATE_DATA")
    
else
    echo -e "${YELLOW}📝 Creating new CNAME record...${NC}"
    
    # Create new record
    CREATE_DATA=$(cat <<EOF
{
  "type": "CNAME",
  "name": "${DOMAIN_NAME}",
  "content": "${CLOUDFRONT_DOMAIN}",
  "ttl": 300,
  "proxied": false
}
EOF
)
    
    RESULT=$(cf_api_call "POST" "" "$CREATE_DATA")
fi

# Check if the operation was successful
SUCCESS=$(echo "$RESULT" | grep -o '"success":[^,]*' | cut -d':' -f2)

if [ "$SUCCESS" = "true" ]; then
    echo -e "${GREEN}✅ DNS record configured successfully${NC}"
    echo -e "${GREEN}🌐 ${DOMAIN_NAME} → ${CLOUDFRONT_DOMAIN}${NC}"
    echo ""
    echo -e "${YELLOW}📝 Next Steps:${NC}"
    echo "1. DNS propagation may take up to 24 hours"
    echo "2. Test the domain: https://${DOMAIN_NAME}"
    echo "3. Consider setting up SSL/TLS certificates if needed"
else
    echo -e "${RED}❌ Failed to configure DNS record${NC}"
    echo -e "${RED}Response: ${RESULT}${NC}"
    exit 1
fi