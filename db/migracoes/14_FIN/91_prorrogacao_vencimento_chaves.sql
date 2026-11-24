-- Financeiro, prorrogação do vencimento da parcela a pagar (f3-funcoes F3.8-1): chaves, só para frente e idempotente.
ALTER TABLE prorrogacao_parcela_pagar
  ADD KEY IF NOT EXISTS fk_prorrogacao_parcela_pagar_estabelecimento (estabelecimento_id),
  ADD KEY IF NOT EXISTS fk_prorrogacao_parcela_pagar_criado_por (criado_por);
ALTER TABLE prorrogacao_parcela_pagar
  ADD CONSTRAINT fk_prorrogacao_parcela_pagar_estabelecimento FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id),
  ADD CONSTRAINT fk_prorrogacao_parcela_pagar_parcela FOREIGN KEY IF NOT EXISTS (parcela_pagar_id) REFERENCES parcela_pagar (id),
  ADD CONSTRAINT fk_prorrogacao_parcela_pagar_criado_por FOREIGN KEY IF NOT EXISTS (criado_por) REFERENCES usuario (id);
