# Library Seat Reservation System

Bachelor thesis project (Jiangxi University of Science and Technology, 2026):
a seat reservation system for a university library, with a WeChat Mini Program
for readers, a Node.js backend, a MySQL database, a web admin dashboard and a
machine-learning based seat recommendation.

> The user interface is in Chinese, because the system was built for a Chinese university library.

## What it does

**Readers (WeChat Mini Program)**
- Browse zones and seats with their properties (window, power outlet, quiet, table size, …)
- See a seat's timeline for the day and reserve a time slot
- Check in (location-based), take a temporary leave, return and check out
- View reservations, notices and their credit score
- Describe what they need in natural language ("quiet seat with a power outlet for a long study session")
  and get ranked seat recommendations

**Administrators (web dashboard)**
- Dashboard with usage rate, reservations, check-in rate and no-shows
- Manage notices, seats, users and credit scores
- Configure reservation rules (opening hours, maximum duration, days in advance, leave limits, …)

## Architecture

```
WeChat Mini Program ─┐
                     ├── HTTP/JSON ──> Node.js server ──> MySQL
Web admin dashboard ─┘                     │
                                           └── Python (scikit-learn SVM) for recommendations
```

| Part | Technology | Folder |
|---|---|---|
| Reader app | WeChat Mini Program (WXML, WXSS, JavaScript) | `miniprogram/` |
| Backend | Node.js (built-in `http` module), `mysql2` | `server/` |
| Admin dashboard | HTML, CSS, JavaScript (no framework) | `admin-web/` |
| Database | MySQL 8, schema and seed data | `sql/` |
| Recommendation | Python, scikit-learn | `scripts/`, `data/` |
| Early web prototype | HTML, CSS, JavaScript | `prototype/` |

## Technical highlights

### Correct reservations under concurrent requests

Two readers may try to book the same seat for overlapping times at the same moment.
Reservation creation therefore runs inside a **database transaction** and locks the
relevant rows with `SELECT … FOR UPDATE` before checking for conflicts:

1. Start a transaction
2. Lock the user row and the existing reservations of the seat
3. Check the rules: account conflict, seat conflict, opening hours, maximum duration, credit status
4. Insert the reservation and its time slots, then commit (or roll back on any error)

Because the second request has to wait for the lock, it sees the first reservation and
is rejected. Only one of several concurrent requests for the same seat and time slot succeeds
(`server/src/repositories/reservation-repository.js`).
### Rules checked in the backend

All business rules (time validity, opening hours, maximum duration of 240 minutes,
booking at most 3 days in advance, check-in window, temporary leave limits, blacklist)
are enforced on the server, not only in the user interface. The rules are stored in the
database and can be changed in the admin dashboard.

### Seat recommendation as multi-label classification

Seat recommendation is modelled as matching between a reader's requirement and a seat:

- 56 representative requirements × 1,772 seats → 99,232 candidate pairs,
  34,216 after filtering and class balancing
- 68 features per pair (seat environment, table group and zone statistics, preference matches, conflicts)
- 4 output labels: deep focus, comfortable long study, device work, open collaboration
- 7 classifiers compared (logistic regression, SVM, MLP, random forest, decision tree, k-NN, Gaussian naive Bayes)

| Model | Macro-F1 | Micro-F1 | Top-5 precision |
|---|---|---|---|
| SVM (selected) | 0.907 | 0.927 | 0.964 |

At runtime the server filters the seats that can actually be booked, builds the features
and calls the trained SVM; the final ranking combines model scores with explicit
preference matches and penalties for conflicts.

### Authentication

- Passwords are hashed with **scrypt** (Node.js `crypto`, random salt per user) and compared in constant time
- Login errors do not reveal whether the account or the password was wrong
- Sessions use HMAC-signed tokens; the signing secret comes from the environment (`AUTH_TOKEN_SECRET`)
- Admin endpoints require an admin token; readers cannot access `/api/admin/*`

## Running locally

Requirements: Node.js 18+, MySQL 8, Python 3 with scikit-learn (only for recommendations),
WeChat DevTools (only for the Mini Program).

```bash
# 1. Database
mysql -u root -p < sql/001_schema.sql
mysql -u root -p library_seat_reservation < sql/002_seed_config_and_demo.sql
mysql -u root -p library_seat_reservation < sql/003_seed_library_layout.sql
mysql -u root -p library_seat_reservation < sql/004_seed_final_demo_data.sql

# 2. Server
cd server
cp .env.example .env          # fill in DB_PASSWORD and AUTH_TOKEN_SECRET
npm install
npm run db:check              # checks the database connection
npm run set-password -- LIB001 <password>   # seeded admin accounts have no password yet
npm start                     # http://127.0.0.1:3000

# 3. Tests
npm run test:auth             # offline test of registration, login and password hashing
npm test                      # end-to-end smoke test against a running server
```

- Admin dashboard: open `http://127.0.0.1:3000/admin/` and log in with the admin account
- Mini Program: import the repository root in WeChat DevTools (`miniprogram/config/env.js`
  points to the local server by default)

## Project structure

```
miniprogram/     WeChat Mini Program (pages, services, utils)
server/          Node.js backend: HTTP routes, repositories (SQL), rules, authentication
admin-web/       admin dashboard
sql/             schema, seed data and migrations
scripts/         dataset construction, model training and evaluation, runtime inference
data/            seat master data and recommendation runtime data
prototype/       first web prototype of the seat filter
```

## License

MIT
