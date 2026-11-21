-- migrate:up
-- Defaults a new household starts with. Safe to re-run.

-- Expense categories; group_name is the planning dimension: Need | Want | One-time | Unplanned.
INSERT INTO categories (name, group_name, icon, color, sort_order) VALUES
  ('Groceries & Staples', 'Need', '🛒', '#16A34A', 10),
  ('Mobile & Broadband', 'Need', '📱', '#0EA5E9', 20),
  ('Electricity', 'Need', '⚡', '#F59E0B', 30),
  ('Cooking Gas', 'Need', '🔥', '#F97316', 40),
  ('Home Maintenance', 'Need', '🏠', '#2563EB', 50),
  ('Fuel', 'Need', '⛽', '#DC2626', 60),
  ('Vehicle Maintenance', 'Need', '🚗', '#EF4444', 70),
  ('Education', 'Need', '🎒', '#7C3AED', 80),
  ('Healthcare', 'Need', '💊', '#10B981', 90),
  ('Commute & Travel', 'Need', '🚌', '#3B82F6', 100),
  ('Dining Out', 'Want', '🍽️', '#F97316', 110),
  ('Recreation', 'Want', '🎉', '#A855F7', 120),
  ('Grooming & Personal Care', 'Want', '💇', '#EC4899', 130),
  ('Online Shopping', 'Want', '📦', '#6366F1', 140),
  ('Subscriptions', 'Want', '🎧', '#8B5CF6', 150),
  ('Kids & Toys', 'Want', '🧸', '#F43F5E', 160),
  ('Home Improvement (One-time)', 'One-time', '🛠️', '#B45309', 170),
  ('Gold & Jewelry (One-time)', 'One-time', '💎', '#A16207', 180),
  ('Gifts (One-time)', 'One-time', '🎁', '#BE185D', 190),
  ('Property Tax (One-time)', 'One-time', '🏛️', '#92400E', 200),
  ('Miscellaneous', 'Unplanned', '📌', '#6B7280', 210)
ON CONFLICT (name) DO NOTHING;

-- Shared labels. `unplanned` marks unplanned spending; `auto` marks expenses Madal created.
INSERT INTO tags (name, color, user_id, is_shared)
SELECT v.name, v.color, NULL, true
FROM (VALUES
  ('important', '#EF4444'),
  ('recurring', '#3B82F6'),
  ('tax_deductible', '#10B981'),
  ('planned', '#06B6D4'),
  ('unexpected', '#F97316'),
  ('unplanned', '#f59e0b'),
  ('auto', '#f59e0b')
) AS v(name, color)
WHERE NOT EXISTS (SELECT 1 FROM tags WHERE tags.name = v.name);

-- Gold rates (₹ per gram, edited on the Gold Register page) and the Madal go-live cut:
-- alerts dated before this only enrich, never create expenses.
INSERT INTO app_config (key, value) VALUES
  ('gold_rate_22k', '9200'),
  ('gold_rate_24k', '10100'),
  ('inbox_auto_add_from', to_char((NOW() AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD'))
ON CONFLICT (key) DO NOTHING;

-- migrate:down
-- Not reversible.
