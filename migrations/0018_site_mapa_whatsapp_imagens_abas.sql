PRAGMA foreign_keys = ON;

-- URL pronta para incorporação do Google Maps. O link exato compartilhado continua salvo em map_url.
ALTER TABLE public_site_settings ADD COLUMN map_embed_url TEXT;

-- Imagens independentes para cada aba do site público.
CREATE TABLE IF NOT EXISTS public_site_tab_media (
  slot TEXT PRIMARY KEY CHECK(slot IN ('home','quote','offers','location','careers','contact')),
  image_r2_key TEXT,
  image_mime TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
