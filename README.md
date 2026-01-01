# Obsidian Document Reader

Post-processes articles captured by the Obsidian Web Clipper:
- Downloads external images locally
- Links/creates author pages (with Claude-generated bios)
- Generates hierarchical tags using Claude API
- Organizes articles into subject-based subfolders

## Installation

### From Source

1. Clone this repository into your vault's `.obsidian/plugins/` folder:
   ```bash
   cd /path/to/vault/.obsidian/plugins/
   git clone https://github.com/yourusername/obsidian-document-reader
   cd obsidian-document-reader
   npm install
   npm run build
   ```

2. Reload Obsidian and enable the plugin in Settings → Community Plugins

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` (if present)
2. Create folder: `<vault>/.obsidian/plugins/obsidian-document-reader/`
3. Copy files into that folder
4. Reload Obsidian and enable the plugin

## Setup

### 1. Configure the Plugin

Go to Settings → Document Reader and configure:

| Setting | Description | Default |
|---------|-------------|---------|
| **Claude API Key** | Your Anthropic API key from [console.anthropic.com](https://console.anthropic.com) | (required) |
| **Claude Model** | Model for tag generation and author extraction | Claude Sonnet 4.5 |
| **People Folder** | Folder containing author pages | `People` |
| **Articles Folder** | Folder for clipped articles | `Articles` |
| **Image Folder** | Folder for downloaded images | `assets/images` |
| **Auto Process** | Automatically process clipped articles | On |
| **Download Images** | Download external images locally | On |
| **Create Author Pages** | Create new author page if not found | On |
| **Generate Tags** | Use Claude to generate tags | On |
| **Organize by Category** | Move articles into subject subfolders | On |
| **Tag Prefix** | Prefix for generated tags | `research/` |
| **Max Tags** | Maximum tags to generate | 5 |

### 2. Configure Web Clipper

Install the [Obsidian Web Clipper](https://obsidian.md/clipper) browser extension.

Create a new template with this configuration:

```json
{
  "name": "Article for Document Reader",
  "behavior": "create",
  "noteContentFormat": "{{content}}",
  "properties": [
    {
      "name": "title",
      "value": "{{title}}",
      "type": "text"
    },
    {
      "name": "author",
      "value": "{{schema:@Article:author.name|selector:.author-name|meta:author}}",
      "type": "text"
    },
    {
      "name": "url",
      "value": "{{url}}",
      "type": "text"
    },
    {
      "name": "source",
      "value": "web-clipper",
      "type": "text"
    },
    {
      "name": "clipped-at",
      "value": "{{time|date:\"YYYY-MM-DDTHH:mm:ssZ\"}}",
      "type": "datetime"
    },
    {
      "name": "description",
      "value": "{{description|meta:og:description}}",
      "type": "text"
    }
  ],
  "path": "Articles/{{title|safe_name}}",
  "triggers": []
}
```

The key property is `source: web-clipper` - this is how the plugin detects articles to process.

## Usage

### Automatic Processing

When **Auto Process** is enabled:
1. Clip an article using the Web Clipper with the template above
2. The plugin detects the new file and automatically:
   - Downloads external images to `assets/images/`
   - Links the author to a page in `People/` (or creates one)
   - Generates hierarchical tags using Claude
   - Marks the article as processed (`dr-processed: true`)

### Manual Processing

- **Command Palette**: `Document Reader: Process clipped article`
- **Ribbon Icon**: Click the newspaper icon
- **Reprocess**: Use `Document Reader: Reprocess clipped article` to force reprocessing

## How It Works

### Image Downloading

The plugin finds all markdown images with external URLs (`![alt](https://...)`):
1. Downloads the image using Obsidian's `requestUrl` (bypasses CORS)
2. Saves to `assets/images/` with a unique filename
3. Updates the markdown to point to the local path

### Author Linking

1. Checks frontmatter for `author` field
2. If not found and Claude is enabled, extracts author from content
3. Searches `People/` folder for matching page:
   - Exact filename match
   - Alias match (in frontmatter)
   - Fuzzy match (all name parts present)
4. If no match and **Create Author Pages** is on, creates a new page
5. Updates frontmatter with `[[Author Name]]` link

### Tag Generation

1. Sends article content to Claude API
2. Requests hierarchical tags (e.g., `economics/trade-policy`)
3. Applies configured prefix (e.g., `research/economics/trade-policy`)
4. Adds tags to frontmatter (merged with existing)

### Category Organization

1. Claude analyzes article content during tag generation
2. Determines primary category (Economics, Technology, Politics, Culture, Science, Business, Health, Law, etc.)
3. Creates subfolder if needed (e.g., `Articles/Economics/`)
4. Moves article to appropriate subfolder
5. New categories are created automatically if none of the defaults fit

## Vault Structure

After setup, your vault should look like:

```
vault/
├── Articles/                    # Clipped articles organized by category
│   ├── Economics/
│   │   └── Trade Policy Article.md
│   ├── Technology/
│   │   └── AI Research Paper.md
│   └── Politics/
│       └── Election Analysis.md
├── People/                      # Author pages
│   └── John Smith.md
├── assets/
│   └── images/                  # Downloaded images
│       └── img_1234567890_abc123.jpg
└── .obsidian/
    └── plugins/
        └── obsidian-document-reader/
```

## Frontmatter After Processing

```yaml
---
title: My Article Title
author: "[[John Smith]]"
url: https://example.com/article
source: web-clipper
clipped-at: 2025-01-01T12:00:00Z
tags:
  - research/technology/ai
  - research/business/startups
dr-processed: true
dr-processed-at: 2025-01-01T12:05:00Z
---
```

## Troubleshooting

### Plugin doesn't process articles

- Check that `source: web-clipper` is in frontmatter
- Check that `dr-processed` is not already `true`
- Try the manual "Process clipped article" command

### Images not downloading

- Check Settings → Download Images is enabled
- Check that images are external URLs (not already local)
- Check console for network errors

### Tags not generating

- Ensure Claude API key is configured
- Check Settings → Generate Tags is enabled
- Check console for API errors

### Author not linked

- Check Settings → Author Frontmatter Key matches your template
- Ensure People folder exists
- Check console for matching issues

## Development

```bash
# Install dependencies
npm install

# Build for development (with watch)
npm run dev

# Build for production
npm run build
```

## License

MIT
