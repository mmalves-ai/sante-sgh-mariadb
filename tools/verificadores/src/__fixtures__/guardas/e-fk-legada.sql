-- guarda-caminho: packages/legado/src/config/sgh/9996_fk.sql
-- Fixture PROIBIDA (regra e): FK de SGH_ para tabela legada.
CREATE TABLE SGH_CFG_X (ID INTEGER NOT NULL, CONSTRAINT SGH_FK_CFG_X FOREIGN KEY (ID) REFERENCES RICADPAC (ID));
