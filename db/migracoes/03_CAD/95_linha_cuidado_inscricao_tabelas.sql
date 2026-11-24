-- Cadastro, programas de saúde e linhas de cuidado do paciente (F8, 02-CAD linha 11, 24/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2). Sem gatilho.
-- 1. Os estados da inscrição entram com o padrão da base (um por natureza), para o hospital novo inscrever no primeiro
--    dia; o hospital pode renomear, inativar ou criar outros. O de entrada é o "incluído" (padrão de ativação).
-- 2. Uma só inscrição viva por paciente, programa e estabelecimento: a coluna gerada vale 1 enquanto a inscrição não está
--    encerrada nem excluída e fica nula depois, e o índice único é sobre ela. A inscrição encerrada fica no banco, com o
--    histórico, e a volta do paciente ao programa é uma inscrição nova.
INSERT INTO estado_linha_cuidado (codigo, descricao, ativo, tipo_estado, padrao_ativacao, encerra_inscricao, criado_em, versao)
SELECT p.codigo, p.descricao, TRUE, p.tipo_estado, p.padrao_ativacao, p.encerra_inscricao, UTC_TIMESTAMP(3), 1
  FROM (
    SELECT 'incluido' AS codigo, 'Incluído' AS descricao, 'incluido' AS tipo_estado, TRUE AS padrao_ativacao, FALSE AS encerra_inscricao
    UNION ALL SELECT 'ativo', 'Em acompanhamento', 'ativo', FALSE, FALSE
    UNION ALL SELECT 'suspenso', 'Suspenso', 'suspenso', FALSE, FALSE
    UNION ALL SELECT 'alta', 'Alta do programa', 'alta', FALSE, TRUE
    UNION ALL SELECT 'abandono', 'Abandono', 'abandono', FALSE, TRUE
    UNION ALL SELECT 'transferido', 'Transferido', 'transferido', FALSE, TRUE
    UNION ALL SELECT 'obito', 'Óbito', 'obito', FALSE, TRUE
  ) p
 WHERE NOT EXISTS (SELECT 1 FROM estado_linha_cuidado e WHERE e.codigo = p.codigo);

ALTER TABLE paciente_linha_cuidado
  ADD COLUMN IF NOT EXISTS inscricao_viva TINYINT
    AS (IF(ativo AND vigencia_fim IS NULL AND excluido_em IS NULL, 1, NULL)) PERSISTENT
    COMMENT 'Vale 1 enquanto a inscrição está viva (não encerrada nem excluída); nula depois, para a unicidade';
ALTER TABLE paciente_linha_cuidado
  ADD UNIQUE KEY IF NOT EXISTS uq_paciente_linha_cuidado_viva (paciente_id, linha_cuidado_id, estabelecimento_id, inscricao_viva);
