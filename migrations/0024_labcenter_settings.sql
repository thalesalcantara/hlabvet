CREATE TABLE IF NOT EXISTS labcenter_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO labcenter_settings(key,value) VALUES('auto_assign_courier','1') ON CONFLICT(key) DO NOTHING;
