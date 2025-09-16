import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { fromIni } from '@aws-sdk/credential-provider-ini';
import { promptLoader } from './prompt-loader';
import * as fs from 'fs';
import * as path from 'path';

// Configure Bedrock client with proper credentials for local development
const createBedrockClient = () => {
    const region = process.env.AWS_REGION || 'us-west-2';
    
    // If we're in local development and have a profile specified, use it
    if (process.env.NODE_ENV === 'development' && process.env.AWS_PROFILE) {
        return new BedrockRuntimeClient({
            region,
            credentials: fromIni({ profile: process.env.AWS_PROFILE })
        });
    }
    
    // Otherwise use default credential chain (works in Lambda)
    return new BedrockRuntimeClient({ region });
};

const bedrockClient = createBedrockClient();

const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-haiku-20240307-v1:0';

// Debug logging utility
const DEBUG = process.env.DEBUG === '1' || process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

function debug(message: string, data?: any) {
    if (DEBUG) {
        console.log(`[DEBUG] ${message}`);
        if (data !== undefined) {
            console.log('[DEBUG] Data:', JSON.stringify(data, null, 2));
        }
    }
}

interface GenerateRequest {
    activity: string;
    style?: 'default' | 'corporate' | 'funny' | 'nice' | 'mean';
}

interface Achievement {
    title: string;
    description: string;
    reward: string;
}

interface BedrockResponse {
    content: Array<{
        text: string;
    }>;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    debug('Handler invoked', {
        httpMethod: event.httpMethod,
        path: event.path,
        hasBody: !!event.body,
        bodyLength: event.body?.length,
        userAgent: event.headers?.['User-Agent'],
        sourceIp: event.requestContext?.identity?.sourceIp
    });
    
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    // Handle OPTIONS preflight request
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'OK' })
        };
    }

    // Serve static frontend
    if (event.httpMethod === 'GET' && (event.path === '/' || event.path === '/index.html')) {
        try {
            const htmlPath = path.join(__dirname, 'index.html');
            const htmlContent = fs.readFileSync(htmlPath, 'utf8');
            
            return {
                statusCode: 200,
                headers: {
                    ...corsHeaders,
                    'Content-Type': 'text/html',
                    'Cache-Control': 'public, max-age=3600'
                },
                body: htmlContent
            };
        } catch (error) {
            console.error('Error serving HTML:', error);
            return {
                statusCode: 500,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'Failed to serve frontend' })
            };
        }
    }

    // Handle achievement generation
    if (event.httpMethod === 'POST' && event.path === '/generate') {
        debug('Processing /generate request');
        
        try {
            if (!event.body) {
                debug('No request body provided');
                return {
                    statusCode: 400,
                    headers: corsHeaders,
                    body: JSON.stringify({ error: 'Request body is required' })
                };
            }

            debug('Raw request body:', event.body);
            const request: GenerateRequest = JSON.parse(event.body);
            debug('Parsed request:', request);
            
            if (!request.activity || request.activity.trim().length === 0) {
                debug('Activity is empty or missing');
                return {
                    statusCode: 400,
                    headers: corsHeaders,
                    body: JSON.stringify({ error: 'Activity is required' })
                };
            }

            // Rate limiting: simple check based on timestamp
            const userIP = event.requestContext.identity.sourceIp;
            const now = Date.now();
            debug('Rate limiting check', { userIP, timestamp: now });
            
            // Basic rate limiting could be enhanced with DynamoDB
            // For now, we'll rely on Lambda concurrency limits

            debug('Calling generateAchievements', { 
                activity: request.activity, 
                style: request.style || 'default' 
            });
            const achievements = await generateAchievements(request.activity, request.style || 'default');
            debug('Generated achievements:', achievements);

            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({
                    achievements,
                    timestamp: new Date().toISOString()
                })
            };

        } catch (error) {
            console.error('Error generating achievements:', error);
            debug('Error details:', {
                message: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined,
                type: typeof error,
                error: error
            });
            
            return {
                statusCode: 500,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    error: 'Failed to generate achievements',
                    message: error instanceof Error ? error.message : 'Unknown error'
                })
            };
        }
    }

    // 404 for any other routes
    return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Not Found' })
    };
};

