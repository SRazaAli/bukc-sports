-- ============================================================================
-- 031 — Messages (chat with the Coordinator desk).
--
-- Replaces "email the head and wait": people chat with the Coordinators
-- inside the portal.
--
-- Who can talk to whom:
--   STUDENT / EXTERNAL  ↔  Coordinators   (they can't message the Super Admin)
--   SUPER_ADMIN         ↔  Coordinators   (only Coordinators reach the Super Admin)
--   COORDINATOR         ↔  any of the above
--
-- Model: one conversation per non-coordinator user ("party"). The other side
-- is the Coordinator desk — every Coordinator sees the conversation and any
-- of them can reply (each message records which Coordinator sent it).
--
-- Read tracking is per user (conversation_read.last_read_at), so the sidebar
-- badge is correct for each Coordinator on their own.
-- ============================================================================

CREATE TABLE IF NOT EXISTS conversation (
  conversation_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_user_id    uuid NOT NULL UNIQUE REFERENCES app_user(user_id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_message_at  timestamptz
);

CREATE TABLE IF NOT EXISTS message (
  message_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid NOT NULL REFERENCES conversation(conversation_id),
  sender_id        uuid NOT NULL REFERENCES app_user(user_id),
  body             text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ck_message_body CHECK (length(btrim(body)) BETWEEN 1 AND 2000)
);
CREATE INDEX IF NOT EXISTS idx_message_conv_time ON message (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS conversation_read (
  conversation_id  uuid NOT NULL REFERENCES conversation(conversation_id),
  user_id          uuid NOT NULL REFERENCES app_user(user_id),
  last_read_at     timestamptz NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
);

-- The party of a conversation is never a Coordinator (Coordinators are the desk).
CREATE OR REPLACE FUNCTION fn_conversation_party_guard() RETURNS trigger AS $$
BEGIN
  IF fn_role_of(NEW.party_user_id) NOT IN ('STUDENT', 'EXTERNAL', 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'MSG-01: a conversation is between the Coordinator desk and a student, external or Super Admin (got %)',
      fn_role_of(NEW.party_user_id);
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS tg_conversation_party ON conversation;
CREATE TRIGGER tg_conversation_party BEFORE INSERT OR UPDATE ON conversation
  FOR EACH ROW EXECUTE FUNCTION fn_conversation_party_guard();

-- Only the conversation's own party or a Coordinator may post in it.
-- (So a student can never write to the Super Admin, nor into someone else's chat.)
CREATE OR REPLACE FUNCTION fn_message_sender_guard() RETURNS trigger AS $$
DECLARE party uuid;
BEGIN
  SELECT party_user_id INTO party FROM conversation WHERE conversation_id = NEW.conversation_id;
  IF NEW.sender_id <> party AND fn_role_of(NEW.sender_id) <> 'COORDINATOR' THEN
    RAISE EXCEPTION 'MSG-02: only the conversation''s member or a Coordinator can send messages here';
  END IF;
  UPDATE conversation SET last_message_at = NEW.created_at WHERE conversation_id = NEW.conversation_id;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS tg_message_sender ON message;
CREATE TRIGGER tg_message_sender BEFORE INSERT ON message
  FOR EACH ROW EXECUTE FUNCTION fn_message_sender_guard();
