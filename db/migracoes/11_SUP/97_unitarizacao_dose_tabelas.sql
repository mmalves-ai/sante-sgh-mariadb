-- Suprimentos, fracionamento e unitarização de dose (C2-092, 05-SUP linha 11, 25/11/2026): só para frente e idempotente
-- (ADR 0002, parte 2). A ordem (ordem_unitarizacao e ordem_unitarizacao_item), a dose (dose_unitarizada) e a regra do
-- insumo (regra_fracionamento_insumo) já estão no modelo; aqui entram os dois tipos nativos do catálogo do estoque que
-- a ordem usa: a baixa do lote de origem aberto e a entrada das doses no local, com o mesmo número de lote. A regra é
-- do domínio (unitarizacao-dose); o banco só guarda.
INSERT IGNORE INTO tipo_movimento_estoque (codigo, descricao, natureza, sentido, afeta_saldo, afeta_custo_medio, sistema, ativo, criado_em) VALUES
  ('unitarizacao_consumo', 'Baixa do lote de origem aberto no fracionamento ou unitarização', 'producao', 'saida', TRUE, FALSE, TRUE, TRUE, UTC_TIMESTAMP(3)),
  ('unitarizacao_entrada', 'Entrada das doses fracionadas ou unitarizadas', 'producao', 'entrada', TRUE, TRUE, TRUE, TRUE, UTC_TIMESTAMP(3));
