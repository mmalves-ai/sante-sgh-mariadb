-- Vínculo da conta ao estabelecimento e escopo de tipo de agenda com histórico (01-ADM L59). Retirar um tipo de
-- agenda e anular um vínculo ou um perfil que começou no mesmo dia passam a ser exclusão lógica
-- (excluido_em/excluido_por), nunca apagamento. A unicidade vale só entre as linhas vigentes, para que a nova
-- concessão no mesmo dia crie uma linha nova ao lado da anulada. Só para frente e idempotente (ADR 0002, parte 2).

ALTER TABLE usuario_tipo_agenda
  ADD COLUMN IF NOT EXISTS vigente_chave TINYINT UNSIGNED AS (IF(excluido_em IS NULL, 1, NULL)) PERSISTENT COMMENT 'Só para a unicidade: 1 enquanto não retirada',
  ADD UNIQUE KEY IF NOT EXISTS uq_usuario_tipo_agenda_par_vigente (usuario_id, categoria_agenda_id, vigente_chave);
ALTER TABLE usuario_tipo_agenda
  DROP INDEX IF EXISTS uq_usuario_tipo_agenda_par;

ALTER TABLE usuario_estabelecimento
  ADD COLUMN IF NOT EXISTS vigente_chave TINYINT UNSIGNED AS (IF(excluido_em IS NULL, 1, NULL)) PERSISTENT COMMENT 'Só para a unicidade: 1 enquanto não anulada',
  ADD UNIQUE KEY IF NOT EXISTS uq_usuario_estabelecimento_par_vigente (usuario_id, estabelecimento_id, vigencia_inicio, vigente_chave);
ALTER TABLE usuario_estabelecimento
  DROP INDEX IF EXISTS uq_usuario_estabelecimento_par;

ALTER TABLE usuario_perfil
  ADD COLUMN IF NOT EXISTS vigente_chave TINYINT UNSIGNED AS (IF(excluido_em IS NULL, 1, NULL)) PERSISTENT COMMENT 'Só para a unicidade: 1 enquanto não anulada',
  ADD UNIQUE KEY IF NOT EXISTS uq_usuario_perfil_par_vigente (usuario_id, perfil_acesso_id, estabelecimento_id, vigencia_inicio, vigente_chave);
ALTER TABLE usuario_perfil
  DROP INDEX IF EXISTS uq_usuario_perfil_par;
