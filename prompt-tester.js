#!/usr/bin/env node

/**
 * Prompt Testing Utility for Dungeon Achievements Generator
 * 
 * Test different prompts and styles without deploying to AWS
 * Usage: node prompt-tester.js [activity] [style]
 */

const readline = require('readline');
const path = require('path');
const http = require('http');

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

// Debug logging
const DEBUG = process.env.DEBUG === '1' || process.env.DEBUG === 'true';

function debug(message, data = null) {
    if (DEBUG) {
        console.log(`${colors.dim}[DEBUG] ${message}${colors.reset}`);
        if (data) {
            console.log(`${colors.dim}${JSON.stringify(data, null, 2)}${colors.reset}`);
        }
    }
}

// Mock Bedrock response for local testing
function mockBedrockResponse(activity, style) {
    const mockResponses = {
        default: [
            `Achievement Unlocked - Basic Human Function: You managed to "${activity}" without somehow breaking reality. The AI overlords are... mildly impressed.`,
            `Competency Certificate: Congratulations on completing "${activity}" with the skill level of a reasonably functional adult. Your participation trophy is in the mail.`,
            `Minimal Effort Award: You have successfully demonstrated that "${activity}" is within your limited human capabilities. Please collect your pat on the head at the reception desk.`
        ],
        corporate: [
            `Strategic Initiative Completion: You have successfully leveraged synergistic methodologies to optimize "${activity}" deliverables, driving measurable ROI across all stakeholder touchpoints.`,
            `Best-in-Class Excellence: Your paradigm-shifting approach to "${activity}" demonstrates thought leadership and creates sustainable competitive advantages in the marketplace.`,
            `Agile Transformation Champion: By implementing "${activity}" using cutting-edge frameworks, you've actualized next-generation solutions that scale across the enterprise ecosystem.`
        ],
        funny: [
            `Master of the Obvious: You "${activity}" with the same groundbreaking innovation as discovering that water is wet. Scientists everywhere are baffled by your genius.`,
            `Captain Predictable: Your ability to "${activity}" has shocked absolutely no one, but we're giving you this achievement anyway because we ran out of participation trophies.`,
            `Professional Human Being: Against all odds and despite overwhelming evidence to the contrary, you managed to "${activity}" like a normal person. Medical science cannot explain this miracle.`
        ],
        nice: [
            `Wonderful Work: You took the time to "${activity}" and that's absolutely fantastic! Every small step deserves celebration, and you're doing amazing!`,
            `Gentle Giant: The way you approached "${activity}" shows such care and thoughtfulness. The world is brighter because of people like you who take time to do things well.`,
            `Everyday Hero: By choosing to "${activity}", you've made the world just a little bit better. Thank you for being the kind of person who makes a difference!`
        ],
        mean: [
            `Bare Minimum Survivor: Wow, you managed to "${activity}". Want a cookie? Actually, don't answer that - we both know you probably don't deserve one.`,
            `Crushing Mediocrity: Your performance in "${activity}" was so aggressively average that it actually hurt to watch. But hey, at least you finished, right?`,
            `Professional Disappointment: The fact that "${activity}" took you this long and this much effort says everything we need to know about your life choices.`
        ]
    };

    return mockResponses[style] || mockResponses.default;
}

// Call the actual API endpoint
async function callGenerateAPI(activity, style = 'default', useLocal = false) {
    const apiUrl = useLocal ? 'http://localhost:3000' : process.env.API_URL || 'https://your-api.execute-api.region.amazonaws.com/Prod';
    
    debug(`Making API call to: ${apiUrl}/generate`);
    debug('Request payload:', { activity, style });
    
    const postData = JSON.stringify({ activity, style });
    
    const options = {
        hostname: useLocal ? 'localhost' : new URL(apiUrl).hostname,
        port: useLocal ? 3000 : 443,
        path: '/generate',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    };
    
    if (!useLocal) {
        options.protocol = 'https:';
    }
    
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        
        const req = http.request(options, (res) => {
            debug(`Response status: ${res.statusCode}`);
            debug(`Response headers:`, res.headers);
            
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                const responseTime = Date.now() - startTime;
                debug(`Request completed in ${responseTime}ms`);
                debug('Raw response:', data);
                
                try {
                    const parsed = JSON.parse(data);
                    debug('Parsed response:', parsed);
                    resolve(parsed);
                } catch (error) {
                    debug('JSON parse error:', error.message);
                    reject(new Error(`Failed to parse response: ${error.message}`));
                }
            });
        });
        
        req.on('error', (error) => {
            debug('Request error:', error);
            reject(error);
        });
        
        req.on('timeout', () => {
            debug('Request timeout');
            reject(new Error('Request timeout'));
        });
        
        req.setTimeout(10000); // 10 second timeout
        
        debug('Sending request...');
        req.write(postData);
        req.end();
    });
}

