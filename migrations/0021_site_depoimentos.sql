PRAGMA foreign_keys = ON;

-- Depoimentos exibidos no site público, com print opcional do WhatsApp/Google.
CREATE TABLE IF NOT EXISTS site_testimonials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'whatsapp' CHECK(source IN ('whatsapp','google','other')),
  testimonial_text TEXT NOT NULL,
  screenshot_r2_key TEXT,
  screenshot_mime TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by_user_id INTEGER,
  created_by_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_site_testimonials_active_sort ON site_testimonials(active,sort_order,id);
