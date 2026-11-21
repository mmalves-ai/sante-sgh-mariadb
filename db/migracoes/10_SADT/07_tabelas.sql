-- SADT, lote 07 (F2.2 onda 4; pedido do lote 04-02: visualização do resultado pelo médico (fila do médico, M27)). Convenções do ADR 0002 (parte 2). Só para frente.
-- Sem FOREIGN KEY aqui (07_chaves.sql).

CREATE TABLE visualizacao_resultado_exame (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id   BIGINT UNSIGNED NOT NULL,
  resultado_exame_id   BIGINT UNSIGNED NOT NULL,
  paciente_id          BIGINT UNSIGNED NOT NULL COMMENT 'Repetido do resultado para a fila por paciente',
  usuario_id           BIGINT UNSIGNED NOT NULL COMMENT 'Quem abriu o resultado',
  profissional_id      BIGINT UNSIGNED NULL COMMENT 'Profissional do usuário, quando houver',
  visualizado_em       DATETIME(3) NOT NULL COMMENT 'Primeira abertura do resultado por este usuário (UTC)',
  origem               VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em            DATETIME(3) NOT NULL,
  criado_por           BIGINT UNSIGNED NULL,
  alterado_em          DATETIME(3) NULL,
  alterado_por         BIGINT UNSIGNED NULL,
  versao               INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_visualizacao_resultado_exame_origem CHECK (origem IN ('sistema','migracao','integracao')),
  UNIQUE KEY uq_visualizacao_resultado_exame_usuario (resultado_exame_id, usuario_id),
  KEY ix_visualizacao_resultado_exame_paciente (estabelecimento_id, paciente_id, visualizado_em),
  KEY ix_visualizacao_resultado_exame_usuario (usuario_id),
  KEY ix_visualizacao_resultado_exame_profissional (profissional_id)
) COMMENT='Primeira visualização de um resultado de exame por usuário (pendência "resultado novo" da fila do médico)';