// Test achievement parsing (from lambda.ts)
function parseAchievements(text) {
    const achievements = [];
    
    // Split by lines and look for numbered achievements
    const lines = text.split('\n');
    let currentAchievement = '';
    
    for (const line of lines) {
        const trimmedLine = line.trim();
        
        // Check if line starts with a number (1., 2., 3., etc.)
        const numberMatch = trimmedLine.match(/^(\d+)\.\s*(.+)$/);
        
        if (numberMatch) {
            // Save previous achievement if it exists
            if (currentAchievement) {
                achievements.push(currentAchievement.trim());
            }
            
            // Start new achievement
            currentAchievement = numberMatch[2];
        } else if (trimmedLine && currentAchievement) {
            // Continue building the current achievement
            currentAchievement += ' ' + trimmedLine;
        }
    }
    
    // Don't forget the last achievement
    if (currentAchievement) {
        achievements.push(currentAchievement.trim());
    }
    
    // Clean up achievements and limit to 3
    return achievements
        .map(ach => ach.replace(/^Achievement\s*Title:\s*/i, '').trim())
        .filter(ach => ach.length > 0)
        .slice(0, 3);
}

// Interactive prompt tester
function runInteractiveMode() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    log('🏆 Dungeon Achievements Prompt Tester', 'bright');
    log('🎮 Interactive Mode - Test prompts and styles locally', 'cyan');
    log('💡 Available styles: default, corporate, funny, nice, mean', 'yellow');
    log('🚪 Type "exit" to quit\n', 'dim');

    function askForInput() {
        rl.question(colors.blue + 'Activity: ' + colors.reset, (activity) => {
            if (activity.toLowerCase() === 'exit') {
                log('\n👋 Happy prompt testing!', 'green');
                rl.close();
                return;
            }

            if (!activity.trim()) {
                log('❌ Please enter an activity', 'red');
                askForInput();
                return;
            }

            rl.question(colors.magenta + 'Style (default/corporate/funny/nice/mean): ' + colors.reset, async (style) => {
                const selectedStyle = style.trim() || 'default';
                const validStyles = ['default', 'corporate', 'funny', 'nice', 'mean'];
                
                if (!validStyles.includes(selectedStyle)) {
                    log(`❌ Invalid style. Using 'default'`, 'yellow');
                }

                log(`\n🎲 Generating achievements for "${activity}" in ${selectedStyle} style...\n`, 'cyan');

                try {
                    // Try to call the API first (check if local server is running)
                    const response = await callGenerateAPI(activity, selectedStyle, true);
                    
                    if (response.achievements && response.achievements.length > 0) {
                        response.achievements.forEach((achievement, index) => {
                            log(`${index + 1}. ${achievement}`, 'green');
                        });
                    } else {
                        log('❌ No achievements returned from API', 'red');
                        debug('Full response:', response);
                    }
                } catch (error) {
                    log(`❌ API call failed: ${error.message}`, 'red');
                    log('🔄 Falling back to mock responses...', 'yellow');
                    
                    // Fall back to mock responses
                    const achievements = mockBedrockResponse(activity, selectedStyle);
                    achievements.forEach((achievement, index) => {
                        log(`${index + 1}. ${achievement}`, 'dim');
                    });
                }

                log('\n' + '─'.repeat(80), 'dim');
                askForInput();
            });
        });
    }

    askForInput();
}

// Command line mode
async function runCommandLineMode(activity, style = 'default') {
    log('🏆 Dungeon Achievements Prompt Tester', 'bright');
    log(`🎯 Activity: "${activity}"`, 'blue');
    log(`🎨 Style: ${style}`, 'magenta');
    log('', 'reset');

    try {
        // Try to call the API first (check if local server is running)
        const response = await callGenerateAPI(activity, style, true);
        
        if (response.achievements && response.achievements.length > 0) {
            response.achievements.forEach((achievement, index) => {
                log(`${index + 1}. ${achievement}`, 'green');
            });
        } else {
            log('❌ No achievements returned from API', 'red');
            debug('Full response:', response);
        }
    } catch (error) {
        log(`❌ API call failed: ${error.message}`, 'red');
        log('🔄 Falling back to mock responses...', 'yellow');
        
        // Fall back to mock responses
        const achievements = mockBedrockResponse(activity, style);
        achievements.forEach((achievement, index) => {
            log(`${index + 1}. ${achievement}`, 'dim');
        });
    }
    
    log('', 'reset');
    log('💡 Tip: Run without arguments for interactive mode', 'dim');
}

// Show usage
function showUsage() {
    log('🏆 Dungeon Achievements Prompt Tester', 'bright');
    log('', 'reset');
    log('Usage:', 'yellow');
    log('  node prompt-tester.js                           # Interactive mode', 'white');
    log('  node prompt-tester.js "activity" [style]       # Command line mode', 'white');
    log('', 'reset');
    log('Examples:', 'yellow');
    log('  node prompt-tester.js                          # Interactive', 'dim');
    log('  node prompt-tester.js "made coffee"            # Default style', 'dim');
    log('  node prompt-tester.js "attended meeting" funny # Funny style', 'dim');
    log('', 'reset');
    log('Available styles: default, corporate, funny, nice, mean', 'cyan');
}

// Main execution
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        // Interactive mode
        runInteractiveMode();
    } else if (args.includes('--help') || args.includes('-h')) {
        showUsage();
    } else if (args.length >= 1) {
        // Command line mode
        const activity = args[0];
        const style = args[1] || 'default';
        await runCommandLineMode(activity, style);
    } else {
        showUsage();
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    log('\n\n👋 Goodbye!', 'green');
    process.exit(0);
});

main();