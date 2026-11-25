-- Cobrança Pix sobre o título a receber (07-FIN linha 90, F7, 25/11/2026): só para frente e idempotente (ADR 0002,
-- parte 2). Sem gatilho; as regras ficam no domínio (@sgh/dominio-financeiro, cobranca-pix.ts) e nas operações
-- (apps/api/src/modulos/financeiro/cobranca-pix-propria.ts). As tabelas da chave, da cobrança, do retorno e da
-- devolução já existem (14_FIN/02, 04 e 08); aqui entram só os valores padrão de produto que a baixa automática e a
-- devolução usam: a forma de recebimento Pix e o tipo de lançamento bancário do débito da devolução.

-- Valores padrão de produto (não do hospital): INSERT IGNORE pelo código, sem reescrever o que o hospital ajustou.
INSERT IGNORE INTO tipo_lancamento_bancario (codigo, descricao, sentido, tarifa, criado_em) VALUES
  ('devolucao_pix', 'Devolução de Pix recebido ao pagador', 'debito', FALSE, NOW(3));
INSERT IGNORE INTO forma_recebimento (codigo, descricao, meio, uso, criado_em) VALUES
  ('pix', 'Pix (baixa automática pela cobrança)', 'pix', 'recebimento', NOW(3));
