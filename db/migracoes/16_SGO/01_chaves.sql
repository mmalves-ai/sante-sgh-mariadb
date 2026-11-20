-- Módulo SGO, lote 01: chaves estrangeiras (aplicadas depois de todos os tabelas.sql).
ALTER TABLE acao_judicial_beneficiario
  ADD CONSTRAINT fk_acao_judicial_beneficiario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acao_judicial_beneficiario_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acao_judicial_beneficiario_comarca_judicial_id FOREIGN KEY (comarca_judicial_id) REFERENCES comarca_judicial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acao_judicial_beneficiario_departamento_operadora_id FOREIGN KEY (departamento_operadora_id) REFERENCES departamento_operadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acao_judicial_beneficiario_alerta_operadora_id FOREIGN KEY (alerta_operadora_id) REFERENCES alerta_operadora (id) ON DELETE RESTRICT;
ALTER TABLE acao_judicial_beneficiario_andamento
  ADD CONSTRAINT fk_acao_judicial_beneficiario_andamento_acao_judicial_ben_f2a31d FOREIGN KEY (acao_judicial_beneficiario_id) REFERENCES acao_judicial_beneficiario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acao_judicial_beneficiario_andamento_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acao_judicial_beneficiario_andamento_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE acao_judicial_cobranca
  ADD CONSTRAINT fk_acao_judicial_cobranca_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acao_judicial_cobranca_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acao_judicial_cobranca_contratante_plano_id FOREIGN KEY (contratante_plano_id) REFERENCES contratante_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acao_judicial_cobranca_comarca_judicial_id FOREIGN KEY (comarca_judicial_id) REFERENCES comarca_judicial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acao_judicial_cobranca_acordo_inadimplencia_id FOREIGN KEY (acordo_inadimplencia_id) REFERENCES acordo_inadimplencia (id) ON DELETE RESTRICT;
