-- Chaves do FAT, lote 06 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE regra_lancamento
  ADD CONSTRAINT fk_regra_lancamento_gatilho_item_faturavel_id FOREIGN KEY (gatilho_item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_lancamento_gatilho_grupo_faturamento_id FOREIGN KEY (gatilho_grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT;
ALTER TABLE regra_lancamento_excecao
  ADD CONSTRAINT fk_regra_lancamento_excecao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_lancamento_excecao_regra_lancamento_id FOREIGN KEY (regra_lancamento_id) REFERENCES regra_lancamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_lancamento_excecao_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_lancamento_excecao_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_lancamento_excecao_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_lancamento_excecao_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_lancamento_excecao_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_lancamento_excecao_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT;
ALTER TABLE regra_lancamento_item
  ADD CONSTRAINT fk_regra_lancamento_item_regra_lancamento_id FOREIGN KEY (regra_lancamento_id) REFERENCES regra_lancamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_lancamento_item_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_lancamento_item_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_lancamento_item_tabela_preco_id FOREIGN KEY (tabela_preco_id) REFERENCES tabela_preco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_lancamento_item_executante_profissional_id FOREIGN KEY (executante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_lancamento_item_funcao_equipe_cobranca_id FOREIGN KEY (funcao_equipe_cobranca_id) REFERENCES funcao_equipe_cobranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_lancamento_item_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE regra_montagem_guia
  ADD CONSTRAINT fk_regra_montagem_guia_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_montagem_guia_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_montagem_guia_local_atendimento_id FOREIGN KEY (local_atendimento_id) REFERENCES local_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_montagem_guia_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_montagem_guia_versao_padrao_tiss_id FOREIGN KEY (versao_padrao_tiss_id) REFERENCES versao_padrao_tiss (id) ON DELETE RESTRICT;
ALTER TABLE regra_montagem_guia_tipo
  ADD CONSTRAINT fk_regra_montagem_guia_tipo_regra_montagem_guia_id FOREIGN KEY (regra_montagem_guia_id) REFERENCES regra_montagem_guia (id) ON DELETE RESTRICT;
ALTER TABLE regra_percentual_cobranca
  ADD CONSTRAINT fk_regra_percentual_cobranca_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_percentual_cobranca_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_percentual_cobranca_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_percentual_cobranca_contrato_fonte_pagadora_id FOREIGN KEY (contrato_fonte_pagadora_id) REFERENCES contrato_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_percentual_cobranca_tabela_preco_id FOREIGN KEY (tabela_preco_id) REFERENCES tabela_preco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_percentual_cobranca_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_percentual_cobranca_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_percentual_cobranca_funcao_equipe_cobranca_id FOREIGN KEY (funcao_equipe_cobranca_id) REFERENCES funcao_equipe_cobranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_percentual_cobranca_tipo_conta_id FOREIGN KEY (tipo_conta_id) REFERENCES tipo_conta (id) ON DELETE RESTRICT;
ALTER TABLE regra_rateio_repasse
  ADD CONSTRAINT fk_regra_rateio_repasse_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_rateio_repasse_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_rateio_repasse_prestador_terceiro_id FOREIGN KEY (prestador_terceiro_id) REFERENCES prestador_terceiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_rateio_repasse_grupo_repasse_id FOREIGN KEY (grupo_repasse_id) REFERENCES grupo_repasse (id) ON DELETE RESTRICT;
ALTER TABLE regra_rateio_repasse_setor
  ADD CONSTRAINT fk_regra_rateio_repasse_setor_regra_rateio_repasse_id FOREIGN KEY (regra_rateio_repasse_id) REFERENCES regra_rateio_repasse (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_rateio_repasse_setor_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_rateio_repasse_setor_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_rateio_repasse_setor_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE regra_repasse
  ADD CONSTRAINT fk_regra_repasse_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_evento_repasse_id FOREIGN KEY (evento_repasse_id) REFERENCES evento_repasse (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_grupo_repasse_id FOREIGN KEY (grupo_repasse_id) REFERENCES grupo_repasse (id) ON DELETE RESTRICT;
ALTER TABLE regra_repasse_item
  ADD CONSTRAINT fk_regra_repasse_item_regra_repasse_id FOREIGN KEY (regra_repasse_id) REFERENCES regra_repasse (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_item_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_item_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_item_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_item_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_item_subgrupo_faturamento_id FOREIGN KEY (subgrupo_faturamento_id) REFERENCES subgrupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_item_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_item_funcao_equipe_cobranca_id FOREIGN KEY (funcao_equipe_cobranca_id) REFERENCES funcao_equipe_cobranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_item_local_atendimento_id FOREIGN KEY (local_atendimento_id) REFERENCES local_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_item_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_item_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_item_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_item_cooperativa_medica_id FOREIGN KEY (cooperativa_medica_id) REFERENCES cooperativa_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_item_tipo_lancamento_id FOREIGN KEY (tipo_lancamento_id) REFERENCES tipo_lancamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_item_acomodacao_id FOREIGN KEY (acomodacao_id) REFERENCES acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_item_evento_repasse_id FOREIGN KEY (evento_repasse_id) REFERENCES evento_repasse (id) ON DELETE RESTRICT;
ALTER TABLE regra_repasse_minimo_garantido
  ADD CONSTRAINT fk_regra_repasse_minimo_garantido_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_minimo_garantido_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_minimo_garantido_evento_repasse_id FOREIGN KEY (evento_repasse_id) REFERENCES evento_repasse (id) ON DELETE RESTRICT;
ALTER TABLE regra_repasse_plantao
  ADD CONSTRAINT fk_regra_repasse_plantao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_plantao_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_plantao_grupo_setor_plantao_id FOREIGN KEY (grupo_setor_plantao_id) REFERENCES grupo_setor_plantao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_plantao_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_plantao_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_plantao_escala_id FOREIGN KEY (escala_id) REFERENCES escala (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_plantao_evento_repasse_id FOREIGN KEY (evento_repasse_id) REFERENCES evento_repasse (id) ON DELETE RESTRICT;
ALTER TABLE regra_repasse_profissional
  ADD CONSTRAINT fk_regra_repasse_profissional_regra_repasse_id FOREIGN KEY (regra_repasse_id) REFERENCES regra_repasse (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_profissional_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE regra_repasse_resultado
  ADD CONSTRAINT fk_regra_repasse_resultado_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_resultado_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_resultado_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_resultado_evento_repasse_id FOREIGN KEY (evento_repasse_id) REFERENCES evento_repasse (id) ON DELETE RESTRICT;
ALTER TABLE regra_repasse_valor_fixo
  ADD CONSTRAINT fk_regra_repasse_valor_fixo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_valor_fixo_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_valor_fixo_grupo_repasse_id FOREIGN KEY (grupo_repasse_id) REFERENCES grupo_repasse (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_valor_fixo_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_valor_fixo_evento_repasse_id FOREIGN KEY (evento_repasse_id) REFERENCES evento_repasse (id) ON DELETE RESTRICT;
ALTER TABLE regra_repasse_variavel
  ADD CONSTRAINT fk_regra_repasse_variavel_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_variavel_equipe_repasse_variavel_id FOREIGN KEY (equipe_repasse_variavel_id) REFERENCES equipe_repasse_variavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_variavel_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_variavel_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_variavel_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_variavel_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_variavel_acomodacao_id FOREIGN KEY (acomodacao_id) REFERENCES acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_variavel_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_variavel_evento_repasse_id FOREIGN KEY (evento_repasse_id) REFERENCES evento_repasse (id) ON DELETE RESTRICT;
ALTER TABLE regra_repasse_variavel_faixa
  ADD CONSTRAINT fk_regra_repasse_variavel_faixa_regra_repasse_variavel_id FOREIGN KEY (regra_repasse_variavel_id) REFERENCES regra_repasse_variavel (id) ON DELETE RESTRICT;
ALTER TABLE regra_repasse_versao
  ADD CONSTRAINT fk_regra_repasse_versao_regra_repasse_id FOREIGN KEY (regra_repasse_id) REFERENCES regra_repasse (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_versao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_versao_proposto_por_usuario_id FOREIGN KEY (proposto_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_repasse_versao_decidido_por_usuario_id FOREIGN KEY (decidido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE regra_transferencia_conta
  ADD CONSTRAINT fk_regra_transferencia_conta_origem_estabelecimento_id FOREIGN KEY (origem_estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_transferencia_conta_destino_estabelecimento_id FOREIGN KEY (destino_estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_transferencia_conta_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_transferencia_conta_destino_fonte_pagadora_id FOREIGN KEY (destino_fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_transferencia_conta_origem_local_atendimento_id FOREIGN KEY (origem_local_atendimento_id) REFERENCES local_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_transferencia_conta_destino_local_atendimento_id FOREIGN KEY (destino_local_atendimento_id) REFERENCES local_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_transferencia_conta_origem_setor_funcional_id FOREIGN KEY (origem_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_transferencia_conta_destino_setor_funcional_id FOREIGN KEY (destino_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE regra_transferencia_item_estabelecimento
  ADD CONSTRAINT fk_regra_transferencia_item_estabelecimento_origem_estabelecimen FOREIGN KEY (origem_estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_transferencia_item_estabelecimento_destino_estabelecime FOREIGN KEY (destino_estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_transferencia_item_estabelecimento_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_transferencia_item_estabelecimento_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_transferencia_item_estabelecimento_subgrupo_faturamento FOREIGN KEY (subgrupo_faturamento_id) REFERENCES subgrupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_transferencia_item_estabelecimento_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_transferencia_item_estabelecimento_funcao_equipe_cobran FOREIGN KEY (funcao_equipe_cobranca_id) REFERENCES funcao_equipe_cobranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_transferencia_item_estabelecimento_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_transferencia_item_estabelecimento_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE regra_via_acesso
  ADD CONSTRAINT fk_regra_via_acesso_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_via_acesso_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_via_acesso_via_acesso_cirurgico_id FOREIGN KEY (via_acesso_cirurgico_id) REFERENCES via_acesso_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_via_acesso_tipo_lancamento_id FOREIGN KEY (tipo_lancamento_id) REFERENCES tipo_lancamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_via_acesso_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE resposta_autorizacao
  ADD CONSTRAINT fk_resposta_autorizacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resposta_autorizacao_solicitacao_autorizacao_id FOREIGN KEY (solicitacao_autorizacao_id) REFERENCES solicitacao_autorizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resposta_autorizacao_acomodacao_autorizada_id FOREIGN KEY (acomodacao_autorizada_id) REFERENCES acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resposta_autorizacao_motivo_glosa_id FOREIGN KEY (motivo_glosa_id) REFERENCES motivo_glosa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resposta_autorizacao_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resposta_autorizacao_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resposta_autorizacao_registrado_por_usuario_id FOREIGN KEY (registrado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE resposta_autorizacao_item
  ADD CONSTRAINT fk_resposta_autorizacao_item_resposta_autorizacao_id FOREIGN KEY (resposta_autorizacao_id) REFERENCES resposta_autorizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resposta_autorizacao_item_solicitacao_autorizacao_item_id FOREIGN KEY (solicitacao_autorizacao_item_id) REFERENCES solicitacao_autorizacao_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resposta_autorizacao_item_termo_terminologia_id FOREIGN KEY (termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_resposta_autorizacao_item_motivo_glosa_id FOREIGN KEY (motivo_glosa_id) REFERENCES motivo_glosa (id) ON DELETE RESTRICT;
ALTER TABLE restricao_cobertura_criterio
  ADD CONSTRAINT fk_restricao_cobertura_criterio_restricao_cobertura_fonte_pagado FOREIGN KEY (restricao_cobertura_fonte_pagadora_id) REFERENCES restricao_cobertura_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_cobertura_criterio_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_cobertura_criterio_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_cobertura_criterio_prestador_terceiro_id FOREIGN KEY (prestador_terceiro_id) REFERENCES prestador_terceiro (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_cobertura_criterio_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_cobertura_criterio_empresa_pessoa_juridica_id FOREIGN KEY (empresa_pessoa_juridica_id) REFERENCES pessoa_juridica (id) ON DELETE RESTRICT;
ALTER TABLE restricao_cobertura_excecao
  ADD CONSTRAINT fk_restricao_cobertura_excecao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_cobertura_excecao_restricao_cobertura_fonte_pagador FOREIGN KEY (restricao_cobertura_fonte_pagadora_id) REFERENCES restricao_cobertura_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_cobertura_excecao_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_cobertura_excecao_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_cobertura_excecao_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_cobertura_excecao_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_cobertura_excecao_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_cobertura_excecao_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_cobertura_excecao_justificativa_excecao_cobertura_i FOREIGN KEY (justificativa_excecao_cobertura_id) REFERENCES justificativa_excecao_cobertura (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_cobertura_excecao_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_cobertura_excecao_autorizado_por_usuario_id FOREIGN KEY (autorizado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE restricao_cobertura_fonte_pagadora
  ADD CONSTRAINT fk_restricao_cobertura_fonte_pagadora_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_cobertura_fonte_pagadora_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_cobertura_fonte_pagadora_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_cobertura_fonte_pagadora_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_cobertura_fonte_pagadora_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_restricao_cobertura_fonte_pagadora_tabela_preco_id FOREIGN KEY (tabela_preco_id) REFERENCES tabela_preco (id) ON DELETE RESTRICT;
ALTER TABLE rpa
  ADD CONSTRAINT fk_rpa_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rpa_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rpa_apuracao_repasse_id FOREIGN KEY (apuracao_repasse_id) REFERENCES apuracao_repasse (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rpa_natureza_rendimento_id FOREIGN KEY (natureza_rendimento_id) REFERENCES natureza_rendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rpa_cancelado_por_usuario_id FOREIGN KEY (cancelado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rpa_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE rpa_lancamento
  ADD CONSTRAINT fk_rpa_lancamento_rpa_id FOREIGN KEY (rpa_id) REFERENCES rpa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rpa_lancamento_lancamento_repasse_id FOREIGN KEY (lancamento_repasse_id) REFERENCES lancamento_repasse (id) ON DELETE RESTRICT;
ALTER TABLE rpa_retencao
  ADD CONSTRAINT fk_rpa_retencao_rpa_id FOREIGN KEY (rpa_id) REFERENCES rpa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rpa_retencao_tributo_id FOREIGN KEY (tributo_id) REFERENCES tributo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rpa_retencao_natureza_rendimento_id FOREIGN KEY (natureza_rendimento_id) REFERENCES natureza_rendimento (id) ON DELETE RESTRICT;
ALTER TABLE sequencial_guia
  ADD CONSTRAINT fk_sequencial_guia_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sequencial_guia_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE solicitacao_autorizacao
  ADD CONSTRAINT fk_solicitacao_autorizacao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_autorizacao_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_autorizacao_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_autorizacao_conta_hospitalar_id FOREIGN KEY (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_autorizacao_principal_solicitacao_autorizacao_id FOREIGN KEY (principal_solicitacao_autorizacao_id) REFERENCES solicitacao_autorizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_autorizacao_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_autorizacao_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_autorizacao_cobertura_paciente_id FOREIGN KEY (cobertura_paciente_id) REFERENCES cobertura_paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_autorizacao_solicitante_profissional_id FOREIGN KEY (solicitante_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_autorizacao_solicitante_externo_id FOREIGN KEY (solicitante_externo_id) REFERENCES solicitante_externo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_autorizacao_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_autorizacao_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_autorizacao_carater_atendimento_tiss_id FOREIGN KEY (carater_atendimento_tiss_id) REFERENCES carater_atendimento_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_autorizacao_acomodacao_id FOREIGN KEY (acomodacao_id) REFERENCES acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_autorizacao_versao_padrao_tiss_id FOREIGN KEY (versao_padrao_tiss_id) REFERENCES versao_padrao_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_autorizacao_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_autorizacao_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE solicitacao_autorizacao_anexo_clinico
  ADD CONSTRAINT fk_solicitacao_autorizacao_anexo_clinico_solicitacao_autorizacao FOREIGN KEY (solicitacao_autorizacao_id) REFERENCES solicitacao_autorizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_autorizacao_anexo_clinico_cid_termo_terminologia_ FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_autorizacao_anexo_clinico_estadiamento_termo_term FOREIGN KEY (estadiamento_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_autorizacao_anexo_clinico_finalidade_termo_termin FOREIGN KEY (finalidade_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_autorizacao_anexo_clinico_ecog_termo_terminologia FOREIGN KEY (ecog_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_autorizacao_anexo_clinico_tipo_quimioterapia_term FOREIGN KEY (tipo_quimioterapia_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE solicitacao_autorizacao_diagnostico
  ADD CONSTRAINT fk_solicitacao_autorizacao_diagnostico_solicitacao_autorizacao_i FOREIGN KEY (solicitacao_autorizacao_id) REFERENCES solicitacao_autorizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_autorizacao_diagnostico_cid_termo_terminologia_id FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE solicitacao_autorizacao_item
  ADD CONSTRAINT fk_solicitacao_autorizacao_item_solicitacao_autorizacao_id FOREIGN KEY (solicitacao_autorizacao_id) REFERENCES solicitacao_autorizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_autorizacao_item_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_autorizacao_item_termo_terminologia_id FOREIGN KEY (termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_autorizacao_item_fabricante_id FOREIGN KEY (fabricante_id) REFERENCES fabricante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_autorizacao_item_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_autorizacao_item_via_administracao_termo_terminol FOREIGN KEY (via_administracao_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;
ALTER TABLE solicitacao_demonstrativo
  ADD CONSTRAINT fk_solicitacao_demonstrativo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_demonstrativo_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_demonstrativo_lote_tiss_id FOREIGN KEY (lote_tiss_id) REFERENCES lote_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_demonstrativo_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_demonstrativo_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_demonstrativo_demonstrativo_pagamento_id FOREIGN KEY (demonstrativo_pagamento_id) REFERENCES demonstrativo_pagamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_solicitacao_demonstrativo_demonstrativo_analise_conta_id FOREIGN KEY (demonstrativo_analise_conta_id) REFERENCES demonstrativo_analise_conta (id) ON DELETE RESTRICT;
ALTER TABLE subgrupo_faturamento
  ADD CONSTRAINT fk_subgrupo_faturamento_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT;
ALTER TABLE tabela_preco
  ADD CONSTRAINT fk_tabela_preco_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tabela_preco_terminologia_id FOREIGN KEY (terminologia_id) REFERENCES terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tabela_preco_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tabela_preco_contrato_fonte_pagadora_id FOREIGN KEY (contrato_fonte_pagadora_id) REFERENCES contrato_fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE terminologia_tipo_lancamento
  ADD CONSTRAINT fk_terminologia_tipo_lancamento_terminologia_id FOREIGN KEY (terminologia_id) REFERENCES terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_terminologia_tipo_lancamento_tipo_lancamento_id FOREIGN KEY (tipo_lancamento_id) REFERENCES tipo_lancamento (id) ON DELETE RESTRICT;
ALTER TABLE termo_versao_tiss
  ADD CONSTRAINT fk_termo_versao_tiss_termo_terminologia_id FOREIGN KEY (termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_versao_tiss_versao_padrao_tiss_id FOREIGN KEY (versao_padrao_tiss_id) REFERENCES versao_padrao_tiss (id) ON DELETE RESTRICT;
ALTER TABLE teto_cobranca
  ADD CONSTRAINT fk_teto_cobranca_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teto_cobranca_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teto_cobranca_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teto_cobranca_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teto_cobranca_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teto_cobranca_excedente_fonte_pagadora_id FOREIGN KEY (excedente_fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teto_cobranca_excedente_plano_fonte_pagadora_id FOREIGN KEY (excedente_plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT;
ALTER TABLE teto_cobranca_excecao
  ADD CONSTRAINT fk_teto_cobranca_excecao_teto_cobranca_id FOREIGN KEY (teto_cobranca_id) REFERENCES teto_cobranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teto_cobranca_excecao_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teto_cobranca_excecao_autorizado_por_usuario_id FOREIGN KEY (autorizado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
