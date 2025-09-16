#!/bin/bash

# Dungeon Achievements Generator - Deployment Script
# Usage: ./deploy.sh [environment] [region]
# Example: ./deploy.sh prod us-west-2
# Uses 'kibler' profile by default (set AWS_PROFILE to override)

set -e  # Exit on any error

# Parse arguments
FAST_DEPLOY=false
ENVIRONMENT="dev"
AWS_REGION="us-west-2"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --fast)
            FAST_DEPLOY=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS] [environment] [region]"
            echo ""
            echo "OPTIONS:"
            echo "  --fast    Fast deployment (Lambda code only, ~30-60 seconds)"
            echo "  --help    Show this help message"
            echo ""
            echo "EXAMPLES:"
            echo "  $0                    # Full deploy to dev"
            echo "  $0 --fast            # Fast deploy to dev"
            echo "  $0 prod               # Full deploy to prod"
            echo "  $0 --fast prod        # Fast deploy to prod"
            exit 0
            ;;
        *)
            if [ -z "$ENVIRONMENT_SET" ]; then
                ENVIRONMENT="$1"
                ENVIRONMENT_SET=true
            elif [ -z "$REGION_SET" ]; then
                AWS_REGION="$1"
                REGION_SET=true
            else
                echo "Unknown argument: $1"
                exit 1
            fi
            shift
            ;;
    esac
done

# If fast deploy requested, delegate to fast-deploy.sh
if [ "$FAST_DEPLOY" = true ]; then
    echo "🚀 Delegating to fast deployment..."
    exec ./fast-deploy.sh "$ENVIRONMENT"
fi

# Configuration for full deployment
AWS_PROFILE=${AWS_PROFILE:-kibler}
STACK_NAME="dungeon-achievements-${ENVIRONMENT}"
S3_BUCKET="dungeon-achievements-sam-artifacts-${ENVIRONMENT}-$(date +%s)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🏆 Dungeon Achievements Generator Deployment${NC}"
echo -e "${BLUE}Profile: ${AWS_PROFILE}${NC}"
echo -e "${BLUE}Environment: ${ENVIRONMENT}${NC}"
echo -e "${BLUE}Region: ${AWS_REGION}${NC}"
echo -e "${BLUE}Stack: ${STACK_NAME}${NC}"
echo ""

# Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"

if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ AWS CLI is not installed or not in PATH${NC}"
    exit 1
fi

if ! command -v sam &> /dev/null; then
    echo -e "${RED}❌ AWS SAM CLI is not installed or not in PATH${NC}"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm is not installed or not in PATH${NC}"
    exit 1
fi

# Set AWS profile if specified
if [ "$AWS_PROFILE" != "" ]; then
    export AWS_PROFILE="$AWS_PROFILE"
fi

# Check AWS credentials
aws sts get-caller-identity > /dev/null 2>&1 || {
    echo -e "${RED}❌ AWS credentials not configured or invalid${NC}"
    echo -e "${YELLOW}💡 Tip: Make sure profile '${AWS_PROFILE}' exists and is configured${NC}"
    exit 1
}

echo -e "${GREEN}✅ Prerequisites check passed${NC}"
echo ""

# Install dependencies
echo -e "${YELLOW}Installing dependencies...${NC}"
npm install

# Build TypeScript
echo -e "${YELLOW}Building TypeScript...${NC}"
npm run build

# Copy static files to dist directory
echo -e "${YELLOW}Copying static files...${NC}"
cp src/index.html dist/
cp -r prompts dist/

# Create S3 bucket for SAM artifacts if it doesn't exist
echo -e "${YELLOW}Setting up deployment bucket...${NC}"
if ! aws s3api head-bucket --bucket "$S3_BUCKET" --region "$AWS_REGION" 2>/dev/null; then
    echo "Creating S3 bucket: $S3_BUCKET"
    if [ "$AWS_REGION" = "us-east-1" ]; then
        aws s3api create-bucket --bucket "$S3_BUCKET" --region "$AWS_REGION"
    else
        aws s3api create-bucket --bucket "$S3_BUCKET" --region "$AWS_REGION" --create-bucket-configuration LocationConstraint="$AWS_REGION"
    fi
    
    # Enable versioning for better artifact management
    aws s3api put-bucket-versioning --bucket "$S3_BUCKET" --versioning-configuration Status=Enabled
