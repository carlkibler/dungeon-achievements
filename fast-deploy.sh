#!/bin/bash

# Dungeon Achievements Generator - Fast Lambda Deployment
# Usage: ./fast-deploy.sh [environment]
# Example: ./fast-deploy.sh prod
# Only updates Lambda code, skips infrastructure changes

set -e

ENVIRONMENT=${1:-dev}
AWS_REGION=${AWS_REGION:-us-west-2}
AWS_PROFILE=${AWS_PROFILE:-kibler}
STACK_NAME="dungeon-achievements-${ENVIRONMENT}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}⚡ Fast Lambda Deployment${NC}"
echo -e "${BLUE}Environment: ${ENVIRONMENT}${NC}"
echo -e "${BLUE}Region: ${AWS_REGION}${NC}"
echo -e "${BLUE}Profile: ${AWS_PROFILE}${NC}"
echo ""

# Set AWS profile
export AWS_PROFILE="$AWS_PROFILE"

# Verify AWS credentials
aws sts get-caller-identity > /dev/null 2>&1 || {
    echo -e "${RED}❌ AWS credentials not configured${NC}"
    exit 1
}

# Get function name from CloudFormation stack
echo -e "${YELLOW}Getting Lambda function name...${NC}"
FUNCTION_NAME=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$AWS_REGION" \
    --query 'Stacks[0].Outputs[?OutputKey==`FunctionName`].OutputValue' \
    --output text 2>/dev/null)

if [ -z "$FUNCTION_NAME" ] || [ "$FUNCTION_NAME" = "None" ]; then
    echo -e "${RED}❌ Could not find Lambda function for stack: ${STACK_NAME}${NC}"
    echo -e "${YELLOW}💡 Run full deployment first: ./deploy.sh ${ENVIRONMENT}${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Found function: ${FUNCTION_NAME}${NC}"

# Build TypeScript
echo -e "${YELLOW}🔨 Building TypeScript...${NC}"
npm run build

# Copy static files
echo -e "${YELLOW}📦 Copying static files...${NC}"
cp src/index.html dist/
cp -r prompts dist/

# Create deployment package
echo -e "${YELLOW}📦 Creating deployment package...${NC}"
TEMP_DIR=$(mktemp -d)
ZIP_FILE="${TEMP_DIR}/lambda-code.zip"

# Copy built files to temp directory
cp -r dist/* "$TEMP_DIR/"
cp -r node_modules "$TEMP_DIR/" 2>/dev/null || {
    echo -e "${YELLOW}⚠️ node_modules not found, installing dependencies...${NC}"
    cd "$TEMP_DIR"
    cp ../package.json .
    npm install --production --silent
    cd - > /dev/null
}

# Create ZIP file
cd "$TEMP_DIR"
zip -r lambda-code.zip . > /dev/null 2>&1
cd - > /dev/null

echo -e "${YELLOW}⚡ Updating Lambda function code...${NC}"
UPDATE_RESULT=$(aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --zip-file "fileb://${ZIP_FILE}" \
    --region "$AWS_REGION" \
    --output json)

# Extract version from result
VERSION=$(echo "$UPDATE_RESULT" | grep -o '"Version":"[^"]*"' | cut -d'"' -f4)

# Wait for function to be updated
echo -e "${YELLOW}⏳ Waiting for function update to complete...${NC}"
aws lambda wait function-updated \
    --function-name "$FUNCTION_NAME" \
    --region "$AWS_REGION"

# Cleanup
rm -rf "$TEMP_DIR"

# Get function URL for testing
WEBSITE_URL=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$AWS_REGION" \
    --query 'Stacks[0].Outputs[?OutputKey==`WebsiteURL`].OutputValue' \
    --output text)

echo ""
echo -e "${GREEN}🎉 Fast deployment complete!${NC}"
echo -e "${GREEN}⚡ Function: ${FUNCTION_NAME}${NC}"
echo -e "${GREEN}📦 Version: ${VERSION}${NC}"
echo -e "${GREEN}🌐 URL: ${WEBSITE_URL}${NC}"
echo ""
echo -e "${YELLOW}📝 Notes:${NC}"
echo "• Lambda code updated in ~30-60 seconds vs 5-10 minutes for full deploy"
echo "• Infrastructure (CloudFront, API Gateway, etc.) unchanged"
echo "• Use full deploy for infrastructure or environment changes"
echo ""

# Optional: Test the deployment
read -p "Test the deployment? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}🧪 Testing deployment...${NC}"
    
    # Simple health check
    if curl -f -s "$WEBSITE_URL" > /dev/null; then
        echo -e "${GREEN}✅ Website is responding${NC}"
    else
        echo -e "${RED}❌ Website test failed${NC}"
    fi
    
    # Test API endpoint
    TEST_PAYLOAD='{"activity":"testing fast deployment"}'
    API_URL="${WEBSITE_URL}generate"
    
    if API_RESPONSE=$(curl -f -s -X POST "$API_URL" \
        -H "Content-Type: application/json" \
        -d "$TEST_PAYLOAD"); then
        echo -e "${GREEN}✅ API is responding${NC}"
        echo -e "${BLUE}Sample achievement: $(echo "$API_RESPONSE" | grep -o '"[^"]*"' | head -1 | tr -d '"')${NC}"
    else
        echo -e "${RED}❌ API test failed${NC}"
    fi
fi