ALTER TABLE acionista_operadora
  ADD CONSTRAINT fk_acionista_operadora_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acionista_operadora_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acionista_operadora_pessoa_juridica_id FOREIGN KEY (pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT;
ALTER TABLE acompanhamento_programa
  ADD CONSTRAINT fk_acompanhamento_programa_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acompanhamento_programa_participante_programa_id FOREIGN KEY (participante_programa_id) REFERENCES participante_programa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acompanhamento_programa_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acompanhamento_programa_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT;
ALTER TABLE acordo_inadimplencia
  ADD CONSTRAINT fk_acordo_inadimplencia_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acordo_inadimplencia_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acordo_inadimplencia_renegociacao_id FOREIGN KEY (renegociacao_id) REFERENCES renegociacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acordo_inadimplencia_protocolo_beneficiario_id FOREIGN KEY (protocolo_beneficiario_id) REFERENCES protocolo_beneficiario (id) ON DELETE RESTRICT;
ALTER TABLE acordo_inadimplencia_fatura
  ADD CONSTRAINT fk_acordo_inadimplencia_fatura_acordo_inadimplencia_id FOREIGN KEY (acordo_inadimplencia_id) REFERENCES acordo_inadimplencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acordo_inadimplencia_fatura_fatura_plano_id FOREIGN KEY (fatura_plano_id) REFERENCES fatura_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acordo_inadimplencia_fatura_fatura_plano_item_id FOREIGN KEY (fatura_plano_item_id) REFERENCES fatura_plano_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_acordo_inadimplencia_fatura_estornado_por_usuario_id FOREIGN KEY (estornado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE adiantamento_rede
  ADD CONSTRAINT fk_adiantamento_rede_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_adiantamento_rede_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_adiantamento_rede_titulo_pagar_id FOREIGN KEY (titulo_pagar_id) REFERENCES titulo_pagar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_adiantamento_rede_lote_pagamento_rede_id FOREIGN KEY (lote_pagamento_rede_id) REFERENCES lote_pagamento_rede (id) ON DELETE RESTRICT;
ALTER TABLE aditivo_contrato_plano
  ADD CONSTRAINT fk_aditivo_contrato_plano_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aditivo_contrato_plano_anterior_plano_comercializado_id FOREIGN KEY (anterior_plano_comercializado_id) REFERENCES plano_comercializado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aditivo_contrato_plano_novo_plano_comercializado_id FOREIGN KEY (novo_plano_comercializado_id) REFERENCES plano_comercializado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aditivo_contrato_plano_motivo_cancelamento_contrato_id FOREIGN KEY (motivo_cancelamento_contrato_id) REFERENCES motivo_cancelamento_contrato (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aditivo_contrato_plano_norma_regulatoria_id FOREIGN KEY (norma_regulatoria_id) REFERENCES norma_regulatoria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aditivo_contrato_plano_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE agenda_comercial
  ADD CONSTRAINT fk_agenda_comercial_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agenda_comercial_tipo_compromisso_operadora_id FOREIGN KEY (tipo_compromisso_operadora_id) REFERENCES tipo_compromisso_operadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agenda_comercial_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agenda_comercial_vendedor_plano_id FOREIGN KEY (vendedor_plano_id) REFERENCES vendedor_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agenda_comercial_carteira_contrato_plano_id FOREIGN KEY (carteira_contrato_plano_id) REFERENCES carteira_contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agenda_comercial_contratante_plano_id FOREIGN KEY (contratante_plano_id) REFERENCES contratante_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agenda_comercial_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT;
ALTER TABLE agenda_comercial_material
  ADD CONSTRAINT fk_agenda_comercial_material_agenda_comercial_id FOREIGN KEY (agenda_comercial_id) REFERENCES agenda_comercial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agenda_comercial_material_material_divulgacao_id FOREIGN KEY (material_divulgacao_id) REFERENCES material_divulgacao (id) ON DELETE RESTRICT;
ALTER TABLE agrupamento_procedimento_item
  ADD CONSTRAINT fk_agrupamento_procedimento_item_agrupamento_procedimento_id FOREIGN KEY (agrupamento_procedimento_id) REFERENCES agrupamento_procedimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agrupamento_procedimento_item_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE agrupamento_reajuste_coletivo
  ADD CONSTRAINT fk_agrupamento_reajuste_coletivo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agrupamento_reajuste_coletivo_reajuste_contrato_plano_id FOREIGN KEY (reajuste_contrato_plano_id) REFERENCES reajuste_contrato_plano (id) ON DELETE RESTRICT;
ALTER TABLE agrupamento_reajuste_contrato
  ADD CONSTRAINT fk_agrupamento_reajuste_contrato_agrupamento_reajuste_col_bbc28a FOREIGN KEY (agrupamento_reajuste_coletivo_id) REFERENCES agrupamento_reajuste_coletivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agrupamento_reajuste_contrato_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT;
ALTER TABLE alcada_autorizador_plano
  ADD CONSTRAINT fk_alcada_autorizador_plano_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alcada_autorizador_plano_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alcada_autorizador_plano_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alcada_autorizador_plano_superior_alcada_autorizador_plano_id FOREIGN KEY (superior_alcada_autorizador_plano_id) REFERENCES alcada_autorizador_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alcada_autorizador_plano_departamento_operadora_id FOREIGN KEY (departamento_operadora_id) REFERENCES departamento_operadora (id) ON DELETE RESTRICT;
ALTER TABLE alerta_operadora
  ADD CONSTRAINT fk_alerta_operadora_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alerta_operadora_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alerta_operadora_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alerta_operadora_contratante_plano_id FOREIGN KEY (contratante_plano_id) REFERENCES contratante_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alerta_operadora_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alerta_operadora_motivo_contato_beneficiario_id FOREIGN KEY (motivo_contato_beneficiario_id) REFERENCES motivo_contato_beneficiario (id) ON DELETE RESTRICT;
ALTER TABLE alerta_operadora_departamento
  ADD CONSTRAINT fk_alerta_operadora_departamento_alerta_operadora_id FOREIGN KEY (alerta_operadora_id) REFERENCES alerta_operadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alerta_operadora_departamento_departamento_operadora_id FOREIGN KEY (departamento_operadora_id) REFERENCES departamento_operadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alerta_operadora_departamento_acao_judicial_beneficiario_id FOREIGN KEY (acao_judicial_beneficiario_id) REFERENCES acao_judicial_beneficiario (id) ON DELETE RESTRICT;
ALTER TABLE alteracao_vencimento_contrato
  ADD CONSTRAINT fk_alteracao_vencimento_contrato_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alteracao_vencimento_contrato_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alteracao_vencimento_contrato_fatura_plano_item_id FOREIGN KEY (fatura_plano_item_id) REFERENCES fatura_plano_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alteracao_vencimento_contrato_cancelado_por_usuario_id FOREIGN KEY (cancelado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE apuracao_ato_cooperativo
  ADD CONSTRAINT fk_apuracao_ato_cooperativo_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_ato_cooperativo_fechado_por_usuario_id FOREIGN KEY (fechado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE apuracao_fator_custeio
  ADD CONSTRAINT fk_apuracao_fator_custeio_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_fator_custeio_fechado_por_usuario_id FOREIGN KEY (fechado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE apuracao_taxa_saude_suplementar
  ADD CONSTRAINT fk_apuracao_taxa_saude_suplementar_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_taxa_saude_suplementar_plano_comercializado_id FOREIGN KEY (plano_comercializado_id) REFERENCES plano_comercializado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_taxa_saude_suplementar_guia_recolhimento_id FOREIGN KEY (guia_recolhimento_id) REFERENCES guia_recolhimento (id) ON DELETE RESTRICT;
ALTER TABLE area_abrangencia_produto
  ADD CONSTRAINT fk_area_abrangencia_produto_produto_plano_id FOREIGN KEY (produto_plano_id) REFERENCES produto_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_area_abrangencia_produto_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_area_abrangencia_produto_unidade_federativa_id FOREIGN KEY (unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT;
ALTER TABLE area_atuacao_operadora
  ADD CONSTRAINT fk_area_atuacao_operadora_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_area_atuacao_operadora_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT;
ALTER TABLE arquivo_enviado_prestador
  ADD CONSTRAINT fk_arquivo_enviado_prestador_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_arquivo_enviado_prestador_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_arquivo_enviado_prestador_conta_portal_prestador_id FOREIGN KEY (conta_portal_prestador_id) REFERENCES conta_portal_prestador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_arquivo_enviado_prestador_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_arquivo_enviado_prestador_lote_conta_recebida_id FOREIGN KEY (lote_conta_recebida_id) REFERENCES lote_conta_recebida (id) ON DELETE RESTRICT;
ALTER TABLE ativo_garantidor_operadora
  ADD CONSTRAINT fk_ativo_garantidor_operadora_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ativo_garantidor_operadora_tipo_ativo_garantidor_id FOREIGN KEY (tipo_ativo_garantidor_id) REFERENCES tipo_ativo_garantidor (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ativo_garantidor_operadora_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT;
ALTER TABLE auditor_plano
  ADD CONSTRAINT fk_auditor_plano_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditor_plano_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditor_plano_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditor_plano_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditor_plano_alcada_autorizador_plano_id FOREIGN KEY (alcada_autorizador_plano_id) REFERENCES alcada_autorizador_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditor_plano_empresa_auditoria_externa_id FOREIGN KEY (empresa_auditoria_externa_id) REFERENCES empresa_auditoria_externa (id) ON DELETE RESTRICT;
ALTER TABLE auditoria_conta_recebida
  ADD CONSTRAINT fk_auditoria_conta_recebida_guia_conta_recebida_id FOREIGN KEY (guia_conta_recebida_id) REFERENCES guia_conta_recebida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_conta_recebida_guia_conta_recebida_item_id FOREIGN KEY (guia_conta_recebida_item_id) REFERENCES guia_conta_recebida_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_conta_recebida_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_conta_recebida_motivo_auditoria_id FOREIGN KEY (motivo_auditoria_id) REFERENCES motivo_auditoria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_conta_recebida_motivo_glosa_id FOREIGN KEY (motivo_glosa_id) REFERENCES motivo_glosa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_conta_recebida_auditor_plano_id FOREIGN KEY (auditor_plano_id) REFERENCES auditor_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_auditoria_conta_recebida_liberado_por_usuario_id FOREIGN KEY (liberado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE autorizacao_intercambio
  ADD CONSTRAINT fk_autorizacao_intercambio_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_intercambio_operadora_congenere_id FOREIGN KEY (operadora_congenere_id) REFERENCES operadora_congenere (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_intercambio_beneficiario_intercambio_id FOREIGN KEY (beneficiario_intercambio_id) REFERENCES beneficiario_intercambio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_intercambio_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_intercambio_tipo_acomodacao_plano_id FOREIGN KEY (tipo_acomodacao_plano_id) REFERENCES tipo_acomodacao_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_intercambio_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_intercambio_solicitante_profissional_id FOREIGN KEY (solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_intercambio_pedido_autorizacao_plano_id FOREIGN KEY (pedido_autorizacao_plano_id) REFERENCES pedido_autorizacao_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_autorizacao_intercambio_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT;
ALTER TABLE avaliacao_protocolo_beneficiario
  ADD CONSTRAINT fk_avaliacao_protocolo_beneficiario_protocolo_beneficiario_id FOREIGN KEY (protocolo_beneficiario_id) REFERENCES protocolo_beneficiario (id) ON DELETE RESTRICT;
ALTER TABLE avaliacao_risco_participante
  ADD CONSTRAINT fk_avaliacao_risco_participante_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_risco_participante_participante_programa_id FOREIGN KEY (participante_programa_id) REFERENCES participante_programa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_risco_participante_modelo_questionario_saude_id FOREIGN KEY (modelo_questionario_saude_id) REFERENCES modelo_questionario_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_risco_participante_aplicador_profissional_id FOREIGN KEY (aplicador_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_risco_participante_grupo_risco_saude_id FOREIGN KEY (grupo_risco_saude_id) REFERENCES grupo_risco_saude (id) ON DELETE RESTRICT;
ALTER TABLE avaliacao_risco_participante_resposta
  ADD CONSTRAINT fk_avaliacao_risco_participante_resposta_avaliacao_risco__d40d91 FOREIGN KEY (avaliacao_risco_participante_id) REFERENCES avaliacao_risco_participante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_avaliacao_risco_participante_resposta_modelo_questiona_a53d75 FOREIGN KEY (modelo_questionario_saude_pergunta_id) REFERENCES modelo_questionario_saude_pergunta (id) ON DELETE RESTRICT;
ALTER TABLE aviso_atendimento_intercambio
  ADD CONSTRAINT fk_aviso_atendimento_intercambio_lote_atendimento_reciproco_id FOREIGN KEY (lote_atendimento_reciproco_id) REFERENCES lote_atendimento_reciproco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aviso_atendimento_intercambio_origem_operadora_congenere_id FOREIGN KEY (origem_operadora_congenere_id) REFERENCES operadora_congenere (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aviso_atendimento_intercambio_destino_operadora_congenere_id FOREIGN KEY (destino_operadora_congenere_id) REFERENCES operadora_congenere (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aviso_atendimento_intercambio_beneficiario_intercambio_id FOREIGN KEY (beneficiario_intercambio_id) REFERENCES beneficiario_intercambio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aviso_atendimento_intercambio_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aviso_atendimento_intercambio_guia_conta_recebida_id FOREIGN KEY (guia_conta_recebida_id) REFERENCES guia_conta_recebida (id) ON DELETE RESTRICT;
ALTER TABLE aviso_portal_prestador
  ADD CONSTRAINT fk_aviso_portal_prestador_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aviso_portal_prestador_tipo_prestador_rede_id FOREIGN KEY (tipo_prestador_rede_id) REFERENCES tipo_prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aviso_portal_prestador_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aviso_portal_prestador_imagem_arquivo_id FOREIGN KEY (imagem_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aviso_portal_prestador_documento_arquivo_id FOREIGN KEY (documento_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE beneficiario_intercambio
  ADD CONSTRAINT fk_beneficiario_intercambio_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_beneficiario_intercambio_operadora_congenere_id FOREIGN KEY (operadora_congenere_id) REFERENCES operadora_congenere (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_beneficiario_intercambio_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_beneficiario_intercambio_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_beneficiario_intercambio_municipio_ibge_id FOREIGN KEY (municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_beneficiario_intercambio_tipo_acomodacao_plano_id FOREIGN KEY (tipo_acomodacao_plano_id) REFERENCES tipo_acomodacao_plano (id) ON DELETE RESTRICT;
ALTER TABLE beneficiario_plano
  ADD CONSTRAINT fk_beneficiario_plano_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_beneficiario_plano_plano_comercializado_id FOREIGN KEY (plano_comercializado_id) REFERENCES plano_comercializado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_beneficiario_plano_pessoa_fisica_id FOREIGN KEY (pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_beneficiario_plano_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_beneficiario_plano_titular_beneficiario_plano_id FOREIGN KEY (titular_beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_beneficiario_plano_grau_parentesco_dependente_id FOREIGN KEY (grau_parentesco_dependente_id) REFERENCES grau_parentesco_dependente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_beneficiario_plano_classe_beneficiario_plano_id FOREIGN KEY (classe_beneficiario_plano_id) REFERENCES classe_beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_beneficiario_plano_motivo_movimento_cadastral_id FOREIGN KEY (motivo_movimento_cadastral_id) REFERENCES motivo_movimento_cadastral (id) ON DELETE RESTRICT;
ALTER TABLE beneficiario_plano_observacao
  ADD CONSTRAINT fk_beneficiario_plano_observacao_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_beneficiario_plano_observacao_tipo_observacao_operadora_id FOREIGN KEY (tipo_observacao_operadora_id) REFERENCES tipo_observacao_operadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_beneficiario_plano_observacao_autor_usuario_id FOREIGN KEY (autor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE bonificacao_programa
  ADD CONSTRAINT fk_bonificacao_programa_programa_saude_id FOREIGN KEY (programa_saude_id) REFERENCES programa_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bonificacao_programa_tipo_lancamento_fatura_id FOREIGN KEY (tipo_lancamento_fatura_id) REFERENCES tipo_lancamento_fatura (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_bonificacao_programa_norma_regulatoria_id FOREIGN KEY (norma_regulatoria_id) REFERENCES norma_regulatoria (id) ON DELETE RESTRICT;
ALTER TABLE calendario_compensacao_intercambio
  ADD CONSTRAINT fk_calendario_compensacao_intercambio_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_calendario_compensacao_intercambio_camara_operadora_co_dcdb6e FOREIGN KEY (camara_operadora_congenere_id) REFERENCES operadora_congenere (id) ON DELETE RESTRICT;
ALTER TABLE calendario_compensacao_intercambio_item
  ADD CONSTRAINT fk_calendario_compensacao_intercambio_item_calendario_com_53cc2b FOREIGN KEY (calendario_compensacao_intercambio_id) REFERENCES calendario_compensacao_intercambio (id) ON DELETE RESTRICT;
ALTER TABLE calendario_pagamento_rede
  ADD CONSTRAINT fk_calendario_pagamento_rede_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_calendario_pagamento_rede_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT;
ALTER TABLE campanha_comercial_plano
  ADD CONSTRAINT fk_campanha_comercial_plano_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_campanha_comercial_plano_regra_comissao_venda_id FOREIGN KEY (regra_comissao_venda_id) REFERENCES regra_comissao_venda (id) ON DELETE RESTRICT;
ALTER TABLE campanha_venda_desconto
  ADD CONSTRAINT fk_campanha_venda_desconto_campanha_comercial_plano_id FOREIGN KEY (campanha_comercial_plano_id) REFERENCES campanha_comercial_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_campanha_venda_desconto_plano_comercializado_id FOREIGN KEY (plano_comercializado_id) REFERENCES plano_comercializado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_campanha_venda_desconto_faixa_etaria_modelo_item_id FOREIGN KEY (faixa_etaria_modelo_item_id) REFERENCES faixa_etaria_modelo_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_campanha_venda_desconto_tipo_lancamento_fatura_id FOREIGN KEY (tipo_lancamento_fatura_id) REFERENCES tipo_lancamento_fatura (id) ON DELETE RESTRICT;
