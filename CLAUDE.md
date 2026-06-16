# Workforce BD

## Project Vision
Workforce marketplace for Bangladesh. Connect businesses needing temporary workers with workers looking for flexible earning. A user can work here or can post for a job. For now, one admin user will be created. The admin will approve the job post and other security and spam related things. Worker or Business login can not use most of the features without admin verification.

## Main Features
- Worker login
- business login
- worker/business verification
- go through shifts
- apply for shifts
- create shifts from business account
- notification system for important events
- chat between worker and business
- progess tracking
- trust metrics
- statistical graphs

note: you can get a lot clear idea from the database reference file. (docs/workforce_marketplace_schema.sql)


## Tech Stack
- Nodejs
- Javascript (not TypeScript)
- Express
- Docker
- Nginx 
- Postgresql
- Prisma


## Commands

```bash
npm run dev      # run app
```


## Architecture & Module

- `src/index.js` — entry point
- `src/app.js` — Express app setup (when populated)
- `src/constants.js` — shared constants
- Modular Monolith backend
- Feature-based modules
- ensure proper all security mesures
- role based access (a user may be worker, business and admin)
- **Source of Truth:** The backend engine, state machines, and lifecycle rules are mapped out explicitly in `docs/BACKEND_MAP.md`.
- **Rule:** Before writing any API endpoints, database migrations, hooks, or service layer logic, you MUST read the corresponding module section in `docs/BACKEND_MAP.md` and check the relevant screenshots in `docs/`.


## Database
See:
- docs/workforce_marketplace_schema.sql (not the final version. may change during development)

## Coding Rules

- DRY
- KISS
- SOLID
- JSDoc comments
- No business logic in controllers
- Service layer contains business logic
- Repository layer handles database access
- Consistent error handling
- Use async/await
- No class-based architecture unless necessary


## Folder Structure
```
WorkforceBD/
├── docs/
│   └── workforce_marketplace_schema.sql
└── src/
    ├── app.js
    ├── constants.js
    ├── controllers/
    ├── db/
    │   └── index.js
    ├── index.js
    ├── middleware/
    ├── modules/
    │   ├── auth/
    │   │   ├── auth.routes.js
    │   │   ├── auth.controller.js
    │   │   ├── auth.service.js
    │   │   ├── auth.repository.js
    │   │   └── auth.validation.js
    .    .
    .    .
    .    .
    └── utils/
```
## Additional Instructions
- write minimal comment for new developers
- add logging to important checkpoints
- whenever you change the db schema (adding a column), update the docs/workforce_marketplace_schema.sql file
- whenever you add, change, or remove an API endpoint (route, request/response shape, params, error cases, or auth/role/verification requirements), update docs/api-guidelines.md to match in the same change
