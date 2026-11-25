-- Manutenção corretiva (F7, 04-HOT L135, 25/11/2026): orçamento da OS com aprovação por alçada e remessa do equipamento
-- para conserto externo. Só para frente e idempotente (ADR 0002, parte 2). Sem gatilho: as regras ficam no domínio
-- (@sgh/dominio-manutencao, oficina-orcamento) e na porta (manutencao/oficina-orcamento-propria).
--   - Orçamento: um ou mais por OS; o novo substitui o pendente (nada se apaga). A decisão grava quem, quando e a
--     justificativa (obrigatória na reprovação). Quem registrou não decide (conferido no domínio).
--   - Alçada: valor máximo que o aprovador da oficina aprova (oficina_manutencao_usuario, função aprovador; nula = sem
--     limite), como pedem a RDC 509/2021 e a NBR 15943 (o gestor aprova dentro da alçada).
--   - Remessa: a saída do equipamento ao fornecedor com o termo (estado, acessórios), a nota de remessa para conserto
--     (CFOP 5.915 no estado, 6.915 fora) e a previsão; o retorno fecha a remessa com o resultado. A OS fica
--     aguardando o fornecedor enquanto a remessa está aberta.
ALTER TABLE oficina_manutencao_usuario
  ADD COLUMN IF NOT EXISTS alcada_aprovacao DECIMAL(15,2) NULL COMMENT 'Valor máximo que o aprovador aprova; nula = sem limite' AFTER funcao;
ALTER TABLE oficina_manutencao_usuario DROP CONSTRAINT IF EXISTS ck_oficina_manutencao_usuario_alcada;
ALTER TABLE oficina_manutencao_usuario ADD CONSTRAINT ck_oficina_manutencao_usuario_alcada
  CHECK (alcada_aprovacao IS NULL OR (funcao = 'aprovador' AND alcada_aprovacao > 0));

CREATE TABLE IF NOT EXISTS orcamento_ordem_servico_manutencao (
  id                           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id           BIGINT UNSIGNED NOT NULL,
  ordem_servico_manutencao_id  BIGINT UNSIGNED NOT NULL,
  empresa_fornecedora_id       BIGINT UNSIGNED NULL COMMENT 'Fornecedor que orçou; nulo quando o orçamento é da oficina própria',
  descricao                    VARCHAR(1000) NOT NULL COMMENT 'Serviço e peças orçados',
  valor                        DECIMAL(15,2) NOT NULL,
  prazo_dias                   INT UNSIGNED NULL COMMENT 'Prazo de execução prometido, em dias',
  validade                     DATE NULL,
  situacao                     VARCHAR(20) NOT NULL DEFAULT 'pendente',
  registrado_por_usuario_id    BIGINT UNSIGNED NOT NULL,
  registrado_em                DATETIME(3) NOT NULL,
  decidido_por_usuario_id      BIGINT UNSIGNED NULL,
  decidido_em                  DATETIME(3) NULL,
  justificativa_decisao        VARCHAR(1000) NULL,
  criado_em                    DATETIME(3) NOT NULL,
  criado_por                   BIGINT UNSIGNED NULL,
  alterado_em                  DATETIME(3) NULL,
  alterado_por                 BIGINT UNSIGNED NULL,
  versao                       INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_orcamento_ordem_servico_manutencao_situacao CHECK (situacao IN ('pendente','aprovado','reprovado','substituido')),
  CONSTRAINT ck_orcamento_ordem_servico_manutencao_valor CHECK (valor > 0),
  CONSTRAINT ck_orcamento_ordem_servico_manutencao_decisao CHECK (situacao NOT IN ('aprovado','reprovado') OR (decidido_em IS NOT NULL AND decidido_por_usuario_id IS NOT NULL)),
  CONSTRAINT ck_orcamento_ordem_servico_manutencao_reprovado CHECK (situacao <> 'reprovado' OR CHAR_LENGTH(justificativa_decisao) >= 10),
  KEY ix_orcamento_ordem_servico_manutencao_os (ordem_servico_manutencao_id, situacao),
  KEY ix_orcamento_ordem_servico_manutencao_estabelecimento (estabelecimento_id, situacao),
  KEY ix_orcamento_ordem_servico_manutencao_fornecedor (empresa_fornecedora_id),
  KEY ix_orcamento_ordem_servico_manutencao_registrado (registrado_por_usuario_id),
  KEY ix_orcamento_ordem_servico_manutencao_decidido (decidido_por_usuario_id)
) COMMENT='Orçamento da ordem de serviço de manutenção, com a aprovação ou reprovação pelo aprovador da oficina';

