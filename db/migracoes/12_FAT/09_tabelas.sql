-- FAT, lote 09 (F2.2 onda 3; pedidos do lote 03-04: repasse médico). Convenções do ADR 0002 (parte 2). Só para frente.
-- Sem FOREIGN KEY aqui (09_chaves.sql).

ALTER TABLE apuracao_repasse
  ADD COLUMN quantidade_itens INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Itens na memória de cálculo',
  ADD COLUMN quantidade_pendentes INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Itens sem profissional ou sem regra',
  ADD COLUMN pendencias JSON NULL COMMENT 'Resumo das pendências por código, sem dado pessoal',
  ADD COLUMN conferida_em DATETIME(3) NULL,
  ADD COLUMN conferida_por_usuario_id BIGINT UNSIGNED NULL,
  ADD CONSTRAINT ck_apuracao_repasse_conferencia CHECK ((conferida_em IS NULL) = (conferida_por_usuario_id IS NULL)),
  ADD CONSTRAINT ck_apuracao_repasse_segregacao CHECK (aprovada_por_usuario_id IS NULL OR aprovada_por_usuario_id <> iniciada_por_usuario_id),
  ADD KEY ix_apuracao_repasse_conferida_por_usuario_id (conferida_por_usuario_id);

ALTER TABLE apuracao_repasse_item
  MODIFY profissional_id BIGINT UNSIGNED NULL,
  ADD COLUMN regra_repasse_item_id BIGINT UNSIGNED NULL COMMENT 'Item da regra aplicado',
  ADD COLUMN dimensoes VARCHAR(500) NULL COMMENT 'Dimensões da regra que casaram',
  ADD COLUMN dimensoes_ignoradas VARCHAR(500) NULL COMMENT 'Dimensões informadas que a regra não usa',
  ADD COLUMN base_calculo VARCHAR(20) NULL,
  ADD COLUMN valor_fixo DECIMAL(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN valor_sem_adicional DECIMAL(15,2) NULL,
  ADD COLUMN adicional VARCHAR(30) NULL COMMENT 'Adicional aplicado (horário, urgência)',
  ADD COLUMN pendencia VARCHAR(60) NULL COMMENT 'Código da pendência que impede o repasse do item',
  ADD CONSTRAINT ck_apuracao_repasse_item_profissional CHECK (profissional_id IS NOT NULL OR pendencia IS NOT NULL),
  ADD KEY ix_apuracao_repasse_item_regra_repasse_item_id (regra_repasse_item_id);

ALTER TABLE rpa
  ADD COLUMN titulo_pagar_id BIGINT UNSIGNED NULL COMMENT 'Título a pagar do RPA no contas a pagar',
  ADD COLUMN pago_em DATE NULL,
  ADD CONSTRAINT ck_rpa_pago_em CHECK (pago_em IS NULL OR situacao = 'pago'),
  ADD KEY ix_rpa_titulo_pagar_id (titulo_pagar_id);

ALTER TABLE producao_repasse
  ADD COLUMN valor_recebido DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT 'Valor recebido da fonte pagadora pelo item',
  ADD COLUMN valor_recurso_deferido DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT 'Valor recuperado em recurso de glosa deferido',
  ADD COLUMN conciliado BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'O recebimento do item foi conciliado',
  ADD CONSTRAINT ck_producao_repasse_recebido CHECK (valor_recebido >= 0 AND valor_recurso_deferido >= 0);

ALTER TABLE regra_repasse_item
  ADD COLUMN profissional_id BIGINT UNSIGNED NULL COMMENT 'Nulo: vale para todos os profissionais' AFTER regra_repasse_id,
  ADD KEY ix_regra_repasse_item_profissional_id (profissional_id);
