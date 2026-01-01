import { App, TFile, TFolder, normalizePath, requestUrl } from 'obsidian';
import { DocumentReaderSettings } from '../settings';
import { ClaudeApiClient } from './ClaudeApiClient';

export interface AuthorLinkResult {
    authorName: string | null;
    authorLink: string | null;
    created: boolean;
}

export interface MultiAuthorLinkResult {
    results: AuthorLinkResult[];
    allAuthorNames: string[];
    allAuthorLinks: string[];
    authorsCreated: number;
}

export class AuthorLinker {
    private app: App;
    private settings: DocumentReaderSettings;
    private claudeClient: ClaudeApiClient;

    constructor(app: App, settings: DocumentReaderSettings, claudeClient: ClaudeApiClient) {
        this.app = app;
        this.settings = settings;
        this.claudeClient = claudeClient;
    }

    /**
     * Split an author string into individual author names
     * Handles formats like:
     * - "John Smith and Jane Doe"
     * - "John Smith, Jane Doe"
     * - "John Smith & Jane Doe"
     * - "John Smith, Jane Doe, and Bob Johnson"
     */
    splitAuthors(authorString: string): string[] {
        if (!authorString || authorString.trim().length === 0) {
            return [];
        }

        let authors = authorString.trim();

        // First, handle "and" as a separator (with surrounding spaces)
        // Replace " and " and " & " with a common delimiter
        authors = authors.replace(/\s+and\s+/gi, ', ');
        authors = authors.replace(/\s+&\s+/g, ', ');

        // Now split on ", " (comma followed by space)
        const parts = authors.split(/,\s+/);

        // Filter out empty strings and trim each author name
        return parts
            .map(name => name.trim())
            .filter(name => name.length > 0);
    }

    /**
     * Link or create author pages for the article
     * Handles multiple authors separated by commas, "and", or "&"
     */
    async linkAuthor(file: TFile, _frontmatter: Record<string, unknown>, content: string): Promise<MultiAuthorLinkResult> {
        const multiResult: MultiAuthorLinkResult = {
            results: [],
            allAuthorNames: [],
            allAuthorLinks: [],
            authorsCreated: 0
        };

        // Step 1: Extract author name from file content directly (parse YAML ourselves)
        // This avoids cache timing issues where metadataCache hasn't updated yet
        let authorString = this.extractAuthorFromContent(content);

        if (!authorString && this.settings.useClaudeForAuthor && this.claudeClient.isConfigured()) {
            authorString = await this.extractWithClaude(content);
        }

        if (!authorString) {
            return multiResult;
        }

        // Step 2: Split into individual authors
        const authorNames = this.splitAuthors(authorString);

        if (authorNames.length === 0) {
            return multiResult;
        }

        // Step 3: Process each author
        for (const rawAuthorName of authorNames) {
            const result = await this.processOneAuthor(rawAuthorName, content);
            multiResult.results.push(result);

            if (result.authorName) {
                multiResult.allAuthorNames.push(result.authorName);
            }
            if (result.authorLink) {
                multiResult.allAuthorLinks.push(result.authorLink);
            }
            if (result.created) {
                multiResult.authorsCreated++;
            }
        }

        return multiResult;
    }

    /**
     * Process a single author: normalize, search, and optionally create page
     */
    private async processOneAuthor(rawAuthorName: string, content: string): Promise<AuthorLinkResult> {
        const result: AuthorLinkResult = {
            authorName: null,
            authorLink: null,
            created: false
        };

        // Normalize the author name
        const authorName = this.normalizeName(rawAuthorName);
        result.authorName = authorName;

        // Search for existing author page
        const existingPage = await this.findAuthorPage(authorName);

        if (existingPage) {
            result.authorLink = `[[${existingPage.basename}]]`;
            return result;
        }

        // Create new author page if enabled
        if (this.settings.createAuthorPages) {
            const newPage = await this.createAuthorPage(authorName, content);
            if (newPage) {
                result.authorLink = `[[${newPage.basename}]]`;
                result.created = true;
            }
        } else {
            // Return the link format even if we didn't create the page
            result.authorLink = `[[${authorName}]]`;
        }

        return result;
    }

