-- Chaves da 99w_regra_plano_especialidade_servico_setor (só para frente e idempotente).
ALTER TABLE regra_atendimento_fonte_pagadora ADD CONSTRAINT fk_regra_atendimento_fonte_pagadora_especialidade_medica_id FOREIGN KEY IF NOT EXISTS (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT;
ALTER TABLE regra_atendimento_fonte_pagadora ADD CONSTRAINT fk_regra_atendimento_fonte_pagadora_servico_atendimento_id FOREIGN KEY IF NOT EXISTS (servico_atendimento_id) REFERENCES servico_atendimento (id) ON DELETE RESTRICT;
ALTER TABLE regra_atendimento_fonte_pagadora ADD CONSTRAINT fk_regra_atendimento_fonte_pagadora_unidade_assistencial_id FOREIGN KEY IF NOT EXISTS (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT;
