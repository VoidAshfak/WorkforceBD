# Workforce BD

## Project Vision
Workforce marketplace for Bangladesh. Connect businesses needing temporary workers with workers looking for flexible earning. 


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
