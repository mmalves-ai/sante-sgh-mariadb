-- F2.4 (dívida da migração): DDL pendente dos pedidos da F2.2, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado.md

ALTER TABLE vinculo_responsavel_portal ADD CONSTRAINT fk_vinculo_responsavel_portal_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE vinculo_responsavel_portal ADD CONSTRAINT fk_vinculo_responsavel_portal_conta_portal_paciente_id FOREIGN KEY IF NOT EXISTS (conta_portal_paciente_id) REFERENCES conta_portal_paciente (id) ON DELETE RESTRICT;
ALTER TABLE vinculo_responsavel_portal ADD CONSTRAINT fk_vinculo_responsavel_portal_paciente_id FOREIGN KEY IF NOT EXISTS (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT;
ALTER TABLE vinculo_responsavel_portal ADD CONSTRAINT fk_vinculo_responsavel_portal_prova_arquivo_id FOREIGN KEY IF NOT EXISTS (prova_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE vinculo_responsavel_portal ADD CONSTRAINT fk_vinculo_responsavel_portal_decidido_por_usuario_id FOREIGN KEY IF NOT EXISTS (decidido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;

ALTER TABLE intencao_pagamento_portal ADD CONSTRAINT fk_intencao_pagamento_portal_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE intencao_pagamento_portal ADD CONSTRAINT fk_intencao_pagamento_portal_conta_portal_paciente_id FOREIGN KEY IF NOT EXISTS (conta_portal_paciente_id) REFERENCES conta_portal_paciente (id) ON DELETE RESTRICT;
ALTER TABLE intencao_pagamento_portal ADD CONSTRAINT fk_intencao_pagamento_portal_paciente_id FOREIGN KEY IF NOT EXISTS (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT;
ALTER TABLE intencao_pagamento_portal ADD CONSTRAINT fk_intencao_pagamento_portal_marcacao_horario_id FOREIGN KEY IF NOT EXISTS (marcacao_horario_id) REFERENCES marcacao_horario (id) ON DELETE RESTRICT;
ALTER TABLE intencao_pagamento_portal ADD CONSTRAINT fk_intencao_pagamento_portal_confirmado_por_usuario_id FOREIGN KEY IF NOT EXISTS (confirmado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE intencao_pagamento_portal ADD CONSTRAINT fk_intencao_pagamento_portal_recebimento_particular_id FOREIGN KEY IF NOT EXISTS (recebimento_particular_id) REFERENCES recebimento_particular (id) ON DELETE RESTRICT;

ALTER TABLE conciliacao_pagamento_portal ADD CONSTRAINT fk_conciliacao_pagamento_portal_intencao_pagamento_portal_id FOREIGN KEY IF NOT EXISTS (intencao_pagamento_portal_id) REFERENCES intencao_pagamento_portal (id) ON DELETE RESTRICT;
ALTER TABLE conciliacao_pagamento_portal ADD CONSTRAINT fk_conciliacao_pagamento_portal_usuario_id FOREIGN KEY IF NOT EXISTS (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;

