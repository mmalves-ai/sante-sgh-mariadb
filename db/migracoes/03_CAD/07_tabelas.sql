-- CAD, lote 07 (F2.2 ondas finais, onda 4; pedido do lote 04-01). Convenções do ADR 0002 (parte 2). Só para frente.

-- 04-01: NIRE e data do NIRE para a abertura da escrituração contábil digital
ALTER TABLE estabelecimento
  ADD COLUMN nire VARCHAR(11) NULL COMMENT 'Número de identificação do registro de empresas na junta comercial' AFTER inscricao_municipal,
  ADD COLUMN data_nire DATE NULL COMMENT 'Data do arquivamento do ato constitutivo na junta comercial' AFTER nire,
  ADD CONSTRAINT ck_estabelecimento_nire CHECK (nire IS NULL OR nire REGEXP '^[0-9]{11}$');
