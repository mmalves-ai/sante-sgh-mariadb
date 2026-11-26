-- Recusas da carga (fase 2, V-D2): o princípio ativo do cadastro próprio do cliente (principio_ativo_cliente_id) tem
-- a mesma chave única do princípio oficial: o mesmo pai não liga duas vezes o mesmo princípio próprio. As linhas
-- ligadas ao oficial têm a coluna nula e não entram na chave (NULL não se repete numa chave única).
-- Idempotente e válida em qualquer ordem depois da coluna (ADD UNIQUE KEY IF NOT EXISTS).
ALTER TABLE alergia_paciente_principio
  ADD UNIQUE KEY IF NOT EXISTS uq_alergia_paciente_principio_cliente_par (alergia_paciente_id, principio_ativo_cliente_id);
ALTER TABLE item_nao_padronizado_principio
  ADD UNIQUE KEY IF NOT EXISTS uq_item_nao_padronizado_principio_cliente_par (item_nao_padronizado_id, principio_ativo_cliente_id);
ALTER TABLE alergeno_principio_ativo
  ADD UNIQUE KEY IF NOT EXISTS uq_alergeno_principio_ativo_cliente_par (alergeno_id, principio_ativo_cliente_id);