    /**
     * Extract author directly from file content by parsing YAML frontmatter
     * This is more reliable than using the cache which may not be updated yet
     */
    private extractAuthorFromContent(content: string): string | null {
        // Match YAML frontmatter
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (!frontmatterMatch) {
            return null;
        }

        const yaml = frontmatterMatch[1];

        // Look for author field - handle various formats
        // author: Name
        // author: "Name"
        // author: 'Name'
        const authorMatch = yaml.match(/^author:\s*["']?([^"'\n]+)["']?\s*$/m);
        if (authorMatch && authorMatch[1]) {
            const author = authorMatch[1].trim();
            // Skip if it's already a wiki link
            if (author.startsWith('[[')) {
                return null;
            }
            return author;
        }

        return null;
    }

    /**
     * Use Claude to extract author name from content
     */
    private async extractWithClaude(content: string): Promise<string | null> {
        const prompt = `Extract the author's full name from this article. Look for bylines, author credits, or signatures.

IMPORTANT: Return ONLY the person's actual name (e.g., "John Smith"). Do NOT return:
- Generic text like "About The Author" or "Written By"
- Website names or publication names
- "UNKNOWN" if you cannot find a specific person's name

If you cannot find a specific person's name, respond with exactly: UNKNOWN

Article content (first 3000 characters):
${content.slice(0, 3000)}`;

        try {
            const response = await this.claudeClient.query(prompt);
            const authorName = response.trim();

            // Reject generic/invalid responses
            if (authorName === 'UNKNOWN' ||
                authorName.length === 0 ||
                authorName.length > 100 ||
                authorName.toLowerCase().includes('about the author') ||
                authorName.toLowerCase().includes('written by') ||
                authorName.toLowerCase() === 'author') {
                return null;
            }

            return authorName;
        } catch (error) {
            console.error('Failed to extract author with Claude:', error);
            return null;
        }
    }

    /**
     * Normalize author name:
     * - Remove "By " prefix
     * - Handle "Last, First" format
     * - Title case
     */
    private normalizeName(name: string): string {
        let normalized = name.trim();

        // Remove common prefixes
        normalized = normalized.replace(/^(by|written by|author:)\s*/i, '');

        // Handle "Last, First" format (but not organization names)
        if (normalized.includes(',')) {
            const parts = normalized.split(',').map(p => p.trim());
            if (parts.length === 2 && parts[0] && parts[1]) {
                // Words that indicate this is NOT a "Last, First" person name
                const orgIndicators = [
                    'association', 'guild', 'foundation', 'institute', 'society',
                    'organization', 'corporation', 'inc', 'llc', 'ltd', 'company',
                    'group', 'committee', 'board', 'council', 'department', 'office'
                ];
                const lowerParts = (parts[0] + ' ' + parts[1]).toLowerCase();
                const isOrganization = orgIndicators.some(word => lowerParts.includes(word));

                // Only flip if it looks like a person name (not an organization)
                if (!isOrganization && (!parts[1].includes(' ') || parts[1].split(' ').length <= 2)) {
                    normalized = `${parts[1]} ${parts[0]}`;
                }
            }
        }

        // Title case
        normalized = normalized
            .split(' ')
            .map(word => {
                if (word.length === 0) return word;
                // Preserve all-caps initials like "J.K."
                if (word.length <= 3 && word === word.toUpperCase()) {
                    return word;
                }
                return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
            })
            .join(' ');

        return normalized;
    }

    /**
     * Search for an existing author page
     */
    private async findAuthorPage(authorName: string): Promise<TFile | null> {
        const peopleFolder = this.app.vault.getAbstractFileByPath(
            normalizePath(this.settings.peopleFolder)
        );

        if (!(peopleFolder instanceof TFolder)) {
            return null;
        }

        const normalizedSearch = authorName.toLowerCase();

        // Get all markdown files in the People folder
        const files = this.app.vault.getMarkdownFiles().filter(
            f => f.path.startsWith(peopleFolder.path + '/')
        );

        for (const file of files) {
            // Exact match on filename
            if (file.basename.toLowerCase() === normalizedSearch) {
                return file;
            }

            // Check aliases in frontmatter
            const cache = this.app.metadataCache.getFileCache(file);
            if (cache?.frontmatter?.aliases) {
                const aliases = cache.frontmatter.aliases;
                if (Array.isArray(aliases)) {
                    for (const alias of aliases) {
                        if (typeof alias === 'string' && alias.toLowerCase() === normalizedSearch) {
                            return file;
                        }
                    }
                }
            }
        }

        // Removed fuzzy matching to prevent incorrect author linking
        // (e.g., "John" matching "Johnny Depp" or "John Smith")

        return null;
    }

