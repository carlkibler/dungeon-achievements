#!/usr/bin/env node

/**
 * External Prompt Testing Utility
 * 
 * Test prompts loaded from external files
 * Usage: node test-prompts.js [activity] [style]
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

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

// Simple prompt loader (mirrors TypeScript version)
class SimplePromptLoader {
    constructor() {
        this.promptsDir = path.join(__dirname, 'prompts');
        this.config = this.loadConfig();
        this.baseTemplate = this.loadBaseTemplate();
    }

    loadConfig() {
        const configPath = path.join(this.promptsDir, 'config.json');
        try {
            const configData = fs.readFileSync(configPath, 'utf8');
            return JSON.parse(configData);
        } catch (error) {
            log('❌ Failed to load prompt config', 'red');
            throw error;
        }
    }

    loadBaseTemplate() {
        const templatePath = path.join(this.promptsDir, this.config.baseTemplate);
        try {
            return fs.readFileSync(templatePath, 'utf8');
        } catch (error) {
            log('❌ Failed to load base template', 'red');
            throw error;
        }
    }

    loadStyleInstruction(style) {
        // Check standard styles first
        let styleConfig = this.config.styles[style];
        
        // If not found, check experimental styles
        if (!styleConfig && this.config.experimental) {
            styleConfig = this.config.experimental[style];
        }

        if (!styleConfig) {
            log(`⚠️ Style '${style}' not found, using default`, 'yellow');
            styleConfig = this.config.styles.default;
        }

        const stylePath = path.join(this.promptsDir, styleConfig.file);
        try {
            const styleContent = fs.readFileSync(stylePath, 'utf8');
            // Extract content after the header
            const contentMatch = styleContent.match(/^#[^\n]*\n\n([\s\S]+)/);
            return contentMatch ? contentMatch[1].trim() : styleContent.trim();
        } catch (error) {
            log(`❌ Failed to load style '${style}'`, 'red');
            return 'Write in the sarcastic, trolling style of the AI from "Dungeon Crawler Carl"';
        }
    }

    generatePrompt(activity, style = 'default') {
        const styleInstruction = this.loadStyleInstruction(style);
        
        return this.baseTemplate
            .replace('{{STYLE_INSTRUCTION}}', styleInstruction)
            .replace('{{ACTIVITY}}', activity);
    }

    getAvailableStyles() {
        const styles = {};
        
        // Add standard styles
        Object.entries(this.config.styles).forEach(([key, config]) => {
            styles[key] = { name: config.name, description: config.description };
        });

        // Add experimental styles
        if (this.config.experimental) {
            Object.entries(this.config.experimental).forEach(([key, config]) => {
                styles[key] = { name: config.name, description: config.description };
            });
        }

        return styles;
    }
}

// Interactive prompt tester
function runInteractiveMode() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    log('🏆 External Prompt Tester', 'bright');
    log('🎮 Testing prompts from external files', 'cyan');
    
    const loader = new SimplePromptLoader();
    const styles = loader.getAvailableStyles();
    
    log('\n📋 Available Styles:', 'yellow');
    Object.entries(styles).forEach(([key, config]) => {
        const experimental = loader.config.experimental && loader.config.experimental[key] ? ' (experimental)' : '';
        log(`  ${key}: ${config.name}${experimental}`, 'white');
        log(`    ${config.description}`, 'dim');
    });
    
    log('\n🚪 Type "exit" to quit', 'dim');
    log('🔄 Type "reload" to reload prompt files\n', 'dim');

    function askForInput() {
        rl.question(colors.blue + 'Activity: ' + colors.reset, (activity) => {
            if (activity.toLowerCase() === 'exit') {
                log('\n👋 Happy prompt testing!', 'green');
                rl.close();
                return;
            }

            if (activity.toLowerCase() === 'reload') {
                try {
                    // Recreate loader to reload files
                    const newLoader = new SimplePromptLoader();
                    Object.assign(loader, newLoader);
                    log('🔄 Prompts reloaded!', 'green');
                } catch (error) {
                    log('❌ Failed to reload prompts', 'red');
                }
                askForInput();
                return;
            }

            if (!activity.trim()) {
                log('❌ Please enter an activity', 'red');
                askForInput();
                return;
            }

            rl.question(colors.magenta + 'Style: ' + colors.reset, (style) => {
                const selectedStyle = style.trim() || 'default';

                log(`\n📝 Generated prompt for "${activity}" in ${selectedStyle} style:\n`, 'cyan');

                try {
                    const prompt = loader.generatePrompt(activity, selectedStyle);
                    log(prompt, 'white');
                } catch (error) {
                    log(`❌ Error generating prompt: ${error.message}`, 'red');
                }

                log('\n' + '─'.repeat(80), 'dim');
                askForInput();
            });
        });
    }

    askForInput();
}

// Command line mode
function runCommandLineMode(activity, style = 'default') {
    log('🏆 External Prompt Tester', 'bright');
    log(`🎯 Activity: "${activity}"`, 'blue');
    log(`🎨 Style: ${style}`, 'magenta');
    log('', 'reset');

    try {
        const loader = new SimplePromptLoader();
        const prompt = loader.generatePrompt(activity, style);
        log(prompt, 'white');
    } catch (error) {
        log(`❌ Error: ${error.message}`, 'red');
    }
    
    log('', 'reset');
    log('💡 Tip: Run without arguments for interactive mode', 'dim');
}

// Show usage
function showUsage() {
    log('🏆 External Prompt Tester', 'bright');
    log('', 'reset');
    log('Usage:', 'yellow');
    log('  node test-prompts.js                           # Interactive mode', 'white');
    log('  node test-prompts.js "activity" [style]       # Command line mode', 'white');
    log('', 'reset');
    log('Examples:', 'yellow');
    log('  node test-prompts.js                          # Interactive', 'dim');
    log('  node test-prompts.js "made coffee"            # Default style', 'dim');
    log('  node test-prompts.js "attended meeting" pirate # Pirate style', 'dim');
}

// Main execution
function main() {
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
        runCommandLineMode(activity, style);
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