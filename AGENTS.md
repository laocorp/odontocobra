# Repository Guidelines

## Project Structure & Module Organization

This repository contains the OdontoCuenta application (a single-clinic product, separate from any SaaS copy), its shared payment domain, and Supabase backend assets. The web app lives in `apps/web`, reusable financial/payment rules in `packages/domain`, versioned schema and RLS changes in `supabase/migrations`, and server integrations in `supabase/functions`. Keep UI concerns in the app and financial calculations in the domain package. Keep manual registration available unless the product owner explicitly changes that decision.

## Build, Test, and Development Commands

Use the workspace scripts documented in `README.md` and confirm any additional commands in the root `package.json`. Common commands are `pnpm install`, `pnpm dev`, `pnpm supabase:start` (requires Docker), and `pnpm db:reset` (local database only). Check visual changes in both themes and mobile/desktop widths; inspect browser errors and horizontal overflow. For schema and role changes, review migrations and verify allowed and denied RLS access when the backend is available.

## Coding Style & Naming Conventions

Follow the formatter, lint rules, and TypeScript settings committed with the application. Use clear domain names for patients, plans, installments, payments, and allocations. Keep money calculations in shared domain functions: represent amounts in integer minor units where applicable, use exact decimal arithmetic for exchange-rate conversions, and centralize rounding rules. Keep agreed USD plan values and historical payment data immutable; correct financial records through audited reversals or adjustments. Reuse `apps/web/src/brand.css` and `brand-theme.css`: the product palette is warm gold, cream, taupe, and charcoal, with no green/teal UI accents. Put theme rules in the shared brand styles instead of adding more inline overrides to `App.tsx`. Give SVGs a deliberate `currentColor` and verify contrast in both themes; use at least 14 px form text on desktop and 16 px on mobile to prevent browser zoom on input focus.

## Testing Guidelines

Use the root `pnpm build`, `pnpm typecheck`, and `pnpm test` scripts when changing behavior. Cover installment rounding, payment allocation, balances, reversals, and exchange-rate conversion in the domain. Verify clinic membership and role isolation with both allowed and denied cases in Supabase RLS policies. For UI changes, check both themes at mobile and desktop widths, keyboard focus, accessible names, browser console, and horizontal overflow. Follow the test naming convention configured by the selected framework.

## Commit & Pull Request Guidelines

Use concise imperative commit subjects with a type prefix, such as `feat: add payment allocation` or `docs: clarify pilot scope`. Pull requests should summarize behavior and decisions, link the relevant issue or product-plan section, describe tests and migrations, and include screenshots for UI changes.

## Security & Configuration

Never expose privileged Supabase `service_role` or secret keys in browser code. Enforce clinic membership and role checks in RLS, and keep credentials in ignored local environment configuration. `.env.example` may contain variable names and placeholders only. Use fictitious or anonymized patient data during development. This product stores contact and billing information, not clinical histories; do not submit or remove patient/payment records during UI checks.
