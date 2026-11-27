-- Central de integrações externas (decisão 53 do dono, 27/11/2026): só para frente e idempotente (ADR 0002, parte 2).
-- Uma linha por integração do catálogo (packages/contratos, integracao/externas.ts) no banco do cliente: o modo
-- (simulador ou real), os parâmetros não secretos, o prefixo da referência das credenciais no cofre (o valor nunca
-- fica aqui), quem ligou o modo e quando, e a última falha do real registrada pelo adaptador. Sem gatilho.

CREATE TABLE IF NOT EXISTS configuracao_integracao_externa (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  integracao            VARCHAR(60) NOT NULL COMMENT 'Identificador da integração no catálogo do produto',
  modo                  VARCHAR(10) NOT NULL DEFAULT 'simulador' COMMENT 'simulador (padrão) ou real; fora de produção o real fica neutralizado',
  parametros            JSON NULL COMMENT 'Endereço e parâmetros não secretos, pelos identificadores do catálogo',
  referencia_cofre      VARCHAR(200) NOT NULL COMMENT 'Prefixo da referência das credenciais no cofre (cofre:integracao/<cliente>/<integração>); nunca o valor',
  modo_alterado_em      DATETIME(3) NULL COMMENT 'Quando o modo foi trocado pela última vez',
  modo_alterado_por     BIGINT UNSIGNED NULL COMMENT 'Quem trocou o modo (usuário do cliente)',
  ultima_falha_em       DATETIME(3) NULL COMMENT 'Última falha do real registrada pelo adaptador',
  ultima_falha          VARCHAR(500) NULL COMMENT 'Motivo da última falha, sem dado de pessoa nem segredo',
  origem                VARCHAR(20) NOT NULL DEFAULT 'sistema' COMMENT 'Como o registro entrou: sistema, migracao ou integracao',
  criado_em             DATETIME(3) NOT NULL,
  criado_por            BIGINT UNSIGNED NULL,
  alterado_em           DATETIME(3) NULL,
  alterado_por          BIGINT UNSIGNED NULL,
  versao                INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_configuracao_integracao_externa_modo CHECK (modo IN ('simulador','real')),
  CONSTRAINT ck_configuracao_integracao_externa_origem CHECK (origem IN ('sistema','migracao','integracao')),
  CONSTRAINT ck_configuracao_integracao_externa_referencia CHECK (referencia_cofre LIKE 'cofre:integracao/%'),
  CONSTRAINT ck_configuracao_integracao_externa_parametros CHECK (parametros IS NULL OR JSON_VALID(parametros)),
  UNIQUE KEY uq_configuracao_integracao_externa_integracao (integracao)
) COMMENT='Central de integrações externas: modo simulador ou real, parâmetros não secretos e referência do cofre, por cliente';
