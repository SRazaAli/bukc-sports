-- ============================================================================
-- 013 — Archive equipment types instead of forcing destructive delete.
--
-- Deleting an equipment type that has real articles/borrow history would
-- either be blocked (correctly — INV-26 forbids deleting articles, and
-- historical borrow_transaction rows feed usage analytics) or, if forced,
-- silently destroy that history. Archiving gives staff the same practical
-- outcome — the type disappears from "add article" and student-facing
-- borrowing — without deleting anything.
-- ============================================================================

ALTER TABLE equipment_type ADD COLUMN is_active boolean NOT NULL DEFAULT true;
