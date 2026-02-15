# Gemin-Eye

AI-powered customer acquisition platform that monitors niche online communities for high-intent questions, then generates helpful, human-sounding responses that subtly promote your business.

Instead of traditional advertising, Gemin-Eye finds people actively seeking recommendations and engages them organically.

## How It Works

1. **Monitor** - Scans Reddit, Facebook groups, LinkedIn, and Google Alerts RSS feeds for posts matching your business keywords
2. **Score** - Uses Gemini 2.5 Flash to rate each post's purchase intent (1-10)
3. **Respond** - Uses Gemini 2.5 Pro to craft natural, human-sounding replies that subtly recommend your business
4. **Alert** - Sends leads and suggested responses to your Telegram with one-tap feedback buttons

## Features

- **Automated Reddit RSS Monitoring** - Scans target subreddits every 5 minutes
- **Google Alerts RSS Monitoring** - Monitors web mentions via Google Alerts feeds every 2 minutes
- **Facebook Spy Glass Bookmarklet** - Browser bookmarklet that scans Facebook group posts as you scroll
- **LinkedIn Spy Glass Bookmarklet** - Browser bookmarklet for scanning LinkedIn feed posts
- **Telegram Bot** - Command center for managing businesses, keywords, groups, and alerts
- **Telegram Self-Onboarding** - New clients onboard via `t.me/your_bot?start=setup`
- **Web Dashboard** - View businesses, campaigns, leads, and AI responses
- **Admin Panel** - Manage all clients, businesses, campaigns, keywords, and groups at `/admin`
- **Feedback Loop** - Inline Telegram buttons for rating responses; feedback improves future generations
- **Lead Scoring** - AI-powered intent scoring with configurable thresholds
- **Multi-Business Support** - Each post is evaluated against all relevant businesses

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, TanStack Query
- **Backend**: Express.js, TypeScript (tsx)
- **Database**: PostgreSQL (Drizzle ORM)
- **AI**: Google Gemini 2.5 Pro + Flash via `@google/genai`
- **Auth**: Replit OIDC (OpenID Connect) via Passport.js
- **Bot**: Telegram Bot API with webhook mode

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL database
- Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
- Google Gemini API access

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/kmages/Gemin-Eye.git
   cd Gemin-Eye
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy the environment template and fill in your values:
   ```bash
   cp .env.example .env
   ```

4. Push the database schema:
   ```bash
   npm run db:push
   ```

5. Start the development server:
   ```bash
   npm run dev
   ```

The app will be available at `http://localhost:5000`.

### Production Build

```bash
npm run build
npm start
```

## Project Structure

```
client/                  # React frontend
  src/
    pages/               # Landing, Dashboard, Onboarding, Admin
    components/ui/       # shadcn/ui components
    lib/                 # Query client, utilities
  public/
    spy-glass.js         # Facebook bookmarklet script
    li-spy-glass.js      # LinkedIn bookmarklet script

server/                  # Express backend
  routes.ts              # Main API routes
  routes/
    admin.ts             # Admin CRUD routes
    scan.ts              # Facebook/LinkedIn scan endpoints
  telegram-bot.ts        # Telegram bot commands and webhooks
  telegram.ts            # Telegram messaging utilities
  reddit-monitor.ts      # Reddit RSS monitor
  google-alerts-monitor.ts # Google Alerts RSS monitor
  reddit-poster.ts       # Reddit reply posting (optional)
  storage.ts             # Database storage interface
  utils/
    ai.ts                # Gemini AI client, schemas, parsing
    html.ts              # HTML escaping, stripping, URL utils
    dedup.ts             # Deduplication helpers
    feedback.ts          # Response feedback aggregation
    rate-limit.ts        # Rate limiter factory

shared/
  schema.ts              # Drizzle ORM schema definitions
```

## Telegram Bot Commands

| Command | Description |
|---------|-------------|
| `/newclient` | Create a new business profile |
| `/removeclient` | Delete a business and all its data |
| `/keywords` | View/edit keywords for a business |
| `/groups` | View/edit target subreddits |
| `/addalert` | Add a Google Alerts RSS feed |
| `/alerts` | List active Google Alerts feeds |
| `/removealert` | Remove a Google Alerts feed |

## License

MIT
