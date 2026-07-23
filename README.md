# Lineage — Family Tree App

A full-stack family tree builder: add people, connect them as parents,
spouses, and children, and see them laid out automatically as a
generational chart (top = oldest ancestors, each row below = the next
generation), similar to MyHeritage-style tree views.

## Stack

- **Backend:** Node.js + Express + PostgreSQL (via `pg`) — providing secure, multi-tenant family trees.
- **Frontend:** Plain HTML/CSS/JS (no build step) rendered as SVG, served
  by the same Express server.

## Setup

Requires [Node.js](https://nodejs.org) 18+. You will also need a PostgreSQL database.

1. Ensure PostgreSQL is running and create a database (e.g., `family_tree`).
2. Create a `.env` file in the project folder with your database connection:
   ```env
   DATABASE_URL=postgresql://postgres:password@localhost:5432/family_tree
   SESSION_SECRET=create_a_super_secret_random_string_here
   ```
3. Install dependencies and start the app:
   ```bash
   npm install
   npm start
   ```

Then open **http://localhost:4000** in your browser. The tables will be created automatically on the first run.


## Using it

- **Add a person** — top-right button, or the empty-state prompt on a
  blank tree. Fill in name, dates, a photo (optional), and — if this
  isn't the very first person — pick how they connect to someone already
  in the tree (child of / parent of / spouse of).
- **Click any card** to open their detail panel on the right: edit their
  info, or use "+ Add parent / child / spouse" to grow the tree from
  that person.
- **Hover a card** and click the small "+" badge on it as a shortcut to
  add a relative connected to that person.
- **Search** people by name in the top bar; selecting a result centers
  the view on them.
- **Pan** by dragging the canvas; **zoom** with the +/− buttons or
  Ctrl/Cmd + scroll wheel.
- The tree name at the top left is editable and saved automatically.

## Data model

Two tables in SQLite:

- `persons` — one row per individual (name, gender, birth/death dates,
  birthplace, photo URL, notes).
- `relationships` — one row per connection:
  - `type = 'parent'`: `person1_id` is the parent of `person2_id`.
  - `type = 'spouse'`: `person1_id` and `person2_id` are partners
    (undirected).

The tree view is computed client-side from these two tables: people are
grouped into "couple units" via spouse links, generations are computed
from parent/child links, and units are positioned left-to-right so that
children are centered under their parents (a simplified tidy-tree
layout). Everything is recomputed live from the database — there's no
separate "layout" table to keep in sync.

## API

All endpoints are under `/api`:

| Method | Path                  | Purpose                          |
|--------|-----------------------|-----------------------------------|
| GET    | `/persons`             | List all people                  |
| POST   | `/persons`              | Create a person                  |
| GET    | `/persons/:id`          | Get one person                   |
| PUT    | `/persons/:id`          | Update a person                  |
| DELETE | `/persons/:id`          | Delete a person (and their relationships) |
| GET    | `/relationships`        | List all relationships           |
| POST   | `/relationships`        | Create a relationship            |
| DELETE | `/relationships/:id`    | Remove a relationship            |
| GET    | `/tree`                 | Everything needed to render the tree |
| PUT    | `/tree`                 | Rename the tree                  |
| POST   | `/upload`               | Upload a profile photo (multipart, field `photo`) |

## Known limitations (MVP)

- The generational layout assumes a mostly "normal" family tree. Very
  unusual cases (e.g. cousins marrying into the same unit, deeply
  overlapping blended families) may render with some visual overlap —
  the underlying data is still stored correctly either way.

## Deploying to Render
1. Create a **Web Service** on Render pointing to your repository.
2. Depending on your choice, also create a PostgreSQL DB instance via Render or use an external URL. 
3. Under Environment Variables for your Web Service, add:
   - `DATABASE_URL`: Set this to your PostgreSQL connection string (e.g., Internal Database URL if hosted on Render as well).
   - `SESSION_SECRET`: A secure random string for session cookies.

## Project structure

```
family-tree-app/
├── server.js         # Express app + REST API
├── db.js             # SQLite schema + connection
├── package.json
└── public/
    ├── index.html
    ├── style.css
    ├── app.js         # tree layout algorithm + all UI logic
    └── uploads/        # uploaded profile photos land here
```
