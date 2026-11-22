-- INTG, lote 30 (era o 05; renumerado na junção com o conector, que usou o mesmo número) (F2.2 ondas finais, onda 5; pedido do lote 05-14). Convenções do ADR 0002 (parte 2). Só para frente.

-- 05-14: o recibo do destino (ACK, protocolo ou identificador) inteiro; antes ia truncado a 30 em codigo_resposta
ALTER TABLE mensagem_integracao_saida
  ADD COLUMN recibo VARCHAR(120) NULL COMMENT 'Recibo devolvido pelo destino (ACK, protocolo ou identificador)' AFTER codigo_resposta;
