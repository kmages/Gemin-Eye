# Gemin-Eye - AI-Powered Customer Acquisition Platform

## Overview

Gemin-Eye is an AI-powered customer acquisition platform that monitors niche online communities (Facebook groups, Reddit, etc.) for high-intent questions, then generates helpful, human-sounding responses that subtly promote a client's business. Instead of traditional advertising, it finds people actively seeking recommendations and engages them organically.

The app has three main flows:
1. **Landing page** - Marketing page with animated demo showing how the product works
2. **Onboarding** - Multi-step wizard where users describe their business, and AI generates a monitoring strategy (platforms, target groups, keywords, sample responses)
3. **Dashboard** - Shows businesses, campaigns, leads discovered, and AI-generated responses with status tracking

## Recent Changes (Feb 14, 2026)
- Added automated Reddit RSS monitor (`server/reddit-monitor.ts`) that scans subreddits every 90 seconds
  - Pulls target subreddits from DB campaigns (targetGroups field)
  - Filters posts by keywords, then uses Gemini Flash for lead scoring
  - Generates responses with Gemini Pro for leads with intent >= 5
  - Saves leads and responses to DB, sends Telegram alerts with feedback buttons
  - Includes rate-limit handling, seen-post deduplication, and memory pruning
- Improved Context Upgrade: Bot now matches first, only asks "Which group?" when confidence < 6 AND multiple businesses exist (not every post)
- Added feedback deduplication: one feedback per responseId prevents spam
- Added TTL (5 min) on pending context requests to prevent stale state
- Added Context Upgrade: Bot asks "Which group is this from?" when group name is missing and multiple businesses exist, improving match accuracy
- Added Feedback Loop: Every AI response includes 4 inline buttons (Used It / Bad Match / Too Salesy / Wrong Client) saved to `response_feedback` table
- Feedback-aware response generation: Bot queries recent feedback per business and adjusts prompts (e.g., less salesy if flagged)
- Leads and AI responses now saved to database when generated via Telegram bot
- Added screenshot/image support to Telegram bot - send a screenshot and Gemini Flash reads text from the image
- Added admin command center via Telegram: /newclient, /removeclient, /keywords, /groups for managing businesses entirely from chat
- Primary domain: Gemin-Eye.com

## Previous Changes (Feb 13, 2026)
- Built complete frontend: landing page with animated demo, onboarding wizard, and dashboard
- Built backend API routes with Zod validation, auth protection, and ownership checks
- Added seed data with 3 demo businesses: Doro Mind, Chicago Bocce, LMAITFY.ai
- Fixed authorization on response approval endpoint (ownership verification)
- Added lead scoring endpoint using Gemini 2.5 Flash
- Strategy generation and response crafting use Gemini 2.5 Pro
- Implemented Telegram bot with URL detection, business matching, and response generation
- Added inline keyboard buttons for direct post navigation

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight alternative to React Router)
- **State/Data fetching**: TanStack React Query for server state management
- **Styling**: Tailwind CSS with CSS variables for theming (light/dark mode support)
- **UI Components**: shadcn/ui (new-york style) built on Radix UI primitives
- **Forms**: React Hook Form with Zod validation via @hookform/resolvers
- **Build tool**: Vite with HMR support
- **Path aliases**: `@/` maps to `client/src/`, `@shared/` maps to `shared/`
- **Brand colors**: Indigo/violet (hsl 258 70% 55%) with Inter sans-serif font

### Backend
- **Framework**: Express.js running on Node with TypeScript (via tsx)
- **HTTP server**: Node's built-in `http.createServer` wrapping Express
- **API pattern**: RESTful JSON APIs under `/api/` prefix
- **AI Integration**: Google Gemini via `@google/genai` SDK, accessed through Replit's AI Integrations proxy
- **AI Model Usage**:
  - `gemini-2.5-pro`: Strategy generation and response crafting (high quality)
  - `gemini-2.5-flash`: Lead scoring (fast/cheap)
- **Build for production**: esbuild bundles server to `dist/index.cjs`, Vite builds client to `dist/public/`

### Authentication
- **Method**: Replit OpenID Connect (OIDC) authentication via Passport.js
- **Sessions**: Express sessions stored in PostgreSQL via `connect-pg-simple`
- **Required tables**: `sessions` and `users` tables (defined in `shared/models/auth.ts`) — these are mandatory and should not be dropped
- **Session duration**: 1 week TTL
- **Middleware**: `isAuthenticated` middleware protects API routes; user info available at `req.user.claims.sub`

### Database
- **Database**: PostgreSQL (required, connection via `DATABASE_URL` env var)
- **ORM**: Drizzle ORM with `drizzle-zod` for schema-to-Zod validation
- **Schema location**: `shared/schema.ts` (re-exports from `shared/models/auth.ts` and `shared/models/chat.ts`)
- **Migration tool**: Drizzle Kit with `db:push` command for schema synchronization
- **Key tables**:
  - `users` - User accounts (Replit Auth managed)
  - `sessions` - Session storage (Replit Auth managed)
  - `businesses` - User's business profiles with target audience, tone preferences
  - `campaigns` - Monitoring campaigns per business (platform, target groups, keywords)
  - `response_feedback` - Feedback on AI responses (positive, bad_match, too_salesy, wrong_client)
  - `leads` - Discovered high-intent posts from communities
  - `ai_responses` - AI-generated responses to leads with approval status
  - `conversations` / `messages` - Chat functionality tables

### Storage Layer
- **Pattern**: Interface-based storage (`IStorage` in `server/storage.ts`) with `DatabaseStorage` implementation
- **Auth storage**: Separate `IAuthStorage` interface in `server/replit_integrations/auth/storage.ts`
- **Chat storage**: Separate `IChatStorage` interface in `server/replit_integrations/chat/storage.ts`

### Replit Integrations (server/replit_integrations/)
Pre-built modules that provide:
- **auth/**: OIDC authentication setup, session management, user routes
- **batch/**: Batch processing utilities for Gemini API calls with rate limiting, retries, and concurrency control
- **chat/**: Conversation/message CRUD routes and storage for AI chat functionality
- **image/**: Image generation endpoint using Gemini's image model

### Dev vs Production
- **Development**: Vite dev server with HMR proxied through Express, `tsx` runs TypeScript directly
- **Production**: Vite builds static assets to `dist/public/`, esbuild bundles server to `dist/index.cjs`, Express serves static files

## External Dependencies

- **PostgreSQL**: Primary database, required via `DATABASE_URL` environment variable
- **Replit AI Integrations (Gemini)**: AI text and image generation, configured via `AI_INTEGRATIONS_GEMINI_API_KEY` and `AI_INTEGRATIONS_GEMINI_BASE_URL` environment variables
- **Replit OIDC**: Authentication provider via `ISSUER_URL` (defaults to `https://replit.com/oidc`) and `REPL_ID`
- **Session Secret**: `SESSION_SECRET` environment variable required for Express session encryption
- **Google Fonts**: Inter, Playfair Display, JetBrains Mono
- **react-icons**: Social media icons (Facebook, Reddit) via `react-icons/si`
