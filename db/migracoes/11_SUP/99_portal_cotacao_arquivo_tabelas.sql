-- Portal de cotação "troca por arquivo" (05-SUP linha 19, C3-008, 26/11/2026): só para frente e idempotente (ADR 0002,
-- parte 2). Sem gatilho.
--   - É o primeiro adaptador da porta genérica do portal de cotação: o comprador baixa o mapa em planilha e importa o
--     arquivo devolvido pelo fornecedor ou pelo portal (apps/api/src/modulos/suprimentos/mapa-cotacao.ts lê o código
--     'arquivo'). Cada importação liga o pedido ao portal em vinculo_pedido_compra_portal.
--   - Os portais com API entram como outra linha deste cadastro, com a credencial no cofre (referencia_cofre).
INSERT INTO portal_cotacao (codigo, descricao, tipo_integracao, publica_automatico, envia_pedido, recebe_nota, ativo, criado_em)
  SELECT 'arquivo', 'Troca do mapa por arquivo', 'arquivo', FALSE, FALSE, FALSE, TRUE, CURRENT_TIMESTAMP(3) FROM DUAL
   WHERE NOT EXISTS (SELECT 1 FROM portal_cotacao WHERE codigo = 'arquivo');
