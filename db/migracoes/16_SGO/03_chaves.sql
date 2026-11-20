-- Módulo SGO (operadora de plano de saúde), lote 03: chaves estrangeiras (aplicadas depois de todos os tabelas.sql).

ALTER TABLE credito_fatura_plano
  ADD CONSTRAINT fk_credito_fatura_plano_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_credito_fatura_plano_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_credito_fatura_plano_fatura_origem_fatura_plano_id FOREIGN KEY (fatura_origem_fatura_plano_id) REFERENCES fatura_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_credito_fatura_plano_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE credito_fatura_plano_baixa
  ADD CONSTRAINT fk_credito_fatura_plano_baixa_credito_fatura_plano_id FOREIGN KEY (credito_fatura_plano_id) REFERENCES credito_fatura_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_credito_fatura_plano_baixa_fatura_plano_id FOREIGN KEY (fatura_plano_id) REFERENCES fatura_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_credito_fatura_plano_baixa_titulo_receber_id FOREIGN KEY (titulo_receber_id) REFERENCES titulo_receber (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_credito_fatura_plano_baixa_estornado_por_usuario_id FOREIGN KEY (estornado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE criterio_elegibilidade_programa
  ADD CONSTRAINT fk_criterio_elegibilidade_programa_programa_saude_id FOREIGN KEY (programa_saude_id) REFERENCES programa_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_criterio_elegibilidade_programa_termo_terminologia_id FOREIGN KEY (termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_criterio_elegibilidade_programa_grupo_patologia_id FOREIGN KEY (grupo_patologia_id) REFERENCES grupo_patologia (id) ON DELETE RESTRICT;
ALTER TABLE critica_autorizacao
  ADD CONSTRAINT fk_critica_autorizacao_motivo_glosa_id FOREIGN KEY (motivo_glosa_id) REFERENCES motivo_glosa (id) ON DELETE RESTRICT;
ALTER TABLE critica_conta_recebida
  ADD CONSTRAINT fk_critica_conta_recebida_guia_conta_recebida_id FOREIGN KEY (guia_conta_recebida_id) REFERENCES guia_conta_recebida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_critica_conta_recebida_guia_conta_recebida_item_id FOREIGN KEY (guia_conta_recebida_item_id) REFERENCES guia_conta_recebida_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_critica_conta_recebida_regra_critica_conta_id FOREIGN KEY (regra_critica_conta_id) REFERENCES regra_critica_conta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_critica_conta_recebida_motivo_glosa_id FOREIGN KEY (motivo_glosa_id) REFERENCES motivo_glosa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_critica_conta_recebida_liberada_por_usuario_id FOREIGN KEY (liberada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE critica_fechamento_competencia_plano
  ADD CONSTRAINT fk_critica_fechamento_competencia_plano_provisao_tecnica__e30d4f FOREIGN KEY (provisao_tecnica_competencia_id) REFERENCES provisao_tecnica_competencia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_critica_fechamento_competencia_plano_fatura_plano_id FOREIGN KEY (fatura_plano_id) REFERENCES fatura_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_critica_fechamento_competencia_plano_resolvida_por_usuario_id FOREIGN KEY (resolvida_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE critica_pedido_autorizacao
  ADD CONSTRAINT fk_critica_pedido_autorizacao_pedido_autorizacao_plano_id FOREIGN KEY (pedido_autorizacao_plano_id) REFERENCES pedido_autorizacao_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_critica_pedido_autorizacao_pedido_autorizacao_plano_item_id FOREIGN KEY (pedido_autorizacao_plano_item_id) REFERENCES pedido_autorizacao_plano_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_critica_pedido_autorizacao_critica_autorizacao_id FOREIGN KEY (critica_autorizacao_id) REFERENCES critica_autorizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_critica_pedido_autorizacao_motivo_glosa_id FOREIGN KEY (motivo_glosa_id) REFERENCES motivo_glosa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_critica_pedido_autorizacao_auditor_plano_id FOREIGN KEY (auditor_plano_id) REFERENCES auditor_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_critica_pedido_autorizacao_liberada_por_usuario_id FOREIGN KEY (liberada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE critica_pedido_reembolso
  ADD CONSTRAINT fk_critica_pedido_reembolso_pedido_reembolso_id FOREIGN KEY (pedido_reembolso_id) REFERENCES pedido_reembolso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_critica_pedido_reembolso_pedido_reembolso_item_id FOREIGN KEY (pedido_reembolso_item_id) REFERENCES pedido_reembolso_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_critica_pedido_reembolso_motivo_glosa_id FOREIGN KEY (motivo_glosa_id) REFERENCES motivo_glosa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_critica_pedido_reembolso_liberada_por_usuario_id FOREIGN KEY (liberada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE critica_recurso_glosa
  ADD CONSTRAINT fk_critica_recurso_glosa_recurso_glosa_recebido_id FOREIGN KEY (recurso_glosa_recebido_id) REFERENCES recurso_glosa_recebido (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_critica_recurso_glosa_recurso_glosa_recebido_item_id FOREIGN KEY (recurso_glosa_recebido_item_id) REFERENCES recurso_glosa_recebido_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_critica_recurso_glosa_guia_conta_recebida_id FOREIGN KEY (guia_conta_recebida_id) REFERENCES guia_conta_recebida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_critica_recurso_glosa_motivo_glosa_id FOREIGN KEY (motivo_glosa_id) REFERENCES motivo_glosa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_critica_recurso_glosa_liberada_por_usuario_id FOREIGN KEY (liberada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE decisao_auditoria_medica
  ADD CONSTRAINT fk_decisao_auditoria_medica_pedido_autorizacao_plano_id FOREIGN KEY (pedido_autorizacao_plano_id) REFERENCES pedido_autorizacao_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_decisao_auditoria_medica_pedido_autorizacao_plano_item_id FOREIGN KEY (pedido_autorizacao_plano_item_id) REFERENCES pedido_autorizacao_plano_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_decisao_auditoria_medica_auditor_plano_id FOREIGN KEY (auditor_plano_id) REFERENCES auditor_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_decisao_auditoria_medica_motivo_decisao_autorizacao_id FOREIGN KEY (motivo_decisao_autorizacao_id) REFERENCES motivo_decisao_autorizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_decisao_auditoria_medica_motivo_glosa_id FOREIGN KEY (motivo_glosa_id) REFERENCES motivo_glosa (id) ON DELETE RESTRICT;
ALTER TABLE declaracao_saude
  ADD CONSTRAINT fk_declaracao_saude_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_saude_proposta_adesao_id FOREIGN KEY (proposta_adesao_id) REFERENCES proposta_adesao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_saude_proposta_adesao_beneficiario_id FOREIGN KEY (proposta_adesao_beneficiario_id) REFERENCES proposta_adesao_beneficiario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_saude_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_saude_modelo_questionario_saude_id FOREIGN KEY (modelo_questionario_saude_id) REFERENCES modelo_questionario_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_saude_medico_orientador_profissional_id FOREIGN KEY (medico_orientador_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_saude_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_saude_analisada_por_usuario_id FOREIGN KEY (analisada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE declaracao_saude_resposta
  ADD CONSTRAINT fk_declaracao_saude_resposta_declaracao_saude_id FOREIGN KEY (declaracao_saude_id) REFERENCES declaracao_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_saude_resposta_modelo_questionario_saude_pe_9d7cff FOREIGN KEY (modelo_questionario_saude_pergunta_id) REFERENCES modelo_questionario_saude_pergunta (id) ON DELETE RESTRICT;
ALTER TABLE declaracao_servicos_medicos
  ADD CONSTRAINT fk_declaracao_servicos_medicos_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_servicos_medicos_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_servicos_medicos_retificada_declaracao_serv_00b31c FOREIGN KEY (retificada_declaracao_servicos_medicos_id) REFERENCES declaracao_servicos_medicos (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_servicos_medicos_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE declaracao_servicos_medicos_item
  ADD CONSTRAINT fk_declaracao_servicos_medicos_item_declaracao_servicos_m_ca1b2f FOREIGN KEY (declaracao_servicos_medicos_id) REFERENCES declaracao_servicos_medicos (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_servicos_medicos_item_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_declaracao_servicos_medicos_item_titular_beneficiario__4999cd FOREIGN KEY (titular_beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT;
ALTER TABLE demanda_nip
  ADD CONSTRAINT fk_demanda_nip_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demanda_nip_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demanda_nip_protocolo_beneficiario_id FOREIGN KEY (protocolo_beneficiario_id) REFERENCES protocolo_beneficiario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demanda_nip_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demanda_nip_pedido_autorizacao_plano_id FOREIGN KEY (pedido_autorizacao_plano_id) REFERENCES pedido_autorizacao_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demanda_nip_departamento_operadora_id FOREIGN KEY (departamento_operadora_id) REFERENCES departamento_operadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demanda_nip_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE demanda_nip_andamento
  ADD CONSTRAINT fk_demanda_nip_andamento_demanda_nip_id FOREIGN KEY (demanda_nip_id) REFERENCES demanda_nip (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demanda_nip_andamento_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demanda_nip_andamento_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE demonstrativo_analise_emitido
  ADD CONSTRAINT fk_demonstrativo_analise_emitido_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demonstrativo_analise_emitido_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demonstrativo_analise_emitido_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demonstrativo_analise_emitido_lote_conta_recebida_id FOREIGN KEY (lote_conta_recebida_id) REFERENCES lote_conta_recebida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demonstrativo_analise_emitido_termo_versao_tiss_id FOREIGN KEY (termo_versao_tiss_id) REFERENCES termo_versao_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demonstrativo_analise_emitido_troca_tiss_operadora_id FOREIGN KEY (troca_tiss_operadora_id) REFERENCES troca_tiss_operadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demonstrativo_analise_emitido_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE demonstrativo_pagamento_emitido
  ADD CONSTRAINT fk_demonstrativo_pagamento_emitido_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demonstrativo_pagamento_emitido_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demonstrativo_pagamento_emitido_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demonstrativo_pagamento_emitido_lote_pagamento_rede_id FOREIGN KEY (lote_pagamento_rede_id) REFERENCES lote_pagamento_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demonstrativo_pagamento_emitido_termo_versao_tiss_id FOREIGN KEY (termo_versao_tiss_id) REFERENCES termo_versao_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demonstrativo_pagamento_emitido_troca_tiss_operadora_id FOREIGN KEY (troca_tiss_operadora_id) REFERENCES troca_tiss_operadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demonstrativo_pagamento_emitido_banco_id FOREIGN KEY (banco_id) REFERENCES banco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demonstrativo_pagamento_emitido_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE demonstrativo_pagamento_emitido_item
  ADD CONSTRAINT fk_demonstrativo_pagamento_emitido_item_demonstrativo_pag_c67b28 FOREIGN KEY (demonstrativo_pagamento_emitido_id) REFERENCES demonstrativo_pagamento_emitido (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demonstrativo_pagamento_emitido_item_lote_conta_recebida_id FOREIGN KEY (lote_conta_recebida_id) REFERENCES lote_conta_recebida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_demonstrativo_pagamento_emitido_item_termo_terminologia_id FOREIGN KEY (termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE departamento_operadora
  ADD CONSTRAINT fk_departamento_operadora_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_departamento_operadora_superior_departamento_operadora_id FOREIGN KEY (superior_departamento_operadora_id) REFERENCES departamento_operadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_departamento_operadora_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_departamento_operadora_superior_usuario_id FOREIGN KEY (superior_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE descredenciamento_prestador
  ADD CONSTRAINT fk_descredenciamento_prestador_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_descredenciamento_prestador_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_descredenciamento_prestador_local_atendimento_rede_id FOREIGN KEY (local_atendimento_rede_id) REFERENCES local_atendimento_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_descredenciamento_prestador_substituto_prestador_rede_id FOREIGN KEY (substituto_prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_descredenciamento_prestador_cancelado_por_usuario_id FOREIGN KEY (cancelado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_descredenciamento_prestador_reincluido_por_usuario_id FOREIGN KEY (reincluido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE diretriz_utilizacao_ans
  ADD CONSTRAINT fk_diretriz_utilizacao_ans_rol_procedimento_ans_id FOREIGN KEY (rol_procedimento_ans_id) REFERENCES rol_procedimento_ans (id) ON DELETE RESTRICT;
ALTER TABLE distribuicao_cobranca_terceiro
  ADD CONSTRAINT fk_distribuicao_cobranca_terceiro_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_distribuicao_cobranca_terceiro_escritorio_pessoa_juridica_id FOREIGN KEY (escritorio_pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_distribuicao_cobranca_terceiro_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE documento_emitido_operadora
  ADD CONSTRAINT fk_documento_emitido_operadora_modelo_arquivo_id FOREIGN KEY (modelo_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE doenca_preexistente_declarada
  ADD CONSTRAINT fk_doenca_preexistente_declarada_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_doenca_preexistente_declarada_declaracao_saude_id FOREIGN KEY (declaracao_saude_id) REFERENCES declaracao_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_doenca_preexistente_declarada_termo_terminologia_id FOREIGN KEY (termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_doenca_preexistente_declarada_grupo_patologia_id FOREIGN KEY (grupo_patologia_id) REFERENCES grupo_patologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_doenca_preexistente_declarada_cobertura_parcial_temporaria_id FOREIGN KEY (cobertura_parcial_temporaria_id) REFERENCES cobertura_parcial_temporaria (id) ON DELETE RESTRICT;
ALTER TABLE envio_ans
  ADD CONSTRAINT fk_envio_ans_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_ans_operadora_saude_id FOREIGN KEY (operadora_saude_id) REFERENCES operadora_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_ans_substituido_envio_ans_id FOREIGN KEY (substituido_envio_ans_id) REFERENCES envio_ans (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_ans_gerado_por_usuario_id FOREIGN KEY (gerado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_ans_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE envio_ans_item
  ADD CONSTRAINT fk_envio_ans_item_envio_ans_id FOREIGN KEY (envio_ans_id) REFERENCES envio_ans (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_ans_item_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_ans_item_guia_conta_recebida_id FOREIGN KEY (guia_conta_recebida_id) REFERENCES guia_conta_recebida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_ans_item_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_ans_item_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_ans_item_reajuste_contrato_plano_id FOREIGN KEY (reajuste_contrato_plano_id) REFERENCES reajuste_contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_ans_item_conta_contabil_id FOREIGN KEY (conta_contabil_id) REFERENCES conta_contabil (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_ans_item_quadro_economico_ans_id FOREIGN KEY (quadro_economico_ans_id) REFERENCES quadro_economico_ans (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_ans_item_item_assistencial_ans_id FOREIGN KEY (item_assistencial_ans_id) REFERENCES item_assistencial_ans (id) ON DELETE RESTRICT;
ALTER TABLE envio_ans_item_procedimento
  ADD CONSTRAINT fk_envio_ans_item_procedimento_envio_ans_item_id FOREIGN KEY (envio_ans_item_id) REFERENCES envio_ans_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_ans_item_procedimento_pacote_envio_ans_item_proc_2f7a1d FOREIGN KEY (pacote_envio_ans_item_procedimento_id) REFERENCES envio_ans_item_procedimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_ans_item_procedimento_guia_conta_recebida_item_id FOREIGN KEY (guia_conta_recebida_item_id) REFERENCES guia_conta_recebida_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_ans_item_procedimento_termo_terminologia_id FOREIGN KEY (termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE envio_ans_retorno
  ADD CONSTRAINT fk_envio_ans_retorno_envio_ans_id FOREIGN KEY (envio_ans_id) REFERENCES envio_ans (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_ans_retorno_envio_ans_item_id FOREIGN KEY (envio_ans_item_id) REFERENCES envio_ans_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_ans_retorno_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_ans_retorno_corrigido_por_usuario_id FOREIGN KEY (corrigido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_ans_retorno_reenvio_envio_ans_id FOREIGN KEY (reenvio_envio_ans_id) REFERENCES envio_ans (id) ON DELETE RESTRICT;
ALTER TABLE equipe_prestador_rede
  ADD CONSTRAINT fk_equipe_prestador_rede_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipe_prestador_rede_membro_prestador_rede_id FOREIGN KEY (membro_prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipe_prestador_rede_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipe_prestador_rede_local_atendimento_rede_id FOREIGN KEY (local_atendimento_rede_id) REFERENCES local_atendimento_rede (id) ON DELETE RESTRICT;
ALTER TABLE equipe_venda
  ADD CONSTRAINT fk_equipe_venda_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipe_venda_superior_equipe_venda_id FOREIGN KEY (superior_equipe_venda_id) REFERENCES equipe_venda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipe_venda_chefe_vendedor_plano_id FOREIGN KEY (chefe_vendedor_plano_id) REFERENCES vendedor_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipe_venda_corretora_venda_id FOREIGN KEY (corretora_venda_id) REFERENCES corretora_venda (id) ON DELETE RESTRICT;
ALTER TABLE equipe_venda_membro
  ADD CONSTRAINT fk_equipe_venda_membro_equipe_venda_id FOREIGN KEY (equipe_venda_id) REFERENCES equipe_venda (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipe_venda_membro_vendedor_plano_id FOREIGN KEY (vendedor_plano_id) REFERENCES vendedor_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equipe_venda_membro_papel_venda_id FOREIGN KEY (papel_venda_id) REFERENCES papel_venda (id) ON DELETE RESTRICT;
ALTER TABLE equivalencia_intercambio
  ADD CONSTRAINT fk_equivalencia_intercambio_operadora_congenere_id FOREIGN KEY (operadora_congenere_id) REFERENCES operadora_congenere (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equivalencia_intercambio_contrato_plano_id FOREIGN KEY (contrato_plano_id) REFERENCES contrato_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equivalencia_intercambio_produto_plano_id FOREIGN KEY (produto_plano_id) REFERENCES produto_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equivalencia_intercambio_produto_intercambio_id FOREIGN KEY (produto_intercambio_id) REFERENCES produto_intercambio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equivalencia_intercambio_tipo_lancamento_fatura_id FOREIGN KEY (tipo_lancamento_fatura_id) REFERENCES tipo_lancamento_fatura (id) ON DELETE RESTRICT;
ALTER TABLE equivalencia_item_prestador_rede
  ADD CONSTRAINT fk_equivalencia_item_prestador_rede_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equivalencia_item_prestador_rede_termo_terminologia_id FOREIGN KEY (termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE especialidade_atendida_rede
  ADD CONSTRAINT fk_especialidade_atendida_rede_prestador_rede_id FOREIGN KEY (prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_especialidade_atendida_rede_local_atendimento_rede_id FOREIGN KEY (local_atendimento_rede_id) REFERENCES local_atendimento_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_especialidade_atendida_rede_equipe_prestador_rede_id FOREIGN KEY (equipe_prestador_rede_id) REFERENCES equipe_prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_especialidade_atendida_rede_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_especialidade_atendida_rede_area_atuacao_medica_id FOREIGN KEY (area_atuacao_medica_id) REFERENCES area_atuacao_medica (id) ON DELETE RESTRICT;
ALTER TABLE etiqueta_autorizacao_plano
  ADD CONSTRAINT fk_etiqueta_autorizacao_plano_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_etiqueta_autorizacao_plano_tipo_etiqueta_autorizacao_id FOREIGN KEY (tipo_etiqueta_autorizacao_id) REFERENCES tipo_etiqueta_autorizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_etiqueta_autorizacao_plano_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_etiqueta_autorizacao_plano_indicado_prestador_rede_id FOREIGN KEY (indicado_prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_etiqueta_autorizacao_plano_utilizada_pedido_autorizaca_cae2ce FOREIGN KEY (utilizada_pedido_autorizacao_plano_id) REFERENCES pedido_autorizacao_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_etiqueta_autorizacao_plano_utilizada_prestador_rede_id FOREIGN KEY (utilizada_prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT;
ALTER TABLE execucao_autorizacao_item
  ADD CONSTRAINT fk_execucao_autorizacao_item_pedido_autorizacao_plano_item_id FOREIGN KEY (pedido_autorizacao_plano_item_id) REFERENCES pedido_autorizacao_plano_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_execucao_autorizacao_item_executor_prestador_rede_id FOREIGN KEY (executor_prestador_rede_id) REFERENCES prestador_rede (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_execucao_autorizacao_item_autorizador_usuario_id FOREIGN KEY (autorizador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_execucao_autorizacao_item_guia_conta_recebida_item_id FOREIGN KEY (guia_conta_recebida_item_id) REFERENCES guia_conta_recebida_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_execucao_autorizacao_item_cancelado_por_usuario_id FOREIGN KEY (cancelado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE faixa_etaria_modelo
  ADD CONSTRAINT fk_faixa_etaria_modelo_norma_regulatoria_id FOREIGN KEY (norma_regulatoria_id) REFERENCES norma_regulatoria (id) ON DELETE RESTRICT;
ALTER TABLE faixa_etaria_modelo_item
  ADD CONSTRAINT fk_faixa_etaria_modelo_item_faixa_etaria_modelo_id FOREIGN KEY (faixa_etaria_modelo_id) REFERENCES faixa_etaria_modelo (id) ON DELETE RESTRICT;
ALTER TABLE fatura_intercambio
  ADD CONSTRAINT fk_fatura_intercambio_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fatura_intercambio_operadora_congenere_id FOREIGN KEY (operadora_congenere_id) REFERENCES operadora_congenere (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fatura_intercambio_origem_fatura_intercambio_id FOREIGN KEY (origem_fatura_intercambio_id) REFERENCES fatura_intercambio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fatura_intercambio_fatura_plano_id FOREIGN KEY (fatura_plano_id) REFERENCES fatura_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fatura_intercambio_acordo_fatura_plano_id FOREIGN KEY (acordo_fatura_plano_id) REFERENCES fatura_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fatura_intercambio_titulo_receber_id FOREIGN KEY (titulo_receber_id) REFERENCES titulo_receber (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fatura_intercambio_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fatura_intercambio_cancelada_por_usuario_id FOREIGN KEY (cancelada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE fatura_intercambio_item
  ADD CONSTRAINT fk_fatura_intercambio_item_fatura_intercambio_id FOREIGN KEY (fatura_intercambio_id) REFERENCES fatura_intercambio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fatura_intercambio_item_beneficiario_intercambio_id FOREIGN KEY (beneficiario_intercambio_id) REFERENCES beneficiario_intercambio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fatura_intercambio_item_beneficiario_plano_id FOREIGN KEY (beneficiario_plano_id) REFERENCES beneficiario_plano (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fatura_intercambio_item_guia_conta_recebida_item_id FOREIGN KEY (guia_conta_recebida_item_id) REFERENCES guia_conta_recebida_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fatura_intercambio_item_termo_terminologia_id FOREIGN KEY (termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fatura_intercambio_item_cid_termo_terminologia_id FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
