-- F2.4 (dívida da migração), 2ª volta: DDL pedido pelos lotes, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v2.md

ALTER TABLE atributo_categoria_acomodacao ADD CONSTRAINT fk_atributo_categoria_acomodacao_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE atributo_categoria_acomodacao ADD CONSTRAINT fk_atributo_categoria_acomodacao_categoria_acomodacao_id FOREIGN KEY IF NOT EXISTS (categoria_acomodacao_id) REFERENCES categoria_acomodacao (id) ON DELETE RESTRICT;
