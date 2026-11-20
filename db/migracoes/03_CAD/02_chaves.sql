-- Chaves do lote 02 de cadastros (aplicadas depois de todos os tabelas.sql)
ALTER TABLE estrutura_organizacional
  ADD CONSTRAINT fk_estrutura_organizacional_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estrutura_organizacional_pai_estrutura_organizacional_id FOREIGN KEY (pai_estrutura_organizacional_id) REFERENCES estrutura_organizacional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estrutura_organizacional_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estrutura_organizacional_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_estrutura_organizacional_responsavel_pessoa_fisica_id FOREIGN KEY (responsavel_pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT;
ALTER TABLE faixa_etaria
  ADD CONSTRAINT fk_faixa_etaria_unidade_idade_id FOREIGN KEY (unidade_idade_id) REFERENCES unidade_idade (id) ON DELETE RESTRICT;
ALTER TABLE fonte_pagadora
  ADD CONSTRAINT fk_fonte_pagadora_pessoa_juridica_id FOREIGN KEY (pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fonte_pagadora_grupo_fonte_pagadora_id FOREIGN KEY (grupo_fonte_pagadora_id) REFERENCES grupo_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fonte_pagadora_classe_fonte_pagadora_id FOREIGN KEY (classe_fonte_pagadora_id) REFERENCES classe_fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE fonte_pagadora_estabelecimento
  ADD CONSTRAINT fk_fonte_pagadora_estabelecimento_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fonte_pagadora_estabelecimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE fonte_pagadora_versao
  ADD CONSTRAINT fk_fonte_pagadora_versao_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fonte_pagadora_versao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fonte_pagadora_versao_classe_fonte_pagadora_id FOREIGN KEY (classe_fonte_pagadora_id) REFERENCES classe_fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE habilitacao_estabelecimento
  ADD CONSTRAINT fk_habilitacao_estabelecimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_habilitacao_estabelecimento_habilitacao_sus_id FOREIGN KEY (habilitacao_sus_id) REFERENCES habilitacao_sus (id) ON DELETE RESTRICT;
ALTER TABLE identidade_de_genero
  ADD CONSTRAINT fk_identidade_de_genero_sexo_id FOREIGN KEY (sexo_id) REFERENCES sexo (id) ON DELETE RESTRICT;
ALTER TABLE identificacao_biometrica
  ADD CONSTRAINT fk_identificacao_biometrica_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_identificacao_biometrica_tipo_autenticacao_biometrica_id FOREIGN KEY (tipo_autenticacao_biometrica_id) REFERENCES tipo_autenticacao_biometrica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_identificacao_biometrica_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_identificacao_biometrica_consentimento_titular_id FOREIGN KEY (consentimento_titular_id) REFERENCES consentimento_titular (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_identificacao_biometrica_captura_estabelecimento_id FOREIGN KEY (captura_estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_identificacao_biometrica_capturado_por_usuario_id FOREIGN KEY (capturado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE inscricao_conselho
  ADD CONSTRAINT fk_inscricao_conselho_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inscricao_conselho_conselho_classe_id FOREIGN KEY (conselho_classe_id) REFERENCES conselho_classe (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inscricao_conselho_unidade_federativa_id FOREIGN KEY (unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inscricao_conselho_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inscricao_conselho_tipo_vinculo_trabalho_id FOREIGN KEY (tipo_vinculo_trabalho_id) REFERENCES tipo_vinculo_trabalho (id) ON DELETE RESTRICT;
ALTER TABLE instituicao_ensino
  ADD CONSTRAINT fk_instituicao_ensino_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_instituicao_ensino_pais_referencia_id FOREIGN KEY (pais_referencia_id) REFERENCES pais_referencia (id) ON DELETE RESTRICT;
ALTER TABLE liberacao_acesso_restrito
  ADD CONSTRAINT fk_liberacao_acesso_restrito_paciente_acesso_restrito_id FOREIGN KEY (paciente_acesso_restrito_id) REFERENCES paciente_acesso_restrito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_acesso_restrito_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_acesso_restrito_equipe_profissional_id FOREIGN KEY (equipe_profissional_id) REFERENCES equipe_profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_acesso_restrito_autorizador_usuario_id FOREIGN KEY (autorizador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE linha_cuidado
  ADD CONSTRAINT fk_linha_cuidado_faixa_etaria_id FOREIGN KEY (faixa_etaria_id) REFERENCES faixa_etaria (id) ON DELETE RESTRICT;
ALTER TABLE local_fisico
  ADD CONSTRAINT fk_local_fisico_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_local_fisico_tipo_local_fisico_id FOREIGN KEY (tipo_local_fisico_id) REFERENCES tipo_local_fisico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_local_fisico_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_local_fisico_responsavel_pessoa_fisica_id FOREIGN KEY (responsavel_pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT;
ALTER TABLE logotipo_estabelecimento
  ADD CONSTRAINT fk_logotipo_estabelecimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_logotipo_estabelecimento_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE logradouro_cep
  ADD CONSTRAINT fk_logradouro_cep_especie_logradouro_id FOREIGN KEY (especie_logradouro_id) REFERENCES especie_logradouro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_logradouro_cep_bairro_id FOREIGN KEY (bairro_id) REFERENCES bairro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_logradouro_cep_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_logradouro_cep_unidade_federativa_id FOREIGN KEY (unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT;
ALTER TABLE lotacao_profissional
  ADD CONSTRAINT fk_lotacao_profissional_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lotacao_profissional_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lotacao_profissional_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lotacao_profissional_inscricao_conselho_id FOREIGN KEY (inscricao_conselho_id) REFERENCES inscricao_conselho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lotacao_profissional_tipo_vinculo_trabalho_id FOREIGN KEY (tipo_vinculo_trabalho_id) REFERENCES tipo_vinculo_trabalho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lotacao_profissional_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE mantenedora
  ADD CONSTRAINT fk_mantenedora_pessoa_juridica_id FOREIGN KEY (pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mantenedora_natureza_juridica_id FOREIGN KEY (natureza_juridica_id) REFERENCES natureza_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mantenedora_responsavel_pessoa_fisica_id FOREIGN KEY (responsavel_pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mantenedora_contador_pessoa_fisica_id FOREIGN KEY (contador_pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT;
ALTER TABLE motorista
  ADD CONSTRAINT fk_motorista_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_motorista_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_motorista_empresa_pessoa_juridica_id FOREIGN KEY (empresa_pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_motorista_unidade_federativa_id FOREIGN KEY (unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT;
ALTER TABLE municipio_ibge
  ADD CONSTRAINT fk_municipio_ibge_unidade_federativa_id FOREIGN KEY (unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_municipio_ibge_area_ddd_id FOREIGN KEY (area_ddd_id) REFERENCES area_ddd (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_municipio_ibge_regional_saude_id FOREIGN KEY (regional_saude_id) REFERENCES regional_saude (id) ON DELETE RESTRICT;
ALTER TABLE nacionalidade
  ADD CONSTRAINT fk_nacionalidade_pais_referencia_id FOREIGN KEY (pais_referencia_id) REFERENCES pais_referencia (id) ON DELETE RESTRICT;
ALTER TABLE nucleo_familiar
  ADD CONSTRAINT fk_nucleo_familiar_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nucleo_familiar_equipe_profissional_id FOREIGN KEY (equipe_profissional_id) REFERENCES equipe_profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nucleo_familiar_responsavel_paciente_id FOREIGN KEY (responsavel_paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nucleo_familiar_logradouro_cep_id FOREIGN KEY (logradouro_cep_id) REFERENCES logradouro_cep (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nucleo_familiar_especie_logradouro_id FOREIGN KEY (especie_logradouro_id) REFERENCES especie_logradouro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nucleo_familiar_bairro_id FOREIGN KEY (bairro_id) REFERENCES bairro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nucleo_familiar_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT;
ALTER TABLE nucleo_familiar_membro
  ADD CONSTRAINT fk_nucleo_familiar_membro_nucleo_familiar_id FOREIGN KEY (nucleo_familiar_id) REFERENCES nucleo_familiar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nucleo_familiar_membro_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_nucleo_familiar_membro_tipo_parentesco_id FOREIGN KEY (tipo_parentesco_id) REFERENCES tipo_parentesco (id) ON DELETE RESTRICT;
ALTER TABLE ocorrencia_profissional
  ADD CONSTRAINT fk_ocorrencia_profissional_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_profissional_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_profissional_tipo_ocorrencia_profissional_id FOREIGN KEY (tipo_ocorrencia_profissional_id) REFERENCES tipo_ocorrencia_profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_profissional_conduta_ocorrencia_profissional_id FOREIGN KEY (conduta_ocorrencia_profissional_id) REFERENCES conduta_ocorrencia_profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_profissional_agenda_servico_id FOREIGN KEY (agenda_servico_id) REFERENCES agenda_servico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_profissional_marcacao_horario_id FOREIGN KEY (marcacao_horario_id) REFERENCES marcacao_horario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_profissional_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_profissional_registrante_usuario_id FOREIGN KEY (registrante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE orgao_emissor_documento
  ADD CONSTRAINT fk_orgao_emissor_documento_conselho_classe_id FOREIGN KEY (conselho_classe_id) REFERENCES conselho_classe (id) ON DELETE RESTRICT;
ALTER TABLE paciente
  ADD CONSTRAINT fk_paciente_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_cadastro_estabelecimento_id FOREIGN KEY (cadastro_estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_sobrevivente_paciente_id FOREIGN KEY (sobrevivente_paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_identidade_de_genero_id FOREIGN KEY (identidade_de_genero_id) REFERENCES identidade_de_genero (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_orientacao_sexual_declarada_id FOREIGN KEY (orientacao_sexual_declarada_id) REFERENCES orientacao_sexual_declarada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_classificacao_raca_cor_id FOREIGN KEY (classificacao_raca_cor_id) REFERENCES classificacao_raca_cor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_povo_indigena_id FOREIGN KEY (povo_indigena_id) REFERENCES povo_indigena (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_idioma_indigena_id FOREIGN KEY (idioma_indigena_id) REFERENCES idioma_indigena (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_crenca_religiosa_id FOREIGN KEY (crenca_religiosa_id) REFERENCES crenca_religiosa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_estado_civil_id FOREIGN KEY (estado_civil_id) REFERENCES estado_civil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_nivel_escolaridade_id FOREIGN KEY (nivel_escolaridade_id) REFERENCES nivel_escolaridade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_nacionalidade_id FOREIGN KEY (nacionalidade_id) REFERENCES nacionalidade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_naturalidade_municipio_ibge_id FOREIGN KEY (naturalidade_municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_nascimento_pais_referencia_id FOREIGN KEY (nascimento_pais_referencia_id) REFERENCES pais_referencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_capacidade_civil_id FOREIGN KEY (capacidade_civil_id) REFERENCES capacidade_civil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_situacao_convivio_familiar_id FOREIGN KEY (situacao_convivio_familiar_id) REFERENCES situacao_convivio_familiar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_classe_socioeconomica_id FOREIGN KEY (classe_socioeconomica_id) REFERENCES classe_socioeconomica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_forca_militar_id FOREIGN KEY (forca_militar_id) REFERENCES forca_militar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_posto_graduacao_militar_id FOREIGN KEY (posto_graduacao_militar_id) REFERENCES posto_graduacao_militar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_motivo_ausencia_documento_paciente_id FOREIGN KEY (motivo_ausencia_documento_paciente_id) REFERENCES motivo_ausencia_documento_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_declaracao_obito_id FOREIGN KEY (declaracao_obito_id) REFERENCES declaracao_obito (id) ON DELETE RESTRICT;
ALTER TABLE paciente_acesso_restrito
  ADD CONSTRAINT fk_paciente_acesso_restrito_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_acesso_restrito_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_acesso_restrito_motivo_acesso_prontuario_restrito_id FOREIGN KEY (motivo_acesso_prontuario_restrito_id) REFERENCES motivo_acesso_prontuario_restrito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_acesso_restrito_solicitante_usuario_id FOREIGN KEY (solicitante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE paciente_classe
  ADD CONSTRAINT fk_paciente_classe_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_classe_classe_paciente_id FOREIGN KEY (classe_paciente_id) REFERENCES classe_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_classe_atribuidor_usuario_id FOREIGN KEY (atribuidor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE paciente_condicao_especial
  ADD CONSTRAINT fk_paciente_condicao_especial_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_condicao_especial_condicao_especial_id FOREIGN KEY (condicao_especial_id) REFERENCES condicao_especial (id) ON DELETE RESTRICT;
ALTER TABLE paciente_deficiencia
  ADD CONSTRAINT fk_paciente_deficiencia_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_deficiencia_tipo_deficiencia_id FOREIGN KEY (tipo_deficiencia_id) REFERENCES tipo_deficiencia (id) ON DELETE RESTRICT;
ALTER TABLE paciente_linha_cuidado
  ADD CONSTRAINT fk_paciente_linha_cuidado_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_linha_cuidado_linha_cuidado_id FOREIGN KEY (linha_cuidado_id) REFERENCES linha_cuidado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_linha_cuidado_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_linha_cuidado_estado_linha_cuidado_id FOREIGN KEY (estado_linha_cuidado_id) REFERENCES estado_linha_cuidado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_linha_cuidado_referencia_profissional_id FOREIGN KEY (referencia_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_linha_cuidado_equipe_profissional_id FOREIGN KEY (equipe_profissional_id) REFERENCES equipe_profissional (id) ON DELETE RESTRICT;
ALTER TABLE paciente_linha_cuidado_historico
  ADD CONSTRAINT fk_paciente_linha_cuidado_historico_paciente_linha_cuidado_id FOREIGN KEY (paciente_linha_cuidado_id) REFERENCES paciente_linha_cuidado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_linha_cuidado_historico_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_linha_cuidado_historico_estado_linha_cuidado_id FOREIGN KEY (estado_linha_cuidado_id) REFERENCES estado_linha_cuidado (id) ON DELETE RESTRICT;
ALTER TABLE paciente_versao
  ADD CONSTRAINT fk_paciente_versao_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_versao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_versao_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_versao_documento_prontuario_id FOREIGN KEY (documento_prontuario_id) REFERENCES documento_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_versao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
