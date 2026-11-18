-- A dock takes back an attestation's scan points when a report filed with
-- it is closed as inflated, invalid or a duplicate of a published one. Its
-- row is negative, so every sum over scan_points already counts it.
ALTER TABLE scan_points DROP CONSTRAINT scan_points_kind_check;
ALTER TABLE scan_points ADD CONSTRAINT scan_points_kind_check CHECK (kind IN ('scan', 'finding', 'dock'));
