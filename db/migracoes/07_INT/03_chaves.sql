-- 07_INT, lote 03: chaves estrangeiras (aplicadas depois de todos os tabelas.sql)
ALTER TABLE recusa_acomodacao
  ADD CONSTRAINT fk_recusa_acomodacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recusa_acomodacao_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recusa_acomodacao_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recusa_acomodacao_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recusa_acomodacao_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recusa_acomodacao_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recusa_acomodacao_direito_categoria_acomodacao_id FOREIGN KEY (direito_categoria_acomodacao_id) REFERENCES categoria_acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recusa_acomodacao_oferecida_categoria_acomodacao_id FOREIGN KEY (oferecida_categoria_acomodacao_id) REFERENCES categoria_acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recusa_acomodacao_solicitada_categoria_acomodacao_id FOREIGN KEY (solicitada_categoria_acomodacao_id) REFERENCES categoria_acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recusa_acomodacao_destino_unidade_internacao_id FOREIGN KEY (destino_unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recusa_acomodacao_motivo_recusa_acomodacao_id FOREIGN KEY (motivo_recusa_acomodacao_id) REFERENCES motivo_recusa_acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recusa_acomodacao_solicitante_profissional_id FOREIGN KEY (solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recusa_acomodacao_destino_profissional_id FOREIGN KEY (destino_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recusa_acomodacao_tipo_parentesco_id FOREIGN KEY (tipo_parentesco_id) REFERENCES tipo_parentesco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recusa_acomodacao_termo_arquivo_id FOREIGN KEY (termo_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE regime_atendimento_internacao
  ADD CONSTRAINT fk_regime_atendimento_internacao_regime_atendimento_id FOREIGN KEY (regime_atendimento_id) REFERENCES regime_atendimento (id) ON DELETE RESTRICT;
ALTER TABLE regra_cobranca_gas
  ADD CONSTRAINT fk_regra_cobranca_gas_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_cobranca_gas_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_cobranca_gas_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_cobranca_gas_gas_item_faturavel_id FOREIGN KEY (gas_item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_cobranca_gas_cobranca_item_faturavel_id FOREIGN KEY (cobranca_item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE regra_cobranca_gas_faixa
  ADD CONSTRAINT fk_regra_cobranca_gas_faixa_regra_cobranca_gas_id FOREIGN KEY (regra_cobranca_gas_id) REFERENCES regra_cobranca_gas (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_cobranca_gas_faixa_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE regra_cobranca_gas_simultaneo
  ADD CONSTRAINT fk_regra_cobranca_gas_simultaneo_regra_cobranca_gas_id FOREIGN KEY (regra_cobranca_gas_id) REFERENCES regra_cobranca_gas (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_cobranca_gas_simultaneo_simultaneo_item_faturavel_id FOREIGN KEY (simultaneo_item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE regra_diaria
  ADD CONSTRAINT fk_regra_diaria_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_diaria_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_diaria_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_diaria_categoria_acomodacao_id FOREIGN KEY (categoria_acomodacao_id) REFERENCES categoria_acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_diaria_modalidade_internacao_id FOREIGN KEY (modalidade_internacao_id) REFERENCES modalidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_diaria_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_diaria_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_diaria_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_diaria_parcial_item_faturavel_id FOREIGN KEY (parcial_item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE regra_documento_internacao
  ADD CONSTRAINT fk_regra_documento_internacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_documento_internacao_modelo_documento_internacao_id FOREIGN KEY (modelo_documento_internacao_id) REFERENCES modelo_documento_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_documento_internacao_titulo_documento_internacao_id FOREIGN KEY (titulo_documento_internacao_id) REFERENCES titulo_documento_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_documento_internacao_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_documento_internacao_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_documento_internacao_modalidade_internacao_id FOREIGN KEY (modalidade_internacao_id) REFERENCES modalidade_internacao (id) ON DELETE RESTRICT;
ALTER TABLE reserva_leito
  ADD CONSTRAINT fk_reserva_leito_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_leito_leito_hospitalar_id FOREIGN KEY (leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_leito_pedido_leito_id FOREIGN KEY (pedido_leito_id) REFERENCES pedido_leito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_leito_solicitacao_transferencia_leito_id FOREIGN KEY (solicitacao_transferencia_leito_id) REFERENCES solicitacao_transferencia_leito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_leito_agendamento_internacao_id FOREIGN KEY (agendamento_internacao_id) REFERENCES agendamento_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_leito_agendamento_cirurgico_id FOREIGN KEY (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_leito_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_leito_pre_cadastro_id FOREIGN KEY (pre_cadastro_id) REFERENCES pre_cadastro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_leito_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_leito_categoria_acomodacao_id FOREIGN KEY (categoria_acomodacao_id) REFERENCES categoria_acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_leito_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_leito_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_leito_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_leito_confirmada_por_usuario_id FOREIGN KEY (confirmada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_leito_excecao_autorizada_por_usuario_id FOREIGN KEY (excecao_autorizada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_leito_encerrada_por_usuario_id FOREIGN KEY (encerrada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reserva_leito_conflito_internacao_id FOREIGN KEY (conflito_internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT;
ALTER TABLE reuniao_leitos
  ADD CONSTRAINT fk_reuniao_leitos_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reuniao_leitos_unidade_internacao_id FOREIGN KEY (unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reuniao_leitos_coordenador_usuario_id FOREIGN KEY (coordenador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE reuniao_leitos_paciente
  ADD CONSTRAINT fk_reuniao_leitos_paciente_reuniao_leitos_id FOREIGN KEY (reuniao_leitos_id) REFERENCES reuniao_leitos (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reuniao_leitos_paciente_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reuniao_leitos_paciente_leito_hospitalar_id FOREIGN KEY (leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reuniao_leitos_paciente_tipo_barreira_alta_id FOREIGN KEY (tipo_barreira_alta_id) REFERENCES tipo_barreira_alta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reuniao_leitos_paciente_barreira_alta_id FOREIGN KEY (barreira_alta_id) REFERENCES barreira_alta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reuniao_leitos_paciente_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE rota_ambulancia
  ADD CONSTRAINT fk_rota_ambulancia_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rota_ambulancia_destino_estabelecimento_externo_id FOREIGN KEY (destino_estabelecimento_externo_id) REFERENCES estabelecimento_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rota_ambulancia_destino_municipio_ibge_id FOREIGN KEY (destino_municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rota_ambulancia_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE servico_funerario
  ADD CONSTRAINT fk_servico_funerario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_funerario_pessoa_juridica_id FOREIGN KEY (pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_funerario_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT;
ALTER TABLE servico_regulacao
  ADD CONSTRAINT fk_servico_regulacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_regulacao_central_reguladora_id FOREIGN KEY (central_reguladora_id) REFERENCES central_reguladora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_regulacao_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_regulacao_especialidade_leito_id FOREIGN KEY (especialidade_leito_id) REFERENCES especialidade_leito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_servico_regulacao_tipo_leito_regulado_id FOREIGN KEY (tipo_leito_regulado_id) REFERENCES tipo_leito_regulado (id) ON DELETE RESTRICT;
ALTER TABLE solicitacao_regulacao
  ADD CONSTRAINT fk_solicitacao_regulacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_regulacao_central_reguladora_id FOREIGN KEY (central_reguladora_id) REFERENCES central_reguladora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_regulacao_servico_regulacao_id FOREIGN KEY (servico_regulacao_id) REFERENCES servico_regulacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_regulacao_solicitacao_anterior_id FOREIGN KEY (solicitacao_anterior_id) REFERENCES solicitacao_regulacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_regulacao_pedido_leito_id FOREIGN KEY (pedido_leito_id) REFERENCES pedido_leito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_regulacao_situacao_pedido_leito_id FOREIGN KEY (situacao_pedido_leito_id) REFERENCES situacao_pedido_leito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_regulacao_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_regulacao_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_regulacao_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_regulacao_reserva_leito_id FOREIGN KEY (reserva_leito_id) REFERENCES reserva_leito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_regulacao_leito_hospitalar_id FOREIGN KEY (leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_regulacao_tipo_leito_regulado_id FOREIGN KEY (tipo_leito_regulado_id) REFERENCES tipo_leito_regulado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_regulacao_especialidade_leito_id FOREIGN KEY (especialidade_leito_id) REFERENCES especialidade_leito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_regulacao_solicitante_estabelecimento_externo_id FOREIGN KEY (solicitante_estabelecimento_externo_id) REFERENCES estabelecimento_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_regulacao_executante_estabelecimento_externo_id FOREIGN KEY (executante_estabelecimento_externo_id) REFERENCES estabelecimento_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_regulacao_solicitante_profissional_id FOREIGN KEY (solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_regulacao_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_regulacao_suporte_oxigenio_id FOREIGN KEY (suporte_oxigenio_id) REFERENCES suporte_oxigenio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_regulacao_nivel_consciencia_id FOREIGN KEY (nivel_consciencia_id) REFERENCES nivel_consciencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_regulacao_faixa_diurese_id FOREIGN KEY (faixa_diurese_id) REFERENCES faixa_diurese (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_regulacao_tipo_precaucao_id FOREIGN KEY (tipo_precaucao_id) REFERENCES tipo_precaucao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_regulacao_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT;
ALTER TABLE solicitacao_transferencia_leito
  ADD CONSTRAINT fk_solicitacao_transferencia_leito_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_transferencia_leito_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_transferencia_leito_origem_leito_hospitalar_id FOREIGN KEY (origem_leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_transferencia_leito_solicitada_categoria_a87b73ff FOREIGN KEY (solicitada_categoria_acomodacao_id) REFERENCES categoria_acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_transferencia_leito_sugerida_unidade_int_8b3afc8b FOREIGN KEY (sugerida_unidade_internacao_id) REFERENCES unidade_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_transferencia_leito_sugerido_leito_hospitalar_id FOREIGN KEY (sugerido_leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_transferencia_leito_motivo_troca_leito_id FOREIGN KEY (motivo_troca_leito_id) REFERENCES motivo_troca_leito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_transferencia_leito_solicitante_usuario_id FOREIGN KEY (solicitante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_transferencia_leito_tipo_parentesco_id FOREIGN KEY (tipo_parentesco_id) REFERENCES tipo_parentesco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_transferencia_leito_reserva_leito_id FOREIGN KEY (reserva_leito_id) REFERENCES reserva_leito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_transferencia_leito_transferencia_leito_id FOREIGN KEY (transferencia_leito_id) REFERENCES transferencia_leito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_transferencia_leito_cancelado_por_usuario_id FOREIGN KEY (cancelado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE solicitacao_transporte_paciente
  ADD CONSTRAINT fk_solicitacao_transporte_paciente_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_transporte_paciente_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_transporte_paciente_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_transporte_paciente_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_transporte_paciente_alta_hospitalar_id FOREIGN KEY (alta_hospitalar_id) REFERENCES alta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_transporte_paciente_agendamento_cirurgico_id FOREIGN KEY (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_transporte_paciente_meio_transporte_id FOREIGN KEY (meio_transporte_id) REFERENCES meio_transporte (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_transporte_paciente_posicao_paciente_tra_09feaae7 FOREIGN KEY (posicao_paciente_transporte_id) REFERENCES posicao_paciente_transporte (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_transporte_paciente_ambulancia_id FOREIGN KEY (ambulancia_id) REFERENCES ambulancia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_transporte_paciente_chamado_ambulancia_id FOREIGN KEY (chamado_ambulancia_id) REFERENCES chamado_ambulancia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_transporte_paciente_rota_ambulancia_id FOREIGN KEY (rota_ambulancia_id) REFERENCES rota_ambulancia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_transporte_paciente_origem_setor_funcional_id FOREIGN KEY (origem_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_transporte_paciente_destino_setor_funcional_id FOREIGN KEY (destino_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_transporte_paciente_destino_estabelecime_a92c969d FOREIGN KEY (destino_estabelecimento_externo_id) REFERENCES estabelecimento_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_transporte_paciente_acompanhante_profissional_id FOREIGN KEY (acompanhante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_transporte_paciente_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_transporte_paciente_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_transporte_paciente_solicitante_usuario_id FOREIGN KEY (solicitante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_transporte_paciente_motivo_cancelamento__a3d38861 FOREIGN KEY (motivo_cancelamento_transporte_id) REFERENCES motivo_cancelamento_transporte (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_transporte_paciente_motivo_atraso_transporte_id FOREIGN KEY (motivo_atraso_transporte_id) REFERENCES motivo_atraso_transporte (id) ON DELETE RESTRICT;
ALTER TABLE tipo_chamado_domiciliar
  ADD CONSTRAINT fk_tipo_chamado_domiciliar_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE tipo_leito_regulado
  ADD CONSTRAINT fk_tipo_leito_regulado_especialidade_leito_id FOREIGN KEY (especialidade_leito_id) REFERENCES especialidade_leito (id) ON DELETE RESTRICT;
ALTER TABLE transferencia_leito
  ADD CONSTRAINT fk_transferencia_leito_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_leito_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_leito_origem_leito_hospitalar_id FOREIGN KEY (origem_leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_leito_destino_leito_hospitalar_id FOREIGN KEY (destino_leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_leito_origem_ocupacao_leito_id FOREIGN KEY (origem_ocupacao_leito_id) REFERENCES ocupacao_leito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_leito_destino_ocupacao_leito_id FOREIGN KEY (destino_ocupacao_leito_id) REFERENCES ocupacao_leito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_leito_destino_categoria_acomodacao_id FOREIGN KEY (destino_categoria_acomodacao_id) REFERENCES categoria_acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_leito_motivo_troca_leito_id FOREIGN KEY (motivo_troca_leito_id) REFERENCES motivo_troca_leito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_leito_solicitacao_transferencia_leito_id FOREIGN KEY (solicitacao_transferencia_leito_id) REFERENCES solicitacao_transferencia_leito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_leito_reserva_leito_id FOREIGN KEY (reserva_leito_id) REFERENCES reserva_leito (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_leito_responsavel_profissional_id FOREIGN KEY (responsavel_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_leito_executado_por_usuario_id FOREIGN KEY (executado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_leito_estornado_por_usuario_id FOREIGN KEY (estornado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE troca_internacao
  ADD CONSTRAINT fk_troca_internacao_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_troca_internacao_tipo_troca_internacao_id FOREIGN KEY (tipo_troca_internacao_id) REFERENCES tipo_troca_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_troca_internacao_anterior_fonte_pagadora_id FOREIGN KEY (anterior_fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_troca_internacao_nova_fonte_pagadora_id FOREIGN KEY (nova_fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_troca_internacao_anterior_plano_fonte_pagadora_id FOREIGN KEY (anterior_plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_troca_internacao_novo_plano_fonte_pagadora_id FOREIGN KEY (novo_plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_troca_internacao_anterior_clinica_assistencial_id FOREIGN KEY (anterior_clinica_assistencial_id) REFERENCES clinica_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_troca_internacao_nova_clinica_assistencial_id FOREIGN KEY (nova_clinica_assistencial_id) REFERENCES clinica_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_troca_internacao_anterior_especialidade_medica_id FOREIGN KEY (anterior_especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_troca_internacao_nova_especialidade_medica_id FOREIGN KEY (nova_especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_troca_internacao_anterior_profissional_id FOREIGN KEY (anterior_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_troca_internacao_novo_profissional_id FOREIGN KEY (novo_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_troca_internacao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE unidade_internacao
  ADD CONSTRAINT fk_unidade_internacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_unidade_internacao_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_unidade_internacao_bloco_internacao_id FOREIGN KEY (bloco_internacao_id) REFERENCES bloco_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_unidade_internacao_clinica_assistencial_id FOREIGN KEY (clinica_assistencial_id) REFERENCES clinica_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_unidade_internacao_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_unidade_internacao_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_unidade_internacao_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_unidade_internacao_faixa_etaria_id FOREIGN KEY (faixa_etaria_id) REFERENCES faixa_etaria (id) ON DELETE RESTRICT;
ALTER TABLE uso_gas_medicinal
  ADD CONSTRAINT fk_uso_gas_medicinal_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_uso_gas_medicinal_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_uso_gas_medicinal_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_uso_gas_medicinal_insumo_id FOREIGN KEY (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_uso_gas_medicinal_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_uso_gas_medicinal_prescricao_item_id FOREIGN KEY (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_uso_gas_medicinal_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_uso_gas_medicinal_leito_hospitalar_id FOREIGN KEY (leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_uso_gas_medicinal_agendamento_cirurgico_id FOREIGN KEY (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_uso_gas_medicinal_solicitacao_transporte_paciente_id FOREIGN KEY (solicitacao_transporte_paciente_id) REFERENCES solicitacao_transporte_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_uso_gas_medicinal_uso_anterior_id FOREIGN KEY (uso_anterior_id) REFERENCES uso_gas_medicinal (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_uso_gas_medicinal_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_uso_gas_medicinal_registrado_por_usuario_id FOREIGN KEY (registrado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE visita_domiciliar
  ADD CONSTRAINT fk_visita_domiciliar_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_visita_domiciliar_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_visita_domiciliar_internacao_domiciliar_id FOREIGN KEY (internacao_domiciliar_id) REFERENCES internacao_domiciliar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_visita_domiciliar_escala_atendimento_domiciliar_id FOREIGN KEY (escala_atendimento_domiciliar_id) REFERENCES escala_atendimento_domiciliar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_visita_domiciliar_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_visita_domiciliar_tipo_chamado_domiciliar_id FOREIGN KEY (tipo_chamado_domiciliar_id) REFERENCES tipo_chamado_domiciliar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_visita_domiciliar_chamado_domiciliar_id FOREIGN KEY (chamado_domiciliar_id) REFERENCES chamado_domiciliar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_visita_domiciliar_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_visita_domiciliar_registro_assistencial_id FOREIGN KEY (registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT;
