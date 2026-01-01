import { App, TFile } from 'obsidian';
import { DocumentReaderSettings } from '../settings';

interface ScoredFile {
    file: TFile;
    score: number;
}

export class RelatedArticles {
    private app: App;
    private settings: DocumentReaderSettings;

    constructor(app: App, settings: DocumentReaderSettings) {
        this.app = app;
        this.settings = settings;
    }

    /**
     * Find related articles based on shared tags and category
     * @param currentFile The current article file
     * @param tags Tags from the current article
     * @param category Category of the current article (or null)
     * @returns Array of related TFile objects, sorted by relevance
     */
    async findRelated(currentFile: TFile, tags: string[], category: string | null): Promise<TFile[]> {
        // Get all markdown files in the articles folder
        const articlesFolder = this.settings.articlesFolder;
        const allFiles = this.app.vault.getMarkdownFiles();

        // Filter to only files in articles folder, excluding current file
        const candidateFiles = allFiles.filter(file => {
            // Exclude current file
            if (file.path === currentFile.path) {
                return false;
            }

            // Only include files in articles folder (including subfolders)
            if (!file.path.startsWith(articlesFolder + '/') && file.path !== articlesFolder) {
                return false;
            }

            return true;
        });

        // Score each candidate file
        const scoredFiles: ScoredFile[] = [];

        for (const file of candidateFiles) {
            const score = this.calculateRelevance(file, tags, category);
            if (score > 0) {
                scoredFiles.push({ file, score });
            }
        }

        // Sort by score (descending) and return top N
        scoredFiles.sort((a, b) => b.score - a.score);

        const maxResults = this.settings.maxRelatedArticles;
        return scoredFiles.slice(0, maxResults).map(sf => sf.file);
    }

    /**
     * Calculate relevance score for a file based on tag and category overlap
     * @param file The file to score
     * @param tags Tags from the current article
     * @param category Category of the current article
     * @returns Relevance score (higher = more relevant)
     */
    calculateRelevance(file: TFile, tags: string[], category: string | null): number {
        const cache = this.app.metadataCache.getFileCache(file);
        const frontmatter = cache?.frontmatter;

        if (!frontmatter) {
            return 0;
        }

        let score = 0;

        // Get file's tags
        let fileTags: string[] = [];
        if (Array.isArray(frontmatter.tags)) {
            fileTags = frontmatter.tags.filter((t: unknown): t is string => typeof t === 'string');
        } else if (typeof frontmatter.tags === 'string') {
            fileTags = [frontmatter.tags];
        }

        // Score +2 for each matching tag
        for (const tag of tags) {
            if (fileTags.includes(tag)) {
                score += 2;
            }
        }

        // Score +3 if same category
        if (category) {
            // Check if file is in the same category folder
            const expectedPath = `${this.settings.articlesFolder}/${category}/`;
            if (file.path.startsWith(expectedPath)) {
                score += 3;
            }
        }

        return score;
    }

    /**
     * Format the related articles section as markdown
     * @param relatedFiles Array of related TFile objects
     * @returns Markdown string for the related articles section
     */
    formatRelatedSection(relatedFiles: TFile[]): string {
        if (relatedFiles.length === 0) {
            return '';
        }

        const links = relatedFiles.map(file => {
            // Use basename (filename without extension) for the wiki link
            return `- [[${file.basename}]]`;
        });

        return `\n## Related Articles\n\n${links.join('\n')}\n`;
    }

    /**
     * Update settings reference
     */
    updateSettings(settings: DocumentReaderSettings): void {
        this.settings = settings;
    }
}
