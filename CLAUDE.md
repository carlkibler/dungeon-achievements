# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a serverless web application that generates amusing fake achievements in the style of the trolling AI from "Dungeon Crawler Carl". Users enter any activity and receive three creative achievements with copy-to-clipboard functionality and local storage for recent generations.

## Architecture

**Minimal AWS Serverless Stack:**
- **Single TypeScript Lambda** - Serves frontend HTML and handles `/generate` API calls
- **AWS Bedrock** - Claude 3 Haiku for achievement generation via structured prompts
- **CloudFront Distribution** - Global CDN for performance and caching
- **API Gateway** - RESTful routing to Lambda function

**Key Design Decisions:**
- No database required - achievements stored in browser LocalStorage
- Single Lambda handles both static serving and API to minimize cold starts
- Vanilla HTML/CSS/JS frontend for zero build complexity
- AWS SAM for infrastructure-as-code deployment

## Development Commands

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Local development (requires SAM CLI)
npm run dev

# Deploy to AWS
./deploy.sh [environment] [region]
# Example: ./deploy.sh prod us-east-1

# Clean build artifacts
npm run clean
```

## Project Structure

```
src/
├── index.html      # Single-page frontend with embedded CSS/JS
├── lambda.ts       # Dual-purpose Lambda (static + API handler)
template.yaml       # SAM CloudFormation template
deploy.sh          # One-command deployment script
```

## Key Implementation Details

### Frontend Features
- Game-themed dark UI with gold accents and monospace fonts
- LocalStorage persistence for recent achievements (last 10 entries)
- Copy-to-clipboard with visual feedback
- Responsive design with mobile optimization
- Example activity buttons for quick testing

### Backend Features
- Bedrock integration with structured prompts for consistent style
- Error handling with witty fallback achievements
- CORS support for cross-origin requests
- Simple rate limiting via Lambda concurrency
- Extensible style system (default/corporate/funny/nice/mean)

### AWS Infrastructure
- CloudFront caches static assets globally
- API calls bypass cache for real-time generation
- IAM roles with minimal Bedrock permissions
- Environment-based deployments (dev/prod)

## Adding New Features

**Style Variations**: Extend the `stylePrompts` object in `lambda.ts:99` and add UI controls in the frontend

**Different AI Models**: Change `BEDROCK_MODEL_ID` environment variable in `template.yaml:15`

**Custom Domain**: Add Route 53 and certificate resources to SAM template

**Analytics**: Add CloudWatch custom metrics or integrate third-party services

## Deployment Requirements

- AWS CLI configured with appropriate permissions
- SAM CLI installed
- Node.js 18+ for TypeScript compilation
- Bedrock model access in target region

## Security Considerations

- No API keys exposed in frontend code
- IAM roles follow least-privilege principle
- CORS configured for safe cross-origin requests
- No sensitive data stored or transmitted