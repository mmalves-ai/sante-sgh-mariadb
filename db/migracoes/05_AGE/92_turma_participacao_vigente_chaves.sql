-- Agenda, grupos e turmas (F8, 02-AGE linha 50; 25/11/2026): cada inscrição do paciente na turma é uma participação
-- própria. Quem saiu (concluiu, desistiu, foi desligado) e volta ganha uma linha nova; a participação encerrada fica
-- com a data, o motivo e as presenças dela (histórico nunca apagado; a frequência da nova não mistura a antiga). A
-- chave única passa do par turma + paciente para a coluna gerada que só tem valor na participação vigente (na espera,
-- inscrita ou ativa, não excluída): um paciente segue com uma só participação vigente por turma. Roda depois de todas
-- as tabelas (arquivo de chaves). Só para frente e idempotente. Sem gatilho.
ALTER TABLE turma_participante
  ADD COLUMN IF NOT EXISTS paciente_vigente_id BIGINT UNSIGNED AS (IF(situacao IN ('em_espera','inscrito','ativo') AND excluido_em IS NULL, paciente_id, NULL)) PERSISTENT COMMENT 'Só para a unicidade: o paciente da participação vigente' AFTER paciente_id,
  ADD KEY IF NOT EXISTS ix_turma_participante_turma_paciente (turma_atividade_id, paciente_id),
  ADD UNIQUE KEY IF NOT EXISTS uq_turma_participante_vigente (turma_atividade_id, paciente_vigente_id);
ALTER TABLE turma_participante DROP INDEX IF EXISTS uq_turma_participante_par;
