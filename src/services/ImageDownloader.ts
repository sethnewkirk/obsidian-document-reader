import { App, TFile, requestUrl, normalizePath } from 'obsidian';
import { DocumentReaderSettings } from '../settings';

export interface ImageProcessingResult {
    updatedContent: string;
    downloadedCount: number;
    failedUrls: string[];
}

export class ImageDownloader {
    private app: App;
    private settings: DocumentReaderSettings;

    // Regex to match markdown images: ![alt](url)
    private readonly IMAGE_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/g;

    // Common image extensions
    private readonly EXTENSION_MAP: Record<string, string> = {
        'image/jpeg': '.jpg',
        'image/jpg': '.jpg',
        'image/png': '.png',
        'image/gif': '.gif',
        'image/webp': '.webp',
        'image/svg+xml': '.svg',
        'image/bmp': '.bmp',
        'image/tiff': '.tiff',
        'image/x-icon': '.ico',
        'image/avif': '.avif',
    };

    constructor(app: App, settings: DocumentReaderSettings) {
        this.app = app;
        this.settings = settings;
    }

    /**
     * Process all images in the file content, downloading external images locally
     */
    async processImages(file: TFile, content: string): Promise<ImageProcessingResult> {
        const result: ImageProcessingResult = {
            updatedContent: content,
            downloadedCount: 0,
            failedUrls: []
        };

        // Find all image references
        const matches = [...content.matchAll(this.IMAGE_REGEX)];

        for (const match of matches) {
            const [fullMatch, altText, url] = match;

            // Skip non-HTTP URLs (already local or data URIs)
            if (!this.isExternalUrl(url)) {
                continue;
            }

            try {
                const localPath = await this.downloadImage(url, file);

                // Replace the URL with the local path
                const newImageRef = `![${altText}](${localPath})`;
                result.updatedContent = result.updatedContent.replace(fullMatch, newImageRef);
                result.downloadedCount++;
            } catch (error) {
                console.error(`Failed to download image ${url}:`, error);
                result.failedUrls.push(url);
            }
        }

        return result;
    }

    /**
     * Check if a URL is external (http/https)
     */
    private isExternalUrl(url: string): boolean {
        const trimmedUrl = url.trim();
        return trimmedUrl.startsWith('http://') || trimmedUrl.startsWith('https://');
    }

    /**
     * Download an image and save it to the vault
     */
    private async downloadImage(url: string, sourceFile: TFile): Promise<string> {
        // Download the image
        const response = await requestUrl({
            url: url,
            method: 'GET',
        });

        if (response.status !== 200) {
            throw new Error(`HTTP ${response.status}`);
        }

        // Determine file extension from Content-Type or URL
        const contentType = response.headers['content-type']?.toLowerCase() || '';
        let extension = this.getExtensionFromContentType(contentType);

        if (!extension) {
            extension = this.getExtensionFromUrl(url);
        }

        if (!extension) {
            extension = '.png'; // Default fallback
        }

        // Generate unique filename
        const hash = this.generateHash(url);
        const filename = `img-${hash}${extension}`;

        // Ensure image folder exists
        await this.ensureFolder(this.settings.imageFolder);

        // Build the full path
        const imagePath = normalizePath(`${this.settings.imageFolder}/${filename}`);

        // Check if file already exists (skip re-downloading)
        const existingFile = this.app.vault.getAbstractFileByPath(imagePath);
        if (existingFile instanceof TFile) {
            return imagePath;
        }

        // Save the image
        await this.app.vault.adapter.writeBinary(imagePath, response.arrayBuffer);

        return imagePath;
    }

    /**
     * Get file extension from Content-Type header
     */
    private getExtensionFromContentType(contentType: string): string | null {
        // Extract the MIME type (ignore charset etc.)
        const mimeType = contentType.split(';')[0].trim();
        return this.EXTENSION_MAP[mimeType] || null;
    }

    /**
     * Get file extension from URL
     */
    private getExtensionFromUrl(url: string): string | null {
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            const match = pathname.match(/\.(jpg|jpeg|png|gif|webp|svg|bmp|tiff|ico|avif)$/i);
            if (match) {
                return '.' + match[1].toLowerCase();
            }
        } catch {
            // Invalid URL, ignore
        }
        return null;
    }

    /**
     * Generate a hash from the URL for unique filenames
     */
    private generateHash(url: string): string {
        let hash = 0;
        for (let i = 0; i < url.length; i++) {
            const char = url.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash).toString(16).padStart(8, '0');
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
