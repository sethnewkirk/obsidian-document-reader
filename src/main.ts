import { Plugin, TFile, Notice, debounce } from 'obsidian';
import { DocumentReaderSettings, DEFAULT_SETTINGS, DocumentReaderSettingTab } from './settings';
import { ArticleProcessor } from './services/ArticleProcessor';

export default class DocumentReaderPlugin extends Plugin {
    settings: DocumentReaderSettings;
    private articleProcessor: ArticleProcessor;
    private processingQueue: Set<string> = new Set();
    private debouncedProcess: ReturnType<typeof debounce>;

    async onload() {
        console.log('Loading Document Reader plugin');

        // Load settings
        await this.loadSettings();

        // Initialize article processor
        this.articleProcessor = new ArticleProcessor(this.app, this.settings);

        // Create debounced processing function (1 second delay)
        this.debouncedProcess = debounce(
            async (file: TFile) => {
                await this.processFileIfNeeded(file);
            },
            1000,
            true
        );

        // Register settings tab
        this.addSettingTab(new DocumentReaderSettingTab(this.app, this));

        // Register metadata cache changed event for auto-processing
        this.registerEvent(
            this.app.metadataCache.on('changed', (file: TFile) => {
                if (this.settings.autoProcess) {
                    this.debouncedProcess(file);
                }
            })
        );

        // Register rename event to catch files moved into articles folder
        this.registerEvent(
            this.app.vault.on('rename', (file, _oldPath) => {
                if (file instanceof TFile && this.settings.autoProcess) {
                    this.debouncedProcess(file);
                }
            })
        );

        // Add command: Process clipped article
        this.addCommand({
            id: 'process-clipped-article',
            name: 'Process clipped article',
            checkCallback: (checking: boolean) => {
                const activeFile = this.app.workspace.getActiveFile();
                if (!activeFile) {
                    return false;
                }

                if (checking) {
                    return true;
                }

                this.processFile(activeFile);
                return true;
            }
        });

        // Add command: Process clipped article (force reprocess)
        this.addCommand({
            id: 'reprocess-clipped-article',
            name: 'Reprocess clipped article (ignore dr-processed flag)',
            checkCallback: (checking: boolean) => {
                const activeFile = this.app.workspace.getActiveFile();
                if (!activeFile) {
                    return false;
                }

                if (checking) {
                    return true;
                }

                this.processFile(activeFile, true);
                return true;
            }
        });

        // Add ribbon icon (newspaper icon)
        this.addRibbonIcon('newspaper', 'Process clipped article', async () => {
            const activeFile = this.app.workspace.getActiveFile();
            if (activeFile) {
                await this.processFile(activeFile);
            } else {
                new Notice('Document Reader: No active file to process');
            }
        });
    }

    async onunload() {
        console.log('Unloading Document Reader plugin');
    }

    /**
     * Load plugin settings
     */
    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    /**
     * Save plugin settings
     */
    async saveSettings() {
        await this.saveData(this.settings);

        // Update processor with new settings
        if (this.articleProcessor) {
            this.articleProcessor.updateSettings(this.settings);
        }
    }

    /**
     * Process a file if it meets the criteria (called from debounced event)
     */
    private async processFileIfNeeded(file: TFile): Promise<void> {
        // Only process markdown files
        if (file.extension !== 'md') {
            return;
        }

        // Check if file should be processed
        if (!this.articleProcessor.shouldProcess(file)) {
            return;
        }

        // Avoid duplicate processing
        if (this.processingQueue.has(file.path)) {
            return;
        }

        await this.processFile(file);
    }

    /**
     * Process a file (manual or auto)
     */
    private async processFile(file: TFile, forceReprocess: boolean = false): Promise<void> {
        // Only process markdown files
        if (file.extension !== 'md') {
            new Notice('Document Reader: Can only process markdown files');
            return;
        }

        // Check if already processing
        if (this.processingQueue.has(file.path)) {
            new Notice('Document Reader: File is already being processed');
            return;
        }

        // Check if should process (unless force reprocess)
        if (!forceReprocess) {
            const cache = this.app.metadataCache.getFileCache(file);
            const frontmatter = cache?.frontmatter;

            // For manual processing, check if it has web-clipper source
            if (!frontmatter || frontmatter.source !== 'web-clipper') {
                new Notice('Document Reader: File does not have "source: web-clipper" in frontmatter');
                return;
            }

            // Check if already processed
            if (frontmatter['dr-processed'] === true) {
                new Notice('Document Reader: File already processed. Use "Reprocess" command to process again.');
                return;
            }
        }

        // Add to processing queue
        this.processingQueue.add(file.path);

        try {
            new Notice(`Document Reader: Processing "${file.basename}"...`);
            await this.articleProcessor.process(file);
        } finally {
            // Remove from processing queue
            this.processingQueue.delete(file.path);
        }
    }
}
