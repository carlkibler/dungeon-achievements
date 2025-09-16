import * as fs from 'fs';
import * as path from 'path';

interface PromptConfig {
    baseTemplate: string;
    styles: Record<string, {
        name: string;
        file: string;
        description: string;
    }>;
    experimental?: Record<string, {
        name: string;
        file: string;
        description: string;
    }>;
}

class PromptLoader {
    private config!: PromptConfig;
    private promptsDir: string;
    private baseTemplate!: string;
    private styleCache: Map<string, string> = new Map();

    constructor(promptsDir?: string) {
        // Default path resolution for different environments
        if (!promptsDir) {
            // In Lambda: __dirname is /var/task, prompts are in /var/task/prompts
            // In development: __dirname is dist/, prompts are in dist/prompts
            const defaultPath = path.join(__dirname, 'prompts');
            
            // Fallback to relative path if default doesn't exist (for development)
            if (fs.existsSync(defaultPath)) {
                this.promptsDir = defaultPath;
            } else {
                this.promptsDir = path.join(__dirname, '../prompts');
            }
        } else {
            this.promptsDir = promptsDir;
        }
        
        this.loadConfig();
        this.loadBaseTemplate();
    }

    private loadConfig(): void {
        const configPath = path.join(this.promptsDir, 'config.json');
        try {
            const configData = fs.readFileSync(configPath, 'utf8');
            this.config = JSON.parse(configData);
        } catch (error) {
            console.error('Failed to load prompt config:', error);
            throw new Error('Prompt configuration not found');
        }
    }

    private loadBaseTemplate(): void {
        const templatePath = path.join(this.promptsDir, this.config.baseTemplate);
        try {
            this.baseTemplate = fs.readFileSync(templatePath, 'utf8');
        } catch (error) {
            console.error('Failed to load base template:', error);
            throw new Error('Base template not found');
        }
    }

    private loadStyleInstruction(style: string): string {
        if (this.styleCache.has(style)) {
            return this.styleCache.get(style)!;
        }

        // Check standard styles first
        let styleConfig = this.config.styles[style];
        
        // If not found, check experimental styles
        if (!styleConfig && this.config.experimental) {
            styleConfig = this.config.experimental[style];
        }

        if (!styleConfig) {
            console.warn(`Style '${style}' not found, using default`);
            styleConfig = this.config.styles.default;
        }

        const stylePath = path.join(this.promptsDir, styleConfig.file);
        try {
            const styleContent = fs.readFileSync(stylePath, 'utf8');
            // Extract content after the header
            const contentMatch = styleContent.match(/^#[^\n]*\n\n([\s\S]+)/);
            const instruction = contentMatch ? contentMatch[1].trim() : styleContent.trim();
            
            this.styleCache.set(style, instruction);
            return instruction;
        } catch (error) {
            console.error(`Failed to load style '${style}':`, error);
            // Fallback to hardcoded default
            const fallback = 'Write in the sarcastic, trolling style of the AI from "Dungeon Crawler Carl"';
            this.styleCache.set(style, fallback);
            return fallback;
        }
    }

    public generatePrompt(activity: string, style: string = 'default'): string {
        const styleInstruction = this.loadStyleInstruction(style);
        
        return this.baseTemplate
            .replace('{{STYLE_INSTRUCTION}}', styleInstruction)
            .replace('{{ACTIVITY}}', activity);
    }

    public getAvailableStyles(): Record<string, { name: string; description: string }> {
        const styles: Record<string, { name: string; description: string }> = {};
        
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

    public reloadCache(): void {
        this.styleCache.clear();
        this.loadBaseTemplate();
        console.log('Prompt cache reloaded');
    }
}

// Export singleton instance
export const promptLoader = new PromptLoader();