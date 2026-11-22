-- SUP, lote 8 (F4 conector, rodada 4: pedidos de modelo das fatias, registrados para a trilha F2.2 em
-- docs/obra/passagens/F4-pedidos-f22.md). Convenções do ADR 0002 (parte 2). Só para frente.
-- Sem FOREIGN KEY aqui (08_chaves.sql).

-- L7-05 (18)
ALTER TABLE saldo_estoque_mensal
  ADD COLUMN quantidade_saida_nao_classificada DECIMAL(15,4) NOT NULL DEFAULT 0 COMMENT 'Quantidade de saida sem classificação no sistema anterior',
  ADD COLUMN valor_saida_nao_classificada DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT 'Valor de saida sem classificação no sistema anterior',
  ADD COLUMN quantidade_devolucao_nao_classificada DECIMAL(15,4) NOT NULL DEFAULT 0 COMMENT 'Quantidade de devolucao sem classificação no sistema anterior',
  ADD COLUMN valor_devolucao_nao_classificada DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT 'Valor de devolucao sem classificação no sistema anterior';

-- L7-07 (numero_origem, fornecedor_opcional) e L5-04 (14): pedido em elaboração sem fornecedor; origem do recurso na nota (no pedido já existia)
ALTER TABLE pedido_compra
  ADD COLUMN numero_documento_origem VARCHAR(30) NULL COMMENT 'Número que o usuário conhecia no sistema anterior',
  MODIFY COLUMN empresa_fornecedora_id BIGINT UNSIGNED NULL DEFAULT NULL,
  ADD CONSTRAINT ck_pedido_compra_fornecedor CHECK (empresa_fornecedora_id IS NOT NULL OR situacao IN ('rascunho','em_cotacao','cancelado'));
ALTER TABLE nota_entrada
  ADD COLUMN origem_recurso_compra_id BIGINT UNSIGNED NULL COMMENT 'Origem do recurso da compra',
  ADD KEY ix_nota_entrada_origem_recurso_compra_id (origem_recurso_compra_id);

-- L7-08 (8, 9)
ALTER TABLE documento_estoque
  ADD COLUMN numero_origem VARCHAR(30) NULL COMMENT 'Número que o usuário conhecia no sistema anterior',
  ADD COLUMN numero_chamada VARCHAR(30) NULL COMMENT 'Número do chamado (saída externa)',
  ADD COLUMN numero_ocorrencia VARCHAR(30) NULL COMMENT 'Número da ocorrência (saída externa)',
  ADD COLUMN documento_origem_id BIGINT UNSIGNED NULL COMMENT 'Documento de origem (devolução: a saída devolvida)',
  ADD KEY ix_documento_estoque_documento_origem_id (documento_origem_id);

