-- Tipo de pendência da revisão do prontuário pela comissão (F3.9, fatia F3.9-Q4, qualidade.revisarProntuario,
-- 24/11/2026): só para frente e idempotente (ADR 0002, parte 2). Sem gatilho; a regra fica no domínio
-- (@sgh/dominio-qualidade, revisao-prontuario-plano) e na porta (qualidade/porta-propria-revisar-prontuario).
-- O item não conforme na revisão gera a pendência ao médico com este tipo. A semente da qualidade
-- (db/sementes/18_qualidade.json) já o traz para o cliente novo; esta migração o garante nos clientes que já existiam
-- (inclusive os de carga), sem mexer no tipo que o cliente já tenha ajustado.
INSERT INTO tipo_pendencia_prontuario (codigo, descricao, categoria, responsavel, resolucao_manual, criado_em) VALUES
  ('revisao_comissao', 'Item não conforme na revisão do prontuário pela comissão', 'documento', 'medico', TRUE, NOW(3))
ON DUPLICATE KEY UPDATE codigo = codigo;
