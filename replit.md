# Gemin-Eye - AI-Powered Customer Acquisition Platform

## Overview

Gemin-Eye is an AI-powered customer acquisition platform designed to revolutionize customer acquisition by leveraging AI to monitor niche online communities (Facebook groups, Reddit, etc.) for high-intent questions. It generates helpful, human-sounding responses that subtly promote client businesses, offering an organic alternative to traditional advertising. The platform features a landing page, an onboarding wizard for business setup, a dashboard for campaign and lead management, and an admin panel for overall client and campaign oversight.

## User Preferences

Preferred communication style: Simple, everyday language.
Always push code to GitHub after every commit (requires GitHub remote to be connected).
Always derive keywords from a new client's website — scrape their actual site to understand what they offer before setting up campaigns.
Business data (type, core_offering, target_audience) must accurately reflect what the business actually is, based on their website.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter
- **State/Data fetching**: TanStack React Query
- **Styling**: Tailwind CSS with CSS variables (light/dark mode)
- **UI Components**: shadcn/ui built on Radix UI
- **Forms**: React Hook Form with Zod validation
- **Build tool**: Vite
- **Branding**: Indigo/violet color scheme, Inter sans-serif font

### Backend
- **Framework**: Express.js on Node with TypeScript
- **API pattern**: RESTful JSON APIs under `/api/`
- **AI Integration**: Google Gemini via `@google/genai` SDK
  - `gemini-2.5-pro`: Strategy generation and response crafting
  - `gemini-2.5-flash`: Lead scoring
- **Build**: esbuild for server, Vite for client

### Authentication
- **Method**: Replit OpenID Connect (OIDC) via Passport.js
- **Sessions**: Express sessions stored in PostgreSQL using `connect-pg-simple`
- **Middleware**: `isAuthenticated` for route protection

### Database
- **Database**: PostgreSQL
- **ORM**: Drizzle ORM with `drizzle-zod`
- **Schema**: `shared/schema.ts`
- **Migration**: Drizzle Kit
- **Key tables**: `users`, `sessions`, `businesses`, `campaigns`, `response_feedback`, `leads`, `ai_responses`, `conversations`, `messages`

### Storage Layer
- **Pattern**: Interface-based storage (`IStorage`, `IAuthStorage`, `IChatStorage`)

### Replit Integrations
- Pre-built modules for OIDC authentication, batch processing (rate limiting, retries), chat functionality (CRUD), and image generation.

### Core Features
- **AI-Powered Monitoring**: Scans platforms like Reddit, Facebook groups, and Google Alerts for high-intent questions.
- **Smart Keyword Matching**: Utilizes a sophisticated keyword matching algorithm that includes multi-word and stop-word filtering for more accurate lead detection.
- **AI-Generated Responses**: Crafts helpful, community-compliant responses tailored to the platform (e.g., Reddit responses exclude promotional content).
- **Lead Scoring**: Employs Gemini Flash for unbiased lead scoring across various monitoring channels.
- **Client Onboarding**: Multi-step wizard (web or Telegram-based) for business description and AI-generated monitoring strategy. Automatically creates Google Alerts campaigns for every new business.
- **Admin Panel**: Comprehensive management of clients, businesses, campaigns, keywords, and groups. Includes a monitoring kill switch.
- **Bookmarklets**: Facebook and LinkedIn "Spy Glass" bookmarklets for clients to manually scan groups.
- **Telegram Bot**: Facilitates client onboarding, lead alerts, feedback, and admin commands.
- **Slack Integration**: Sends lead notifications to Slack channels via incoming webhooks, configured per-business alongside Telegram.
- **Robustness**: Includes AI call timeout protection, rate limiting, Zod validation for AI JSON parsing, and modularized code.
- **Performance**: Optimized dashboard data fetching and modularized Telegram bot for better maintainability and scalability.

## External Dependencies

- **PostgreSQL**: Primary database.
- **Replit AI Integrations (Gemini)**: For AI text and image generation.
- **Replit OIDC**: For user authentication.
- **Google Fonts**: Inter, Playfair Display, JetBrains Mono.
- **react-icons**: For social media icons.