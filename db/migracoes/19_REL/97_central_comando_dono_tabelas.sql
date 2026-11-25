-- Central de comando assistencial (01-ADM L117, C2-053, correção): só para frente e idempotente (ADR 0002, parte 2).
-- 1) O limite de fluxo ganha o estabelecimento dono: o limite "de todo o estabelecimento" (sem unidade) deixa de
--    valer para os outros hospitais do cliente. As linhas existentes herdam o estabelecimento da unidade; o limite
--    geral sem dono vai ao único estabelecimento do cliente ou, havendo vários, ao de menor id, inativado para o
--    hospital revisar (nunca apagado).
-- 2) A ocorrência de risco encerrada pelo sistema (critérios que deixaram de ocorrer, regra desligada ou fora da
--    vigência) é marcada como tal, sem atribuir a um profissional o reconhecimento e a resolução que ele não fez.

ALTER TABLE alerta_fluxo_unidade
  ADD COLUMN IF NOT EXISTS estabelecimento_id BIGINT UNSIGNED NULL COMMENT 'Estabelecimento dono do limite' AFTER id;

UPDATE alerta_fluxo_unidade a JOIN unidade_assistencial u ON u.id = a.unidade_assistencial_id
   SET a.estabelecimento_id = u.estabelecimento_id
 WHERE a.estabelecimento_id IS NULL;

UPDATE alerta_fluxo_unidade
   SET estabelecimento_id = (SELECT MIN(e.id) FROM estabelecimento e)
 WHERE estabelecimento_id IS NULL AND (SELECT COUNT(*) FROM estabelecimento e) = 1;

UPDATE alerta_fluxo_unidade
   SET estabelecimento_id = (SELECT MIN(e.id) FROM estabelecimento e), ativo = FALSE,
       alterado_em = NOW(3), versao = versao + 1
 WHERE estabelecimento_id IS NULL;

ALTER TABLE alerta_fluxo_unidade
  MODIFY estabelecimento_id BIGINT UNSIGNED NOT NULL COMMENT 'Estabelecimento dono do limite',
  ADD INDEX IF NOT EXISTS ix_alerta_fluxo_unidade_estabelecimento (estabelecimento_id, ativo, tipo_alerta);

ALTER TABLE ocorrencia_risco_clinico
  ADD COLUMN IF NOT EXISTS encerrado_pelo_sistema BOOLEAN NOT NULL DEFAULT FALSE
    COMMENT 'Encerrada pela apuração, sem profissional (o usuário que apurou fica só na trilha)' AFTER resolucao;

ALTER TABLE ocorrencia_risco_clinico
  DROP CONSTRAINT IF EXISTS ck_ocorrencia_risco_clinico_reconhecimento,
  ADD CONSTRAINT ck_ocorrencia_risco_clinico_reconhecimento CHECK (situacao = 'aberta' OR encerrado_pelo_sistema OR (reconhecido_em IS NOT NULL AND reconhecido_por_usuario_id IS NOT NULL)),
  DROP CONSTRAINT IF EXISTS ck_ocorrencia_risco_clinico_resolucao,
  ADD CONSTRAINT ck_ocorrencia_risco_clinico_resolucao CHECK (situacao NOT IN ('resolvida','descartada') OR (resolvido_em IS NOT NULL AND resolucao IS NOT NULL AND (resolvido_por_usuario_id IS NOT NULL OR encerrado_pelo_sistema))),
  DROP CONSTRAINT IF EXISTS ck_ocorrencia_risco_clinico_encerrado_sistema,
  ADD CONSTRAINT ck_ocorrencia_risco_clinico_encerrado_sistema CHECK (NOT encerrado_pelo_sistema OR (situacao = 'resolvida' AND resolvido_por_usuario_id IS NULL));
