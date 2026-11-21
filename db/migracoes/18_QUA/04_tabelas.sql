-- QUA, lote 04 (F2.2 onda 3; pedidos do lote 03-03: tecnovigilância ligada ao parque). Convenções do ADR 0002 (parte 2). Só para frente.
-- Sem FOREIGN KEY aqui (04_chaves.sql).

ALTER TABLE alerta_sanitario
  ADD COLUMN modelo VARCHAR(60) NULL COMMENT 'Modelo do equipamento afetado' AFTER fabricante_id,
  ADD COLUMN numero_serie_inicial VARCHAR(40) NULL COMMENT 'Início da faixa de série afetada',
  ADD COLUMN numero_serie_final VARCHAR(40) NULL COMMENT 'Fim da faixa de série afetada',
  ADD COLUMN registro_anvisa CHAR(11) NULL COMMENT 'Registro sanitário do produto afetado',
  ADD COLUMN publicado_em DATE NULL COMMENT 'Publicação pelo emissor',
  ADD COLUMN acao_recomendada TEXT NULL COMMENT 'Ação pedida pelo emissor (troca, inspeção, ajuste)',
  ADD CONSTRAINT ck_alerta_sanitario_faixa_serie CHECK ((numero_serie_inicial IS NULL) = (numero_serie_final IS NULL)),
  ADD CONSTRAINT ck_alerta_sanitario_registro CHECK (registro_anvisa IS NULL OR registro_anvisa REGEXP '^[0-9]{11}$');

CREATE TABLE alerta_sanitario_equipamento (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  alerta_sanitario_id BIGINT UNSIGNED NOT NULL,
  equipamento_saude_id BIGINT UNSIGNED NOT NULL,
  ordem_servico_manutencao_id BIGINT UNSIGNED NOT NULL COMMENT 'OS de ação de campo gerada',
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_alerta_sanitario_equipamento_par (alerta_sanitario_id, equipamento_saude_id),
  UNIQUE KEY uq_alerta_sanitario_equipamento_os (ordem_servico_manutencao_id),
  KEY ix_alerta_sanitario_equipamento_equipamento_saude_id (equipamento_saude_id)
) COMMENT='Equipamentos do parque afetados pelo alerta sanitário, com a OS de ação de campo';

ALTER TABLE queixa_tecnica_produto
  MODIFY insumo_id BIGINT UNSIGNED NULL,
  ADD COLUMN equipamento_saude_id BIGINT UNSIGNED NULL AFTER insumo_id,
  ADD COLUMN ordem_servico_manutencao_id BIGINT UNSIGNED NULL COMMENT 'OS que originou a queixa',
  ADD CONSTRAINT ck_queixa_tecnica_produto_alvo CHECK (insumo_id IS NOT NULL OR equipamento_saude_id IS NOT NULL),
  ADD UNIQUE KEY uq_queixa_tecnica_produto_os (ordem_servico_manutencao_id),
  ADD KEY ix_queixa_tecnica_produto_equipamento_saude_id (equipamento_saude_id);