fi

# Deploy with SAM
echo -e "${YELLOW}Deploying with SAM...${NC}"
sam deploy \
    --template-file template.yaml \
    --stack-name "$STACK_NAME" \
    --s3-bucket "$S3_BUCKET" \
    --capabilities CAPABILITY_IAM \
    --region "$AWS_REGION" \
    --parameter-overrides \
        Environment="$ENVIRONMENT" \
    --no-fail-on-empty-changeset

# Get outputs
echo -e "${YELLOW}Getting deployment information...${NC}"
WEBSITE_URL=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$AWS_REGION" \
    --query 'Stacks[0].Outputs[?OutputKey==`WebsiteURL`].OutputValue' \
    --output text)

API_URL=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$AWS_REGION" \
    --query 'Stacks[0].Outputs[?OutputKey==`ApiGatewayURL`].OutputValue' \
    --output text)

FUNCTION_NAME=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$AWS_REGION" \
    --query 'Stacks[0].Outputs[?OutputKey==`FunctionName`].OutputValue' \
    --output text)

# Success message
echo ""
echo -e "${GREEN}🎉 Deployment successful!${NC}"
echo ""
echo -e "${BLUE}📋 Deployment Information:${NC}"
echo -e "${GREEN}Website URL (CloudFront): ${WEBSITE_URL}${NC}"
echo -e "${GREEN}API URL (Direct): ${API_URL}${NC}"
echo -e "${GREEN}Lambda Function: ${FUNCTION_NAME}${NC}"
echo ""

# Configure Cloudflare DNS (if credentials are available)
if [ -f ".env.local" ] && grep -q "CLOUDFLARE_API_TOKEN" .env.local; then
    echo -e "${YELLOW}Configuring Cloudflare DNS...${NC}"
    
    # Load environment variables for Cloudflare
    export $(grep -v '^#' .env.local | xargs)
    
    if [ -n "$CLOUDFLARE_API_TOKEN" ] && [ -n "$CLOUDFLARE_ZONE_ID" ]; then
        # Extract CloudFront domain from URL
        CLOUDFRONT_DOMAIN=$(echo "$WEBSITE_URL" | sed 's|https\?://||' | cut -d'/' -f1)
        
        # Run Cloudflare DNS configuration
        if ./cloudflare-dns.sh "$ENVIRONMENT" "$CLOUDFRONT_DOMAIN"; then
            echo -e "${GREEN}✅ Cloudflare DNS configured successfully${NC}"
            if [ "$ENVIRONMENT" = "prod" ]; then
                CUSTOM_DOMAIN="achievements.carlkibler.com"
            else
                CUSTOM_DOMAIN="achievements.dev.carlkibler.com"
            fi
            echo -e "${GREEN}🌐 Custom Domain: https://${CUSTOM_DOMAIN}${NC}"
        else
            echo -e "${YELLOW}⚠️ Cloudflare DNS configuration failed (continuing anyway)${NC}"
        fi
    else
        echo -e "${YELLOW}⚠️ Cloudflare credentials not found in .env.local${NC}"
        echo -e "${YELLOW}💡 Add CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID to enable custom domains${NC}"
    fi
else
    echo -e "${YELLOW}💡 Cloudflare DNS configuration skipped${NC}"
    echo -e "${YELLOW}   Add CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID to .env.local to enable custom domains${NC}"
fi
echo ""
echo -e "${YELLOW}📝 Next Steps:${NC}"
echo "1. Visit the website URL to test the application"
echo "2. The CloudFront distribution may take 5-10 minutes to fully propagate"
echo "3. Monitor logs with: aws logs tail /aws/lambda/${FUNCTION_NAME} --follow --region ${AWS_REGION}"
echo ""

# Optional: Open website in browser (macOS)
if [[ "$OSTYPE" == "darwin"* ]]; then
    read -p "Open website in browser? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        open "$WEBSITE_URL"
    fi
fi