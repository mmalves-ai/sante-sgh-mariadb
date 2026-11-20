-- guarda-caminho: packages/legado/src/config/sgh/9997_trigger.sql
-- Fixture PROIBIDA (regra d): trigger em tabela legada.
CREATE TRIGGER SGH_TRG_RICADPAC FOR RICADPAC AFTER INSERT AS BEGIN END;
