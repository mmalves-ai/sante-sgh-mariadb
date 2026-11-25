-- Prazo do município para cancelar e substituir a nota de serviço e motivos padrão da nota (07-FIN linha 113, F3.8,
-- 24/11/2026): só para frente e idempotente (ADR 0002, parte 2). Sem gatilho; a regra fica no domínio
-- (@sgh/dominio-financeiro, nfse-ciclo.ts: conferirCancelamentoNfse, conferirSubstituicaoNfse, conferirParametroNfse)
-- e nas operações (apps/api/src/modulos/financeiro/nota-servico-propria.ts). O prazo é do município onde o serviço é
-- prestado e fica na regra do ISS dele; vazio vale o prazo padrão do produto (30 dias).
ALTER TABLE regra_iss_municipio
  ADD COLUMN IF NOT EXISTS prazo_cancelamento_dias SMALLINT UNSIGNED NULL COMMENT 'Dias, contados da emissão, em que a nota de serviço pode ser cancelada no município; vazio vale o padrão' AFTER percentual_deducao_base,
  ADD COLUMN IF NOT EXISTS prazo_substituicao_dias SMALLINT UNSIGNED NULL COMMENT 'Dias, contados da emissão, em que a nota de serviço pode ser substituída no município; vazio vale o padrão' AFTER prazo_cancelamento_dias;

ALTER TABLE regra_iss_municipio
  ADD CONSTRAINT IF NOT EXISTS ck_regra_iss_municipio_prazos CHECK ((prazo_cancelamento_dias IS NULL OR prazo_cancelamento_dias <= 3650) AND (prazo_substituicao_dias IS NULL OR prazo_substituicao_dias <= 3650));

-- Valores padrão de produto (não do hospital): motivos usuais do cancelamento e da substituição da nota de serviço; o
-- hospital acrescenta ou desliga os seus. INSERT IGNORE pelo código: não reescreve o que o hospital já ajustou.
INSERT IGNORE INTO motivo_cancelamento_documento_fiscal
  (codigo, descricao, aplica_nota_servico, aplica_nota_mercadoria, aplica_nota_credito_debito, criado_em) VALUES
  ('servico_nao_prestado', 'Serviço não prestado ou atendimento desfeito', TRUE, FALSE, FALSE, NOW(3)),
  ('nota_duplicada', 'Nota emitida em duplicidade', TRUE, TRUE, FALSE, NOW(3)),
  ('erro_tomador', 'Dados do tomador incorretos', TRUE, FALSE, FALSE, NOW(3)),
  ('erro_valor_tributo', 'Valor, dedução ou tributo incorreto', TRUE, TRUE, FALSE, NOW(3)),
  ('glosa_reapresentacao', 'Fatura glosada e reapresentada com outro valor', TRUE, FALSE, FALSE, NOW(3));
