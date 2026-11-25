-- Suprimentos, governança do cadastro de itens (C2-082, 05-SUP linha 2, 25/11/2026): só para frente e idempotente
-- (ADR 0002, parte 2). A solicitação de cadastro, a unificação e a substituição já estão no modelo
-- (solicitacao_cadastro_insumo, unificacao_insumo, unificacao_insumo_item, substituicao_insumo). A execução da
-- unificação transfere o saldo do item absorvido para o que permanece com dois tipos nativos do catálogo do estoque: a
-- saída do absorvido (pelo custo médio do local, sem mexer no custo médio do que fica) e a entrada no que permanece
-- (convertida pelo fator, com o mesmo valor). O item absorvido fica inativo, nunca apagado; o histórico continua ligado
-- a ele e a correspondência fica em unificacao_insumo_item. Contagem das referências do cadastro transferidas por item.
-- A regra é do domínio (governanca-cadastro); o banco só guarda.
INSERT IGNORE INTO tipo_movimento_estoque (codigo, descricao, natureza, sentido, afeta_saldo, afeta_custo_medio, sistema, ativo, criado_em) VALUES
  ('unificacao_saida', 'Saída do item absorvido na unificação do cadastro', 'ajuste', 'saida', TRUE, FALSE, TRUE, TRUE, UTC_TIMESTAMP(3)),
  ('unificacao_entrada', 'Entrada no item que permanece na unificação do cadastro', 'ajuste', 'entrada', TRUE, TRUE, TRUE, TRUE, UTC_TIMESTAMP(3));

ALTER TABLE unificacao_insumo_item
  ADD COLUMN IF NOT EXISTS referencias_transferidas INT UNSIGNED NOT NULL DEFAULT 0
    COMMENT 'Quantas referências do cadastro (código de barras, fornecedor, kit, prescrição, preço) passaram ao item que permanece' AFTER quantidade_saldo_transferida,
  ADD COLUMN IF NOT EXISTS referencias_mantidas INT UNSIGNED NOT NULL DEFAULT 0
    COMMENT 'Referências que já existiam no item que permanece e ficaram no absorvido (sem duplicar)' AFTER referencias_transferidas;
