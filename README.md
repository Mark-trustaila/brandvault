# BrandVault

Trademark portfolio dashboard for AiLA. Follows the same design patterns as [InnoVault](https://github.com/Mark-trustaila/Innovault) (patent dashboard).

## Quick Start

1. **Fetch trademark data** (requires LawPanel credentials):
   ```bash
   LAWPANEL_USER=tmd LAWPANEL_KEY=your-subscription-key node scripts/lawpanel-fetch-trademarks.js
   ```

2. **Preview locally:**
   ```bash
   npx serve public
   ```

3. **Deploy to Vercel:**
   - Push to GitHub
   - Connect repo in Vercel dashboard
   - No build step required — serves static files from `public/`

## Project Structure

```
brandvault/
├── public/
│   ├── brandvault-trademark-dashboard.html   # Main dashboard (self-contained)
│   ├── trademark-data.json                   # Trademark data (from LawPanel API)
│   └── index.html                            # Redirect to dashboard
├── scripts/
│   └── lawpanel-fetch-trademarks.js          # Data fetch script
├── package.json
├── vercel.json
└── README.md
```

## API Key Security

- Credentials are **never** stored in the repo
- The fetch script reads from environment variables: `LAWPANEL_USER`, `LAWPANEL_KEY`
- The dashboard HTML only reads from the local JSON file — no API calls from the browser
- For Vercel: add credentials as Environment Variables if automating data refresh

## Data Source

Trademarks are fetched from the [LawPanel Firms API](https://lawpanel.developer.azure-api.net/) and filtered for Yoti / Yoti Holdings Ltd registrations.

## Grouping Logic

Unlike patents (which group by family), trademarks group by:
1. **Identical mark text** (e.g. all "YOTI" registrations)
2. **Nice classification class** (e.g. Class 9, Class 42)
3. **Registry / country** (e.g. UKIPO, EUIPO, USPTO)
