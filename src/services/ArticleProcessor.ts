import { App, TFile, TFolder, Notice, normalizePath } from 'obsidian';
import { DocumentReaderSettings } from '../settings';
import { ClaudeApiClient } from './ClaudeApiClient';
import { ImageDownloader, ImageProcessingResult } from './ImageDownloader';
import { AuthorLinker, MultiAuthorLinkResult } from './AuthorLinker';
import { TagGenerator, TagGenerationResult } from './TagGenerator';
import { RelatedArticles } from './RelatedArticles';

export interface ProcessingResult {
    success: boolean;
    file: TFile;
    imagesDownloaded: number;
    imagesFailed: number;
    authorNames: string[];
    authorsCreated: number;
    tagsGenerated: string[];
    category: string | null;
    publishedDate: string | null;
    movedTo: string | null;
    readingTime: number;
    skippedDuplicate: boolean;
    relatedArticlesLinked: number;
    errors: string[];
}

export class ArticleProcessor {
    private app: App;
    private settings: DocumentReaderSettings;
    private claudeClient: ClaudeApiClient;
    private imageDownloader: ImageDownloader;
    private authorLinker: AuthorLinker;
    private tagGenerator: TagGenerator;
    private relatedArticles: RelatedArticles;

    constructor(app: App, settings: DocumentReaderSettings) {
        this.app = app;
        this.settings = settings;

        // Initialize services
        this.claudeClient = new ClaudeApiClient(settings);
        this.imageDownloader = new ImageDownloader(app, settings);
        this.authorLinker = new AuthorLinker(app, settings, this.claudeClient);
        this.tagGenerator = new TagGenerator(settings, this.claudeClient);
        this.relatedArticles = new RelatedArticles(app, settings);
    }

    /**
     * Process an article file
     */
    async process(file: TFile): Promise<ProcessingResult> {
        const result: ProcessingResult = {
            success: false,
            file: file,
            imagesDownloaded: 0,
            imagesFailed: 0,
            authorNames: [],
            authorsCreated: 0,
            tagsGenerated: [],
            category: null,
            publishedDate: null,
            movedTo: null,
            readingTime: 0,
            skippedDuplicate: false,
            relatedArticlesLinked: 0,
            errors: []
        };

        try {
            // Get frontmatter from cache first for duplicate check
            const cache = this.app.metadataCache.getFileCache(file);
            const frontmatter: Record<string, unknown> = cache?.frontmatter || {};

            // Check for duplicate URL before any processing
            if (this.settings.skipDuplicates) {
                const url = frontmatter.url;
                if (typeof url === 'string' && url.length > 0) {
                    const isDuplicate = await this.isDuplicate(url, file);
                    if (isDuplicate) {
                        result.skippedDuplicate = true;
                        result.errors.push('Duplicate URL found in another file');
                        new Notice(`Document Reader: Skipping "${file.basename}" - duplicate URL already exists in vault`);
                        return result;
                    }
                }
            }

            // Read current file content
            let content = await this.app.vault.read(file);

            // Calculate reading time
            result.readingTime = this.calculateReadingTime(content);

            // Step 1: Download images (if enabled)
            let imageResult: ImageProcessingResult | null = null;
            if (this.settings.downloadImages) {
                try {
                    imageResult = await this.imageDownloader.processImages(file, content);
                    content = imageResult.updatedContent;
                    result.imagesDownloaded = imageResult.downloadedCount;
                    result.imagesFailed = imageResult.failedUrls.length;

                    if (imageResult.failedUrls.length > 0) {
                        result.errors.push(`Failed to download ${imageResult.failedUrls.length} image(s)`);
                    }
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                    result.errors.push(`Image processing failed: ${errorMsg}`);
                    console.error('Image processing error:', error);
                }
            }

            // Step 2: Link/create author (if enabled)
            let authorResult: MultiAuthorLinkResult | null = null;
            if (this.settings.createAuthorPages || this.settings.useClaudeForAuthor) {
                try {
                    authorResult = await this.authorLinker.linkAuthor(file, frontmatter, content);
                    result.authorNames = authorResult.allAuthorNames;
                    result.authorsCreated = authorResult.authorsCreated;
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                    result.errors.push(`Author linking failed: ${errorMsg}`);
                    console.error('Author linking error:', error);
                }
            }

            // Step 3: Generate tags, category, and publication date (if enabled)
            let generatedTags: string[] = [];
            let category: string | null = null;
            let publishedDate: string | null = null;
            if (this.settings.generateTags) {
                try {
                    const tagResult = await this.tagGenerator.generateTags(content, frontmatter);
                    generatedTags = tagResult.tags;
                    category = tagResult.category;
                    publishedDate = tagResult.publishedDate;
                    result.tagsGenerated = generatedTags;
                    result.category = category;
                    result.publishedDate = publishedDate;
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                    result.errors.push(`Tag generation failed: ${errorMsg}`);
                    console.error('Tag generation error:', error);
                }
            }

            // Step 4: Update the file content (if images were processed)
            if (imageResult && imageResult.downloadedCount > 0) {
                await this.app.vault.modify(file, content);
            }

            // Step 5: Move to category subfolder (if enabled and category exists)
            if (this.settings.organizeByCategory && category) {
                try {
                    const moveResult = await this.moveToCategory(file, category);
                    file = moveResult.file;
                    result.file = file;
                    result.movedTo = moveResult.newPath;
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                    result.errors.push(`Failed to move to category folder: ${errorMsg}`);
                    console.error('Category move error:', error);
                }
            }

            // Step 6: Update frontmatter
            await this.updateFrontmatter(file, {
                authorLinks: authorResult?.allAuthorLinks || [],
                tags: generatedTags,
                readingTime: result.readingTime,
                publishedDate: publishedDate
            });

            // Step 7: Link related articles (if enabled)
            if (this.settings.linkRelatedArticles) {
                try {
                    const relatedFiles = await this.relatedArticles.findRelated(file, generatedTags, category);
                    if (relatedFiles.length > 0) {
                        const relatedSection = this.relatedArticles.formatRelatedSection(relatedFiles);
                        // Read current content and append related section
                        const currentContent = await this.app.vault.read(file);
                        await this.app.vault.modify(file, currentContent + relatedSection);
                        result.relatedArticlesLinked = relatedFiles.length;
                    }
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                    result.errors.push(`Related articles linking failed: ${errorMsg}`);
                    console.error('Related articles error:', error);
                }
            }

            result.success = true;

            // Show notification
            this.showCompletionNotice(result);

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            result.errors.push(`Processing failed: ${errorMsg}`);
            console.error('Article processing error:', error);

            new Notice(`Document Reader: Failed to process article - ${errorMsg}`);
        }

        return result;
    }

