# Jai's Bayou Command Center — Jai Davis

A deployable static WGU study portal with public instructor-shareable resources and an owner-only Supabase dashboard.

## Contents
- `site/`: **only this folder should be deployed to Netlify**.
- `setup/supabase-schema.sql`: database schema, policies, and single-owner authorization.
- `setup/private-workbook-import.json`: **PRIVATE** extracted course/resource records from the uploaded Live Progress workbook. NEVER publish this file or the `setup/` folder.

## Setup
1. Create a Supabase project. In Authentication > Providers, use email/password. Disable public signup in Authentication settings if you only want your own account. Create/invite your personal owner user in Authentication > Users. Set a strong password and enable MFA if available.
2. Run `setup/supabase-schema.sql` in Supabase SQL Editor. Copy the user UUID from Authentication > Users and execute `insert into public.owner_accounts(user_id) values ('YOUR-AUTH-USER-UUID');` with your actual UUID.
3. Open `site/config.js` and enter the Supabase **Project URL** and **anon/publishable** key. **Never use the service_role or secret key.** The anon key is intended for browser use; row-level security protects private data.
4. Deploy **the `site/` folder only** to Netlify (drag-and-drop or Git). Don't deploy the project root because it contains private import data.
5. Visit the site, select **Private Entrance**, and sign in. Go to **Admin HQ** > Import workbook data and select `setup/private-workbook-import.json` from your computer. Imported records are saved in your owner-only Supabase tables.
6. Review statuses and WGU degree mapping. Workbook codes, transfer status, and course list are a **planning snapshot**, not a verified current WGU evaluation. The imported file includes 33 courses and 12 reference links.
7. In **Study Studio**, choose D658, create flashcards and original practice questions. Practice scores are saved privately.
8. In **Admin HQ**, publish a study resource with title, description, and an HTTPS link or public study-guide text. Open the Study Lounge in an incognito window to verify only explicitly published items are visible.

## Security design
- `owner_accounts` is managed by you through the Supabase SQL Editor. No public registration grants admin privileges.
- Private course data, personal notes, flashcards, quizzes, and attempts have owner-only row-level security policies.
- Public visitors can read **only** `public_resources` rows with `published=true`.
- The site contains **no private workbook import or personal notes** in its deployed `site/` folder.
- Do not publish passwords, private student information, official OA questions, or private course notes as public study resources.
- For public mnemonics, publish original content or a link to your own publicly accessible mnemonic page.

## Included in v1
- Public landing page and explicitly published study resources.
- Supabase password login and owner-only dashboard.
- Course status editing and automatic course/CU progress calculations.
- Private resource vault imported from workbook.
- Per-course flashcards and original four-choice practice quiz builder.
- Quiz scoring and private attempt history.
- D658 quick-reference study area.
- Private degree/career planning notes.
- Workbook JSON import and admin publishing controls.

## Planned for v2
- Bulk quiz/flashcard import, card spaced repetition, editable study calendar, official OA attempt log, richer skill-level analytics, uploads with private storage policies, customizable themes, and complete degree-roadmap editing.

## Testing checklist
- Sign in as owner; import courses; change a status; confirm progress updates.
- Create a D658 card and question; complete quiz; check saved attempt history.
- Publish a resource; open site in incognito; verify only that resource is visible.
- Try fetching `/rest/v1/courses` with anon key without a login: it must return no private rows.
- Verify the deployed Netlify site does **not** contain `/setup/` or the private JSON import file.

No deployment, Supabase account creation, or security testing against a live database was performed automatically. You must complete setup and validate before using with real personal data.
