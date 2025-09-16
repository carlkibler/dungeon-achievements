#!/usr/bin/env node

/**
 * Local Development Server for Dungeon Achievements Generator
 * 
 * Simulates the Lambda environment locally with hot reload
 * Run: npm run dev
 */

// Load environment variables from .env.local
require('dotenv').config({ path: '.env.local' });

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PORT = process.env.PORT || 3000;
const DIST_DIR = path.join(__dirname, 'dist');
const SRC_DIR = path.join(__dirname, 'src');

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

// Recursively copy directory
function copyDirectory(source, dest) {
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }
    
    const items = fs.readdirSync(source);
    for (const item of items) {
        const sourcePath = path.join(source, item);
        const destPath = path.join(dest, item);
        
        if (fs.statSync(sourcePath).isDirectory()) {
            copyDirectory(sourcePath, destPath);
        } else {
            fs.copyFileSync(sourcePath, destPath);
        }
    }
}

// Build TypeScript and copy files
function build() {
    try {
        log('🔨 Building TypeScript...', 'yellow');
        execSync('npm run build', { stdio: 'pipe' });
        
        // Copy HTML file
        const htmlSource = path.join(SRC_DIR, 'index.html');
        const htmlDest = path.join(DIST_DIR, 'index.html');
        if (fs.existsSync(htmlSource)) {
            fs.copyFileSync(htmlSource, htmlDest);
        }
        
        // Copy prompts directory
        const promptsSource = path.join(__dirname, 'prompts');
        const promptsDest = path.join(DIST_DIR, 'prompts');
        if (fs.existsSync(promptsSource)) {
            copyDirectory(promptsSource, promptsDest);
        }
        
        log('✅ Build complete', 'green');
        return true;
    } catch (error) {
        log('❌ Build failed:', 'red');
        log(error.message, 'red');
        return false;
    }
}

// Mock AWS environment for local development
const mockEvent = (method, path, body = null) => ({
    httpMethod: method,
    path: path,
    body: body,
    headers: {
        'Content-Type': 'application/json'
    },
    requestContext: {
        identity: {
            sourceIp: '127.0.0.1'
        }
    }
});

// Load and execute the Lambda handler
function loadHandler() {
    try {
        // Clear require cache to enable hot reload
        const handlerPath = path.join(DIST_DIR, 'lambda.js');
        delete require.cache[require.resolve(handlerPath)];
        
        const { handler } = require(handlerPath);
        return handler;
    } catch (error) {
        log('❌ Failed to load handler:', 'red');
        log(error.message, 'red');
        return null;
    }
}

// Create HTTP server
const server = http.createServer(async (req, res) => {
    const startTime = Date.now();
    
    // Enable CORS for local development
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    
    // Collect request body
    let body = '';
    req.on('data', chunk => {
        body += chunk.toString();
    });
    
    req.on('end', async () => {
        try {
            // Build on each request for hot reload
            if (!build()) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Build failed' }));
                return;
            }
            
            // Load handler
            const handler = loadHandler();
            if (!handler) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Handler load failed' }));
                return;
            }
            
            // Create mock event
            const event = mockEvent(req.method, req.url, body || null);
            
            // Call Lambda handler
            const result = await handler(event);
            
            // Send response
            res.writeHead(result.statusCode, result.headers || {});
            res.end(result.body);
            
            // Log request
            const duration = Date.now() - startTime;
            const statusColor = result.statusCode >= 400 ? 'red' : 'green';
            log(`${req.method} ${req.url} - ${result.statusCode} (${duration}ms)`, statusColor);
            
        } catch (error) {
            log(`❌ Request error: ${error.message}`, 'red');
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                error: 'Internal server error',
                message: error.message 
            }));
        }
    });
});

// Start server
server.listen(PORT, () => {
    log('🏆 Dungeon Achievements Generator - Local Dev Server', 'bright');
    log(`🌐 Server running at http://localhost:${PORT}`, 'cyan');
    log(`📁 Serving from ${DIST_DIR}`, 'blue');
    log('🔄 Hot reload enabled', 'yellow');
    log('📝 Logs will appear below...', 'magenta');
    log('---', 'reset');
    
    // Initial build
    build();
});

// Graceful shutdown
process.on('SIGINT', () => {
    log('\n🛑 Shutting down dev server...', 'yellow');
    server.close(() => {
        log('✅ Server stopped', 'green');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    log('\n🛑 Received SIGTERM, shutting down...', 'yellow');
    server.close(() => {
        log('✅ Server stopped', 'green');
        process.exit(0);
    });
});