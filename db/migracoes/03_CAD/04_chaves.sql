-- Chaves do módulo CAD, lote 04 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE sinonimo_especialidade
  ADD CONSTRAINT fk_sinonimo_especialidade_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT;
ALTER TABLE solicitante_externo
  ADD CONSTRAINT fk_solicitante_externo_conselho_classe_id FOREIGN KEY (conselho_classe_id) REFERENCES conselho_classe (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitante_externo_conselho_unidade_federativa_id FOREIGN KEY (conselho_unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitante_externo_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitante_externo_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT;
ALTER TABLE solicitante_externo_fonte_pagadora
  ADD CONSTRAINT fk_solicitante_externo_fonte_pagadora_solicitante_externo_id FOREIGN KEY (solicitante_externo_id) REFERENCES solicitante_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitante_externo_fonte_pagadora_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE suspeita_duplicidade
  ADD CONSTRAINT fk_suspeita_duplicidade_primeiro_paciente_id FOREIGN KEY (primeiro_paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_suspeita_duplicidade_segundo_paciente_id FOREIGN KEY (segundo_paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_suspeita_duplicidade_decidido_por_usuario_id FOREIGN KEY (decidido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_suspeita_duplicidade_unificacao_cadastro_id FOREIGN KEY (unificacao_cadastro_id) REFERENCES unificacao_cadastro (id) ON DELETE RESTRICT;
ALTER TABLE telefone_pessoa
  ADD CONSTRAINT fk_telefone_pessoa_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_telefone_pessoa_tipo_telefone_id FOREIGN KEY (tipo_telefone_id) REFERENCES tipo_telefone (id) ON DELETE RESTRICT;
ALTER TABLE teto_plano
  ADD CONSTRAINT fk_teto_plano_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teto_plano_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teto_plano_regime_atendimento_id FOREIGN KEY (regime_atendimento_id) REFERENCES regime_atendimento (id) ON DELETE RESTRICT;
ALTER TABLE tipo_documento_identificacao
  ADD CONSTRAINT fk_tipo_documento_identificacao_pais_referencia_id FOREIGN KEY (pais_referencia_id) REFERENCES pais_referencia (id) ON DELETE RESTRICT;
ALTER TABLE tipo_vinculo_trabalho
  ADD CONSTRAINT fk_tipo_vinculo_trabalho_superior_tipo_vinculo_trabalho_id FOREIGN KEY (superior_tipo_vinculo_trabalho_id) REFERENCES tipo_vinculo_trabalho (id) ON DELETE RESTRICT;
ALTER TABLE titular_cobertura
  ADD CONSTRAINT fk_titular_cobertura_cobertura_paciente_id FOREIGN KEY (cobertura_paciente_id) REFERENCES cobertura_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titular_cobertura_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titular_cobertura_pessoa_juridica_id FOREIGN KEY (pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titular_cobertura_tipo_parentesco_id FOREIGN KEY (tipo_parentesco_id) REFERENCES tipo_parentesco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titular_cobertura_tipo_documento_identificacao_id FOREIGN KEY (tipo_documento_identificacao_id) REFERENCES tipo_documento_identificacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titular_cobertura_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_titular_cobertura_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT;
ALTER TABLE unidade_assistencial
  ADD CONSTRAINT fk_unidade_assistencial_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_unidade_assistencial_local_fisico_id FOREIGN KEY (local_fisico_id) REFERENCES local_fisico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_unidade_assistencial_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_unidade_assistencial_diretor_profissional_id FOREIGN KEY (diretor_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_unidade_assistencial_autorizador_profissional_id FOREIGN KEY (autorizador_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_unidade_assistencial_farmaceutico_profissional_id FOREIGN KEY (farmaceutico_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_unidade_assistencial_logotipo_arquivo_id FOREIGN KEY (logotipo_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE unidade_federativa
  ADD CONSTRAINT fk_unidade_federativa_pais_referencia_id FOREIGN KEY (pais_referencia_id) REFERENCES pais_referencia (id) ON DELETE RESTRICT;
ALTER TABLE unificacao_cadastro
  ADD CONSTRAINT fk_unificacao_cadastro_mantido_paciente_id FOREIGN KEY (mantido_paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_unificacao_cadastro_absorvido_paciente_id FOREIGN KEY (absorvido_paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_unificacao_cadastro_suspeita_duplicidade_id FOREIGN KEY (suspeita_duplicidade_id) REFERENCES suspeita_duplicidade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_unificacao_cadastro_unificado_por_usuario_id FOREIGN KEY (unificado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_unificacao_cadastro_revertido_por_usuario_id FOREIGN KEY (revertido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE unificacao_cadastro_item
  ADD CONSTRAINT fk_unificacao_cadastro_item_unificacao_cadastro_id FOREIGN KEY (unificacao_cadastro_id) REFERENCES unificacao_cadastro (id) ON DELETE RESTRICT;
ALTER TABLE verificacao_biometrica
  ADD CONSTRAINT fk_verificacao_biometrica_identificacao_biometrica_id FOREIGN KEY (identificacao_biometrica_id) REFERENCES identificacao_biometrica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_verificacao_biometrica_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_verificacao_biometrica_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_verificacao_biometrica_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_verificacao_biometrica_tipo_autenticacao_biometrica_id FOREIGN KEY (tipo_autenticacao_biometrica_id) REFERENCES tipo_autenticacao_biometrica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_verificacao_biometrica_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_verificacao_biometrica_local_fisico_id FOREIGN KEY (local_fisico_id) REFERENCES local_fisico (id) ON DELETE RESTRICT;
