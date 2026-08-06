# AuditFlow

A practice management system for audit and tax firms — client records,
work orders, compliance deadline tracking, staff scheduling, and firm-wide
reporting in one place.

Built as a static HTML/CSS/vanilla-JS app, backed entirely by Supabase
(Auth, Postgres, Row Level Security, Storage, scheduled jobs). No frontend
framework, no build step, no separate API server.

## What it does

- **Client management** — company records, branch/team assignment, financial
  year end tracking, appointment-of-auditor history, bulk import/export via
  Excel
- **Work orders** — audit, tax, and custom engagement types with configurable
  step-by-step workflows, staff/partner/manager assignment, automatic
  work order numbering
- **Compliance tracking** — automatic deadline generation for statutory
  filings (audit reports, tax computations, estimated tax payments and
  revisions), scoped to each client's financial year end, with a
  firm-wide monitoring view
- **Multi-branch / multi-team access control** — data visibility scoped by
  branch and team via Postgres Row Level Security, not just application-level
  checks
- **Dashboard reporting** — work-in-progress and deadline charts, filterable
  by branch, team, and staff
- **Firm announcements** — an internal news feed with automatic entries for
  client onboarding/offboarding, plus manual firm-wide posts
- **ISQM support** — independence declaration tracking and independence
  concern reporting with a discussion thread and resolution workflow
- **Report generation** — built-in and customisable exports to Excel
- **Role-based access** — Firm Admin, Manager, and Staff roles, each with
  scoped permissions enforced at the database level

## Running locally

This is a static site — no build step. Any local static server works, e.g.:

```
npx serve .
```

Then open the printed URL. Before that, copy `config.example.js` to
`config.js` and fill in your own Supabase project URL and anon key. Both
values are safe to expose in a browser — access control is enforced by
Row Level Security, not by keeping these values secret — but `config.js`
is gitignored anyway so a clone or fork doesn't default to pointing at
someone else's live project.

## Deploying

Static output, so GitHub Pages, Netlify, or any static host works as-is.
Hash-based routing (`#/dashboard`, `#/clients`, etc.) means no server-side
rewrite rules are needed.

## Architecture notes

- Every table is scoped by `organisation_id`, so a single Supabase project
  can host multiple independent firms with full data isolation enforced by
  Row Level Security — not just a single-tenant deployment.
- No ORM — plain Supabase client queries throughout, with business logic
  living in Postgres functions and triggers where it needs to be
  authoritative (deadline calculations, work order numbering, status
  rollups) rather than duplicated in the frontend.
