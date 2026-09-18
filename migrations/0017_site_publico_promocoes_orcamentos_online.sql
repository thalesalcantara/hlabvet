PRAGMA foreign_keys = ON;

-- Site público institucional/comercial. O link usa sempre o domínio atual + /site.
CREATE TABLE IF NOT EXISTS public_site_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  enabled INTEGER NOT NULL DEFAULT 1,
  company_name TEXT NOT NULL DEFAULT 'HLab Vet Resultados',
  headline TEXT NOT NULL DEFAULT 'Diagnóstico veterinário com agilidade, cuidado e confiança',
  subheadline TEXT,
  whatsapp_phone TEXT,
  contact_email TEXT,
  careers_email TEXT,
  address TEXT,
  map_url TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO public_site_settings(
  id,enabled,company_name,headline,subheadline,whatsapp_phone,contact_email,careers_email,address,map_url
) VALUES(
  1,1,'HLab Vet Resultados','Diagnóstico veterinário com agilidade, cuidado e confiança',
  'Exames, coleta e resultados em um fluxo simples para clínicas, veterinários e tutores.',NULL,NULL,NULL,NULL,NULL
);

-- Cards comerciais do site: serviço, produto ou promoção, com foto armazenada no R2.
CREATE TABLE IF NOT EXISTS site_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_type TEXT NOT NULL DEFAULT 'service' CHECK(offer_type IN ('service','product','promotion')),
  title TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER,
  promo_price_cents INTEGER,
  badge TEXT,
  button_text TEXT,
  image_r2_key TEXT,
  image_mime TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by_user_id INTEGER,
  created_by_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_site_offers_active_sort ON site_offers(active,sort_order,id);

-- Origem e acompanhamento comercial dos orçamentos gerados pelo site.
ALTER TABLE quotes ADD COLUMN source TEXT NOT NULL DEFAULT 'internal';
ALTER TABLE quotes ADD COLUMN lead_status TEXT;
ALTER TABLE quotes ADD COLUMN lead_email TEXT;
ALTER TABLE quotes ADD COLUMN contacted_at TEXT;
ALTER TABLE quotes ADD COLUMN contacted_by_name TEXT;

-- O novo site entra ativo por padrão. O administrador pode desativá-lo a qualquer momento.
UPDATE quote_site_settings SET enabled=1,updated_at=CURRENT_TIMESTAMP WHERE id=1;
