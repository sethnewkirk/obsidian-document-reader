import { requestUrl, RequestUrlParam } from 'obsidian';
import { DocumentReaderSettings } from '../settings';

export interface ClaudeResponse {
    id: string;
    type: string;
    role: string;
    content: Array<{
        type: string;
        text: string;
    }>;
    model: string;
    stop_reason: string;
    usage: {
        input_tokens: number;
        output_tokens: number;
    };
}

export interface ClaudeError {
    type: string;
    error: {
        type: string;
        message: string;
    };
}

export class ClaudeApiClient {
    private settings: DocumentReaderSettings;
    private readonly API_URL = 'https://api.anthropic.com/v1/messages';
    private readonly ANTHROPIC_VERSION = '2023-06-01';

    constructor(settings: DocumentReaderSettings) {
        this.settings = settings;
    }

    /**
     * Send a query to Claude and get a response
     * @param prompt The prompt to send to Claude
     * @returns The text response from Claude
     * @throws Error if API key is missing or request fails
     */
    async query(prompt: string): Promise<string> {
        if (!this.settings.claudeApiKey) {
            throw new Error('Claude API key is not configured. Please add your API key in Document Reader settings.');
        }

        const requestBody = {
            model: this.settings.claudeModel,
            max_tokens: 1024,
            messages: [
                {
                    role: 'user',
                    content: prompt
                }
            ]
        };

        const requestOptions: RequestUrlParam = {
            url: this.API_URL,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.settings.claudeApiKey,
                'anthropic-version': this.ANTHROPIC_VERSION
            },
            body: JSON.stringify(requestBody)
        };

        try {
            const response = await requestUrl(requestOptions);

            if (response.status !== 200) {
                const errorData = response.json as ClaudeError;
                throw new Error(
                    `Claude API error (${response.status}): ${errorData.error?.message || 'Unknown error'}`
                );
            }

            const data = response.json as ClaudeResponse;

            if (!data.content || data.content.length === 0) {
                throw new Error('Claude returned an empty response');
            }

            const textContent = data.content.find(c => c.type === 'text');
            if (!textContent) {
                throw new Error('Claude response did not contain text content');
            }

            return textContent.text;
        } catch (error) {
            if (error instanceof Error) {
                // Re-throw our own errors
                if (error.message.includes('Claude API')) {
                    throw error;
                }
                // Wrap network/other errors
                throw new Error(`Failed to communicate with Claude API: ${error.message}`);
            }
            throw new Error('An unexpected error occurred while querying Claude');
        }
    }

    /**
     * Check if the API key is configured
     */
    isConfigured(): boolean {
        return Boolean(this.settings.claudeApiKey);
    }

    /**
     * Update the settings reference (useful when settings change)
     */
    updateSettings(settings: DocumentReaderSettings): void {
        this.settings = settings;
    }
}
