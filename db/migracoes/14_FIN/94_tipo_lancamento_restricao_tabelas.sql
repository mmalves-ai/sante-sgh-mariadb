-- Financeiro, restrição de tipos de lançamento por perfil e estabelecimento (F3.8, 07-FIN linha 99, corretor F3.8-3,
-- 24/11/2026): só para frente e idempotente (ADR 0002, parte 2).
-- A marca de "perfil restrito" na operação fica numa linha própria, separada das liberações: retirar o último tipo
-- liberado deixa o perfil restrito com a lista vazia (nada passa), em vez de devolvê-lo a "sem restrição". Desfazer a
-- restrição é uma decisão explícita (a linha fica, marcada como excluída, com quem e quando).
-- A liberação e a restrição valem por estabelecimento: o perfil global (sem estabelecimento) recebe a lista de cada
-- estabelecimento em separado, e quem mantém o parâmetro num estabelecimento não muda a lista de outro.
CREATE TABLE IF NOT EXISTS restricao_tipo_lancamento_perfil (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  perfil_acesso_id    BIGINT UNSIGNED NOT NULL,
  estabelecimento_id  BIGINT UNSIGNED NOT NULL,
  operacao            VARCHAR(30) NOT NULL,
  criado_em           DATETIME(3) NOT NULL,
  criado_por          BIGINT UNSIGNED NULL,
  alterado_em         DATETIME(3) NULL,
  alterado_por        BIGINT UNSIGNED NULL,
  versao              INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em         DATETIME(3) NULL COMMENT 'Preenchido: a restrição foi desfeita (o perfil volta a seguir só a permissão da operação)',
  excluido_por        BIGINT UNSIGNED NULL,
  CONSTRAINT ck_restricao_tipo_lancamento_perfil_operacao CHECK (operacao IN ('contas_pagar','contas_receber','banco','caixa','adiantamento')),
  UNIQUE KEY uq_restricao_tipo_lancamento_perfil (perfil_acesso_id, estabelecimento_id, operacao),
  KEY ix_restricao_tipo_lancamento_perfil_estabelecimento_id (estabelecimento_id)
) COMMENT='Perfis restritos a uma lista de tipos de lançamento, por estabelecimento e operação';

ALTER TABLE permissao_tipo_lancamento
  ADD COLUMN IF NOT EXISTS estabelecimento_id BIGINT UNSIGNED NULL COMMENT 'Estabelecimento em que a liberação vale (nulo: linha anterior a 24/11/2026 de perfil global, sem efeito)' AFTER perfil_acesso_id;

-- Linhas anteriores: o estabelecimento do próprio perfil; e o perfil que já tinha lista passa a ter a marca de restrito.
UPDATE permissao_tipo_lancamento p JOIN perfil_acesso a ON a.id = p.perfil_acesso_id
   SET p.estabelecimento_id = a.estabelecimento_id
 WHERE p.estabelecimento_id IS NULL AND a.estabelecimento_id IS NOT NULL;
INSERT IGNORE INTO restricao_tipo_lancamento_perfil (perfil_acesso_id, estabelecimento_id, operacao, criado_em)
SELECT DISTINCT perfil_acesso_id, estabelecimento_id, operacao, NOW(3) FROM permissao_tipo_lancamento
 WHERE estabelecimento_id IS NOT NULL AND excluido_em IS NULL;
