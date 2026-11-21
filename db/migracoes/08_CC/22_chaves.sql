-- F2.4 (dívida da migração), 3ª etapa: DDL pedido pelos lotes da 2ª volta, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v3.md

ALTER TABLE lancamento_ficha_anestesica ADD CONSTRAINT fk_lancamento_ficha_anestesica_procedimento_cirurgico_id FOREIGN KEY IF NOT EXISTS (procedimento_cirurgico_id) REFERENCES procedimento_cirurgico (id) ON DELETE RESTRICT;
