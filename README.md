# 🏆 Dungeon Achievements Generator

A serverless web application that generates amusing fake achievements in the style of the trolling AI from "Dungeon Crawler Carl". Enter any activity and receive three wickedly creative achievements with copy-to-clipboard functionality.

**🌐 Live Site**: https://d2mpgwz50hual0.cloudfront.net

## Features

- **AI-Generated Achievements** - Powered by AWS Bedrock (Claude 3 Haiku)
- **Multiple Styles** - Default, corporate, funny, nice, or mean variations
- **Local Storage** - Recent achievements persist across browser sessions
- **Copy-to-Clipboard** - Easy sharing of your favorite achievements
- **Responsive Design** - Game-themed dark UI with mobile optimization
- **Serverless Architecture** - Zero maintenance, sub-$5/month operation

## Quick Start

### Local Development

```bash
# Install dependencies
npm install

# Start development server with hot reload
npm run dev

# Visit http://localhost:3000
```

### Deployment

```bash
# Full deployment (5-10 minutes) - infrastructure + code
npm run deploy              # Deploy to dev environment
npm run deploy:prod         # Deploy to production

# Fast deployment (30-60 seconds) - Lambda code only
npm run deploy:fast         # Fast deploy to dev
npm run deploy:fast:prod    # Fast deploy to production
```

## Development Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start hot-reload dev server (localhost:3000) |
| `npm run dev:sam` | Use SAM local (slower but AWS-accurate) |
| `npm run test:prompts` | Interactive prompt testing utility |
| `npm run build` | Build TypeScript |
| `npm run deploy` | Full deploy to dev (5-10 min, includes infrastructure) |
| `npm run deploy:prod` | Full deploy to production |
| `npm run deploy:fast` | Fast deploy to dev (30-60 sec, code only) |
| `npm run deploy:fast:prod` | Fast deploy to production |
| `npm run logs` | Follow dev environment logs |
| `npm run logs:prod` | Follow production logs |
| `npm run clean` | Clean build artifacts |

## Architecture

**Minimal AWS Serverless Stack:**
- **Single TypeScript Lambda** - Serves frontend HTML and handles `/generate` API calls
- **AWS Bedrock** - Claude 3 Haiku for achievement generation
- **CloudFront Distribution** - Global CDN for performance
- **API Gateway** - RESTful routing to Lambda function

**Key Design Decisions:**
- No database required - achievements stored in browser LocalStorage
- Single Lambda handles both static serving and API to minimize cold starts
- Vanilla HTML/CSS/JS frontend for zero build complexity
- AWS SAM for infrastructure-as-code deployment

## Project Structure

```
dungeon-achievements/
├── src/
│   ├── index.html          # Single-page frontend with embedded CSS/JS
│   └── lambda.ts           # Dual-purpose Lambda (static + API handler)
├── template.yaml           # SAM CloudFormation template
├── deploy.sh              # One-command deployment script
├── dev-server.js          # Local development server with hot reload
├── prompt-tester.js       # Interactive prompt testing utility
└── .env.example           # Environment configuration template
```

## Local Development Features

### Hot-Reload Dev Server
- Automatic TypeScript compilation on each request
- Simulates Lambda environment locally
- CORS enabled for frontend development
- Colored logging for easy debugging

### Prompt Testing Utility
Test different achievement styles without AWS calls:

```bash
# Interactive mode
npm run test:prompts

# Command line mode
node prompt-tester.js "made coffee" funny
node prompt-tester.js "attended meeting" corporate
```

### Environment Configuration
Copy `.env.example` to `.env.local` and customize:

```bash
# AWS Configuration
AWS_REGION=us-west-2
AWS_PROFILE=kibler
BEDROCK_MODEL_ID=anthropic.claude-3-haiku-20240307-v1:0
PORT=3000

# Cloudflare Configuration (optional - for custom domains)
CLOUDFLARE_API_TOKEN=your_cloudflare_api_token_here
CLOUDFLARE_ZONE_ID=your_zone_id_for_carlkibler_com
```

## Deployment Requirements

- **AWS CLI** configured with appropriate permissions
- **SAM CLI** installed (`brew install aws-sam-cli`)
- **Node.js 18+** for TypeScript compilation
- **Bedrock model access** in target region (us-west-2)

The deployment script defaults to:
- **Profile**: `kibler` (set `AWS_PROFILE` to override)
- **Environment**: `dev` (pass `prod` as argument)
- **Region**: `us-west-2`

### Custom Domain Setup (Optional)

The deployment automatically configures custom domains via Cloudflare if credentials are provided:

- **Production**: `achievements.carlkibler.com`
- **Development**: `achievements.dev.carlkibler.com`

**Setup Steps:**
1. Get your Cloudflare API token from [Cloudflare Dashboard](https://dash.cloudflare.com/profile/api-tokens)
2. Find your zone ID for `carlkibler.com` 
3. Add both to your `.env.local` file
4. Deploy normally - DNS will be configured automatically

```bash
# The deploy script will automatically:
./deploy.sh prod    # Sets up achievements.carlkibler.com
./deploy.sh dev     # Sets up achievements.dev.carlkibler.com
```

### Deployment Strategy

**Use Fast Deployment (`--fast`) for:**
- Code changes (Lambda function updates)
- Prompt modifications 
- Bug fixes and feature updates
- Iterative development (30-60 seconds)

**Use Full Deployment (default) for:**
- First-time setup
- Infrastructure changes (SAM template updates)
- Environment variable changes
- Cloudflare domain configuration (5-10 minutes)

```bash
# Development workflow example:
./deploy.sh dev              # Initial full deployment
./deploy.sh --fast dev       # Fast updates during development
./deploy.sh prod             # Full production deployment
./deploy.sh --fast prod      # Fast production updates
```

## Adding New Features

**Style Variations**: Extend the `stylePrompts` object in `lambda.ts:125` and add UI controls

**Different AI Models**: Change `BEDROCK_MODEL_ID` in `template.yaml` or environment variables

**Custom Domain**: Add Route 53 and certificate resources to SAM template

**Analytics**: Add CloudWatch custom metrics or integrate third-party services

## Cost Estimation

- **CloudFront**: ~$0.50/month for moderate traffic
- **Lambda**: Nearly free (first 1M requests free)
- **API Gateway**: ~$3.50 per million requests  
- **Bedrock**: ~$0.25 per 1K input tokens (Claude Haiku)

**Total**: <$5/month for moderate usage

## Security

- No API keys exposed in frontend code
- IAM roles follow least-privilege principle
- CORS configured for safe cross-origin requests
- No sensitive data stored or transmitted

## License

MIT