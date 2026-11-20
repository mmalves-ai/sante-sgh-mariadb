-- Módulo FAT, lote 01: chaves estrangeiras (aplicadas depois de todos os tabelas.sql).

ALTER TABLE acordo_equipe_medica
  ADD CONSTRAINT fk_acordo_equipe_medica_acordo_honorario_particular_id FOREIGN KEY (acordo_honorario_particular_id) REFERENCES acordo_honorario_particular (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acordo_equipe_medica_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acordo_equipe_medica_funcao_equipe_cobranca_id FOREIGN KEY (funcao_equipe_cobranca_id) REFERENCES funcao_equipe_cobranca (id) ON DELETE RESTRICT;
ALTER TABLE acordo_honorario_particular
  ADD CONSTRAINT fk_acordo_honorario_particular_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acordo_honorario_particular_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acordo_honorario_particular_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acordo_honorario_particular_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acordo_honorario_particular_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acordo_honorario_particular_funcao_equipe_cobranca_id FOREIGN KEY (funcao_equipe_cobranca_id) REFERENCES funcao_equipe_cobranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acordo_honorario_particular_desativado_por_usuario_id FOREIGN KEY (desativado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE acrescimo_horario_especial
  ADD CONSTRAINT fk_acrescimo_horario_especial_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acrescimo_horario_especial_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acrescimo_horario_especial_contrato_fonte_pagadora_id FOREIGN KEY (contrato_fonte_pagadora_id) REFERENCES contrato_fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE acrescimo_horario_procedimento
  ADD CONSTRAINT fk_acrescimo_horario_procedimento_acrescimo_horario_especial_id FOREIGN KEY (acrescimo_horario_especial_id) REFERENCES acrescimo_horario_especial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acrescimo_horario_procedimento_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acrescimo_horario_procedimento_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT;
ALTER TABLE ajuste_conta
  ADD CONSTRAINT fk_ajuste_conta_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ajuste_conta_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ajuste_conta_motivo_ajuste_conta_id FOREIGN KEY (motivo_ajuste_conta_id) REFERENCES motivo_ajuste_conta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ajuste_conta_solicitado_por_usuario_id FOREIGN KEY (solicitado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ajuste_conta_pedido_aprovacao_id FOREIGN KEY (pedido_aprovacao_id) REFERENCES pedido_aprovacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ajuste_conta_decidido_por_usuario_id FOREIGN KEY (decidido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE ajuste_conta_item
  ADD CONSTRAINT fk_ajuste_conta_item_ajuste_conta_id FOREIGN KEY (ajuste_conta_id) REFERENCES ajuste_conta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ajuste_conta_item_conta_hospitalar_item_id FOREIGN KEY (conta_hospitalar_item_id) REFERENCES conta_hospitalar_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ajuste_conta_item_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT;
ALTER TABLE ajuste_repasse
  ADD CONSTRAINT fk_ajuste_repasse_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ajuste_repasse_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ajuste_repasse_recebedor_prestador_terceiro_id FOREIGN KEY (recebedor_prestador_terceiro_id) REFERENCES prestador_terceiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ajuste_repasse_apuracao_repasse_id FOREIGN KEY (apuracao_repasse_id) REFERENCES apuracao_repasse (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ajuste_repasse_tipo_desconto_repasse_id FOREIGN KEY (tipo_desconto_repasse_id) REFERENCES tipo_desconto_repasse (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ajuste_repasse_pedido_aprovacao_id FOREIGN KEY (pedido_aprovacao_id) REFERENCES pedido_aprovacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ajuste_repasse_decidido_por_usuario_id FOREIGN KEY (decidido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE apuracao_repasse
  ADD CONSTRAINT fk_apuracao_repasse_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_repasse_iniciada_por_usuario_id FOREIGN KEY (iniciada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_repasse_aprovada_por_usuario_id FOREIGN KEY (aprovada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE apuracao_repasse_item
  ADD CONSTRAINT fk_apuracao_repasse_item_apuracao_repasse_id FOREIGN KEY (apuracao_repasse_id) REFERENCES apuracao_repasse (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_repasse_item_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_repasse_item_recebedor_prestador_terceiro_id FOREIGN KEY (recebedor_prestador_terceiro_id) REFERENCES prestador_terceiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_repasse_item_producao_repasse_id FOREIGN KEY (producao_repasse_id) REFERENCES producao_repasse (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_repasse_item_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_repasse_item_conta_hospitalar_item_id FOREIGN KEY (conta_hospitalar_item_id) REFERENCES conta_hospitalar_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_repasse_item_funcao_equipe_cobranca_id FOREIGN KEY (funcao_equipe_cobranca_id) REFERENCES funcao_equipe_cobranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_repasse_item_regra_repasse_id FOREIGN KEY (regra_repasse_id) REFERENCES regra_repasse (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_repasse_item_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_repasse_item_glosa_id FOREIGN KEY (glosa_id) REFERENCES glosa (id) ON DELETE RESTRICT;
ALTER TABLE apuracao_repasse_rateio_setor
  ADD CONSTRAINT fk_apuracao_repasse_rateio_setor_apuracao_repasse_id FOREIGN KEY (apuracao_repasse_id) REFERENCES apuracao_repasse (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_repasse_rateio_setor_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_repasse_rateio_setor_recebedor_prestador_terceiro_id FOREIGN KEY (recebedor_prestador_terceiro_id) REFERENCES prestador_terceiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_repasse_rateio_setor_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE arquivo_lote_tiss
  ADD CONSTRAINT fk_arquivo_lote_tiss_lote_tiss_id FOREIGN KEY (lote_tiss_id) REFERENCES lote_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_arquivo_lote_tiss_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_arquivo_lote_tiss_versao_padrao_tiss_id FOREIGN KEY (versao_padrao_tiss_id) REFERENCES versao_padrao_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_arquivo_lote_tiss_gerado_por_usuario_id FOREIGN KEY (gerado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE atendimento_categoria_clinica
  ADD CONSTRAINT fk_atendimento_categoria_clinica_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_categoria_clinica_clinica_assistencial_id FOREIGN KEY (clinica_assistencial_id) REFERENCES clinica_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_categoria_clinica_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_categoria_clinica_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE atributo_guia_fonte_pagadora
  ADD CONSTRAINT fk_atributo_guia_fonte_pagadora_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atributo_guia_fonte_pagadora_depende_atributo_guia_f_d9634286 FOREIGN KEY (depende_atributo_guia_fonte_pagadora_id) REFERENCES atributo_guia_fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE atributo_guia_opcao
  ADD CONSTRAINT fk_atributo_guia_opcao_atributo_guia_fonte_pagadora_id FOREIGN KEY (atributo_guia_fonte_pagadora_id) REFERENCES atributo_guia_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atributo_guia_opcao_opcao_pai_id FOREIGN KEY (opcao_pai_id) REFERENCES atributo_guia_opcao (id) ON DELETE RESTRICT;
ALTER TABLE auditoria_conta
  ADD CONSTRAINT fk_auditoria_conta_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_conta_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_conta_tipo_auditoria_id FOREIGN KEY (tipo_auditoria_id) REFERENCES tipo_auditoria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_conta_motivo_auditoria_id FOREIGN KEY (motivo_auditoria_id) REFERENCES motivo_auditoria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_conta_empresa_auditoria_externa_id FOREIGN KEY (empresa_auditoria_externa_id) REFERENCES empresa_auditoria_externa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_conta_auditor_profissional_id FOREIGN KEY (auditor_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_conta_auditor_usuario_id FOREIGN KEY (auditor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_conta_solicitante_usuario_id FOREIGN KEY (solicitante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_conta_cancelada_por_usuario_id FOREIGN KEY (cancelada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE auditoria_conta_item
  ADD CONSTRAINT fk_auditoria_conta_item_auditoria_conta_id FOREIGN KEY (auditoria_conta_id) REFERENCES auditoria_conta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_conta_item_conta_hospitalar_item_id FOREIGN KEY (conta_hospitalar_item_id) REFERENCES conta_hospitalar_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_conta_item_motivo_glosa_id FOREIGN KEY (motivo_glosa_id) REFERENCES motivo_glosa (id) ON DELETE RESTRICT;
ALTER TABLE auditoria_conta_versao
  ADD CONSTRAINT fk_auditoria_conta_versao_auditoria_conta_id FOREIGN KEY (auditoria_conta_id) REFERENCES auditoria_conta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_conta_versao_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_conta_versao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE calendario_entrega_fatura
  ADD CONSTRAINT fk_calendario_entrega_fatura_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_calendario_entrega_fatura_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE cancelamento_guia
  ADD CONSTRAINT fk_cancelamento_guia_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cancelamento_guia_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cancelamento_guia_codigo_prestador_fonte_pagadora_id FOREIGN KEY (codigo_prestador_fonte_pagadora_id) REFERENCES codigo_prestador_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cancelamento_guia_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cancelamento_guia_solicitado_por_usuario_id FOREIGN KEY (solicitado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cancelamento_guia_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cancelamento_guia_descartado_por_usuario_id FOREIGN KEY (descartado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE cancelamento_guia_item
  ADD CONSTRAINT fk_cancelamento_guia_item_cancelamento_guia_id FOREIGN KEY (cancelamento_guia_id) REFERENCES cancelamento_guia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cancelamento_guia_item_guia_tiss_id FOREIGN KEY (guia_tiss_id) REFERENCES guia_tiss (id) ON DELETE RESTRICT;
ALTER TABLE celula_faturamento
  ADD CONSTRAINT fk_celula_faturamento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_celula_faturamento_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_celula_faturamento_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE celula_faturamento_fonte_pagadora
  ADD CONSTRAINT fk_celula_faturamento_fonte_pagadora_celula_faturamento_id FOREIGN KEY (celula_faturamento_id) REFERENCES celula_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_celula_faturamento_fonte_pagadora_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_celula_faturamento_fonte_pagadora_tipo_conta_id FOREIGN KEY (tipo_conta_id) REFERENCES tipo_conta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_celula_faturamento_fonte_pagadora_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE classificacao_despesa
  ADD CONSTRAINT fk_classificacao_despesa_despesa_termo_terminologia_id FOREIGN KEY (despesa_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE codigo_prestador_fonte_pagadora
  ADD CONSTRAINT fk_codigo_prestador_fonte_pagadora_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_codigo_prestador_fonte_pagadora_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_codigo_prestador_fonte_pagadora_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_codigo_prestador_fonte_pagadora_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_codigo_prestador_fonte_pagadora_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_codigo_prestador_fonte_pagadora_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_codigo_prestador_fonte_pagadora_categoria_atendimento_id FOREIGN KEY (categoria_atendimento_id) REFERENCES categoria_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_codigo_prestador_fonte_pagadora_conta_bancaria_credor_id FOREIGN KEY (conta_bancaria_credor_id) REFERENCES conta_bancaria_credor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_codigo_prestador_fonte_pagadora_credencial_fonte_pagadora_id FOREIGN KEY (credencial_fonte_pagadora_id) REFERENCES credencial_fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE compatibilidade_procedimento
  ADD CONSTRAINT fk_compatibilidade_procedimento_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_compatibilidade_procedimento_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_compatibilidade_procedimento_relacionado_item_faturavel_id FOREIGN KEY (relacionado_item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE competencia_faturamento
  ADD CONSTRAINT fk_competencia_faturamento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_competencia_faturamento_aberta_por_usuario_id FOREIGN KEY (aberta_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_competencia_faturamento_fechada_por_usuario_id FOREIGN KEY (fechada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE competencia_faturamento_historico
  ADD CONSTRAINT fk_competencia_faturamento_historico_competencia_faturamento_id FOREIGN KEY (competencia_faturamento_id) REFERENCES competencia_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_competencia_faturamento_historico_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE competencia_trabalho_usuario
  ADD CONSTRAINT fk_competencia_trabalho_usuario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_competencia_trabalho_usuario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE comunicacao_beneficiario
  ADD CONSTRAINT fk_comunicacao_beneficiario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicacao_beneficiario_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicacao_beneficiario_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicacao_beneficiario_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicacao_beneficiario_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicacao_beneficiario_cobertura_paciente_id FOREIGN KEY (cobertura_paciente_id) REFERENCES cobertura_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicacao_beneficiario_tipo_internacao_termo_termi_32072d6b FOREIGN KEY (tipo_internacao_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicacao_beneficiario_motivo_saida_termo_terminologia_id FOREIGN KEY (motivo_saida_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicacao_beneficiario_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicacao_beneficiario_descartado_por_usuario_id FOREIGN KEY (descartado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE comunicacao_beneficiario_recibo
  ADD CONSTRAINT fk_comunicacao_beneficiario_recibo_comunicacao_beneficiario_id FOREIGN KEY (comunicacao_beneficiario_id) REFERENCES comunicacao_beneficiario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_comunicacao_beneficiario_recibo_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT;
ALTER TABLE conciliacao_item
  ADD CONSTRAINT fk_conciliacao_item_demonstrativo_pagamento_item_id FOREIGN KEY (demonstrativo_pagamento_item_id) REFERENCES demonstrativo_pagamento_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conciliacao_item_conta_hospitalar_item_id FOREIGN KEY (conta_hospitalar_item_id) REFERENCES conta_hospitalar_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conciliacao_item_conciliado_por_usuario_id FOREIGN KEY (conciliado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE condicao_liberacao_repasse
  ADD CONSTRAINT fk_condicao_liberacao_repasse_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_condicao_liberacao_repasse_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_condicao_liberacao_repasse_regra_repasse_id FOREIGN KEY (regra_repasse_id) REFERENCES regra_repasse (id) ON DELETE RESTRICT;
ALTER TABLE consulta_elegibilidade
  ADD CONSTRAINT fk_consulta_elegibilidade_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consulta_elegibilidade_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consulta_elegibilidade_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consulta_elegibilidade_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consulta_elegibilidade_cobertura_paciente_id FOREIGN KEY (cobertura_paciente_id) REFERENCES cobertura_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consulta_elegibilidade_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consulta_elegibilidade_codigo_prestador_fonte_pagadora_id FOREIGN KEY (codigo_prestador_fonte_pagadora_id) REFERENCES codigo_prestador_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consulta_elegibilidade_solicitada_por_usuario_id FOREIGN KEY (solicitada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consulta_elegibilidade_motivo_glosa_id FOREIGN KEY (motivo_glosa_id) REFERENCES motivo_glosa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consulta_elegibilidade_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT;
ALTER TABLE consulta_situacao_autorizacao
  ADD CONSTRAINT fk_consulta_situacao_autorizacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consulta_situacao_autorizacao_solicitacao_autorizacao_id FOREIGN KEY (solicitacao_autorizacao_id) REFERENCES solicitacao_autorizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consulta_situacao_autorizacao_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consulta_situacao_autorizacao_resposta_autorizacao_id FOREIGN KEY (resposta_autorizacao_id) REFERENCES resposta_autorizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_consulta_situacao_autorizacao_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT;
ALTER TABLE conta_hospitalar
  ADD CONSTRAINT fk_conta_hospitalar_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_cobertura_paciente_id FOREIGN KEY (cobertura_paciente_id) REFERENCES cobertura_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_contrato_fonte_pagadora_id FOREIGN KEY (contrato_fonte_pagadora_id) REFERENCES contrato_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_tabela_preco_id FOREIGN KEY (tabela_preco_id) REFERENCES tabela_preco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_tipo_conta_id FOREIGN KEY (tipo_conta_id) REFERENCES tipo_conta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_categoria_acomodacao_id FOREIGN KEY (categoria_acomodacao_id) REFERENCES categoria_acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_conta_pai_id FOREIGN KEY (conta_pai_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_guia_fonte_pagadora_id FOREIGN KEY (guia_fonte_pagadora_id) REFERENCES guia_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_etapa_conta_id FOREIGN KEY (etapa_conta_id) REFERENCES etapa_conta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_celula_faturamento_id FOREIGN KEY (celula_faturamento_id) REFERENCES celula_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_fechada_por_usuario_id FOREIGN KEY (fechada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_motivo_reabertura_conta_id FOREIGN KEY (motivo_reabertura_conta_id) REFERENCES motivo_reabertura_conta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_motivo_cancelamento_conta_id FOREIGN KEY (motivo_cancelamento_conta_id) REFERENCES motivo_cancelamento_conta (id) ON DELETE RESTRICT;
ALTER TABLE conta_hospitalar_diagnostico
  ADD CONSTRAINT fk_conta_hospitalar_diagnostico_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_diagnostico_cid_termo_terminologia_id FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE conta_hospitalar_etapa
  ADD CONSTRAINT fk_conta_hospitalar_etapa_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_etapa_etapa_conta_id FOREIGN KEY (etapa_conta_id) REFERENCES etapa_conta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_etapa_celula_faturamento_id FOREIGN KEY (celula_faturamento_id) REFERENCES celula_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_etapa_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_etapa_pendencia_conta_id FOREIGN KEY (pendencia_conta_id) REFERENCES pendencia_conta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_etapa_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE conta_hospitalar_franquia
  ADD CONSTRAINT fk_conta_hospitalar_franquia_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_franquia_franquia_contrato_id FOREIGN KEY (franquia_contrato_id) REFERENCES franquia_contrato (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_franquia_regra_desconto_volume_id FOREIGN KEY (regra_desconto_volume_id) REFERENCES regra_desconto_volume (id) ON DELETE RESTRICT;
ALTER TABLE conta_hospitalar_item
  ADD CONSTRAINT fk_conta_hospitalar_item_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_item_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_item_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_item_tipo_lancamento_id FOREIGN KEY (tipo_lancamento_id) REFERENCES tipo_lancamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_item_classificacao_despesa_id FOREIGN KEY (classificacao_despesa_id) REFERENCES classificacao_despesa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_item_origem_lancamento_id FOREIGN KEY (origem_lancamento_id) REFERENCES origem_lancamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_item_item_pai_id FOREIGN KEY (item_pai_id) REFERENCES conta_hospitalar_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_item_acrescimo_horario_especial_id FOREIGN KEY (acrescimo_horario_especial_id) REFERENCES acrescimo_horario_especial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_item_executante_profissional_id FOREIGN KEY (executante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_item_solicitante_profissional_id FOREIGN KEY (solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_item_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_item_produtor_setor_funcional_id FOREIGN KEY (produtor_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_item_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_item_via_acesso_termo_terminologia_id FOREIGN KEY (via_acesso_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_item_tecnica_termo_terminologia_id FOREIGN KEY (tecnica_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_item_guia_fonte_pagadora_id FOREIGN KEY (guia_fonte_pagadora_id) REFERENCES guia_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_item_guia_tiss_id FOREIGN KEY (guia_tiss_id) REFERENCES guia_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_item_conta_hospitalar_pacote_id FOREIGN KEY (conta_hospitalar_pacote_id) REFERENCES conta_hospitalar_pacote (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_item_kit_cobranca_id FOREIGN KEY (kit_cobranca_id) REFERENCES kit_cobranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_item_regra_lancamento_id FOREIGN KEY (regra_lancamento_id) REFERENCES regra_lancamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_item_movimento_estoque_id FOREIGN KEY (movimento_estoque_id) REFERENCES movimento_estoque (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_item_lote_insumo_id FOREIGN KEY (lote_insumo_id) REFERENCES lote_insumo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_item_empresa_fornecedora_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_item_motivo_glosa_id FOREIGN KEY (motivo_glosa_id) REFERENCES motivo_glosa (id) ON DELETE RESTRICT;
ALTER TABLE conta_hospitalar_item_autorizacao
  ADD CONSTRAINT fk_conta_hospitalar_item_autorizacao_conta_hospitalar_item_id FOREIGN KEY (conta_hospitalar_item_id) REFERENCES conta_hospitalar_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_item_autorizacao_resposta_autorizac_cc7b37b1 FOREIGN KEY (resposta_autorizacao_item_id) REFERENCES resposta_autorizacao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_item_autorizacao_guia_fonte_pagadora_id FOREIGN KEY (guia_fonte_pagadora_id) REFERENCES guia_fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE conta_hospitalar_item_memoria
  ADD CONSTRAINT fk_conta_hospitalar_item_memoria_conta_hospitalar_item_id FOREIGN KEY (conta_hospitalar_item_id) REFERENCES conta_hospitalar_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_item_memoria_tabela_preco_id FOREIGN KEY (tabela_preco_id) REFERENCES tabela_preco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_item_memoria_versao_tabela_preco_id FOREIGN KEY (versao_tabela_preco_id) REFERENCES versao_tabela_preco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_item_memoria_indice_cobranca_id FOREIGN KEY (indice_cobranca_id) REFERENCES indice_cobranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_item_memoria_regra_percentual_cobranca_id FOREIGN KEY (regra_percentual_cobranca_id) REFERENCES regra_percentual_cobranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_item_memoria_regra_lancamento_id FOREIGN KEY (regra_lancamento_id) REFERENCES regra_lancamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_item_memoria_acrescimo_horario_especial_id FOREIGN KEY (acrescimo_horario_especial_id) REFERENCES acrescimo_horario_especial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_item_memoria_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE conta_hospitalar_item_participante
  ADD CONSTRAINT fk_conta_hospitalar_item_participante_conta_hospitalar_item_id FOREIGN KEY (conta_hospitalar_item_id) REFERENCES conta_hospitalar_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_item_participante_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_item_participante_funcao_equipe_cobranca_id FOREIGN KEY (funcao_equipe_cobranca_id) REFERENCES funcao_equipe_cobranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_item_participante_grau_participacao_88a4f36a FOREIGN KEY (grau_participacao_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_item_participante_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_item_participante_recebedor_prestad_e6986b4b FOREIGN KEY (recebedor_prestador_terceiro_id) REFERENCES prestador_terceiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_item_participante_guia_tiss_id FOREIGN KEY (guia_tiss_id) REFERENCES guia_tiss (id) ON DELETE RESTRICT;
ALTER TABLE conta_hospitalar_pacote
  ADD CONSTRAINT fk_conta_hospitalar_pacote_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_pacote_pacote_id FOREIGN KEY (pacote_id) REFERENCES pacote (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_pacote_pacote_versao_id FOREIGN KEY (pacote_versao_id) REFERENCES pacote_versao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_pacote_descaracterizacao_pacote_id FOREIGN KEY (descaracterizacao_pacote_id) REFERENCES descaracterizacao_pacote (id) ON DELETE RESTRICT;
ALTER TABLE conta_hospitalar_periodo
  ADD CONSTRAINT fk_conta_hospitalar_periodo_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_periodo_tipo_lancamento_id FOREIGN KEY (tipo_lancamento_id) REFERENCES tipo_lancamento (id) ON DELETE RESTRICT;
ALTER TABLE conta_hospitalar_segurado
  ADD CONSTRAINT fk_conta_hospitalar_segurado_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_segurado_cobertura_paciente_id FOREIGN KEY (cobertura_paciente_id) REFERENCES cobertura_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_conta_hospitalar_segurado_titular_cobertura_id FOREIGN KEY (titular_cobertura_id) REFERENCES titular_cobertura (id) ON DELETE RESTRICT;