async function generateAchievements(activity: string, style: string): Promise<Achievement[]> {
    debug('generateAchievements called', { activity, style });
    
    // Use external prompt loader for flexible prompt management
    const prompt = promptLoader.generatePrompt(activity, style);
    debug('Generated prompt:', prompt);

    try {
        const requestBody = {
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 1000,
            temperature: 0.9,      // Higher creativity (0.0-1.0, default 0.5)
            top_p: 0.9,           // More diverse responses (0.0-1.0, default 0.7)
            messages: [
                {
                    role: "user",
                    content: prompt
                }
            ]
        };
        
        debug('Bedrock request body:', requestBody);
        
        const command = new InvokeModelCommand({
            modelId: BEDROCK_MODEL_ID,
            body: JSON.stringify(requestBody)
        });
        
        debug('Sending request to Bedrock', { modelId: BEDROCK_MODEL_ID });

        const response = await bedrockClient.send(command);
        debug('Bedrock response received', { 
            statusCode: response.$metadata?.httpStatusCode,
            requestId: response.$metadata?.requestId
        });
        
        const responseBody = JSON.parse(new TextDecoder().decode(response.body)) as BedrockResponse;
        debug('Parsed Bedrock response:', responseBody);
        
        const generatedText = responseBody.content[0]?.text || '';
        debug('Generated text from Bedrock:', generatedText);
        
        // Parse the JSON achievements from the response
        const achievements = parseJsonAchievements(generatedText);
        debug('Parsed achievements:', achievements);
        
        // Fallback achievements if parsing fails
        if (achievements.length === 0) {
            debug('No achievements parsed, using fallback');
            return [
                {
                    title: `🤖 Achievement Unlocked: Basic Achiever`,
                    description: `You did "${activity}" and somehow survived the experience. Congratulations, I suppose.`,
                    reward: `A participation trophy made of recyclable disappointment.`
                },
                {
                    title: `📝 Achievement Unlocked: Effort Acknowledged`,
                    description: `The universe has registered your attempt at "${activity}" in its cosmic ledger of mediocrity.`,
                    reward: `One (1) gold star sticker, slightly used.`
                },
                {
                    title: `⚡ Achievement Unlocked: Activity Completed`,
                    description: `You have successfully converted time and energy into the completion of "${activity}". Revolutionary.`,
                    reward: `The knowledge that time is indeed a flat circle.`
                }
            ];
        }

        debug('Returning achievements:', achievements);
        return achievements;

    } catch (error) {
        console.error('Error calling Bedrock:', error);
        debug('Bedrock error details:', {
            message: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
            name: error instanceof Error ? error.name : undefined,
            code: (error as any)?.code,
            statusCode: (error as any)?.$metadata?.httpStatusCode,
            requestId: (error as any)?.$metadata?.requestId
        });
        
        // Fallback achievements for errors
        return [
            {
                title: `💥 Achievement Unlocked: Error Handler Extraordinaire`,
                description: `You managed to break the achievement generator while doing "${activity}". That's actually impressive.`,
                reward: `A certificate of chaos, signed by our confused servers.`
            },
            {
                title: `🔥 Achievement Unlocked: System Breaker`,
                description: `Your activity "${activity}" was so unprecedented that it crashed our AI. Achievement unlocked by accident.`,
                reward: `The admiration of our debugging team and a free coffee.`
            },
            {
                title: `🌀 Achievement Unlocked: Chaos Creator`,
                description: `The mere act of "${activity}" has caused ripples in the space-time continuum of our servers. Well done.`,
                reward: `A small tear in reality that you can keep as a souvenir.`
            }
        ];
    }
}

function parseJsonAchievements(text: string): Achievement[] {
    debug('Parsing JSON achievements from text:', text);
    
    try {
        // Clean up the text - remove any markdown code blocks
        let cleanText = text.trim();
        
        // Remove markdown code blocks if present
        cleanText = cleanText.replace(/^```json\s*\n?/, '').replace(/\n?```$/, '');
        cleanText = cleanText.replace(/^```\s*\n?/, '').replace(/\n?```$/, '');
        
        // Try to find JSON array in the text
        const jsonMatch = cleanText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            cleanText = jsonMatch[0];
        }
        
        debug('Cleaned text for parsing:', cleanText);
        
        const achievements: Achievement[] = JSON.parse(cleanText);
        
        // Validate the structure
        if (!Array.isArray(achievements)) {
            throw new Error('Response is not an array');
        }
        
        const validAchievements = achievements
            .filter((ach): ach is Achievement => 
                ach && 
                typeof ach === 'object' &&
                typeof ach.title === 'string' &&
                typeof ach.description === 'string' &&
                typeof ach.reward === 'string'
            )
            .slice(0, 3); // Limit to 3
        
        debug('Valid achievements parsed:', validAchievements);
        return validAchievements;
        
    } catch (error) {
        console.error('Error parsing JSON achievements:', error);
        debug('Failed to parse JSON, raw text:', text);
        
        // Fallback: try to parse as old format if JSON parsing fails
        return parseOldFormatAchievements(text);
    }
}

function parseOldFormatAchievements(text: string): Achievement[] {
    debug('Attempting to parse old format achievements');
    
    const achievements: Achievement[] = [];
    
    // Split by double newlines to separate achievement blocks
    const blocks = text.split(/\n\s*\n/);
    
    for (const block of blocks) {
        const trimmedBlock = block.trim();
        if (!trimmedBlock) continue;
        
        const lines = trimmedBlock.split('\n').map(line => line.trim());
        
        let title = '';
        let description = '';
        let reward = '';
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Look for title line with "Achievement Unlocked"
            if (line.match(/Achievement\s+Unlocked:/i)) {
                title = line;
            }
            // Look for reward line
            else if (line.toLowerCase().startsWith('reward:')) {
                reward = line;
            }
            // Everything else is description
            else if (line && !title.includes('Achievement Unlocked')) {
                // If we haven't found a title yet, this might be it
                if (!title) {
                    title = line;
                } else {
                    description = description ? `${description} ${line}` : line;
                }
            } else if (line && title && !reward) {
                description = description ? `${description} ${line}` : line;
            }
        }
        
        if (title) {
            achievements.push({
                title: title || '🤖 Achievement Unlocked: Unknown',
                description: description || 'Something was accomplished.',
                reward: reward || 'Reward: The satisfaction of achievement.'
            });
        }
    }
    
    debug('Parsed old format achievements:', achievements);
    return achievements.slice(0, 3);
}