CREATE TABLE IF NOT EXISTS remessa_conserto_manutencao (
  id                                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id                    BIGINT UNSIGNED NOT NULL,
  ordem_servico_manutencao_id           BIGINT UNSIGNED NOT NULL,
  equipamento_saude_id                  BIGINT UNSIGNED NOT NULL,
  empresa_fornecedora_id                BIGINT UNSIGNED NOT NULL,
  orcamento_ordem_servico_manutencao_id BIGINT UNSIGNED NULL COMMENT 'Orçamento aprovado que autorizou a saída, quando houver',
  termo_saida                           VARCHAR(1000) NOT NULL COMMENT 'Estado e acessórios do equipamento na saída',
  nota_fiscal_remessa                   VARCHAR(20) NULL,
  cfop_remessa                          CHAR(4) NULL COMMENT '5915 (no estado) ou 6915 (fora do estado)',
  enviado_em                            DATETIME(3) NOT NULL,
  enviado_por_usuario_id                BIGINT UNSIGNED NOT NULL,
  previsao_retorno                      DATE NULL,
  situacao                              VARCHAR(20) NOT NULL DEFAULT 'enviado',
  retornado_em                          DATETIME(3) NULL,
  retornado_por_usuario_id              BIGINT UNSIGNED NULL,
  nota_fiscal_retorno                   VARCHAR(20) NULL,
  resultado_retorno                     VARCHAR(20) NULL,
  observacao_retorno                    VARCHAR(1000) NULL,
  criado_em                             DATETIME(3) NOT NULL,
  criado_por                            BIGINT UNSIGNED NULL,
  alterado_em                           DATETIME(3) NULL,
  alterado_por                          BIGINT UNSIGNED NULL,
  versao                                INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_remessa_conserto_manutencao_situacao CHECK (situacao IN ('enviado','retornado')),
  CONSTRAINT ck_remessa_conserto_manutencao_cfop CHECK (cfop_remessa IS NULL OR cfop_remessa IN ('5915','6915')),
  CONSTRAINT ck_remessa_conserto_manutencao_resultado CHECK (resultado_retorno IS NULL OR resultado_retorno IN ('consertado','sem_conserto')),
  CONSTRAINT ck_remessa_conserto_manutencao_retorno CHECK (situacao <> 'retornado' OR (retornado_em IS NOT NULL AND retornado_por_usuario_id IS NOT NULL AND resultado_retorno IS NOT NULL)),
  CONSTRAINT ck_remessa_conserto_manutencao_datas CHECK (retornado_em IS NULL OR retornado_em >= enviado_em),
  CONSTRAINT ck_remessa_conserto_manutencao_previsao CHECK (previsao_retorno IS NULL OR previsao_retorno >= DATE(enviado_em)),
  KEY ix_remessa_conserto_manutencao_os (ordem_servico_manutencao_id, situacao),
  KEY ix_remessa_conserto_manutencao_estabelecimento (estabelecimento_id, situacao, previsao_retorno),
  KEY ix_remessa_conserto_manutencao_equipamento (equipamento_saude_id),
  KEY ix_remessa_conserto_manutencao_fornecedor (empresa_fornecedora_id),
  KEY ix_remessa_conserto_manutencao_orcamento (orcamento_ordem_servico_manutencao_id),
  KEY ix_remessa_conserto_manutencao_enviado_por (enviado_por_usuario_id),
  KEY ix_remessa_conserto_manutencao_retornado_por (retornado_por_usuario_id)
) COMMENT='Remessa do equipamento ao fornecedor para conserto externo, com o termo de saída e o retorno';
