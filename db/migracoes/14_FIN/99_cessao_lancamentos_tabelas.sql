-- Lançamentos da operação de desconto ou cessão de recebíveis (07-FIN linha 79, F8, 24/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2). Sem gatilho; as regras ficam no domínio (@sgh/dominio-financeiro,
-- nota-credito-cessao.ts, lancamentosCessao) e nas operações (apps/api/src/modulos/financeiro/nota-cessao-propria.ts).
-- A operação credita a face na conta do portador e debita o deságio, as tarifas e o IOF, cada um com o seu tipo de
-- lançamento (despesa financeira separada); a recompra debita o valor pago ao portador. A parcela que sai da carteira
-- pela cessão (ou que o sacado paga ao portador) ganha um recebimento com meio de baixa próprio, "cessao", que não se
-- confunde com o pagamento do sacado ao hospital.

-- O meio de baixa da cessão no recebimento (a lista anterior continua toda aceita).
ALTER TABLE recebimento DROP CONSTRAINT IF EXISTS ck_recebimento_meio_baixa;
ALTER TABLE recebimento
  ADD CONSTRAINT IF NOT EXISTS ck_recebimento_meio_baixa CHECK (meio_baixa IN ('manual','retorno_bancario','pix','cartao','demonstrativo','conciliacao','cessao'));

-- Valores padrão de produto (não do hospital): INSERT IGNORE pelo código, sem reescrever o que o hospital ajustou.
INSERT IGNORE INTO tipo_lancamento_bancario (codigo, descricao, sentido, tarifa, criado_em) VALUES
  ('cessao_face', 'Crédito da face dos recebíveis descontados ou cedidos', 'credito', FALSE, NOW(3)),
  ('cessao_desagio', 'Deságio (juros) do desconto ou da cessão de recebíveis', 'debito', FALSE, NOW(3)),
  ('cessao_tarifas', 'Tarifas da operação de desconto ou cessão de recebíveis', 'debito', TRUE, NOW(3)),
  ('cessao_iof', 'IOF da operação de desconto ou cessão de recebíveis', 'debito', FALSE, NOW(3)),
  ('cessao_recompra', 'Recompra de recebível descontado com coobrigação, paga ao portador', 'debito', FALSE, NOW(3));
INSERT IGNORE INTO forma_recebimento (codigo, descricao, meio, uso, criado_em) VALUES
  ('cessao_recebivel', 'Baixa pela cessão ou desconto ao portador', 'transferencia', 'recebimento', NOW(3));
