-- F2.4 (dívida da migração): DDL pendente dos pedidos da F2.2, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado.md

ALTER TABLE pre_checkin ADD CONSTRAINT fk_pre_checkin_conta_portal_paciente_id FOREIGN KEY IF NOT EXISTS (conta_portal_paciente_id) REFERENCES conta_portal_paciente (id) ON DELETE RESTRICT;
ALTER TABLE pre_checkin ADD CONSTRAINT fk_pre_checkin_reservado_por_usuario_id FOREIGN KEY IF NOT EXISTS (reservado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;

ALTER TABLE pre_checkin_documento ADD CONSTRAINT fk_pre_checkin_documento_pre_checkin_id FOREIGN KEY IF NOT EXISTS (pre_checkin_id) REFERENCES pre_checkin (id) ON DELETE RESTRICT;
ALTER TABLE pre_checkin_documento ADD CONSTRAINT fk_pre_checkin_documento_arquivo_id FOREIGN KEY IF NOT EXISTS (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;

ALTER TABLE agenda_online_configuracao ADD CONSTRAINT fk_agenda_online_configuracao_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE agenda_online_configuracao ADD CONSTRAINT fk_agenda_online_configuracao_agenda_servico_id FOREIGN KEY IF NOT EXISTS (agenda_servico_id) REFERENCES agenda_servico (id) ON DELETE RESTRICT;

ALTER TABLE agenda_online_convenio ADD CONSTRAINT fk_agenda_online_convenio_agenda_online_configuracao_id FOREIGN KEY IF NOT EXISTS (agenda_online_configuracao_id) REFERENCES agenda_online_configuracao (id) ON DELETE RESTRICT;
ALTER TABLE agenda_online_convenio ADD CONSTRAINT fk_agenda_online_convenio_fonte_pagadora_id FOREIGN KEY IF NOT EXISTS (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT;

ALTER TABLE agenda_online_servico ADD CONSTRAINT fk_agenda_online_servico_agenda_online_configuracao_id FOREIGN KEY IF NOT EXISTS (agenda_online_configuracao_id) REFERENCES agenda_online_configuracao (id) ON DELETE RESTRICT;
ALTER TABLE agenda_online_servico ADD CONSTRAINT fk_agenda_online_servico_especialidade_medica_id FOREIGN KEY IF NOT EXISTS (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT;
ALTER TABLE agenda_online_servico ADD CONSTRAINT fk_agenda_online_servico_exame_id FOREIGN KEY IF NOT EXISTS (exame_id) REFERENCES exame (id) ON DELETE RESTRICT;

