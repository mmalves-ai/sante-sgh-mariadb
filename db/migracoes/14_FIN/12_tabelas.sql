-- FIN, lote 12 (F2.2 ondas finais, onda 3; pedido do lote 03-13). Convenções do ADR 0002 (parte 2). Só para frente.
ALTER TABLE contrato_fornecedor
  ADD COLUMN critico BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Fornecedor crítico: avaliação a cada 6 meses',
  ADD COLUMN observacao VARCHAR(1000) NULL;
