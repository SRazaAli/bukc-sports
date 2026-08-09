-- 025 — Add coordinator send-back verbs to approval_verb enum.
-- These were added to the TypeScript type in the send-back feature (session 024)
-- but the Postgres enum was never updated, causing 22P02 on INSERT.
ALTER TYPE approval_verb ADD VALUE IF NOT EXISTS 'SEND_BACK';
ALTER TYPE approval_verb ADD VALUE IF NOT EXISTS 'ACCEPT_SENT_BACK';
ALTER TYPE approval_verb ADD VALUE IF NOT EXISTS 'DECLINE_SENT_BACK';
