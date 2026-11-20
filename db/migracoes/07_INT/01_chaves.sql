-- Chaves do lote 07_INT-01 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE acidente_internacao
  ADD CONSTRAINT fk_acidente_internacao_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acidente_internacao_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acidente_internacao_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acidente_internacao_origem_atendimento_id FOREIGN KEY (origem_atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acidente_internacao_sequela_atendimento_id FOREIGN KEY (sequela_atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT;
ALTER TABLE acomodacao
  ADD CONSTRAINT fk_acomodacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acomodacao_bloco_internacao_id FOREIGN KEY (bloco_internacao_id) REFERENCES bloco_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acomodacao_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acomodacao_categoria_acomodacao_id FOREIGN KEY (categoria_acomodacao_id) REFERENCES categoria_acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acomodacao_clinica_assistencial_id FOREIGN KEY (clinica_assistencial_id) REFERENCES clinica_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acomodacao_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT;
ALTER TABLE acomodacao_plano_fonte_pagadora
  ADD CONSTRAINT fk_acomodacao_plano_fonte_pagadora_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acomodacao_plano_fonte_pagadora_categoria_acomodacao_id FOREIGN KEY (categoria_acomodacao_id) REFERENCES categoria_acomodacao (id) ON DELETE RESTRICT;
ALTER TABLE acompanhante_internacao
  ADD CONSTRAINT fk_acompanhante_internacao_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acompanhante_internacao_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acompanhante_internacao_tipo_parentesco_id FOREIGN KEY (tipo_parentesco_id) REFERENCES tipo_parentesco (id) ON DELETE RESTRICT;
ALTER TABLE agendamento_internacao
  ADD CONSTRAINT fk_agendamento_internacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_internacao_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_internacao_carater_admissao_id FOREIGN KEY (carater_admissao_id) REFERENCES carater_admissao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_internacao_regime_atendimento_internacao_id FOREIGN KEY (regime_atendimento_internacao_id) REFERENCES regime_atendimento_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_internacao_categoria_acomodacao_id FOREIGN KEY (categoria_acomodacao_id) REFERENCES categoria_acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_internacao_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_internacao_leito_hospitalar_id FOREIGN KEY (leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_internacao_clinica_assistencial_id FOREIGN KEY (clinica_assistencial_id) REFERENCES clinica_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_internacao_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_internacao_medico_profissional_id FOREIGN KEY (medico_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_internacao_solicitante_profissional_id FOREIGN KEY (solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_internacao_indicacao_profissional_id FOREIGN KEY (indicacao_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_internacao_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_internacao_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_internacao_cid_termo_terminologia_id FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_internacao_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_internacao_anestesia_liberada_por_usuario_id FOREIGN KEY (anestesia_liberada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_internacao_cancelado_por_usuario_id FOREIGN KEY (cancelado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_internacao_motivo_cancelamento_agendamen_4785a0c3 FOREIGN KEY (motivo_cancelamento_agendamento_internacao_id) REFERENCES motivo_cancelamento_agendamento_internacao (id) ON DELETE RESTRICT;
ALTER TABLE agendamento_internacao_material
  ADD CONSTRAINT fk_agendamento_internacao_material_agendamento_internacao_id FOREIGN KEY (agendamento_internacao_id) REFERENCES agendamento_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_internacao_material_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_internacao_material_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_internacao_material_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT;
ALTER TABLE agendamento_internacao_procedimento
  ADD CONSTRAINT fk_agendamento_internacao_procedimento_agendamento_internacao_id FOREIGN KEY (agendamento_internacao_id) REFERENCES agendamento_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_internacao_procedimento_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_internacao_procedimento_cid_termo_terminologia_id FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE agendamento_internacao_profissional
  ADD CONSTRAINT fk_agendamento_internacao_profissional_agendamento_internacao_id FOREIGN KEY (agendamento_internacao_id) REFERENCES agendamento_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_internacao_profissional_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_internacao_profissional_funcao_equipe_ci_9705d9f2 FOREIGN KEY (funcao_equipe_cirurgica_id) REFERENCES funcao_equipe_cirurgica (id) ON DELETE RESTRICT;
ALTER TABLE alta_a_pedido
  ADD CONSTRAINT fk_alta_a_pedido_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alta_a_pedido_medico_profissional_id FOREIGN KEY (medico_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alta_a_pedido_tipo_parentesco_id FOREIGN KEY (tipo_parentesco_id) REFERENCES tipo_parentesco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alta_a_pedido_termo_arquivo_id FOREIGN KEY (termo_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE alta_hospitalar
  ADD CONSTRAINT fk_alta_hospitalar_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alta_hospitalar_alta_medica_id FOREIGN KEY (alta_medica_id) REFERENCES alta_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alta_hospitalar_motivo_saida_hospitalar_id FOREIGN KEY (motivo_saida_hospitalar_id) REFERENCES motivo_saida_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alta_hospitalar_desfecho_internacao_id FOREIGN KEY (desfecho_internacao_id) REFERENCES desfecho_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alta_hospitalar_desfecho_recem_nascido_id FOREIGN KEY (desfecho_recem_nascido_id) REFERENCES desfecho_recem_nascido (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alta_hospitalar_destino_estabelecimento_externo_id FOREIGN KEY (destino_estabelecimento_externo_id) REFERENCES estabelecimento_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alta_hospitalar_declaracao_obito_id FOREIGN KEY (declaracao_obito_id) REFERENCES declaracao_obito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alta_hospitalar_medico_profissional_id FOREIGN KEY (medico_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alta_hospitalar_liberada_por_usuario_id FOREIGN KEY (liberada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE ambulancia
  ADD CONSTRAINT fk_ambulancia_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ambulancia_categoria_ambulancia_id FOREIGN KEY (categoria_ambulancia_id) REFERENCES categoria_ambulancia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ambulancia_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ambulancia_bem_patrimonial_id FOREIGN KEY (bem_patrimonial_id) REFERENCES bem_patrimonial (id) ON DELETE RESTRICT;
ALTER TABLE area_atendimento_domiciliar
  ADD CONSTRAINT fk_area_atendimento_domiciliar_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_area_atendimento_domiciliar_programa_atencao_domiciliar_id FOREIGN KEY (programa_atencao_domiciliar_id) REFERENCES programa_atencao_domiciliar (id) ON DELETE RESTRICT;
ALTER TABLE area_atendimento_domiciliar_cep
  ADD CONSTRAINT fk_area_atendimento_domiciliar_cep_area_atendimento_dom_36d56b83 FOREIGN KEY (area_atendimento_domiciliar_id) REFERENCES area_atendimento_domiciliar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_area_atendimento_domiciliar_cep_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_area_atendimento_domiciliar_cep_bairro_id FOREIGN KEY (bairro_id) REFERENCES bairro (id) ON DELETE RESTRICT;
ALTER TABLE area_atendimento_domiciliar_profissional
  ADD CONSTRAINT fk_area_atendimento_domiciliar_profissional_area_atendi_eaf93e7b FOREIGN KEY (area_atendimento_domiciliar_id) REFERENCES area_atendimento_domiciliar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_area_atendimento_domiciliar_profissional_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE auditoria_isolamento
  ADD CONSTRAINT fk_auditoria_isolamento_isolamento_paciente_id FOREIGN KEY (isolamento_paciente_id) REFERENCES isolamento_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_isolamento_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_isolamento_leito_hospitalar_id FOREIGN KEY (leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_isolamento_tipo_precaucao_id FOREIGN KEY (tipo_precaucao_id) REFERENCES tipo_precaucao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_isolamento_auditor_usuario_id FOREIGN KEY (auditor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE auditoria_isolamento_item
  ADD CONSTRAINT fk_auditoria_isolamento_item_auditoria_isolamento_id FOREIGN KEY (auditoria_isolamento_id) REFERENCES auditoria_isolamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_isolamento_item_criterio_auditoria_isolamento_id FOREIGN KEY (criterio_auditoria_isolamento_id) REFERENCES criterio_auditoria_isolamento (id) ON DELETE RESTRICT;
ALTER TABLE barreira_alta
  ADD CONSTRAINT fk_barreira_alta_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_barreira_alta_tipo_barreira_alta_id FOREIGN KEY (tipo_barreira_alta_id) REFERENCES tipo_barreira_alta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_barreira_alta_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_barreira_alta_responsavel_setor_funcional_id FOREIGN KEY (responsavel_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_barreira_alta_resolvida_por_usuario_id FOREIGN KEY (resolvida_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE bloco_internacao
  ADD CONSTRAINT fk_bloco_internacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bloco_internacao_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT;
ALTER TABLE cancelamento_alta
  ADD CONSTRAINT fk_cancelamento_alta_alta_hospitalar_id FOREIGN KEY (alta_hospitalar_id) REFERENCES alta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cancelamento_alta_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cancelamento_alta_motivo_cancelamento_alta_id FOREIGN KEY (motivo_cancelamento_alta_id) REFERENCES motivo_cancelamento_alta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cancelamento_alta_cancelado_por_usuario_id FOREIGN KEY (cancelado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE cancelamento_internacao
  ADD CONSTRAINT fk_cancelamento_internacao_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cancelamento_internacao_motivo_cancelamento_internacao_id FOREIGN KEY (motivo_cancelamento_internacao_id) REFERENCES motivo_cancelamento_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cancelamento_internacao_cancelado_por_usuario_id FOREIGN KEY (cancelado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cancelamento_internacao_solicitante_profissional_id FOREIGN KEY (solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cancelamento_internacao_leito_hospitalar_id FOREIGN KEY (leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cancelamento_internacao_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT;
ALTER TABLE capacidade_leito_sus
  ADD CONSTRAINT fk_capacidade_leito_sus_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_capacidade_leito_sus_especialidade_leito_id FOREIGN KEY (especialidade_leito_id) REFERENCES especialidade_leito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_capacidade_leito_sus_liberada_por_usuario_id FOREIGN KEY (liberada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_capacidade_leito_sus_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE capacidade_unidade_internacao
  ADD CONSTRAINT fk_capacidade_unidade_internacao_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_capacidade_unidade_internacao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE cartorio_registro_civil
  ADD CONSTRAINT fk_cartorio_registro_civil_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT;
ALTER TABLE central_reguladora
  ADD CONSTRAINT fk_central_reguladora_unidade_federativa_id FOREIGN KEY (unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_central_reguladora_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_central_reguladora_pessoa_juridica_id FOREIGN KEY (pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT;
ALTER TABLE chamado_ambulancia
  ADD CONSTRAINT fk_chamado_ambulancia_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamado_ambulancia_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamado_ambulancia_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamado_ambulancia_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamado_ambulancia_leito_hospitalar_id FOREIGN KEY (leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamado_ambulancia_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamado_ambulancia_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamado_ambulancia_categoria_ambulancia_id FOREIGN KEY (categoria_ambulancia_id) REFERENCES categoria_ambulancia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamado_ambulancia_ambulancia_id FOREIGN KEY (ambulancia_id) REFERENCES ambulancia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamado_ambulancia_rota_ambulancia_id FOREIGN KEY (rota_ambulancia_id) REFERENCES rota_ambulancia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamado_ambulancia_destino_estabelecimento_externo_id FOREIGN KEY (destino_estabelecimento_externo_id) REFERENCES estabelecimento_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamado_ambulancia_destino_municipio_ibge_id FOREIGN KEY (destino_municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamado_ambulancia_aprovado_por_usuario_id FOREIGN KEY (aprovado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamado_ambulancia_reprovado_por_usuario_id FOREIGN KEY (reprovado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamado_ambulancia_chegada_motivo_atraso_transporte_id FOREIGN KEY (chegada_motivo_atraso_transporte_id) REFERENCES motivo_atraso_transporte (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamado_ambulancia_saida_motivo_atraso_transporte_id FOREIGN KEY (saida_motivo_atraso_transporte_id) REFERENCES motivo_atraso_transporte (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamado_ambulancia_fim_motivo_atraso_transporte_id FOREIGN KEY (fim_motivo_atraso_transporte_id) REFERENCES motivo_atraso_transporte (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamado_ambulancia_motivo_cancelamento_transporte_id FOREIGN KEY (motivo_cancelamento_transporte_id) REFERENCES motivo_cancelamento_transporte (id) ON DELETE RESTRICT;
ALTER TABLE chamado_ambulancia_acompanhante
  ADD CONSTRAINT fk_chamado_ambulancia_acompanhante_chamado_ambulancia_id FOREIGN KEY (chamado_ambulancia_id) REFERENCES chamado_ambulancia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamado_ambulancia_acompanhante_tipo_parentesco_id FOREIGN KEY (tipo_parentesco_id) REFERENCES tipo_parentesco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamado_ambulancia_acompanhante_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT;
ALTER TABLE chamado_ambulancia_equipe
  ADD CONSTRAINT fk_chamado_ambulancia_equipe_chamado_ambulancia_id FOREIGN KEY (chamado_ambulancia_id) REFERENCES chamado_ambulancia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamado_ambulancia_equipe_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE chamado_domiciliar
  ADD CONSTRAINT fk_chamado_domiciliar_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamado_domiciliar_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamado_domiciliar_tipo_chamado_domiciliar_id FOREIGN KEY (tipo_chamado_domiciliar_id) REFERENCES tipo_chamado_domiciliar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamado_domiciliar_motivo_chamado_domiciliar_id FOREIGN KEY (motivo_chamado_domiciliar_id) REFERENCES motivo_chamado_domiciliar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamado_domiciliar_area_atendimento_domiciliar_id FOREIGN KEY (area_atendimento_domiciliar_id) REFERENCES area_atendimento_domiciliar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamado_domiciliar_internacao_domiciliar_id FOREIGN KEY (internacao_domiciliar_id) REFERENCES internacao_domiciliar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamado_domiciliar_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamado_domiciliar_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamado_domiciliar_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamado_domiciliar_solicitante_profissional_id FOREIGN KEY (solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamado_domiciliar_solicitante_especialidade_medica_id FOREIGN KEY (solicitante_especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamado_domiciliar_atribuido_profissional_id FOREIGN KEY (atribuido_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamado_domiciliar_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamado_domiciliar_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_chamado_domiciliar_anulado_por_usuario_id FOREIGN KEY (anulado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE comunicacao_internacao_operadora
  ADD CONSTRAINT fk_comunicacao_internacao_operadora_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicacao_internacao_operadora_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicacao_internacao_operadora_guia_tiss_id FOREIGN KEY (guia_tiss_id) REFERENCES guia_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicacao_internacao_operadora_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT;
ALTER TABLE criterio_auditoria_isolamento
  ADD CONSTRAINT fk_criterio_auditoria_isolamento_tipo_precaucao_id FOREIGN KEY (tipo_precaucao_id) REFERENCES tipo_precaucao (id) ON DELETE RESTRICT;
ALTER TABLE diagnostico_internacao
  ADD CONSTRAINT fk_diagnostico_internacao_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diagnostico_internacao_cid_termo_terminologia_id FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diagnostico_internacao_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE diaria_lancada
  ADD CONSTRAINT fk_diaria_lancada_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diaria_lancada_ocupacao_leito_id FOREIGN KEY (ocupacao_leito_id) REFERENCES ocupacao_leito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diaria_lancada_categoria_acomodacao_id FOREIGN KEY (categoria_acomodacao_id) REFERENCES categoria_acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diaria_lancada_leito_hospitalar_id FOREIGN KEY (leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diaria_lancada_regra_diaria_id FOREIGN KEY (regra_diaria_id) REFERENCES regra_diaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diaria_lancada_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diaria_lancada_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diaria_lancada_conta_hospitalar_item_id FOREIGN KEY (conta_hospitalar_item_id) REFERENCES conta_hospitalar_item (id) ON DELETE RESTRICT;
ALTER TABLE diferenca_acomodacao
  ADD CONSTRAINT fk_diferenca_acomodacao_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diferenca_acomodacao_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diferenca_acomodacao_direito_categoria_acomodacao_id FOREIGN KEY (direito_categoria_acomodacao_id) REFERENCES categoria_acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diferenca_acomodacao_utilizada_categoria_acomodacao_id FOREIGN KEY (utilizada_categoria_acomodacao_id) REFERENCES categoria_acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diferenca_acomodacao_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diferenca_acomodacao_termo_arquivo_id FOREIGN KEY (termo_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diferenca_acomodacao_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT;
ALTER TABLE escala_atendimento_domiciliar
  ADD CONSTRAINT fk_escala_atendimento_domiciliar_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escala_atendimento_domiciliar_area_atendimento_domiciliar_id FOREIGN KEY (area_atendimento_domiciliar_id) REFERENCES area_atendimento_domiciliar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escala_atendimento_domiciliar_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_escala_atendimento_domiciliar_tipo_chamado_domiciliar_id FOREIGN KEY (tipo_chamado_domiciliar_id) REFERENCES tipo_chamado_domiciliar (id) ON DELETE RESTRICT;
ALTER TABLE evento_regulacao
  ADD CONSTRAINT fk_evento_regulacao_solicitacao_regulacao_id FOREIGN KEY (solicitacao_regulacao_id) REFERENCES solicitacao_regulacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_regulacao_central_reguladora_id FOREIGN KEY (central_reguladora_id) REFERENCES central_reguladora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_regulacao_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_regulacao_faixa_diurese_id FOREIGN KEY (faixa_diurese_id) REFERENCES faixa_diurese (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_evento_regulacao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE fechamento_censo
  ADD CONSTRAINT fk_fechamento_censo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fechamento_censo_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fechamento_censo_fechado_por_usuario_id FOREIGN KEY (fechado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fechamento_censo_reaberto_por_usuario_id FOREIGN KEY (reaberto_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
