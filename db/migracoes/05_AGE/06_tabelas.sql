-- AGE, lote 6 (F4 conector, rodada 4: pedidos de modelo das fatias, registrados para a trilha F2.2 em
-- docs/obra/passagens/F4-pedidos-f22.md). Convenções do ADR 0002 (parte 2). Só para frente.
-- Sem FOREIGN KEY aqui (06_chaves.sql).

-- L6-03 (9): motivo_marcacao por categoria de agenda
ALTER TABLE motivo_marcacao
  ADD COLUMN categoria_agenda_id BIGINT UNSIGNED NULL COMMENT 'Nulo: vale para todas as categorias de agenda',
  ADD KEY ix_motivo_marcacao_categoria_agenda_id (categoria_agenda_id);

-- L6-03 (9): canal_marcacao por categoria de agenda
ALTER TABLE canal_marcacao
  ADD COLUMN categoria_agenda_id BIGINT UNSIGNED NULL COMMENT 'Nulo: vale para todas as categorias de agenda',
  ADD KEY ix_canal_marcacao_categoria_agenda_id (categoria_agenda_id);

-- L6-03 (20) e L6-04 (1): vigência da agenda; agenda migrada sem dono (o cliente vincula no painel)
ALTER TABLE agenda_servico
  ADD COLUMN vigencia_inicio DATE NULL COMMENT 'Início da vigência da agenda',
  ADD COLUMN vigencia_fim DATE NULL COMMENT 'Fim da vigência da agenda',
  ADD CONSTRAINT ck_agenda_servico_vigencia CHECK (vigencia_fim IS NULL OR vigencia_inicio IS NULL OR vigencia_fim >= vigencia_inicio);
ALTER TABLE agenda_servico DROP CONSTRAINT ck_agenda_servico_dono;
ALTER TABLE agenda_servico ADD CONSTRAINT ck_agenda_servico_dono CHECK (profissional_id IS NOT NULL OR recurso_agendavel_id IS NOT NULL OR setor_funcional_id IS NOT NULL OR origem = 'migracao');

-- L6-04 (9), opção (a): histórico de cancelamento sem a marcação viva
ALTER TABLE cancelamento_marcacao
  MODIFY COLUMN marcacao_horario_id BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'Marcação cancelada; nula só no histórico migrado sem a marcação viva',
  ADD COLUMN agenda_servico_id BIGINT UNSIGNED NULL COMMENT 'Agenda do horário cancelado (histórico migrado)' AFTER marcacao_horario_id,
  ADD COLUMN horario_inicio_em DATETIME(3) NULL COMMENT 'Início do horário cancelado (histórico migrado)' AFTER agenda_servico_id,
  ADD KEY ix_cancelamento_marcacao_agenda_servico_id (agenda_servico_id),
  ADD CONSTRAINT ck_cancelamento_marcacao_alvo CHECK (marcacao_horario_id IS NOT NULL OR (origem = 'migracao' AND agenda_servico_id IS NOT NULL AND horario_inicio_em IS NOT NULL));
