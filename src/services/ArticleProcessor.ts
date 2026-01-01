import { App, TFile, TFolder, Notice, normalizePath } from 'obsidian';
import { DocumentReaderSettings } from '../settings';
import { ClaudeApiClient } from './ClaudeApiClient';
import { ImageDownloader, ImageProcessingResult } from './ImageDownloader';
import { AuthorLinker, AuthorLinkResult } from './AuthorLinker';
import { TagGenerator, TagGenerationResult } from './TagGenerator';

export interface ProcessingResult {
    success: boolean;
    file: TFile;
    imagesDownloaded: number;
    imagesFailed: number;
    authorName: string | null;
    authorCreated: boolean;
    tagsGenerated: string[];
    category: string | null;
    movedTo: string | null;
    errors: string[];
}

export class ArticleProcessor {
    private app: App;
    private settings: DocumentReaderSettings;
    private claudeClient: ClaudeApiClient;
    private imageDownloader: ImageDownloader;
    private authorLinker: AuthorLinker;
    private tagGenerator: TagGenerator;

    constructor(app: App, settings: DocumentReaderSettings) {
        this.app = app;
        this.settings = settings;

        // Initialize services
        this.claudeClient = new ClaudeApiClient(settings);
        this.imageDownloader = new ImageDownloader(app, settings);
        this.authorLinker = new AuthorLinker(app, settings, this.claudeClient);
        this.tagGenerator = new TagGenerator(settings, this.claudeClient);
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
            authorName: null,
            authorCreated: false,
            tagsGenerated: [],
            category: null,
            movedTo: null,
            errors: []
        };

        try {
            // Read current file content
            let content = await this.app.vault.read(file);

            // Get frontmatter from cache
            const cache = this.app.metadataCache.getFileCache(file);
            const frontmatter: Record<string, unknown> = cache?.frontmatter || {};

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
            let authorResult: AuthorLinkResult | null = null;
            if (this.settings.createAuthorPages || this.settings.useClaudeForAuthor) {
                try {
                    authorResult = await this.authorLinker.linkAuthor(file, frontmatter, content);
                    result.authorName = authorResult.authorName;
                    result.authorCreated = authorResult.created;
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                    result.errors.push(`Author linking failed: ${errorMsg}`);
                    console.error('Author linking error:', error);
                }
            }

            // Step 3: Generate tags and category (if enabled)
            let generatedTags: string[] = [];
            let category: string | null = null;
            if (this.settings.generateTags) {
                try {
                    const tagResult = await this.tagGenerator.generateTags(content, frontmatter);
                    generatedTags = tagResult.tags;
                    category = tagResult.category;
                    result.tagsGenerated = generatedTags;
                    result.category = category;
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
                authorLink: authorResult?.authorLink || null,
                tags: generatedTags
            });

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
            authorLink: string | null;
            tags: string[];
        }
    ): Promise<void> {
        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
            // Update author if we have a link
            if (updates.authorLink) {
                frontmatter[this.settings.authorFrontmatterKey] = updates.authorLink;
            }

            // Merge tags (avoid duplicates)
            if (updates.tags.length > 0) {
                const existingTags: string[] = Array.isArray(frontmatter.tags)
                    ? frontmatter.tags.filter((t: unknown): t is string => typeof t === 'string')
                    : (typeof frontmatter.tags === 'string' ? [frontmatter.tags] : []);

                const allTags = [...new Set([...existingTags, ...updates.tags])];
                frontmatter.tags = allTags;
            }

            // Mark as processed
            frontmatter['dr-processed'] = true;
            frontmatter['dr-processed-at'] = new Date().toISOString();
        });
    }

    /**
     * Show a completion notification to the user
     */
    private showCompletionNotice(result: ProcessingResult): void {
        const parts: string[] = [];

        if (result.imagesDownloaded > 0) {
            parts.push(`${result.imagesDownloaded} images`);
        }

        if (result.authorName) {
            if (result.authorCreated) {
                parts.push(`created author: ${result.authorName}`);
            } else {
                parts.push(`linked author: ${result.authorName}`);
            }
        }

        if (result.tagsGenerated.length > 0) {
            parts.push(`${result.tagsGenerated.length} tags`);
        }

        if (result.category) {
            parts.push(`filed in: ${result.category}`);
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
    }
}
