-- ============================================================================
-- 007 — two additional notification_type values Feature 3 needs.
-- Additive (ALTER TYPE ... ADD VALUE); nothing existing changes.
-- ============================================================================

-- Coordinator dismissed the return health-check without scanning/recording a
-- condition. The article's condition label is now unverified since the last
-- borrow. Lingers in the notification center until explicitly acknowledged.
ALTER TYPE notification_type ADD VALUE 'RETURN_CONDITION_UNVERIFIED';

-- A student's late-return count just crossed the threshold (3). Informational
-- only — BORROW-19 enforces no automatic punitive action; this surfaces the
-- pattern to the Coordinator, who decides what (if anything) to do about it.
ALTER TYPE notification_type ADD VALUE 'BAD_SPORT_FLAGGED';
