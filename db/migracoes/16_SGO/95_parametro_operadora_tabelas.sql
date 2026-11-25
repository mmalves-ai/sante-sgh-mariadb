-- Operadora, parâmetros gerais por operadora (F7, 08-SGO linha 93, F78.08-1, 24/11/2026): só para frente e idempotente
-- (ADR 0002, parte 2). Sem gatilho; o catálogo fechado das chaves, o tipo e a faixa legal ficam no domínio
-- (PARAMETROS_OPERADORA, valorDoParametro). Cada valor vale por um período: a troca encerra o vigente na véspera e abre
-- outro (nada é sobrescrito), para saber qual regra valia em cada data.
CREATE TABLE IF NOT EXISTS parametro_operadora (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  operadora_saude_id BIGINT UNSIGNED NOT NULL,
  chave              VARCHAR(60) NOT NULL COMMENT 'Chave do catálogo do domínio',
  valor              VARCHAR(200) NOT NULL COMMENT 'Valor normalizado pelo domínio (inteiro, decimal com 2 casas ou true/false)',
  vigencia_inicio    DATE NOT NULL,
  vigencia_fim       DATE NULL,
  justificativa      VARCHAR(500) NULL,
  origem             VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em          DATETIME(3) NOT NULL,
  criado_por         BIGINT UNSIGNED NULL,
  alterado_em        DATETIME(3) NULL,
  alterado_por       BIGINT UNSIGNED NULL,
  versao             INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em        DATETIME(3) NULL,
  excluido_por       BIGINT UNSIGNED NULL,
  CONSTRAINT ck_parametro_operadora_origem CHECK (origem IN ('sistema','migracao','integracao')),
  CONSTRAINT ck_parametro_operadora_chave CHECK (chave REGEXP '^[a-z][a-z0-9_]{2,59}$'),
  CONSTRAINT ck_parametro_operadora_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio - INTERVAL 1 DAY),
  KEY ix_parametro_operadora_chave (operadora_saude_id, chave, vigencia_inicio)
) COMMENT='Parâmetros gerais de cada operadora da instalação, um período por linha (nunca sobrescrito)';

-- Situações do pedido de cartão (domínio do cliente): o ciclo que o domínio conduz (passoDoPedidoCartao).
INSERT INTO situacao_solicitacao_cartao (codigo, descricao, ativo, ordem, situacao_final, criado_em)
SELECT x.codigo, x.descricao, TRUE, x.ordem, x.final, NOW(3)
  FROM (SELECT 'solicitado' AS codigo, 'Solicitado' AS descricao, 1 AS ordem, FALSE AS final
        UNION ALL SELECT 'emitido', 'Emitido', 2, FALSE
        UNION ALL SELECT 'entregue', 'Entregue', 3, TRUE
        UNION ALL SELECT 'cancelado', 'Cancelado', 4, TRUE) x
 WHERE NOT EXISTS (SELECT 1 FROM situacao_solicitacao_cartao s WHERE s.codigo = x.codigo);