    /**
     * Create a new author page with Claude-generated bio and social links
     */
    private async createAuthorPage(authorName: string, articleContent: string): Promise<TFile | null> {
        try {
            // Ensure People folder exists
            await this.ensureFolder(this.settings.peopleFolder);

            const filePath = normalizePath(`${this.settings.peopleFolder}/${authorName}.md`);

            // Check if file already exists
            const existing = this.app.vault.getAbstractFileByPath(filePath);
            if (existing instanceof TFile) {
                return existing;
            }

            // Generate bio and social links with Claude
            let bioSection = '';
            let socialSection = '';

            if (this.claudeClient.isConfigured()) {
                const bioData = await this.generateAuthorBio(authorName, articleContent);
                if (bioData) {
                    bioSection = bioData.bio;
                    socialSection = bioData.socialLinks;
                }
            }

            // Create the author page with bio, social links, and articles query
            const content = `---
aliases: []
---

# ${authorName}

## Bio

${bioSection || `*Author of clipped articles. Bio to be added.*`}

## Social Media

${socialSection || `*Social media links to be added.*`}

## Articles

\`\`\`dataview
TABLE WITHOUT ID file.link as "Title", clipped-at as "Clipped"
FROM [[]]
SORT clipped-at DESC
\`\`\`
`;

            const newFile = await this.app.vault.create(filePath, content);
            return newFile;
        } catch (error) {
            console.error('Failed to create author page:', error);
            return null;
        }
    }

    /**
     * Generate author bio and social links using web search + Claude
     */
    private async generateAuthorBio(authorName: string, articleContent: string): Promise<{ bio: string; socialLinks: string } | null> {
        // First, search the web for author information
        let webSearchResults = '';
        try {
            webSearchResults = await this.searchForAuthor(authorName);
        } catch (error) {
            console.error('Web search failed, falling back to article content:', error);
        }

        // Also extract any social links from the article
        const articleLinks = this.extractLinksFromContent(articleContent);

        const prompt = `Generate a brief author bio and compile social media links for ${authorName}.

${webSearchResults ? `WEB SEARCH RESULTS about ${authorName}:
${webSearchResults}

` : ''}LINKS FOUND IN ARTICLE:
${articleLinks || 'None found'}

ARTICLE EXCERPT (for additional context):
${articleContent.slice(0, 2000)}

Based on the web search results and article, respond in this exact format:

BIO:
[2-3 sentence bio about the author - who they are, what they're known for, their expertise. Use information from web search results primarily.]

SOCIAL:
- Website: [personal website or blog URL]
- Twitter/X: [@handle or URL]
- Substack: [URL if applicable]
- LinkedIn: [URL if found]
- Other: [any other relevant professional links]

Only include social links you actually found. Do not make up URLs. If a platform isn't found, omit that line entirely.`;

        try {
            const response = await this.claudeClient.query(prompt);

            // Parse the response
            const bioMatch = response.match(/BIO:\s*([\s\S]*?)(?=SOCIAL:|$)/i);
            const socialMatch = response.match(/SOCIAL:\s*([\s\S]*?)$/i);

            const bio = bioMatch ? bioMatch[1].trim() : '';
            let socialLinks = socialMatch ? socialMatch[1].trim() : '';

            // Clean up social links - remove empty entries
            if (socialLinks) {
                socialLinks = socialLinks
                    .split('\n')
                    .filter(line => {
                        const trimmed = line.trim();
                        // Keep lines that have actual URLs or handles
                        return trimmed &&
                               !trimmed.endsWith(': []') &&
                               !trimmed.endsWith(': [URL if found]') &&
                               !trimmed.endsWith(': [handle or URL if found]') &&
                               !trimmed.endsWith(': [@handle or URL]') &&
                               !trimmed.includes('if found]') &&
                               !trimmed.includes('if applicable]') &&
                               trimmed.includes(':') &&
                               trimmed.split(':').slice(1).join(':').trim().length > 0;
                    })
                    .join('\n');
            }

            return { bio, socialLinks };
        } catch (error) {
            console.error('Failed to generate author bio:', error);
            return null;
        }
    }

