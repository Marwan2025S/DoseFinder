# DoseFinder (React + Vite)

Converted from the original static multi-page HTML/CSS/JS website into a React + Vite app, while keeping the original visual style and page flow.

## Setup

```bash
npm install
npm run dev
```

Optional checks:

```bash
npm run lint
npm run build
```

## Routing Structure

Implemented with `react-router-dom`.

- `/` and `/index` -> Home
- `/login` -> Login
- `/register` -> User register
- `/request-account` -> Doctor account request
- `/dashboard` -> Admin Dashboard
- `/medications` -> Medications table
- `/add-drug` -> Add medication
- `/edit-drug` and `/edit-drug/:id` -> Edit medication
- `/chatbot` -> Chatbot page
- `/search` and `/search-results` -> Search results page
- `/drug/:id` and `/view/:id` -> Drug detail page
- `*` -> NotFound (404)

## Project Structure

```text
src/
  assets/         # copied static assets (images/fonts references)
  components/     # reusable UI (Navbar, Footer, App shell, headers, toast)
  pages/          # route pages
  styles/         # CSS from original static site, split by feature/page
  App.jsx         # route map
  main.jsx        # app entry
```

## Notes on Conversion

- Shared layouts were split into React components:
  - Public: `Navbar`, `Footer`
  - Search/detail: `SearchHeader`, `Footer`
  - Admin: `AppLayout`, `AppSidebar`, `AppTopbar`, `AIPanel`
- Original page behaviors were migrated to React state/effects:
  - home hero search suggestions
  - FAQ accordion
  - filters, sorting, pagination, saved states
  - sidebar/AI panel toggles and overlays
  - form validation feedback and toast notifications
- Static assets were preserved and used from `src/assets` and existing styles from `src/styles`.
