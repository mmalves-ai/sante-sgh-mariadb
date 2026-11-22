-- SUP, lote 07 (F4 conector, rodada 3 de cobertura, grupo 3: pedido da fatia L7-08, registrado para a trilha F2.2 em
-- docs/obra/passagens/F4-decisoes-destino.md). Só para frente. Sem tabela nova (não há 07_tabelas.sql).
-- Tipos NATIVOS do sistema para o que a carga de outro sistema traz sem tipo (a origem não tem coluna de tipo do
-- movimento nem da entrada): o conector acha o id pelo código (`cod:`). Inativos: o usuário não os escolhe em
-- movimento novo; nativos: o hospital não os exclui. Idempotente (código único).
INSERT IGNORE INTO tipo_movimento_estoque (codigo, descricao, natureza, sentido, afeta_saldo, afeta_custo_medio, sistema, ativo, criado_em) VALUES
  ('migracao_entrada', 'Entrada trazida de outro sistema', 'entrada', 'entrada', TRUE, FALSE, TRUE, FALSE, UTC_TIMESTAMP(3)),
  ('migracao_saida', 'Saída trazida de outro sistema', 'saida', 'saida', TRUE, FALSE, TRUE, FALSE, UTC_TIMESTAMP(3));
INSERT IGNORE INTO tipo_entrada_estoque (codigo, descricao, natureza, tipo_movimento_estoque_id, exige_documento_fiscal, atualiza_custo_medio, atualiza_ultimo_preco, exige_fornecedor, ativo, criado_em)
  SELECT 'migracao', 'Entrada trazida de outro sistema', 'outra', id, FALSE, FALSE, FALSE, FALSE, FALSE, UTC_TIMESTAMP(3)
  FROM tipo_movimento_estoque WHERE codigo = 'migracao_entrada';
