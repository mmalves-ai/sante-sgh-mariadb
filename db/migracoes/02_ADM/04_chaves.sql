-- Chaves do módulo ADM, lote 04 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE tipo_escopo_acesso
  ADD CONSTRAINT fk_tipo_escopo_acesso_modulo_sistema_id FOREIGN KEY (modulo_sistema_id) REFERENCES modulo_sistema (id) ON DELETE RESTRICT;
ALTER TABLE usuario
  ADD CONSTRAINT fk_usuario_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_usuario_motivo_bloqueio_usuario_id FOREIGN KEY (motivo_bloqueio_usuario_id) REFERENCES motivo_bloqueio_usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_usuario_foto_arquivo_id FOREIGN KEY (foto_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE ultimo_acesso_usuario
  ADD CONSTRAINT fk_ultimo_acesso_usuario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ultimo_acesso_usuario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ultimo_acesso_usuario_modulo_sistema_id FOREIGN KEY (modulo_sistema_id) REFERENCES modulo_sistema (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ultimo_acesso_usuario_estacao_trabalho_id FOREIGN KEY (estacao_trabalho_id) REFERENCES estacao_trabalho (id) ON DELETE RESTRICT;
ALTER TABLE usuario_acao_excecao
  ADD CONSTRAINT fk_usuario_acao_excecao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_usuario_acao_excecao_acao_sistema_id FOREIGN KEY (acao_sistema_id) REFERENCES acao_sistema (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_usuario_acao_excecao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_usuario_acao_excecao_autorizador_usuario_id FOREIGN KEY (autorizador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE usuario_escopo
  ADD CONSTRAINT fk_usuario_escopo_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_usuario_escopo_tipo_escopo_acesso_id FOREIGN KEY (tipo_escopo_acesso_id) REFERENCES tipo_escopo_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_usuario_escopo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE usuario_estabelecimento
  ADD CONSTRAINT fk_usuario_estabelecimento_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_usuario_estabelecimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE usuario_fonte_pagadora
  ADD CONSTRAINT fk_usuario_fonte_pagadora_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_usuario_fonte_pagadora_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE usuario_local_atendimento
  ADD CONSTRAINT fk_usuario_local_atendimento_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_usuario_local_atendimento_local_atendimento_id FOREIGN KEY (local_atendimento_id) REFERENCES local_atendimento (id) ON DELETE RESTRICT;
ALTER TABLE usuario_papel_seguranca
  ADD CONSTRAINT fk_usuario_papel_seguranca_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_usuario_papel_seguranca_papel_seguranca_id FOREIGN KEY (papel_seguranca_id) REFERENCES papel_seguranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_usuario_papel_seguranca_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT;
ALTER TABLE usuario_perfil
  ADD CONSTRAINT fk_usuario_perfil_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_usuario_perfil_perfil_acesso_id FOREIGN KEY (perfil_acesso_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_usuario_perfil_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE usuario_permissao_sus
  ADD CONSTRAINT fk_usuario_permissao_sus_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_usuario_permissao_sus_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE usuario_situacao_historico
  ADD CONSTRAINT fk_usuario_situacao_historico_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_usuario_situacao_historico_motivo_bloqueio_usuario_id FOREIGN KEY (motivo_bloqueio_usuario_id) REFERENCES motivo_bloqueio_usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_usuario_situacao_historico_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE usuario_tipo_agenda
  ADD CONSTRAINT fk_usuario_tipo_agenda_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_usuario_tipo_agenda_categoria_agenda_id FOREIGN KEY (categoria_agenda_id) REFERENCES categoria_agenda (id) ON DELETE RESTRICT;
ALTER TABLE usuario_tipo_prontuario
  ADD CONSTRAINT fk_usuario_tipo_prontuario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_usuario_tipo_prontuario_tipo_documento_clinico_id FOREIGN KEY (tipo_documento_clinico_id) REFERENCES tipo_documento_clinico (id) ON DELETE RESTRICT;
ALTER TABLE usuario_unidade
  ADD CONSTRAINT fk_usuario_unidade_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_usuario_unidade_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT;
ALTER TABLE usuario_vinculo_profissional
  ADD CONSTRAINT fk_usuario_vinculo_profissional_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_usuario_vinculo_profissional_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_usuario_vinculo_profissional_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_usuario_vinculo_profissional_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT;
ALTER TABLE verificacao_backup
  ADD CONSTRAINT fk_verificacao_backup_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE vinculo_identidade_externa
  ADD CONSTRAINT fk_vinculo_identidade_externa_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vinculo_identidade_externa_provedor_identidade_id FOREIGN KEY (provedor_identidade_id) REFERENCES provedor_identidade (id) ON DELETE RESTRICT;
