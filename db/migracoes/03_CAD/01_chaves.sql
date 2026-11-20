-- Chaves do lote 03_CAD-01 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE agrupamento_setor
  ADD CONSTRAINT fk_agrupamento_setor_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE area_ddd
  ADD CONSTRAINT fk_area_ddd_unidade_federativa_id FOREIGN KEY (unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT;
ALTER TABLE bairro
  ADD CONSTRAINT fk_bairro_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT;
ALTER TABLE bloqueio_carteira
  ADD CONSTRAINT fk_bloqueio_carteira_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bloqueio_carteira_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bloqueio_carteira_cobertura_paciente_id FOREIGN KEY (cobertura_paciente_id) REFERENCES cobertura_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bloqueio_carteira_bloqueado_usuario_id FOREIGN KEY (bloqueado_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bloqueio_carteira_liberado_usuario_id FOREIGN KEY (liberado_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE calendario_trabalho
  ADD CONSTRAINT fk_calendario_trabalho_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE calendario_trabalho_dia
  ADD CONSTRAINT fk_calendario_trabalho_dia_calendario_trabalho_id FOREIGN KEY (calendario_trabalho_id) REFERENCES calendario_trabalho (id) ON DELETE RESTRICT;
ALTER TABLE calendario_trabalho_excecao
  ADD CONSTRAINT fk_calendario_trabalho_excecao_calendario_trabalho_id FOREIGN KEY (calendario_trabalho_id) REFERENCES calendario_trabalho (id) ON DELETE RESTRICT;
ALTER TABLE captacao_paciente
  ADD CONSTRAINT fk_captacao_paciente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_captacao_paciente_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_captacao_paciente_pre_cadastro_id FOREIGN KEY (pre_cadastro_id) REFERENCES pre_cadastro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_captacao_paciente_tipo_indicacao_id FOREIGN KEY (tipo_indicacao_id) REFERENCES tipo_indicacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_captacao_paciente_indicador_profissional_id FOREIGN KEY (indicador_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_captacao_paciente_indicador_paciente_id FOREIGN KEY (indicador_paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_captacao_paciente_parceiro_pessoa_juridica_id FOREIGN KEY (parceiro_pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_captacao_paciente_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_captacao_paciente_registrado_usuario_id FOREIGN KEY (registrado_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE categoria_profissional
  ADD CONSTRAINT fk_categoria_profissional_conselho_classe_id FOREIGN KEY (conselho_classe_id) REFERENCES conselho_classe (id) ON DELETE RESTRICT;
ALTER TABLE cobertura_paciente
  ADD CONSTRAINT fk_cobertura_paciente_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cobertura_paciente_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cobertura_paciente_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cobertura_paciente_titular_paciente_id FOREIGN KEY (titular_paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cobertura_paciente_tipo_parentesco_id FOREIGN KEY (tipo_parentesco_id) REFERENCES tipo_parentesco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cobertura_paciente_acomodacao_id FOREIGN KEY (acomodacao_id) REFERENCES acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cobertura_paciente_empresa_pessoa_juridica_id FOREIGN KEY (empresa_pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT;
ALTER TABLE comarca_judicial
  ADD CONSTRAINT fk_comarca_judicial_superior_comarca_judicial_id FOREIGN KEY (superior_comarca_judicial_id) REFERENCES comarca_judicial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comarca_judicial_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT;
ALTER TABLE configuracao_tiss_fonte_pagadora
  ADD CONSTRAINT fk_configuracao_tiss_fonte_pagadora_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_configuracao_tiss_fonte_pagadora_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_configuracao_tiss_fonte_pagadora_versao_padrao_tiss_id FOREIGN KEY (versao_padrao_tiss_id) REFERENCES versao_padrao_tiss (id) ON DELETE RESTRICT;
ALTER TABLE conta_bancaria_profissional
  ADD CONSTRAINT fk_conta_bancaria_profissional_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_bancaria_profissional_banco_id FOREIGN KEY (banco_id) REFERENCES banco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_bancaria_profissional_tipo_conta_bancaria_id FOREIGN KEY (tipo_conta_bancaria_id) REFERENCES tipo_conta_bancaria (id) ON DELETE RESTRICT;
ALTER TABLE correspondencia_setor_estabelecimento
  ADD CONSTRAINT fk_correspondencia_setor_estabelecimento_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_correspondencia_setor_estab_correspondente_setor_funcional_id FOREIGN KEY (correspondente_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE critica_cnes
  ADD CONSTRAINT fk_critica_cnes_remessa_cnes_id FOREIGN KEY (remessa_cnes_id) REFERENCES remessa_cnes (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_critica_cnes_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_critica_cnes_resolvida_usuario_id FOREIGN KEY (resolvida_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE dia_nao_util
  ADD CONSTRAINT fk_dia_nao_util_unidade_federativa_id FOREIGN KEY (unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dia_nao_util_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_dia_nao_util_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE distrito_sanitario
  ADD CONSTRAINT fk_distrito_sanitario_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT;
ALTER TABLE documento_exigido_plano
  ADD CONSTRAINT fk_documento_exigido_plano_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_exigido_plano_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_exigido_plano_regime_atendimento_id FOREIGN KEY (regime_atendimento_id) REFERENCES regime_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_exigido_plano_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_exigido_plano_tipo_documento_arquivo_id FOREIGN KEY (tipo_documento_arquivo_id) REFERENCES tipo_documento_arquivo (id) ON DELETE RESTRICT;
ALTER TABLE documento_pessoa
  ADD CONSTRAINT fk_documento_pessoa_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_pessoa_tipo_documento_identificacao_id FOREIGN KEY (tipo_documento_identificacao_id) REFERENCES tipo_documento_identificacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_pessoa_orgao_emissor_documento_id FOREIGN KEY (orgao_emissor_documento_id) REFERENCES orgao_emissor_documento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_pessoa_unidade_federativa_id FOREIGN KEY (unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_pessoa_pais_referencia_id FOREIGN KEY (pais_referencia_id) REFERENCES pais_referencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_pessoa_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE email_pessoa
  ADD CONSTRAINT fk_email_pessoa_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_email_pessoa_pessoa_juridica_id FOREIGN KEY (pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_email_pessoa_consentimento_titular_id FOREIGN KEY (consentimento_titular_id) REFERENCES consentimento_titular (id) ON DELETE RESTRICT;
ALTER TABLE endereco_pessoa
  ADD CONSTRAINT fk_endereco_pessoa_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_endereco_pessoa_pessoa_juridica_id FOREIGN KEY (pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_endereco_pessoa_tipo_endereco_id FOREIGN KEY (tipo_endereco_id) REFERENCES tipo_endereco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_endereco_pessoa_logradouro_cep_id FOREIGN KEY (logradouro_cep_id) REFERENCES logradouro_cep (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_endereco_pessoa_especie_logradouro_id FOREIGN KEY (especie_logradouro_id) REFERENCES especie_logradouro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_endereco_pessoa_bairro_id FOREIGN KEY (bairro_id) REFERENCES bairro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_endereco_pessoa_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_endereco_pessoa_distrito_sanitario_id FOREIGN KEY (distrito_sanitario_id) REFERENCES distrito_sanitario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_endereco_pessoa_pais_referencia_id FOREIGN KEY (pais_referencia_id) REFERENCES pais_referencia (id) ON DELETE RESTRICT;
ALTER TABLE equipe_profissional
  ADD CONSTRAINT fk_equipe_profissional_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipe_profissional_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipe_profissional_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE equipe_profissional_membro
  ADD CONSTRAINT fk_equipe_profissional_membro_equipe_profissional_id FOREIGN KEY (equipe_profissional_id) REFERENCES equipe_profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipe_profissional_membro_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE especialidade_medica
  ADD CONSTRAINT fk_especialidade_medica_conselho_classe_id FOREIGN KEY (conselho_classe_id) REFERENCES conselho_classe (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_especialidade_medica_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT;
ALTER TABLE especialidade_ocupacao
  ADD CONSTRAINT fk_especialidade_ocupacao_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_especialidade_ocupacao_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT;
ALTER TABLE especialidade_procedimento
  ADD CONSTRAINT fk_especialidade_procedimento_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_especialidade_procedimento_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE estabelecimento
  ADD CONSTRAINT fk_estabelecimento_rede_id FOREIGN KEY (rede_id) REFERENCES rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estabelecimento_mantenedora_id FOREIGN KEY (mantenedora_id) REFERENCES mantenedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estabelecimento_matriz_estabelecimento_id FOREIGN KEY (matriz_estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estabelecimento_tipo_estabelecimento_id FOREIGN KEY (tipo_estabelecimento_id) REFERENCES tipo_estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estabelecimento_porte_estabelecimento_id FOREIGN KEY (porte_estabelecimento_id) REFERENCES porte_estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estabelecimento_esfera_administrativa_id FOREIGN KEY (esfera_administrativa_id) REFERENCES esfera_administrativa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estabelecimento_natureza_juridica_id FOREIGN KEY (natureza_juridica_id) REFERENCES natureza_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estabelecimento_complexidade_estabelecimento_id FOREIGN KEY (complexidade_estabelecimento_id) REFERENCES complexidade_estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estabelecimento_regional_saude_id FOREIGN KEY (regional_saude_id) REFERENCES regional_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estabelecimento_especie_logradouro_id FOREIGN KEY (especie_logradouro_id) REFERENCES especie_logradouro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estabelecimento_bairro_id FOREIGN KEY (bairro_id) REFERENCES bairro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estabelecimento_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT;
ALTER TABLE estabelecimento_externo
  ADD CONSTRAINT fk_estabelecimento_externo_tipo_estabelecimento_id FOREIGN KEY (tipo_estabelecimento_id) REFERENCES tipo_estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estabelecimento_externo_regional_saude_id FOREIGN KEY (regional_saude_id) REFERENCES regional_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estabelecimento_externo_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT;
ALTER TABLE estabelecimento_responsavel
  ADD CONSTRAINT fk_estabelecimento_responsavel_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estabelecimento_responsavel_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estabelecimento_responsavel_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estabelecimento_responsavel_inscricao_conselho_id FOREIGN KEY (inscricao_conselho_id) REFERENCES inscricao_conselho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estabelecimento_responsavel_regime_atendimento_id FOREIGN KEY (regime_atendimento_id) REFERENCES regime_atendimento (id) ON DELETE RESTRICT;
