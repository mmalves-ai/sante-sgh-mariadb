-- Recusas da carga (fase 2, V-D2): o princípio ativo do cadastro próprio do cliente (principio_ativo_cliente_id) tem
-- a mesma chave única do princípio oficial: o mesmo pai não liga duas vezes o mesmo princípio próprio. As linhas
-- ligadas ao oficial têm a coluna nula e não entram na chave (NULL não se repete numa chave única).
-- Idempotente e válida em qualquer ordem depois da coluna (ADD UNIQUE KEY IF NOT EXISTS).
ALTER TABLE insumo_principio_ativo
  ADD UNIQUE KEY IF NOT EXISTS uq_insumo_principio_ativo_insumo_principio_cliente (insumo_id, principio_ativo_cliente_id);
