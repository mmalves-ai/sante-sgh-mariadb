-- F2.4 (dívida da migração), 3ª etapa, 4ª leva: DDL pedido pelos lotes das portas (p-*), só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v4.md

ALTER TABLE plano_refeicao_acompanhante_evento ADD CONSTRAINT fk_plano_refeicao_acompanhante_evento_plano FOREIGN KEY IF NOT EXISTS (plano_refeicao_acompanhante_id) REFERENCES plano_refeicao_acompanhante (id) ON DELETE RESTRICT;
ALTER TABLE plano_refeicao_acompanhante_evento ADD CONSTRAINT fk_plano_refeicao_acompanhante_evento_usuario FOREIGN KEY IF NOT EXISTS (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
