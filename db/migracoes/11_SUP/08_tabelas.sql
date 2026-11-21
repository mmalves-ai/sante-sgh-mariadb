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
