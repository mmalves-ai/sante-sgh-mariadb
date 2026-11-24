-- Cadastro, histórico do responsável pelo setor (F3.1, 02-CAD linha 27, correção da revisão, 24/11/2026): só para
-- frente e idempotente (ADR 0002, parte 2). Sem gatilho; a regra da troca fica no domínio (planoResponsavel).
-- Cada período em que um profissional respondeu pelo setor é uma linha: a troca encerra o anterior na véspera do novo
-- início e abre outro (nada é sobrescrito), para a responsabilidade técnica de cada período ser consultável.
-- setor_funcional.responsavel_* passa a espelhar o período vigente, para as listas.
-- O intervalo vazio (fim na véspera do início) é o do período retirado antes de começar, como na migração 92.
CREATE TABLE IF NOT EXISTS responsavel_setor_funcional (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  setor_funcional_id BIGINT UNSIGNED NOT NULL,
  profissional_id    BIGINT UNSIGNED NOT NULL,
  vigencia_inicio    DATE NOT NULL,
  vigencia_fim       DATE NULL,
  origem             VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em          DATETIME(3) NOT NULL,
  criado_por         BIGINT UNSIGNED NULL,
  alterado_em        DATETIME(3) NULL,
  alterado_por       BIGINT UNSIGNED NULL,
  versao             INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em        DATETIME(3) NULL,
  excluido_por       BIGINT UNSIGNED NULL,
  CONSTRAINT ck_responsavel_setor_funcional_origem CHECK (origem IN ('sistema','migracao','integracao')),
  CONSTRAINT ck_responsavel_setor_funcional_vigencia CHECK (
    vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio - INTERVAL 1 DAY),
  KEY ix_responsavel_setor_funcional_setor (setor_funcional_id, vigencia_inicio),
  KEY ix_responsavel_setor_funcional_profissional (profissional_id)
) COMMENT='Histórico dos responsáveis pelo setor, um período por linha (nunca sobrescrito)';

-- O responsável que já estava no setor vira o primeiro período do histórico (só se o setor ainda não tem nenhum).
INSERT INTO responsavel_setor_funcional (setor_funcional_id, profissional_id, vigencia_inicio, vigencia_fim, origem, criado_em)
SELECT s.id, s.responsavel_profissional_id, COALESCE(s.responsavel_vigencia_inicio, DATE(s.criado_em)),
       s.responsavel_vigencia_fim, 'sistema', NOW(3)
  FROM setor_funcional s
 WHERE s.responsavel_profissional_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM responsavel_setor_funcional r WHERE r.setor_funcional_id = s.id);
