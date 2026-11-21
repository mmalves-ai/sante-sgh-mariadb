-- F4 rodada 5 (ADR 0006, item 2): rascunho clínico com autor e data original, e a regra "rascunho só o autor
-- finaliza ou apaga, com trilha" (a regra é do domínio; aqui ficam as colunas e os CHECKs de integridade).
-- Evolução em rascunho: registro_assistencial_rascunho (já existia). Alergia em rascunho: alergia_paciente com
-- situacao_registro = 'rascunho'. O rascunho nunca aparece como registro finalizado nem dispara alerta.

ALTER TABLE registro_assistencial_rascunho
  MODIFY COLUMN autor_usuario_id BIGINT UNSIGNED NULL COMMENT 'Usuário do autor; nulo só no rascunho migrado sem usuário (o autor é o profissional)',
  ADD COLUMN iniciado_em DATETIME(3) NULL COMMENT 'Data original em que o autor abriu o rascunho (na migração, a da origem; nunca a da carga)' AFTER data_hora_clinica,
  ADD COLUMN imagem_anotada JSON NULL COMMENT 'Imagem anotada em edição (arquivo e marcações), confirmada só na finalização' AFTER alergias,
  ADD COLUMN encerrado_por_profissional_id BIGINT UNSIGNED NULL COMMENT 'Quem finalizou ou descartou: sempre o autor' AFTER encerrado_em,
  ADD COLUMN encerrado_por_usuario_id BIGINT UNSIGNED NULL AFTER encerrado_por_profissional_id,
  ADD CONSTRAINT ck_registro_assistencial_rascunho_autor_usuario CHECK (autor_usuario_id IS NOT NULL OR origem = 'migracao'),
  ADD CONSTRAINT ck_registro_assistencial_rascunho_so_autor CHECK (encerrado_por_profissional_id IS NULL OR encerrado_por_profissional_id = autor_profissional_id),
  ADD CONSTRAINT ck_registro_assistencial_rascunho_imagem CHECK (imagem_anotada IS NULL OR JSON_VALID(imagem_anotada)),
  ADD KEY ix_registro_assistencial_rascunho_encerrado_profissional (encerrado_por_profissional_id),
  ADD KEY ix_registro_assistencial_rascunho_encerrado_usuario (encerrado_por_usuario_id),
  ADD KEY ix_registro_assistencial_rascunho_autor_aberto (autor_profissional_id, situacao);

ALTER TABLE alergia_paciente
  ADD COLUMN situacao_registro VARCHAR(20) NOT NULL DEFAULT 'confirmado' COMMENT 'rascunho (só o autor vê, finaliza ou descarta), confirmado ou descartado' AFTER tipo_registro,
  ADD COLUMN registro_assistencial_rascunho_id BIGINT UNSIGNED NULL COMMENT 'Rascunho de evolução em que a alergia está sendo informada' AFTER registro_assistencial_id,
  ADD COLUMN rascunho_autor_usuario_id BIGINT UNSIGNED NULL COMMENT 'Usuário do autor do rascunho (o autor é registrado_profissional_id)' AFTER registrado_profissional_id,
  ADD COLUMN encerrado_em DATETIME(3) NULL COMMENT 'Quando o autor confirmou ou descartou o rascunho' AFTER rascunho_autor_usuario_id,
  ADD COLUMN encerrado_por_profissional_id BIGINT UNSIGNED NULL COMMENT 'Quem confirmou ou descartou o rascunho: sempre o autor' AFTER encerrado_em,
  ADD CONSTRAINT ck_alergia_paciente_situacao_registro CHECK (situacao_registro IN ('rascunho','confirmado','descartado')),
  ADD CONSTRAINT ck_alergia_paciente_rascunho_autor CHECK (situacao_registro <> 'rascunho' OR registrado_profissional_id IS NOT NULL),
  ADD CONSTRAINT ck_alergia_paciente_descartado CHECK (situacao_registro <> 'descartado' OR encerrado_em IS NOT NULL),
  ADD CONSTRAINT ck_alergia_paciente_so_autor CHECK (encerrado_por_profissional_id IS NULL OR encerrado_por_profissional_id = registrado_profissional_id),
  ADD KEY ix_alergia_paciente_rascunho (registro_assistencial_rascunho_id),
  ADD KEY ix_alergia_paciente_rascunho_autor_usuario (rascunho_autor_usuario_id),
  ADD KEY ix_alergia_paciente_encerrado_profissional (encerrado_por_profissional_id),
  ADD KEY ix_alergia_paciente_situacao (paciente_id, situacao_registro);
