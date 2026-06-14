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


## Architecture

- `src/index.js` — entry point
- `src/app.js` — Express app setup (when populated)
- `src/constants.js` — shared constants
- Modular Monolith backend
- Feature-based modules
- role based access (a user may be worker, business and admin)


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
    ├── models/
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
