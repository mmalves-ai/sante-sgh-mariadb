-- Plataforma 0095 (2026-11-27): versao_migracao cabe o caminho do último arquivo de chaves (pasta/arquivo).
-- Com 40 caracteres, "19_REL/97_central_comando_dono_chaves.sql" (41) fazia o "criar novo cliente" recusar todo
-- cliente novo no registro (registro-falhou, Data too long). Sem gatilhos. Idempotente (MODIFY para o mesmo tipo).

ALTER TABLE cliente MODIFY COLUMN versao_migracao VARCHAR(120) NULL
  COMMENT 'Última migração aplicada no banco do cliente';
