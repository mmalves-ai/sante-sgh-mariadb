-- Histórico do vínculo da nota fiscal de serviço com a fatura ou a conta (06-FAT linha 36, F3.7, 24/11/2026): só para
-- frente e idempotente (ADR 0002, parte 2). Sem gatilho; a regra fica no domínio (@sgh/dominio-faturamento,
-- conta/nota-vinculo.ts) e na operação (apps/api/src/modulos/faturamento/nota-vinculo-propria.ts).
-- Cada ligação, ajuste de valor, desligamento (com motivo obrigatório) e religamento vira uma linha, com o valor anterior
-- e o novo, quem e quando. A linha do vínculo guarda só o estado atual; o histórico fica aqui. Nada é apagado nem
-- alterado depois de gravado.
CREATE TABLE IF NOT EXISTS evento_vinculo_nota_faturamento (
  id                          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  vinculo_nota_faturamento_id BIGINT UNSIGNED NOT NULL,
  acao                        VARCHAR(20) NOT NULL COMMENT 'ligado, ajustado, desligado ou religado',
  valor_apropriado_anterior   DECIMAL(15,2) NULL COMMENT 'Valor que a nota documentava antes (nulo na primeira ligação)',
  valor_apropriado            DECIMAL(15,2) NULL COMMENT 'Valor que passa a documentar (nulo no desligamento)',
  valor_desconto              DECIMAL(15,2) NOT NULL DEFAULT 0,
  valor_acrescimo             DECIMAL(15,2) NOT NULL DEFAULT 0,
  situacao_nota               VARCHAR(20) NOT NULL COMMENT 'Situação da nota no momento do evento',
  motivo                      VARCHAR(500) NULL COMMENT 'Obrigatório no desligamento',
  origem                      VARCHAR(20) NOT NULL DEFAULT 'sistema' COMMENT 'sistema, migracao ou integracao',
  criado_em                   DATETIME(3) NOT NULL,
  criado_por                  BIGINT UNSIGNED NULL,
  alterado_em                 DATETIME(3) NULL,
  alterado_por                BIGINT UNSIGNED NULL,
  versao                      INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em                 DATETIME(3) NULL,
  excluido_por                BIGINT UNSIGNED NULL,
  CONSTRAINT ck_evento_vinculo_nota_faturamento_acao CHECK (acao IN ('ligado','ajustado','desligado','religado')),
  CONSTRAINT ck_evento_vinculo_nota_faturamento_motivo CHECK (acao <> 'desligado' OR (motivo IS NOT NULL AND CHAR_LENGTH(TRIM(motivo)) >= 10)),
  CONSTRAINT ck_evento_vinculo_nota_faturamento_valor CHECK ((acao = 'desligado' AND valor_apropriado IS NULL) OR (acao <> 'desligado' AND valor_apropriado > 0)),
  CONSTRAINT ck_evento_vinculo_nota_faturamento_origem CHECK (origem IN ('sistema','migracao','integracao')),
  KEY ix_evento_vinculo_nota_faturamento_vinculo (vinculo_nota_faturamento_id, id)
) COMMENT='Histórico de ligações, ajustes, desligamentos e religamentos da nota fiscal com a fatura ou a conta';
