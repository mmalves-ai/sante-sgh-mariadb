-- Chaves do módulo INT, lote 02 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE fechamento_censo_paciente
  ADD CONSTRAINT fk_fechamento_censo_paciente_fechamento_censo_id FOREIGN KEY (fechamento_censo_id) REFERENCES fechamento_censo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fechamento_censo_paciente_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fechamento_censo_paciente_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fechamento_censo_paciente_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fechamento_censo_paciente_leito_hospitalar_id FOREIGN KEY (leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fechamento_censo_paciente_acomodacao_id FOREIGN KEY (acomodacao_id) REFERENCES acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fechamento_censo_paciente_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fechamento_censo_paciente_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fechamento_censo_paciente_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE fechamento_censo_unidade
  ADD CONSTRAINT fk_fechamento_censo_unidade_fechamento_censo_id FOREIGN KEY (fechamento_censo_id) REFERENCES fechamento_censo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fechamento_censo_unidade_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT;
ALTER TABLE habilitacao_leito_sus
  ADD CONSTRAINT fk_habilitacao_leito_sus_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_habilitacao_leito_sus_habilitacao_sus_id FOREIGN KEY (habilitacao_sus_id) REFERENCES habilitacao_sus (id) ON DELETE RESTRICT;
ALTER TABLE internacao
  ADD CONSTRAINT fk_internacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_carater_admissao_id FOREIGN KEY (carater_admissao_id) REFERENCES carater_admissao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_regime_atendimento_internacao_id FOREIGN KEY (regime_atendimento_internacao_id) REFERENCES regime_atendimento_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_modalidade_internacao_id FOREIGN KEY (modalidade_internacao_id) REFERENCES modalidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_procedencia_internacao_id FOREIGN KEY (procedencia_internacao_id) REFERENCES procedencia_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_meio_transporte_id FOREIGN KEY (meio_transporte_id) REFERENCES meio_transporte (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_leito_hospitalar_id FOREIGN KEY (leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_acomodacao_id FOREIGN KEY (acomodacao_id) REFERENCES acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_medico_assistente_profissional_id FOREIGN KEY (medico_assistente_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_medico_solicitante_profissional_id FOREIGN KEY (medico_solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_agendamento_internacao_id FOREIGN KEY (agendamento_internacao_id) REFERENCES agendamento_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_pedido_leito_id FOREIGN KEY (pedido_leito_id) REFERENCES pedido_leito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_solicitacao_regulacao_id FOREIGN KEY (solicitacao_regulacao_id) REFERENCES solicitacao_regulacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_internacao_anterior_internacao_id FOREIGN KEY (internacao_anterior_internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_cid_principal_termo_terminologia_id FOREIGN KEY (cid_principal_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_cid_secundario_termo_terminologia_id FOREIGN KEY (cid_secundario_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_procedimento_solicitado_item_faturavel_id FOREIGN KEY (procedimento_solicitado_item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_procedimento_solicitado_procedimento_sigtap_id FOREIGN KEY (procedimento_solicitado_procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_alta_medica_profissional_id FOREIGN KEY (alta_medica_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_motivo_saida_hospitalar_id FOREIGN KEY (motivo_saida_hospitalar_id) REFERENCES motivo_saida_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_desfecho_internacao_id FOREIGN KEY (desfecho_internacao_id) REFERENCES desfecho_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_motivo_cancelamento_internacao_id FOREIGN KEY (motivo_cancelamento_internacao_id) REFERENCES motivo_cancelamento_internacao (id) ON DELETE RESTRICT;
ALTER TABLE internacao_domiciliar
  ADD CONSTRAINT fk_internacao_domiciliar_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_domiciliar_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_domiciliar_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_domiciliar_origem_internacao_id FOREIGN KEY (origem_internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_domiciliar_programa_atencao_domiciliar_id FOREIGN KEY (programa_atencao_domiciliar_id) REFERENCES programa_atencao_domiciliar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_domiciliar_area_atendimento_domiciliar_id FOREIGN KEY (area_atendimento_domiciliar_id) REFERENCES area_atendimento_domiciliar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_domiciliar_endereco_pessoa_id FOREIGN KEY (endereco_pessoa_id) REFERENCES endereco_pessoa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_domiciliar_motivo_transferencia_domicilio_id FOREIGN KEY (motivo_transferencia_domicilio_id) REFERENCES motivo_transferencia_domicilio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_domiciliar_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_domiciliar_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_domiciliar_orcamento_internacao_domiciliar_id FOREIGN KEY (orcamento_internacao_domiciliar_id) REFERENCES orcamento_internacao_domiciliar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_domiciliar_medico_responsavel_profissional_id FOREIGN KEY (medico_responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_domiciliar_enfermeiro_supervisor_profissional_id FOREIGN KEY (enfermeiro_supervisor_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_domiciliar_tecnico_enfermagem_profissional_id FOREIGN KEY (tecnico_enfermagem_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_domiciliar_responsavel_financeiro_respons_1a2f0b58 FOREIGN KEY (responsavel_financeiro_responsavel_paciente_id) REFERENCES responsavel_paciente (id) ON DELETE RESTRICT;
ALTER TABLE internacao_recem_nascido
  ADD CONSTRAINT fk_internacao_recem_nascido_mae_internacao_id FOREIGN KEY (mae_internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_recem_nascido_recem_nascido_paciente_id FOREIGN KEY (recem_nascido_paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_recem_nascido_propria_internacao_id FOREIGN KEY (propria_internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_recem_nascido_declaracao_nascido_vivo_id FOREIGN KEY (declaracao_nascido_vivo_id) REFERENCES declaracao_nascido_vivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_recem_nascido_pediatra_profissional_id FOREIGN KEY (pediatra_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_recem_nascido_condicao_recem_nascido_id FOREIGN KEY (condicao_recem_nascido_id) REFERENCES condicao_recem_nascido (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_recem_nascido_desfecho_recem_nascido_id FOREIGN KEY (desfecho_recem_nascido_id) REFERENCES desfecho_recem_nascido (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_internacao_recem_nascido_cartorio_registro_civil_id FOREIGN KEY (cartorio_registro_civil_id) REFERENCES cartorio_registro_civil (id) ON DELETE RESTRICT;
ALTER TABLE isolamento_paciente
  ADD CONSTRAINT fk_isolamento_paciente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_isolamento_paciente_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_isolamento_paciente_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_isolamento_paciente_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_isolamento_paciente_tipo_precaucao_id FOREIGN KEY (tipo_precaucao_id) REFERENCES tipo_precaucao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_isolamento_paciente_microrganismo_id FOREIGN KEY (microrganismo_id) REFERENCES microrganismo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_isolamento_paciente_caso_infeccao_id FOREIGN KEY (caso_infeccao_id) REFERENCES caso_infeccao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_isolamento_paciente_leito_hospitalar_id FOREIGN KEY (leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_isolamento_paciente_indicacao_profissional_id FOREIGN KEY (indicacao_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_isolamento_paciente_encerramento_profissional_id FOREIGN KEY (encerramento_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE leito_caracteristica
  ADD CONSTRAINT fk_leito_caracteristica_leito_hospitalar_id FOREIGN KEY (leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_leito_caracteristica_caracteristica_leito_id FOREIGN KEY (caracteristica_leito_id) REFERENCES caracteristica_leito (id) ON DELETE RESTRICT;
ALTER TABLE leito_habilitado_sus
  ADD CONSTRAINT fk_leito_habilitado_sus_habilitacao_leito_sus_id FOREIGN KEY (habilitacao_leito_sus_id) REFERENCES habilitacao_leito_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_leito_habilitado_sus_leito_hospitalar_id FOREIGN KEY (leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT;
ALTER TABLE leito_hospitalar
  ADD CONSTRAINT fk_leito_hospitalar_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_leito_hospitalar_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_leito_hospitalar_bloco_internacao_id FOREIGN KEY (bloco_internacao_id) REFERENCES bloco_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_leito_hospitalar_local_fisico_id FOREIGN KEY (local_fisico_id) REFERENCES local_fisico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_leito_hospitalar_acomodacao_id FOREIGN KEY (acomodacao_id) REFERENCES acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_leito_hospitalar_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_leito_hospitalar_especialidade_leito_id FOREIGN KEY (especialidade_leito_id) REFERENCES especialidade_leito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_leito_hospitalar_tipo_leito_regulado_id FOREIGN KEY (tipo_leito_regulado_id) REFERENCES tipo_leito_regulado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_leito_hospitalar_faixa_etaria_id FOREIGN KEY (faixa_etaria_id) REFERENCES faixa_etaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_leito_hospitalar_situacao_leito_id FOREIGN KEY (situacao_leito_id) REFERENCES situacao_leito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_leito_hospitalar_copa_distribuicao_id FOREIGN KEY (copa_distribuicao_id) REFERENCES copa_distribuicao (id) ON DELETE RESTRICT;
ALTER TABLE leito_observacao
  ADD CONSTRAINT fk_leito_observacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_leito_observacao_local_observacao_id FOREIGN KEY (local_observacao_id) REFERENCES local_observacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_leito_observacao_tipo_leito_observacao_id FOREIGN KEY (tipo_leito_observacao_id) REFERENCES tipo_leito_observacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_leito_observacao_situacao_leito_id FOREIGN KEY (situacao_leito_id) REFERENCES situacao_leito (id) ON DELETE RESTRICT;
ALTER TABLE liberacao_corpo
  ADD CONSTRAINT fk_liberacao_corpo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_corpo_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_corpo_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_corpo_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_corpo_declaracao_obito_id FOREIGN KEY (declaracao_obito_id) REFERENCES declaracao_obito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_corpo_servico_funerario_id FOREIGN KEY (servico_funerario_id) REFERENCES servico_funerario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_corpo_retirante_tipo_parentesco_id FOREIGN KEY (retirante_tipo_parentesco_id) REFERENCES tipo_parentesco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_liberacao_corpo_liberacao_usuario_id FOREIGN KEY (liberacao_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE local_observacao
  ADD CONSTRAINT fk_local_observacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_local_observacao_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_local_observacao_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_local_observacao_acomodacao_id FOREIGN KEY (acomodacao_id) REFERENCES acomodacao (id) ON DELETE RESTRICT;
ALTER TABLE meta_tempo_etapa
  ADD CONSTRAINT fk_meta_tempo_etapa_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_meta_tempo_etapa_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_meta_tempo_etapa_etapa_inicio_etapa_fluxo_paciente_id FOREIGN KEY (etapa_inicio_etapa_fluxo_paciente_id) REFERENCES etapa_fluxo_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_meta_tempo_etapa_etapa_fim_etapa_fluxo_paciente_id FOREIGN KEY (etapa_fim_etapa_fluxo_paciente_id) REFERENCES etapa_fluxo_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_meta_tempo_etapa_indicador_id FOREIGN KEY (indicador_id) REFERENCES indicador (id) ON DELETE RESTRICT;
ALTER TABLE modelo_documento_internacao
  ADD CONSTRAINT fk_modelo_documento_internacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_documento_internacao_titulo_documento_internacao_id FOREIGN KEY (titulo_documento_internacao_id) REFERENCES titulo_documento_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_documento_internacao_modelo_documento_clinico_id FOREIGN KEY (modelo_documento_clinico_id) REFERENCES modelo_documento_clinico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_documento_internacao_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT;
ALTER TABLE modelo_pedido_internacao
  ADD CONSTRAINT fk_modelo_pedido_internacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_pedido_internacao_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_pedido_internacao_modalidade_internacao_id FOREIGN KEY (modalidade_internacao_id) REFERENCES modalidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_pedido_internacao_carater_admissao_id FOREIGN KEY (carater_admissao_id) REFERENCES carater_admissao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_pedido_internacao_acomodacao_id FOREIGN KEY (acomodacao_id) REFERENCES acomodacao (id) ON DELETE RESTRICT;
ALTER TABLE modelo_pedido_internacao_item
  ADD CONSTRAINT fk_modelo_pedido_internacao_item_modelo_pedido_internacao_id FOREIGN KEY (modelo_pedido_internacao_id) REFERENCES modelo_pedido_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_pedido_internacao_item_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_pedido_internacao_item_cid_termo_terminologia_id FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE motivo_chamado_domiciliar
  ADD CONSTRAINT fk_motivo_chamado_domiciliar_tipo_chamado_domiciliar_id FOREIGN KEY (tipo_chamado_domiciliar_id) REFERENCES tipo_chamado_domiciliar (id) ON DELETE RESTRICT;
ALTER TABLE motivo_saida_hospitalar
  ADD CONSTRAINT fk_motivo_saida_hospitalar_desfecho_internacao_id FOREIGN KEY (desfecho_internacao_id) REFERENCES desfecho_internacao (id) ON DELETE RESTRICT;
ALTER TABLE ocupacao_leito
  ADD CONSTRAINT fk_ocupacao_leito_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocupacao_leito_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocupacao_leito_leito_hospitalar_id FOREIGN KEY (leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocupacao_leito_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocupacao_leito_acomodacao_id FOREIGN KEY (acomodacao_id) REFERENCES acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocupacao_leito_motivo_troca_leito_id FOREIGN KEY (motivo_troca_leito_id) REFERENCES motivo_troca_leito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocupacao_leito_anterior_ocupacao_leito_id FOREIGN KEY (anterior_ocupacao_leito_id) REFERENCES ocupacao_leito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocupacao_leito_medico_profissional_id FOREIGN KEY (medico_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocupacao_leito_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocupacao_leito_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocupacao_leito_registro_usuario_id FOREIGN KEY (registro_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE ocupacao_leito_observacao
  ADD CONSTRAINT fk_ocupacao_leito_observacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocupacao_leito_observacao_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocupacao_leito_observacao_leito_observacao_id FOREIGN KEY (leito_observacao_id) REFERENCES leito_observacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocupacao_leito_observacao_destino_internacao_id FOREIGN KEY (destino_internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocupacao_leito_observacao_motivo_troca_leito_id FOREIGN KEY (motivo_troca_leito_id) REFERENCES motivo_troca_leito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocupacao_leito_observacao_registro_usuario_id FOREIGN KEY (registro_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE orcamento_internacao_domiciliar
  ADD CONSTRAINT fk_orcamento_internacao_domiciliar_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_internacao_domiciliar_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_internacao_domiciliar_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_internacao_domiciliar_programa_atencao_dom_029605a7 FOREIGN KEY (programa_atencao_domiciliar_id) REFERENCES programa_atencao_domiciliar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_internacao_domiciliar_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_internacao_domiciliar_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_internacao_domiciliar_acomodacao_id FOREIGN KEY (acomodacao_id) REFERENCES acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_internacao_domiciliar_modalidade_internacao_id FOREIGN KEY (modalidade_internacao_id) REFERENCES modalidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_internacao_domiciliar_solicitante_profissional_id FOREIGN KEY (solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_internacao_domiciliar_cid_termo_terminologia_id FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE orcamento_internacao_domiciliar_item
  ADD CONSTRAINT fk_orcamento_internacao_domiciliar_item_orcamento_inter_a320394a FOREIGN KEY (orcamento_internacao_domiciliar_id) REFERENCES orcamento_internacao_domiciliar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_internacao_domiciliar_item_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_internacao_domiciliar_item_tipo_custo_id FOREIGN KEY (tipo_custo_id) REFERENCES tipo_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_internacao_domiciliar_item_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT;
ALTER TABLE pacote_diarias_internacao
  ADD CONSTRAINT fk_pacote_diarias_internacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_diarias_internacao_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_diarias_internacao_procedimento_item_faturavel_id FOREIGN KEY (procedimento_item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_diarias_internacao_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_diarias_internacao_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_diarias_internacao_acomodacao_id FOREIGN KEY (acomodacao_id) REFERENCES acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_diarias_internacao_complementar_item_faturavel_id FOREIGN KEY (complementar_item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pacote_diarias_internacao_adicional_item_faturavel_id FOREIGN KEY (adicional_item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE pedido_leito
  ADD CONSTRAINT fk_pedido_leito_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_leito_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_leito_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_leito_solicitante_profissional_id FOREIGN KEY (solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_leito_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_leito_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_leito_acomodacao_id FOREIGN KEY (acomodacao_id) REFERENCES acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_leito_categoria_acomodacao_id FOREIGN KEY (categoria_acomodacao_id) REFERENCES categoria_acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_leito_tipo_precaucao_id FOREIGN KEY (tipo_precaucao_id) REFERENCES tipo_precaucao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_leito_cid_termo_terminologia_id FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_leito_situacao_pedido_leito_id FOREIGN KEY (situacao_pedido_leito_id) REFERENCES situacao_pedido_leito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_leito_solicitacao_regulacao_id FOREIGN KEY (solicitacao_regulacao_id) REFERENCES solicitacao_regulacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_leito_reserva_leito_id FOREIGN KEY (reserva_leito_id) REFERENCES reserva_leito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_leito_leito_hospitalar_id FOREIGN KEY (leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pedido_leito_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT;
ALTER TABLE periodo_situacao_leito
  ADD CONSTRAINT fk_periodo_situacao_leito_leito_hospitalar_id FOREIGN KEY (leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_periodo_situacao_leito_situacao_leito_id FOREIGN KEY (situacao_leito_id) REFERENCES situacao_leito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_periodo_situacao_leito_motivo_bloqueio_leito_id FOREIGN KEY (motivo_bloqueio_leito_id) REFERENCES motivo_bloqueio_leito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_periodo_situacao_leito_ordem_servico_manutencao_id FOREIGN KEY (ordem_servico_manutencao_id) REFERENCES ordem_servico_manutencao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_periodo_situacao_leito_solicitacao_limpeza_id FOREIGN KEY (solicitacao_limpeza_id) REFERENCES solicitacao_limpeza (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_periodo_situacao_leito_isolamento_paciente_id FOREIGN KEY (isolamento_paciente_id) REFERENCES isolamento_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_periodo_situacao_leito_reserva_leito_id FOREIGN KEY (reserva_leito_id) REFERENCES reserva_leito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_periodo_situacao_leito_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE permissao_unidade_usuario
  ADD CONSTRAINT fk_permissao_unidade_usuario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_permissao_unidade_usuario_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_permissao_unidade_usuario_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE previsao_alta
  ADD CONSTRAINT fk_previsao_alta_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_previsao_alta_informante_profissional_id FOREIGN KEY (informante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_previsao_alta_motivo_saida_hospitalar_id FOREIGN KEY (motivo_saida_hospitalar_id) REFERENCES motivo_saida_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_previsao_alta_liberacao_usuario_id FOREIGN KEY (liberacao_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_previsao_alta_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE procedimento_especialidade_leito
  ADD CONSTRAINT fk_procedimento_especialidade_leito_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_especialidade_leito_especialidade_leito_id FOREIGN KEY (especialidade_leito_id) REFERENCES especialidade_leito (id) ON DELETE RESTRICT;
ALTER TABLE profissional_transporte
  ADD CONSTRAINT fk_profissional_transporte_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_transporte_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_transporte_turno_padrao_id FOREIGN KEY (turno_padrao_id) REFERENCES turno_padrao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_profissional_transporte_ambulancia_id FOREIGN KEY (ambulancia_id) REFERENCES ambulancia (id) ON DELETE RESTRICT;
ALTER TABLE programa_atencao_domiciliar
  ADD CONSTRAINT fk_programa_atencao_domiciliar_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE quadro_clinico_regulacao
  ADD CONSTRAINT fk_quadro_clinico_regulacao_solicitacao_regulacao_id FOREIGN KEY (solicitacao_regulacao_id) REFERENCES solicitacao_regulacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_quadro_clinico_regulacao_registro_profissional_id FOREIGN KEY (registro_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_quadro_clinico_regulacao_nivel_consciencia_id FOREIGN KEY (nivel_consciencia_id) REFERENCES nivel_consciencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_quadro_clinico_regulacao_suporte_oxigenio_id FOREIGN KEY (suporte_oxigenio_id) REFERENCES suporte_oxigenio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_quadro_clinico_regulacao_faixa_diurese_id FOREIGN KEY (faixa_diurese_id) REFERENCES faixa_diurese (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_quadro_clinico_regulacao_procedencia_internacao_id FOREIGN KEY (procedencia_internacao_id) REFERENCES procedencia_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_quadro_clinico_regulacao_germe_1_microrganismo_id FOREIGN KEY (germe_1_microrganismo_id) REFERENCES microrganismo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_quadro_clinico_regulacao_germe_2_microrganismo_id FOREIGN KEY (germe_2_microrganismo_id) REFERENCES microrganismo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_quadro_clinico_regulacao_germe_3_microrganismo_id FOREIGN KEY (germe_3_microrganismo_id) REFERENCES microrganismo (id) ON DELETE RESTRICT;