-- L7-07 (principio_ativo_cliente): princípio do hospital sem código oficial (o oficial nunca é gravado pela migração)
CREATE TABLE principio_ativo_cliente (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome VARCHAR(255) NOT NULL COMMENT 'Nome do princípio no cadastro do hospital',
  principio_ativo_id BIGINT UNSIGNED NULL COMMENT 'Ligação ao catálogo oficial (pelo nome ou pelo farmacêutico)',
  classe_terapeutica_codigo VARCHAR(30) NULL COMMENT 'Código da classe terapêutica do cadastro do hospital',
  unidade_medida_padrao_id BIGINT UNSIGNED NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_principio_ativo_cliente_nome (nome),
  KEY ix_principio_ativo_cliente_principio_ativo_id (principio_ativo_id),
  KEY ix_principio_ativo_cliente_unidade_medida_padrao_id (unidade_medida_padrao_id),
  CONSTRAINT ck_principio_ativo_cliente_origem CHECK (origem IN ('sistema','migracao','integracao'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Princípio ativo do cadastro próprio do cliente, ligado ao oficial quando houver par';
ALTER TABLE insumo_principio_ativo
  MODIFY COLUMN principio_ativo_id BIGINT UNSIGNED NULL DEFAULT NULL,
  ADD COLUMN principio_ativo_cliente_id BIGINT UNSIGNED NULL COMMENT 'Princípio do cadastro próprio do cliente (sem par no oficial)' AFTER principio_ativo_id,
  ADD KEY ix_insumo_principio_ativo_principio_ativo_cliente_id (principio_ativo_cliente_id),
  ADD CONSTRAINT ck_insumo_principio_ativo_principio CHECK ((principio_ativo_id IS NULL) <> (principio_ativo_cliente_id IS NULL));

-- F4 rodada 6 (L7-05, ADR 0006): histórico de compra por insumo (último preço, fornecedor e marca), usado na
-- cotação e na reposição. Guarda o que foi comprado mesmo quando a nota não existe no sistema.
CREATE TABLE historico_compra_insumo (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  insumo_id              BIGINT UNSIGNED NOT NULL,
  empresa_fornecedora_id BIGINT UNSIGNED NULL,
  nota_entrada_id        BIGINT UNSIGNED NULL,
  numero_nota            VARCHAR(30) NULL,
  numero_documento       VARCHAR(30) NULL,
  comprado_em            DATE NOT NULL,
  quantidade             DECIMAL(15,4) NULL,
  valor_unitario         DECIMAL(19,6) NULL,
  custo_unitario         DECIMAL(19,6) NULL,
  marca                  VARCHAR(100) NULL,
  preco_venda            DECIMAL(19,6) NULL,
  origem                 VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em              DATETIME(3) NOT NULL,
  criado_por             BIGINT UNSIGNED NULL,
  alterado_em            DATETIME(3) NULL,
  alterado_por           BIGINT UNSIGNED NULL,
  versao                 INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_historico_compra_insumo_quantidade CHECK (quantidade IS NULL OR quantidade >= 0),
  CONSTRAINT ck_historico_compra_insumo_valores CHECK ((valor_unitario IS NULL OR valor_unitario >= 0) AND (custo_unitario IS NULL OR custo_unitario >= 0) AND (preco_venda IS NULL OR preco_venda >= 0)),
  CONSTRAINT ck_historico_compra_insumo_origem CHECK (origem IN ('sistema','migracao','integracao')),
  KEY ix_historico_compra_insumo_insumo_data (insumo_id, comprado_em),
  KEY ix_historico_compra_insumo_fornecedor (empresa_fornecedora_id),
  KEY ix_historico_compra_insumo_nota (nota_entrada_id)
) COMMENT='Histórico de compra de cada insumo: data, fornecedor, nota, quantidade, valores e marca';

-- F4 rodada 6 (L7-07, ADR 0006): a restrição do usuário no estoque pode ser por classificação de despesa (que
-- atravessa grupos), além de grupo e subgrupo. Uma das duas é obrigatória.
ALTER TABLE usuario_estoque_classificacao
  MODIFY COLUMN grupo_insumo_id BIGINT UNSIGNED NULL COMMENT 'Nulo quando a restrição é só pela classificação de despesa',
  ADD COLUMN classificacao_despesa_id BIGINT UNSIGNED NULL COMMENT 'Classificação de despesa dos insumos permitidos (atravessa grupos)' AFTER subgrupo_insumo_id,
  ADD COLUMN grupo_chave BIGINT UNSIGNED AS (COALESCE(grupo_insumo_id, 0)) STORED COMMENT 'Apoio da unicidade quando o grupo é nulo',
  ADD COLUMN classificacao_chave BIGINT UNSIGNED AS (COALESCE(classificacao_despesa_id, 0)) STORED COMMENT 'Apoio da unicidade quando a classificação é nula',
  DROP INDEX uq_usuario_estoque_classificacao_par,
  ADD UNIQUE KEY uq_usuario_estoque_classificacao_par (estabelecimento_id, usuario_id, grupo_chave, subgrupo_chave, classificacao_chave, vigencia_inicio),
  ADD CONSTRAINT ck_usuario_estoque_classificacao_alvo CHECK (grupo_insumo_id IS NOT NULL OR classificacao_despesa_id IS NOT NULL),
  ADD KEY ix_usuario_estoque_classificacao_despesa (classificacao_despesa_id);

-- F4 rodada 6 (L7-08, ADR 0006): quantidade do lote no movimento depois das devoluções (rastreio por lote).
ALTER TABLE movimento_lote
  ADD COLUMN quantidade_liquida DECIMAL(15,4) NULL COMMENT 'Quantidade do lote no movimento depois das devoluções (saída menos devolução)' AFTER quantidade,
  ADD CONSTRAINT ck_movimento_lote_quantidade_liquida CHECK (quantidade_liquida IS NULL OR (quantidade_liquida >= 0 AND quantidade_liquida <= quantidade));