    /**
     * Search the web for author information using DuckDuckGo
     */
    private async searchForAuthor(authorName: string): Promise<string> {
        try {
            // Use DuckDuckGo HTML search
            const query = encodeURIComponent(`${authorName} writer author biography`);
            const response = await requestUrl({
                url: `https://html.duckduckgo.com/html/?q=${query}`,
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
                }
            });

            if (response.status !== 200) {
                throw new Error(`Search failed with status ${response.status}`);
            }

            // Parse the HTML response to extract search results
            const html = response.text;
            const results: string[] = [];

            // Extract result snippets - DuckDuckGo HTML uses class="result__snippet"
            const snippetRegex = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
            let match;
            let count = 0;

            while ((match = snippetRegex.exec(html)) !== null && count < 5) {
                // Clean HTML tags and decode entities
                let snippet = match[1]
                    .replace(/<[^>]+>/g, '')
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"')
                    .replace(/&#x27;/g, "'")
                    .replace(/&nbsp;/g, ' ')
                    .trim();

                if (snippet.length > 50) {
                    results.push(snippet);
                    count++;
                }
            }

            // Also try to extract result titles and URLs
            const titleRegex = /<a class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
            const links: string[] = [];

            while ((match = titleRegex.exec(html)) !== null && links.length < 5) {
                const url = match[1];
                const title = match[2].replace(/<[^>]+>/g, '').trim();
                if (url && title && !url.includes('duckduckgo.com')) {
                    links.push(`${title}: ${url}`);
                }
            }

            if (results.length === 0 && links.length === 0) {
                return '';
            }

            let output = '';
            if (results.length > 0) {
                output += 'Search snippets:\n' + results.map(r => `- ${r}`).join('\n');
            }
            if (links.length > 0) {
                output += '\n\nRelevant links:\n' + links.map(l => `- ${l}`).join('\n');
            }

            return output;
        } catch (error) {
            console.error('DuckDuckGo search failed:', error);
            return '';
        }
    }

    /**
     * Extract URLs from article content that might be author-related
     */
    private extractLinksFromContent(content: string): string {
        const links: string[] = [];

        // Match markdown links
        const mdLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
        let match;

        while ((match = mdLinkRegex.exec(content)) !== null) {
            const text = match[1].toLowerCase();
            const url = match[2];

            // Look for social/author-related links
            if (text.includes('twitter') || text.includes('@') ||
                text.includes('substack') || text.includes('patreon') ||
                text.includes('linkedin') || text.includes('blog') ||
                text.includes('website') || text.includes('author') ||
                url.includes('twitter.com') || url.includes('x.com') ||
                url.includes('substack.com') || url.includes('patreon.com') ||
                url.includes('linkedin.com') || url.includes('medium.com')) {
                links.push(`${match[1]}: ${url}`);
            }
        }

        // Also look for plain URLs with social platforms
        const urlRegex = /https?:\/\/(?:www\.)?(twitter\.com|x\.com|substack\.com|patreon\.com|linkedin\.com)[^\s)>\]]+/g;
        while ((match = urlRegex.exec(content)) !== null) {
            const url = match[0];
            if (!links.some(l => l.includes(url))) {
                links.push(url);
            }
        }

        return links.length > 0 ? links.join('\n') : '';
    }

    /**
     * Ensure a folder exists in the vault
     */
    private async ensureFolder(folderPath: string): Promise<void> {
        const normalizedPath = normalizePath(folderPath);
        const folder = this.app.vault.getAbstractFileByPath(normalizedPath);

        if (!folder) {
            await this.app.vault.createFolder(normalizedPath);
        }
    }

    /**
     * Update settings reference
     */
    updateSettings(settings: DocumentReaderSettings): void {
        this.settings = settings;
    }
}
