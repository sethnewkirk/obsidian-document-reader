import { DocumentReaderSettings } from '../settings';
import { ClaudeApiClient } from './ClaudeApiClient';

export interface TagGenerationResult {
    tags: string[];
    category: string | null;
}

export class TagGenerator {
    private settings: DocumentReaderSettings;
    private claudeClient: ClaudeApiClient;

    constructor(settings: DocumentReaderSettings, claudeClient: ClaudeApiClient) {
        this.settings = settings;
        this.claudeClient = claudeClient;
    }

    /**
     * Generate hierarchical tags and primary category for the article content
     */
    async generateTags(content: string, frontmatter: Record<string, unknown>): Promise<TagGenerationResult> {
        if (!this.claudeClient.isConfigured()) {
            return { tags: [], category: null };
        }

        // Get existing tags from frontmatter to avoid duplicates
        const existingTags = this.getExistingTags(frontmatter);

        const prompt = this.buildPrompt(content, existingTags);

        try {
            const response = await this.claudeClient.query(prompt);
            return this.parseResponse(response);
        } catch (error) {
            console.error('Failed to generate tags with Claude:', error);
            return { tags: [], category: null };
        }
    }

    /**
     * Build the prompt for tag generation and categorization
     */
    private buildPrompt(content: string, existingTags: string[]): string {
        const tagPrefix = this.settings.tagPrefix;
        const maxTags = this.settings.maxTags;

        let existingTagsNote = '';
        if (existingTags.length > 0) {
            existingTagsNote = `\nThe article already has these tags (avoid duplicating these concepts): ${existingTags.join(', ')}`;
        }

        return `Analyze this article and:
1. Generate ${maxTags} hierarchical tags for categorization
2. Determine the PRIMARY category for filing

For tags:
- Use hierarchical format with "/" separators (e.g., "economics/trade-policy", "technology/ai/machine-learning")
- Tags should be lowercase with hyphens for spaces
- Focus on the main topics, themes, and subject areas
- Be specific but not too narrow${existingTagsNote}
- Each tag should start with the prefix "${tagPrefix}" (I will add it if missing)

For the category:
- Use Title Case
- Choose from these common categories when appropriate:
  Economics, Technology, Politics, Culture, Science, Business, Health, Law, History, Philosophy, Religion, Media, Sports, Arts
- If none fit well, create a new appropriate category name
- Choose the single most appropriate subject area
- Prefer broader categories (e.g., "Technology" over "Machine Learning")

Respond in this exact format:
CATEGORY: [category name]
TAGS:
- tag1
- tag2

Article content (first 4000 characters):
${content.slice(0, 4000)}`;
    }

    /**
     * Parse the Claude response into category and tags
     */
    private parseResponse(response: string): TagGenerationResult {
        const result: TagGenerationResult = {
            tags: [],
            category: null
        };

        // Extract category
        const categoryMatch = response.match(/^CATEGORY:\s*(.+)$/m);
        if (categoryMatch && categoryMatch[1]) {
            const category = categoryMatch[1].trim();
            // Validate category (Title Case, no weird characters)
            if (category.length > 0 && category.length <= 50 && /^[A-Za-z\s&-]+$/.test(category)) {
                result.category = category;
            }
        }

        // Extract tags section
        const tagsMatch = response.match(/TAGS:\s*([\s\S]*?)$/i);
        const tagsSection = tagsMatch ? tagsMatch[1] : response;

        const lines = tagsSection.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);

        for (const line of lines) {
            // Skip the CATEGORY line if it appears in tags section
            if (line.toUpperCase().startsWith('CATEGORY:')) {
                continue;
            }

            // Clean up the tag
            let tag = line
                .replace(/^[-*•]\s*/, '')  // Remove bullet points
                .replace(/^#/, '')          // Remove leading #
                .replace(/^["']|["']$/g, '') // Remove quotes
                .trim()
                .toLowerCase();

            // Skip empty or obviously wrong lines
            if (!tag || tag.length > 100 || (tag.includes(' ') && !tag.includes('/'))) {
                continue;
            }

            // Replace spaces with hyphens
            tag = tag.replace(/\s+/g, '-');

            // Add prefix if not present
            if (!tag.startsWith(this.settings.tagPrefix)) {
                tag = this.settings.tagPrefix + tag;
            }

            // Validate tag format
            if (this.isValidTag(tag)) {
                result.tags.push(tag);
            }

            // Limit to maxTags
            if (result.tags.length >= this.settings.maxTags) {
                break;
            }
        }

        return result;
    }

    /**
     * Check if a tag is valid
     */
    private isValidTag(tag: string): boolean {
        // Must contain only lowercase letters, numbers, hyphens, and slashes
        const validPattern = /^[a-z0-9\-\/]+$/;
        return validPattern.test(tag) && tag.length > 0 && tag.length <= 100;
    }

    /**
     * Extract existing tags from frontmatter
     */
    private getExistingTags(frontmatter: Record<string, unknown>): string[] {
        const tags = frontmatter.tags;

        if (typeof tags === 'string') {
            return [tags];
        }

        if (Array.isArray(tags)) {
            return tags.filter((t): t is string => typeof t === 'string');
        }

        return [];
    }

    /**
     * Update settings reference
     */
    updateSettings(settings: DocumentReaderSettings): void {
        this.settings = settings;
    }
}
