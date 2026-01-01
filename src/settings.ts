import { App, PluginSettingTab, Setting } from 'obsidian';
import type DocumentReaderPlugin from './main';

export interface DocumentReaderSettings {
    claudeApiKey: string;
    claudeModel: string;
    peopleFolder: string;
    articlesFolder: string;
    imageFolder: string;
    autoProcess: boolean;
    downloadImages: boolean;
    createAuthorPages: boolean;
    generateTags: boolean;
    organizeByCategory: boolean;
    tagPrefix: string;
    maxTags: number;
    authorFrontmatterKey: string;
    useClaudeForAuthor: boolean;
}

export const DEFAULT_SETTINGS: DocumentReaderSettings = {
    claudeApiKey: '',
    claudeModel: 'claude-sonnet-4-5-20250929',
    peopleFolder: 'People',
    articlesFolder: 'Articles',
    imageFolder: 'assets/images',
    autoProcess: true,
    downloadImages: true,
    createAuthorPages: true,
    generateTags: true,
    organizeByCategory: true,
    tagPrefix: 'research/',
    maxTags: 5,
    authorFrontmatterKey: 'author',
    useClaudeForAuthor: true,
};

export class DocumentReaderSettingTab extends PluginSettingTab {
    plugin: DocumentReaderPlugin;

    constructor(app: App, plugin: DocumentReaderPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        // Claude API Section
        containerEl.createEl('h2', { text: 'Claude API' });

        new Setting(containerEl)
            .setName('API Key')
            .setDesc('Your Anthropic API key for Claude')
            .addText(text => text
                .setPlaceholder('sk-ant-...')
                .setValue(this.plugin.settings.claudeApiKey)
                .inputEl.type = 'password');

        // Need to set up the change handler separately due to type issue
        const apiKeySetting = containerEl.querySelector('.setting-item:last-child input') as HTMLInputElement;
        if (apiKeySetting) {
            apiKeySetting.addEventListener('change', async () => {
                this.plugin.settings.claudeApiKey = apiKeySetting.value;
                await this.plugin.saveSettings();
            });
        }

        new Setting(containerEl)
            .setName('Claude Model')
            .setDesc('Which Claude model to use for analysis')
            .addDropdown(dropdown => dropdown
                .addOption('claude-sonnet-4-5-20250929', 'Claude Sonnet 4.5 (Recommended)')
                .addOption('claude-opus-4-20250514', 'Claude Opus 4')
                .addOption('claude-haiku-3-5-20241022', 'Claude Haiku 3.5 (Faster, cheaper)')
                .setValue(this.plugin.settings.claudeModel)
                .onChange(async (value) => {
                    this.plugin.settings.claudeModel = value;
                    await this.plugin.saveSettings();
                }));

        // Vault Paths Section
        containerEl.createEl('h2', { text: 'Vault Paths' });

        new Setting(containerEl)
            .setName('People Folder')
            .setDesc('Folder containing author/people pages')
            .addText(text => text
                .setPlaceholder('People')
                .setValue(this.plugin.settings.peopleFolder)
                .onChange(async (value) => {
                    this.plugin.settings.peopleFolder = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Articles Folder')
            .setDesc('Folder where clipped articles are saved')
            .addText(text => text
                .setPlaceholder('Articles')
                .setValue(this.plugin.settings.articlesFolder)
                .onChange(async (value) => {
                    this.plugin.settings.articlesFolder = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Image Folder')
            .setDesc('Folder where downloaded images will be saved')
            .addText(text => text
                .setPlaceholder('assets/images')
                .setValue(this.plugin.settings.imageFolder)
                .onChange(async (value) => {
                    this.plugin.settings.imageFolder = value;
                    await this.plugin.saveSettings();
                }));

        // Processing Options Section
        containerEl.createEl('h2', { text: 'Processing Options' });

        new Setting(containerEl)
            .setName('Auto-process')
            .setDesc('Automatically process articles when they are clipped')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoProcess)
                .onChange(async (value) => {
                    this.plugin.settings.autoProcess = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Download Images')
            .setDesc('Download external images to local vault')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.downloadImages)
                .onChange(async (value) => {
                    this.plugin.settings.downloadImages = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Create Author Pages')
            .setDesc('Create new pages for unknown authors')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.createAuthorPages)
                .onChange(async (value) => {
                    this.plugin.settings.createAuthorPages = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Generate Tags')
            .setDesc('Use Claude to generate hierarchical tags')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.generateTags)
                .onChange(async (value) => {
                    this.plugin.settings.generateTags = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Organize by Category')
            .setDesc('Move articles into subject-based subfolders (e.g., Articles/Economics/)')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.organizeByCategory)
                .onChange(async (value) => {
                    this.plugin.settings.organizeByCategory = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Use Claude for Author Detection')
            .setDesc('Use Claude to extract author name when not in frontmatter')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.useClaudeForAuthor)
                .onChange(async (value) => {
                    this.plugin.settings.useClaudeForAuthor = value;
                    await this.plugin.saveSettings();
                }));

        // Tag Configuration Section
        containerEl.createEl('h2', { text: 'Tag Configuration' });

        new Setting(containerEl)
            .setName('Tag Prefix')
            .setDesc('Prefix for generated tags (e.g., "research/")')
            .addText(text => text
                .setPlaceholder('research/')
                .setValue(this.plugin.settings.tagPrefix)
                .onChange(async (value) => {
                    this.plugin.settings.tagPrefix = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Maximum Tags')
            .setDesc('Maximum number of tags to generate (1-10)')
            .addSlider(slider => slider
                .setLimits(1, 10, 1)
                .setValue(this.plugin.settings.maxTags)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.maxTags = value;
                    await this.plugin.saveSettings();
                }));

        // Author Configuration Section
        containerEl.createEl('h2', { text: 'Author Configuration' });

        new Setting(containerEl)
            .setName('Author Frontmatter Key')
            .setDesc('Frontmatter key to look for author name')
            .addText(text => text
                .setPlaceholder('author')
                .setValue(this.plugin.settings.authorFrontmatterKey)
                .onChange(async (value) => {
                    this.plugin.settings.authorFrontmatterKey = value;
                    await this.plugin.saveSettings();
                }));
    }
}
