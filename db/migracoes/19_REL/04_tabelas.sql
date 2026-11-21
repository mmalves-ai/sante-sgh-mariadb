-- REL, lote 04 (F2.2 ondas finais, onda 5; pedido do lote 05-11). Convenções do ADR 0002 (parte 2). Só para frente.

-- 05-11: a área dona da triagem é a chave de negócio do domínio (PAPEIS_TRIAGEM de @sgh/dominio-relatorio), e toda
-- triagem decidida tem área.
ALTER TABLE triagem_relatorio_legado
  MODIFY COLUMN area VARCHAR(60) NULL COMMENT 'Área dona (chave do domínio)',
  ADD CONSTRAINT ck_triagem_relatorio_legado_area CHECK (area IS NULL OR area IN ('folha','faturamento','financeiro',
    'contabilidade','repasse','estoque','pep','leitos','recepcao','sadt','bloco','diretoria','cadastros','curador')),
  ADD CONSTRAINT ck_triagem_relatorio_legado_area_decidida CHECK (situacao = 'pendente' OR area IS NOT NULL);
