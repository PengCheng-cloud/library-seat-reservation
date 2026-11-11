# SQL files

Run in this order:

1. `001_schema.sql`: database and tables
2. `002_seed_config_and_demo.sql`: default reservation rules, admin accounts and notices
3. `003_seed_library_layout.sql`: zones and seats (generated from `data/seat_master.json`)
4. `004_seed_final_demo_data.sql`: demo readers, notices and reservations
5. `006_backfill_reservation_slots.sql`: time slots of the seeded reservations

`005_add_password_hash.sql` and `007_add_reservation_date_index.sql` are only needed for
databases created before password login and the index on `reservation_date` were added
to `001_schema.sql`.

`dev/generate_history.sql` fills the database with one million synthetic reservations for
looking at query plans (see `docs/database.md`); `dev/remove_history.sql` removes them.

The seeded admin accounts have no password; set one with
`npm run set-password -- <account> <password>` in `server/`.

To regenerate `003` after changing the seat data:

```bash
python scripts/build_library_seed_sql.py
```
