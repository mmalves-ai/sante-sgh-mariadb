-- Chaves do lote 03 de cadastros (aplicadas depois de todos os tabelas.sql)
ALTER TABLE paciente_vulnerabilidade
  ADD CONSTRAINT fk_paciente_vulnerabilidade_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_vulnerabilidade_condicao_vulnerabilidade_id FOREIGN KEY (condicao_vulnerabilidade_id) REFERENCES condicao_vulnerabilidade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_paciente_vulnerabilidade_registrado_por_profissional_id FOREIGN KEY (registrado_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE pendencia_plano
  ADD CONSTRAINT fk_pendencia_plano_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_plano_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE pendencia_profissional
  ADD CONSTRAINT fk_pendencia_profissional_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_profissional_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_profissional_tipo_pendencia_profissional_id FOREIGN KEY (tipo_pendencia_profissional_id) REFERENCES tipo_pendencia_profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pendencia_profissional_baixada_por_usuario_id FOREIGN KEY (baixada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE permissao_campo_cadastro
  ADD CONSTRAINT fk_permissao_campo_cadastro_perfil_acesso_id FOREIGN KEY (perfil_acesso_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT;
ALTER TABLE pessoa_fisica
  ADD CONSTRAINT fk_pessoa_fisica_sexo_id FOREIGN KEY (sexo_id) REFERENCES sexo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pessoa_fisica_identidade_de_genero_id FOREIGN KEY (identidade_de_genero_id) REFERENCES identidade_de_genero (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pessoa_fisica_orientacao_sexual_declarada_id FOREIGN KEY (orientacao_sexual_declarada_id) REFERENCES orientacao_sexual_declarada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pessoa_fisica_classificacao_raca_cor_id FOREIGN KEY (classificacao_raca_cor_id) REFERENCES classificacao_raca_cor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pessoa_fisica_povo_indigena_id FOREIGN KEY (povo_indigena_id) REFERENCES povo_indigena (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pessoa_fisica_estado_civil_id FOREIGN KEY (estado_civil_id) REFERENCES estado_civil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pessoa_fisica_situacao_convivio_familiar_id FOREIGN KEY (situacao_convivio_familiar_id) REFERENCES situacao_convivio_familiar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pessoa_fisica_nivel_escolaridade_id FOREIGN KEY (nivel_escolaridade_id) REFERENCES nivel_escolaridade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pessoa_fisica_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pessoa_fisica_crenca_religiosa_id FOREIGN KEY (crenca_religiosa_id) REFERENCES crenca_religiosa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pessoa_fisica_classe_socioeconomica_id FOREIGN KEY (classe_socioeconomica_id) REFERENCES classe_socioeconomica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pessoa_fisica_nacionalidade_id FOREIGN KEY (nacionalidade_id) REFERENCES nacionalidade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pessoa_fisica_pais_nascimento_id FOREIGN KEY (pais_nascimento_id) REFERENCES pais_referencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pessoa_fisica_naturalidade_municipio_ibge_id FOREIGN KEY (naturalidade_municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pessoa_fisica_posto_graduacao_militar_id FOREIGN KEY (posto_graduacao_militar_id) REFERENCES posto_graduacao_militar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pessoa_fisica_foto_arquivo_id FOREIGN KEY (foto_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE pessoa_juridica
  ADD CONSTRAINT fk_pessoa_juridica_natureza_juridica_id FOREIGN KEY (natureza_juridica_id) REFERENCES natureza_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pessoa_juridica_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pessoa_juridica_pais_referencia_id FOREIGN KEY (pais_referencia_id) REFERENCES pais_referencia (id) ON DELETE RESTRICT;
ALTER TABLE plano_fonte_pagadora
  ADD CONSTRAINT fk_plano_fonte_pagadora_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_fonte_pagadora_plano_superior_id FOREIGN KEY (plano_superior_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_fonte_pagadora_categoria_acomodacao_id FOREIGN KEY (categoria_acomodacao_id) REFERENCES categoria_acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_fonte_pagadora_tabela_preco_id FOREIGN KEY (tabela_preco_id) REFERENCES tabela_preco (id) ON DELETE RESTRICT;
ALTER TABLE plano_fonte_pagadora_estabelecimento
  ADD CONSTRAINT fk_plano_fonte_pagadora_estabelecimento_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_fonte_pagadora_estabelecimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_plano_fonte_pagadora_estabelecimento_tabela_preco_id FOREIGN KEY (tabela_preco_id) REFERENCES tabela_preco (id) ON DELETE RESTRICT;
ALTER TABLE posto_graduacao_militar
  ADD CONSTRAINT fk_posto_graduacao_militar_forca_militar_id FOREIGN KEY (forca_militar_id) REFERENCES forca_militar (id) ON DELETE RESTRICT;
ALTER TABLE pre_cadastro
  ADD CONSTRAINT fk_pre_cadastro_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pre_cadastro_sexo_id FOREIGN KEY (sexo_id) REFERENCES sexo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pre_cadastro_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pre_cadastro_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pre_cadastro_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pre_cadastro_responsavel_tipo_parentesco_id FOREIGN KEY (responsavel_tipo_parentesco_id) REFERENCES tipo_parentesco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pre_cadastro_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT;
ALTER TABLE profissional
  ADD CONSTRAINT fk_profissional_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_pessoa_juridica_id FOREIGN KEY (pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_cooperativa_medica_id FOREIGN KEY (cooperativa_medica_id) REFERENCES cooperativa_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_regra_repasse_id FOREIGN KEY (regra_repasse_id) REFERENCES regra_repasse (id) ON DELETE RESTRICT;
ALTER TABLE profissional_area_atuacao
  ADD CONSTRAINT fk_profissional_area_atuacao_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_area_atuacao_area_atuacao_medica_id FOREIGN KEY (area_atuacao_medica_id) REFERENCES area_atuacao_medica (id) ON DELETE RESTRICT;
ALTER TABLE profissional_assinatura
  ADD CONSTRAINT fk_profissional_assinatura_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_assinatura_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE profissional_dado_fiscal
  ADD CONSTRAINT fk_profissional_dado_fiscal_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_dado_fiscal_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_dado_fiscal_pessoa_juridica_id FOREIGN KEY (pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT;
ALTER TABLE profissional_documento
  ADD CONSTRAINT fk_profissional_documento_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_documento_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE profissional_especialidade
  ADD CONSTRAINT fk_profissional_especialidade_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_especialidade_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_especialidade_inscricao_conselho_id FOREIGN KEY (inscricao_conselho_id) REFERENCES inscricao_conselho (id) ON DELETE RESTRICT;
ALTER TABLE profissional_fonte_pagadora
  ADD CONSTRAINT fk_profissional_fonte_pagadora_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_fonte_pagadora_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_fonte_pagadora_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_fonte_pagadora_inscricao_conselho_id FOREIGN KEY (inscricao_conselho_id) REFERENCES inscricao_conselho (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_fonte_pagadora_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_fonte_pagadora_conta_bancaria_profissional_id FOREIGN KEY (conta_bancaria_profissional_id) REFERENCES conta_bancaria_profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_fonte_pagadora_regra_repasse_id FOREIGN KEY (regra_repasse_id) REFERENCES regra_repasse (id) ON DELETE RESTRICT;
ALTER TABLE profissional_formacao
  ADD CONSTRAINT fk_profissional_formacao_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_formacao_nivel_escolaridade_id FOREIGN KEY (nivel_escolaridade_id) REFERENCES nivel_escolaridade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_formacao_instituicao_ensino_id FOREIGN KEY (instituicao_ensino_id) REFERENCES instituicao_ensino (id) ON DELETE RESTRICT;
ALTER TABLE profissional_habilidade
  ADD CONSTRAINT fk_profissional_habilidade_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_habilidade_habilidade_profissional_id FOREIGN KEY (habilidade_profissional_id) REFERENCES habilidade_profissional (id) ON DELETE RESTRICT;
ALTER TABLE profissional_instituicao_externa
  ADD CONSTRAINT fk_profissional_instituicao_externa_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_instituicao_externa_estabelecimento_externo_id FOREIGN KEY (estabelecimento_externo_id) REFERENCES estabelecimento_externo (id) ON DELETE RESTRICT;
ALTER TABLE profissional_provisorio
  ADD CONSTRAINT fk_profissional_provisorio_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_provisorio_conselho_classe_id FOREIGN KEY (conselho_classe_id) REFERENCES conselho_classe (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_provisorio_conselho_unidade_federativa_id FOREIGN KEY (conselho_unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_provisorio_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_provisorio_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_provisorio_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE profissional_provisorio_uso
  ADD CONSTRAINT fk_profissional_provisorio_uso_profissional_provisorio_id FOREIGN KEY (profissional_provisorio_id) REFERENCES profissional_provisorio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_provisorio_uso_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_provisorio_uso_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_provisorio_uso_agendamento_cirurgico_id FOREIGN KEY (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_provisorio_uso_agendamento_internacao_id FOREIGN KEY (agendamento_internacao_id) REFERENCES agendamento_internacao (id) ON DELETE RESTRICT;
ALTER TABLE profissional_rqe
  ADD CONSTRAINT fk_profissional_rqe_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_rqe_unidade_federativa_id FOREIGN KEY (unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_rqe_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_rqe_conselho_classe_id FOREIGN KEY (conselho_classe_id) REFERENCES conselho_classe (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_rqe_inscricao_conselho_id FOREIGN KEY (inscricao_conselho_id) REFERENCES inscricao_conselho (id) ON DELETE RESTRICT;
ALTER TABLE profissional_unidade_atuacao
  ADD CONSTRAINT fk_profissional_unidade_atuacao_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_unidade_atuacao_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT;
ALTER TABLE profissional_versao
  ADD CONSTRAINT fk_profissional_versao_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_versao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE prontuario_estabelecimento
  ADD CONSTRAINT fk_prontuario_estabelecimento_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prontuario_estabelecimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prontuario_estabelecimento_sequencia_prontuario_id FOREIGN KEY (sequencia_prontuario_id) REFERENCES sequencia_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_prontuario_estabelecimento_local_fisico_id FOREIGN KEY (local_fisico_id) REFERENCES local_fisico (id) ON DELETE RESTRICT;
ALTER TABLE ramal_setor
  ADD CONSTRAINT fk_ramal_setor_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE rede
  ADD CONSTRAINT fk_rede_pessoa_juridica_id FOREIGN KEY (pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT;
ALTER TABLE regiao_geografica
  ADD CONSTRAINT fk_regiao_geografica_regiao_superior_id FOREIGN KEY (regiao_superior_id) REFERENCES regiao_geografica (id) ON DELETE RESTRICT;
ALTER TABLE regional_saude
  ADD CONSTRAINT fk_regional_saude_unidade_federativa_id FOREIGN KEY (unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regional_saude_regiao_geografica_id FOREIGN KEY (regiao_geografica_id) REFERENCES regiao_geografica (id) ON DELETE RESTRICT;
ALTER TABLE regra_campo_cadastro
  ADD CONSTRAINT fk_regra_campo_cadastro_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_campo_cadastro_modulo_recepcao_id FOREIGN KEY (modulo_recepcao_id) REFERENCES modulo_recepcao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_campo_cadastro_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE remessa_cnes
  ADD CONSTRAINT fk_remessa_cnes_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_cnes_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_cnes_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE responsavel_paciente
  ADD CONSTRAINT fk_responsavel_paciente_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_responsavel_paciente_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_responsavel_paciente_pessoa_juridica_id FOREIGN KEY (pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_responsavel_paciente_tipo_parentesco_id FOREIGN KEY (tipo_parentesco_id) REFERENCES tipo_parentesco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_responsavel_paciente_comprovante_arquivo_id FOREIGN KEY (comprovante_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE sequencia_prontuario
  ADD CONSTRAINT fk_sequencia_prontuario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sequencia_prontuario_sequencia_negocio_id FOREIGN KEY (sequencia_negocio_id) REFERENCES sequencia_negocio (id) ON DELETE RESTRICT;
ALTER TABLE servico_classificacao_estabelecimento
  ADD CONSTRAINT fk_servico_classificacao_estabelecimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_classif_estabelecimento_servico_classificacao_id FOREIGN KEY (servico_classificacao_id) REFERENCES servico_classificacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_classif_estabelecimento_estabelecimento_externo_id FOREIGN KEY (estabelecimento_externo_id) REFERENCES estabelecimento_externo (id) ON DELETE RESTRICT;
ALTER TABLE servico_classificacao_setor
  ADD CONSTRAINT fk_servico_classificacao_setor_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_classificacao_setor_servico_classificacao_id FOREIGN KEY (servico_classificacao_id) REFERENCES servico_classificacao (id) ON DELETE RESTRICT;
ALTER TABLE setor_funcional
  ADD CONSTRAINT fk_setor_funcional_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_setor_funcional_setor_superior_id FOREIGN KEY (setor_superior_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_setor_funcional_estrutura_organizacional_id FOREIGN KEY (estrutura_organizacional_id) REFERENCES estrutura_organizacional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_setor_funcional_agrupamento_setor_id FOREIGN KEY (agrupamento_setor_id) REFERENCES agrupamento_setor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_setor_funcional_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_setor_funcional_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_setor_funcional_local_fisico_id FOREIGN KEY (local_fisico_id) REFERENCES local_fisico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_setor_funcional_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_setor_funcional_impressora_id FOREIGN KEY (impressora_id) REFERENCES impressora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_setor_funcional_impressora_etiqueta_id FOREIGN KEY (impressora_etiqueta_id) REFERENCES impressora (id) ON DELETE RESTRICT;
ALTER TABLE setor_turno
  ADD CONSTRAINT fk_setor_turno_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_setor_turno_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_setor_turno_turno_padrao_id FOREIGN KEY (turno_padrao_id) REFERENCES turno_padrao (id) ON DELETE RESTRICT;
ALTER TABLE sigla_conselho
  ADD CONSTRAINT fk_sigla_conselho_conselho_classe_id FOREIGN KEY (conselho_classe_id) REFERENCES conselho_classe (id) ON DELETE RESTRICT;
