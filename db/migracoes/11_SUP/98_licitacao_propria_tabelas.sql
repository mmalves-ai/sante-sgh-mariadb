-- Suprimentos, processo de contratação pública na porta própria (C2-017, 09-AREA linha 81, 25/11/2026): só para frente
-- e idempotente (ADR 0002, parte 2). O processo (processo_licitatorio), os itens, a pesquisa de preços, as propostas e o
-- histórico já estavam no modelo; faltava o que o julgamento e a homologação deixam gravado:
-- 1) no processo: o método da estimativa escolhido na abertura, quem julgou e quando, quem homologou e quando
--    (segregação de funções: quem conduz ou julga não homologa, Lei 14.133, art. 7º);
-- 2) no item: o resultado do julgamento (adjudicável, empate, fracassado, deserto) e o valor unitário adjudicado;
-- 3) na proposta por item: a nota técnica (critério técnica e preço);
-- 4) no histórico: o assunto do registro (etapa, parecer, publicação, esclarecimento, recurso, decisão, documento, ata,
--    pedido), a data do ato, o veículo e a referência da publicação, o fornecedor, o resultado, o pedido de compra e o
--    documento ligados. O histórico é só de inclusão.
-- A regra é do domínio (regras-suprimentos/licitacao); o banco só guarda.
ALTER TABLE processo_licitatorio
  ADD COLUMN IF NOT EXISTS metodo_estimativa VARCHAR(30) NOT NULL DEFAULT 'mediana' COMMENT 'Método da estimativa do valor (mediana, média ou menor preço pesquisado)',
  ADD COLUMN IF NOT EXISTS julgado_em DATE NULL COMMENT 'Dia do julgamento (abre o prazo de recurso)',
  ADD COLUMN IF NOT EXISTS julgado_por_usuario_id BIGINT UNSIGNED NULL COMMENT 'Quem julgou',
  ADD COLUMN IF NOT EXISTS homologado_em DATETIME(3) NULL COMMENT 'Instante da homologação',
  ADD COLUMN IF NOT EXISTS homologado_por_usuario_id BIGINT UNSIGNED NULL COMMENT 'Autoridade que homologou',
  ADD CONSTRAINT IF NOT EXISTS ck_processo_licitatorio_metodo_estimativa CHECK (metodo_estimativa IN ('mediana','media','menor')),
  ADD CONSTRAINT IF NOT EXISTS ck_processo_licitatorio_julgamento CHECK ((julgado_em IS NULL) = (julgado_por_usuario_id IS NULL)),
  ADD CONSTRAINT IF NOT EXISTS ck_processo_licitatorio_homologacao CHECK (etapa <> 'homologado' OR homologado_por_usuario_id IS NOT NULL);

ALTER TABLE processo_licitatorio_item
  ADD COLUMN IF NOT EXISTS resultado_julgamento VARCHAR(30) NULL COMMENT 'adjudicavel, empate, fracassado ou deserto',
  ADD COLUMN IF NOT EXISTS valor_adjudicado DECIMAL(19,6) NULL COMMENT 'Valor unitário (ou desconto) adjudicado ao vencedor',
  ADD CONSTRAINT IF NOT EXISTS ck_processo_licitatorio_item_resultado_julgamento CHECK (resultado_julgamento IS NULL OR resultado_julgamento IN ('adjudicavel','empate','fracassado','deserto')),
  ADD CONSTRAINT IF NOT EXISTS ck_processo_licitatorio_item_vencedor CHECK (vencedora_proposta_licitacao_item_id IS NULL OR COALESCE(resultado_julgamento, '') = 'adjudicavel');

ALTER TABLE proposta_licitacao_item
  ADD COLUMN IF NOT EXISTS nota_tecnica DECIMAL(7,4) NULL COMMENT 'Nota técnica da proposta (técnica e preço, melhor técnica)',
  ADD CONSTRAINT IF NOT EXISTS ck_proposta_licitacao_item_nota_tecnica CHECK (nota_tecnica IS NULL OR nota_tecnica BETWEEN 0 AND 100);

ALTER TABLE evento_processo_licitatorio
  ADD COLUMN IF NOT EXISTS assunto VARCHAR(20) NULL COMMENT 'O que foi registrado (etapa, parecer, publicacao, esclarecimento, recurso, decisao_recurso, documento, ata, pedido)',
  ADD COLUMN IF NOT EXISTS data_ato DATE NULL COMMENT 'Data do ato registrado (publicação, parecer, recurso)',
  ADD COLUMN IF NOT EXISTS veiculo_publicacao VARCHAR(20) NULL,
  ADD COLUMN IF NOT EXISTS referencia_ato VARCHAR(80) NULL COMMENT 'Número da publicação ou do ato no veículo',
  ADD COLUMN IF NOT EXISTS empresa_fornecedora_id BIGINT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS resultado VARCHAR(30) NULL COMMENT 'Resultado da decisão do recurso ou do parecer',
  ADD COLUMN IF NOT EXISTS pedido_compra_id BIGINT UNSIGNED NULL COMMENT 'Pedido de compra gerado para o vencedor',
  ADD COLUMN IF NOT EXISTS documento_id BIGINT UNSIGNED NULL COMMENT 'Documento do processo ligado ao registro',
  ADD CONSTRAINT IF NOT EXISTS ck_evento_processo_licitatorio_assunto CHECK (assunto IS NULL OR assunto IN ('etapa','parecer','publicacao','esclarecimento','recurso','decisao_recurso','documento','ata','pedido')),
  ADD CONSTRAINT IF NOT EXISTS ck_evento_processo_licitatorio_veiculo CHECK (veiculo_publicacao IS NULL OR veiculo_publicacao IN ('pncp','diario_oficial','jornal','sitio')),
  ADD CONSTRAINT IF NOT EXISTS ck_evento_processo_licitatorio_pedido CHECK (assunto <> 'pedido' OR pedido_compra_id IS NOT NULL);
