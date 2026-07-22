-- Save-draft support for the create-shift wizard.
--
-- A draft is a half-filled form, so the fields the wizard collects across later
-- steps must be allowed to be NULL. The CHECK keeps that relaxation scoped to
-- `draft` only: any shift that leaves draft (submitted, published, …) must carry
-- the complete posting, which the service enforces in publishShift().
--
-- Run once against the database, then `npm run db:sync`:
--   npx prisma db execute --file scripts/sql/2026-07-22_draft_shifts_nullable.sql --schema prisma/schema.prisma

ALTER TABLE shifts
    ALTER COLUMN title       DROP NOT NULL,
    ALTER COLUMN category_id DROP NOT NULL,
    ALTER COLUMN shift_date  DROP NOT NULL,
    ALTER COLUMN start_time  DROP NOT NULL,
    ALTER COLUMN end_time    DROP NOT NULL,
    ALTER COLUMN pay_amount  DROP NOT NULL;

ALTER TABLE shifts
    DROP CONSTRAINT IF EXISTS shifts_complete_unless_draft;

ALTER TABLE shifts
    ADD CONSTRAINT shifts_complete_unless_draft CHECK (
        status = 'draft' OR (
            title IS NOT NULL AND category_id IS NOT NULL AND shift_date IS NOT NULL
            AND start_time IS NOT NULL AND end_time IS NOT NULL AND pay_amount IS NOT NULL
        )
    );
