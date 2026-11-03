# Server

Node.js backend (no web framework, built-in `http` module) with a MySQL database.

```bash
cp .env.example .env    # database connection and AUTH_TOKEN_SECRET
npm install
npm start               # default port 3000
```

| Script | Purpose |
|---|---|
| `npm run db:check` | check the database connection |
| `npm run set-password -- <account> <password>` | set a password, e.g. for the seeded admin accounts |
| `npm run test:auth` | offline test of password hashing, registration and login |
| `npm test` | smoke test of the main API flow against a running server |

Main endpoints: `/api/health`, `/api/home`, `/api/rules`, `/api/zones`, `/api/seats`,
`/api/auth/register`, `/api/auth/login`, `/api/reservations/preview`, `/api/reservations`,
`/api/reservations/{no}/checkin|checkout|cancel`, `/api/assistant/seat`, `/api/admin/*`.
