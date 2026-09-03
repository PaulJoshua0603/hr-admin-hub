# HR Admin Hub

A starter Next.js app for HR/Admin day-to-day work: tasks (with and without
deadlines), standing reminders, an employee onboarding/requirements tracker,
a calendar view, and a Google Drive file panel.

## Getting started

Requires Node.js 18.18+ (Node 20 LTS recommended).

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Auth setup (Sign In / Sign Up / Password recovery)

This app uses Supabase Auth and is built for a single HR/Admin user.

1. In your Supabase project, Auth is enabled by default - no extra SQL
   needed for accounts (only `supabase/schema.sql` for the app data table).
2. Under **Authentication → URL Configuration**, set your Site URL (e.g.
   `http://localhost:3000` while developing) and add
   `http://localhost:3000/reset-password` as a Redirect URL.
3. Copy `.env.local.example` to `.env.local` and fill in your project URL
   and anon key, then `npm run dev`.
4. Go to `/register`, create the one account you'll use, confirm it from
   the email Supabase sends, then sign in at `/login`.
5. `/forgot-password` sends a reset email; the link lands on
   `/reset-password` to set a new password.

Every page except `/login`, `/register`, `/forgot-password`, and
`/reset-password` requires a signed-in session - visiting them while signed
out redirects to `/login`.

## What's included

- **Tasks** (`/tasks`) - add tasks with or without a deadline, mark them
  recurring, see how many days have passed since you wrote them, and mark
  them accomplished.
- **Reminders** (`/reminders`) - standing checklist items with no deadline.
- **Employees** (`/employees`) - add an employee, and the requirements
  deadline is auto-set to 2 weeks from today. Each employee has a
  requirements checklist (List of Requirements, Pre-Employment Medical Exam,
  Employment Form, ID Form, Philhealth Form) with Complete/Lacking status
  and notes, plus a hire date that auto-calculates 3rd month, 5th month, and
  anniversary milestones.
- **Calendar** (`/calendar`) - month view combining task deadlines and
  employee requirement due dates.
- **Files** (`/files`) - paste a Google Drive folder share link to browse,
  upload, and open files (Word/PDF) from an embedded Drive view.
- **Notifications** - the bell icon in the header shows anything overdue or
  due today, pulled from tasks and employee requirements.

## Data storage

This starter version stores everything in the browser's `localStorage` - no
backend or database required to try it out. That means:

- Data is per-browser/per-device, and clearing browser data will erase it.
- To share data across your team or devices, swap `useLocalStore`
  (`src/lib/useLocalStore.ts`) for a real backend - Supabase is a natural
  fit (Postgres + built-in auth, generous free tier).

## Where to plug in real integrations next

- **Google Drive** - the Files page currently just embeds a public/shared
  folder view. For real upload/edit from inside the app, add the Google
  Drive API (`googleapis` package) with OAuth so files can be created,
  listed, and downloaded as Word/PDF without leaving the app.
- **Excel exports** - add the `exceljs` package to generate the multi-sheet
  workbook (daily/weekly/monthly/yearly tabs, checklist of
  complete/lacking employees, weekly department report).
- **Email/Word drafts** - add the `docx` package for generated Word
  documents (COE, regularization letters, contracts) and a mail-sending
  service (e.g. Resend, or Microsoft Graph if you're on Outlook) for the
  recurring draft emails (birthday, anniversary, 3rd/5th month).
- **Notifications beyond in-app** - Vercel Cron (or a Supabase scheduled
  function) can run daily, check deadlines, and send email/Slack/Teams
  pings instead of only the in-app bell.

## Project structure

```
src/
  app/
    page.tsx                    Dashboard
    tasks/page.tsx               Task manager
    reminders/page.tsx           Standing reminders
    employees/page.tsx           Employee list + add form
    employees/[id]/page.tsx      Employee detail, requirements, milestones
    calendar/page.tsx            Month calendar
    files/page.tsx               Google Drive panel
  components/
    AppShell.tsx                 Sidebar + header layout
    NotificationBell.tsx         Alerts dropdown
    ui.tsx                       Shared Button/Card/Input/Pill primitives
  lib/
    useLocalStore.ts             localStorage-backed data hook
    dates.ts                     Date math helpers
  types/index.ts                 Shared TypeScript types
```