    /**
     * Update the file frontmatter with processing results
     */
    private async updateFrontmatter(
        file: TFile,
        updates: {
            authorLinks: string[];
            tags: string[];
            readingTime: number;
            publishedDate: string | null;
        }
    ): Promise<void> {
        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
            // Update author if we have links
            if (updates.authorLinks.length > 0) {
                // If single author, store as string for backwards compatibility
                // If multiple authors, store as array
                if (updates.authorLinks.length === 1) {
                    frontmatter[this.settings.authorFrontmatterKey] = updates.authorLinks[0];
                } else {
                    frontmatter[this.settings.authorFrontmatterKey] = updates.authorLinks;
                }
            }

            // Merge tags (avoid duplicates)
            if (updates.tags.length > 0) {
                const existingTags: string[] = Array.isArray(frontmatter.tags)
                    ? frontmatter.tags.filter((t: unknown): t is string => typeof t === 'string')
                    : (typeof frontmatter.tags === 'string' ? [frontmatter.tags] : []);

                const allTags = [...new Set([...existingTags, ...updates.tags])];
                frontmatter.tags = allTags;
            }

            // Add reading time
            if (updates.readingTime > 0) {
                frontmatter['reading-time'] = `${updates.readingTime} min`;
            }

            // Add published date if extracted
            if (updates.publishedDate) {
                frontmatter['published-date'] = updates.publishedDate;
            }

            // Mark as processed
            frontmatter['dr-processed'] = true;
            frontmatter['dr-processed-at'] = new Date().toISOString();
        });
    }

    /**
     * Calculate reading time for article content
     * @param content The full markdown content including frontmatter
     * @returns Reading time in minutes (assumes 200 words per minute)
     */
    calculateReadingTime(content: string): number {
        // Remove frontmatter (text between --- markers at the start)
        let textContent = content;
        const frontmatterMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
        if (frontmatterMatch) {
            textContent = content.slice(frontmatterMatch[0].length);
        }

        // Count words in remaining content
        // Split on whitespace and filter out empty strings
        const words = textContent.trim().split(/\s+/).filter(word => word.length > 0);
        const wordCount = words.length;

        // Calculate reading time (200 words per minute)
        const WORDS_PER_MINUTE = 200;
        const readingTimeMinutes = Math.ceil(wordCount / WORDS_PER_MINUTE);

        // Return at least 1 minute if there's any content
        return wordCount > 0 ? Math.max(1, readingTimeMinutes) : 0;
    }

    /**
     * Show a completion notification to the user
     */
    private showCompletionNotice(result: ProcessingResult): void {
        const parts: string[] = [];

        if (result.readingTime > 0) {
            parts.push(`${result.readingTime} min read`);
        }

        if (result.imagesDownloaded > 0) {
            parts.push(`${result.imagesDownloaded} images`);
        }

        if (result.authorNames.length > 0) {
            const authorCount = result.authorNames.length;
            const createdCount = result.authorsCreated;
            const linkedCount = authorCount - createdCount;

            if (authorCount === 1) {
                // Single author
                if (createdCount === 1) {
                    parts.push(`created author: ${result.authorNames[0]}`);
                } else {
                    parts.push(`linked author: ${result.authorNames[0]}`);
                }
            } else {
                // Multiple authors
                const authorList = result.authorNames.join(', ');
                if (createdCount > 0 && linkedCount > 0) {
                    parts.push(`authors: ${authorList} (${createdCount} created, ${linkedCount} linked)`);
                } else if (createdCount > 0) {
                    parts.push(`created ${createdCount} authors: ${authorList}`);
                } else {
                    parts.push(`linked ${authorCount} authors: ${authorList}`);
                }
            }
        }

        if (result.tagsGenerated.length > 0) {
            parts.push(`${result.tagsGenerated.length} tags`);
        }

        if (result.category) {
            parts.push(`filed in: ${result.category}`);
        }

        if (result.relatedArticlesLinked > 0) {
            parts.push(`${result.relatedArticlesLinked} related`);
        }

        if (parts.length > 0) {
            new Notice(`Document Reader: Processed "${result.file.basename}" - ${parts.join(', ')}`);
        } else {
            new Notice(`Document Reader: Processed "${result.file.basename}" (no changes)`);
        }
    }

    /**
     * Check if a file should be processed
     */
    shouldProcess(file: TFile): boolean {
        const cache = this.app.metadataCache.getFileCache(file);
        const frontmatter = cache?.frontmatter;

        if (!frontmatter) {
            return false;
        }

        // Check for web-clipper source marker
        if (frontmatter.source !== 'web-clipper') {
            return false;
        }

        // Check if already processed
        if (frontmatter['dr-processed'] === true) {
            return false;
        }

        return true;
    }

    /**
     * Check if another file in the vault already has the same URL in frontmatter
     * Only searches in the articles folder for better performance
     * @param url The URL to check for duplicates
     * @param currentFile The current file to exclude from comparison
     * @returns True if a duplicate URL is found in another file
     */
    async isDuplicate(url: string, currentFile: TFile): Promise<boolean> {
        const articlesFolder = this.settings.articlesFolder;
        const files = this.app.vault.getMarkdownFiles().filter(file =>
            file.path.startsWith(articlesFolder + '/') || file.path === articlesFolder
        );

        for (const file of files) {
            // Skip the current file
            if (file.path === currentFile.path) {
                continue;
            }

            // Get frontmatter from cache
            const cache = this.app.metadataCache.getFileCache(file);
            const frontmatter = cache?.frontmatter;

            if (!frontmatter) {
                continue;
            }

            // Check if this file has a matching URL
            const fileUrl = frontmatter.url;
            if (typeof fileUrl === 'string' && fileUrl === url) {
                return true;
            }
        }

        return false;
    }

    /**
     * Move file to a category subfolder
     */
    private async moveToCategory(file: TFile, category: string): Promise<{ file: TFile; newPath: string }> {
        const targetFolder = normalizePath(`${this.settings.articlesFolder}/${category}`);

        // Ensure folder exists
        await this.ensureFolder(targetFolder);

        // Build new path
        const newPath = normalizePath(`${targetFolder}/${file.name}`);

        // Skip if already in correct location
        if (file.path === newPath) {
            return { file, newPath };
        }

        // Move file using Obsidian's file manager
        await this.app.fileManager.renameFile(file, newPath);

        // Get updated file reference
        const movedFile = this.app.vault.getAbstractFileByPath(newPath);
        if (!(movedFile instanceof TFile)) {
            throw new Error(`Failed to get moved file at ${newPath}`);
        }

        return { file: movedFile, newPath };
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
     * Update settings reference for all services
     */
    updateSettings(settings: DocumentReaderSettings): void {
        this.settings = settings;
        this.claudeClient.updateSettings(settings);
        this.imageDownloader.updateSettings(settings);
        this.authorLinker.updateSettings(settings);
        this.tagGenerator.updateSettings(settings);
        this.relatedArticles.updateSettings(settings);
    }
}
