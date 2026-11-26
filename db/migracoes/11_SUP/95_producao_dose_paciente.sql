-- Suprimentos, produção interna (C1-124, 05-SUP linha 12, 25/11/2026): só para frente e idempotente (ADR 0002, parte 2).
-- A ordem de manipulação com finalidade de prescrição é a dose de um paciente (quimioterapia, nutrição parenteral):
-- o lote produzido entra no local e sai na mesma transação para o paciente e o atendimento da ordem, sem ficar no
-- saldo livre. Este é o tipo nativo dessa saída. A regra é do domínio (destinoDoLoteProduzido); o banco só guarda.
INSERT IGNORE INTO tipo_movimento_estoque (codigo, descricao, natureza, sentido, afeta_saldo, afeta_custo_medio, sistema, ativo, criado_em) VALUES
  ('producao_dose_paciente', 'Saída da dose manipulada ao paciente da prescrição', 'consumo_paciente', 'saida', TRUE, FALSE, TRUE, TRUE, UTC_TIMESTAMP(3));
