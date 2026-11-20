-- Módulo REL, lote 01: chaves estrangeiras (aplicadas depois de todos os tabelas.sql).

ALTER TABLE agendamento_relatorio
  ADD CONSTRAINT fk_agendamento_relatorio_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_relatorio_relatorio_id FOREIGN KEY (relatorio_id) REFERENCES relatorio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_relatorio_dono_usuario_id FOREIGN KEY (dono_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE agendamento_relatorio_destinatario
  ADD CONSTRAINT fk_agendamento_relatorio_destinatario_agendamento_relatorio_id FOREIGN KEY (agendamento_relatorio_id) REFERENCES agendamento_relatorio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_relatorio_destinatario_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agendamento_relatorio_destinatario_lista_distribuica_dc2759b7 FOREIGN KEY (lista_distribuicao_email_id) REFERENCES lista_distribuicao_email (id) ON DELETE RESTRICT;
ALTER TABLE agrupamento_relatorio_item
  ADD CONSTRAINT fk_agrupamento_relatorio_item_agrupamento_relatorio_id FOREIGN KEY (agrupamento_relatorio_id) REFERENCES agrupamento_relatorio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agrupamento_relatorio_item_relatorio_id FOREIGN KEY (relatorio_id) REFERENCES relatorio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agrupamento_relatorio_item_leiaute_esocial_id FOREIGN KEY (leiaute_esocial_id) REFERENCES leiaute_esocial (id) ON DELETE RESTRICT;
ALTER TABLE alerta_fluxo_unidade
  ADD CONSTRAINT fk_alerta_fluxo_unidade_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alerta_fluxo_unidade_indicador_id FOREIGN KEY (indicador_id) REFERENCES indicador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alerta_fluxo_unidade_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_alerta_fluxo_unidade_lista_distribuicao_email_id FOREIGN KEY (lista_distribuicao_email_id) REFERENCES lista_distribuicao_email (id) ON DELETE RESTRICT;
ALTER TABLE analise_critica_indicador
  ADD CONSTRAINT fk_analise_critica_indicador_apuracao_indicador_id FOREIGN KEY (apuracao_indicador_id) REFERENCES apuracao_indicador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_analise_critica_indicador_reuniao_analise_critica_id FOREIGN KEY (reuniao_analise_critica_id) REFERENCES reuniao_analise_critica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_analise_critica_indicador_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_analise_critica_indicador_plano_acao_qualidade_id FOREIGN KEY (plano_acao_qualidade_id) REFERENCES plano_acao_qualidade (id) ON DELETE RESTRICT;
ALTER TABLE analise_objetivo_estrategico
  ADD CONSTRAINT fk_analise_objetivo_estrategico_objetivo_estrategico_id FOREIGN KEY (objetivo_estrategico_id) REFERENCES objetivo_estrategico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_analise_objetivo_estrategico_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE analise_salva
  ADD CONSTRAINT fk_analise_salva_dono_usuario_id FOREIGN KEY (dono_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE analise_salva_permissao
  ADD CONSTRAINT fk_analise_salva_permissao_analise_salva_id FOREIGN KEY (analise_salva_id) REFERENCES analise_salva (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_analise_salva_permissao_perfil_acesso_id FOREIGN KEY (perfil_acesso_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_analise_salva_permissao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE apontamento_hora_iniciativa
  ADD CONSTRAINT fk_apontamento_hora_iniciativa_iniciativa_estrategica_acao_id FOREIGN KEY (iniciativa_estrategica_acao_id) REFERENCES iniciativa_estrategica_acao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apontamento_hora_iniciativa_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE apuracao_indicador
  ADD CONSTRAINT fk_apuracao_indicador_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_indicador_indicador_id FOREIGN KEY (indicador_id) REFERENCES indicador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_indicador_indicador_versao_id FOREIGN KEY (indicador_versao_id) REFERENCES indicador_versao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_indicador_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_indicador_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_indicador_meta_indicador_id FOREIGN KEY (meta_indicador_id) REFERENCES meta_indicador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_indicador_carga_data_mart_id FOREIGN KEY (carga_data_mart_id) REFERENCES carga_data_mart (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_indicador_fechada_por_usuario_id FOREIGN KEY (fechada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE apuracao_indicador_estrato
  ADD CONSTRAINT fk_apuracao_indicador_estrato_apuracao_indicador_id FOREIGN KEY (apuracao_indicador_id) REFERENCES apuracao_indicador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_indicador_estrato_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_indicador_estrato_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_indicador_estrato_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_indicador_estrato_faixa_etaria_id FOREIGN KEY (faixa_etaria_id) REFERENCES faixa_etaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_indicador_estrato_acomodacao_id FOREIGN KEY (acomodacao_id) REFERENCES acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_apuracao_indicador_estrato_clinica_assistencial_id FOREIGN KEY (clinica_assistencial_id) REFERENCES clinica_assistencial (id) ON DELETE RESTRICT;
ALTER TABLE carga_data_mart
  ADD CONSTRAINT fk_carga_data_mart_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_carga_data_mart_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE carga_data_mart_etapa
  ADD CONSTRAINT fk_carga_data_mart_etapa_carga_data_mart_id FOREIGN KEY (carga_data_mart_id) REFERENCES carga_data_mart (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_carga_data_mart_etapa_indicador_id FOREIGN KEY (indicador_id) REFERENCES indicador (id) ON DELETE RESTRICT;
ALTER TABLE categoria_relatorio
  ADD CONSTRAINT fk_categoria_relatorio_categoria_pai_id FOREIGN KEY (categoria_pai_id) REFERENCES categoria_relatorio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_categoria_relatorio_modulo_sistema_id FOREIGN KEY (modulo_sistema_id) REFERENCES modulo_sistema (id) ON DELETE RESTRICT;
ALTER TABLE cenario_simulacao_parametro
  ADD CONSTRAINT fk_cenario_simulacao_parametro_cenario_simulacao_receita_id FOREIGN KEY (cenario_simulacao_receita_id) REFERENCES cenario_simulacao_receita (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cenario_simulacao_parametro_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cenario_simulacao_parametro_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cenario_simulacao_parametro_tabela_preco_origem_id FOREIGN KEY (tabela_preco_origem_id) REFERENCES tabela_preco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cenario_simulacao_parametro_tabela_preco_destino_id FOREIGN KEY (tabela_preco_destino_id) REFERENCES tabela_preco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cenario_simulacao_parametro_indice_reajuste_id FOREIGN KEY (indice_reajuste_id) REFERENCES indice_reajuste (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cenario_simulacao_parametro_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cenario_simulacao_parametro_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cenario_simulacao_parametro_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT;
ALTER TABLE cenario_simulacao_receita
  ADD CONSTRAINT fk_cenario_simulacao_receita_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cenario_simulacao_receita_dono_usuario_id FOREIGN KEY (dono_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE envio_relatorio
  ADD CONSTRAINT fk_envio_relatorio_agendamento_relatorio_id FOREIGN KEY (agendamento_relatorio_id) REFERENCES agendamento_relatorio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_relatorio_execucao_relatorio_id FOREIGN KEY (execucao_relatorio_id) REFERENCES execucao_relatorio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_relatorio_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_relatorio_integracao_mensagem_id FOREIGN KEY (integracao_mensagem_id) REFERENCES integracao_mensagem (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_envio_relatorio_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE execucao_relatorio
  ADD CONSTRAINT fk_execucao_relatorio_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_execucao_relatorio_relatorio_id FOREIGN KEY (relatorio_id) REFERENCES relatorio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_execucao_relatorio_agendamento_relatorio_id FOREIGN KEY (agendamento_relatorio_id) REFERENCES agendamento_relatorio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_execucao_relatorio_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_execucao_relatorio_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE faixa_indicador
  ADD CONSTRAINT fk_faixa_indicador_indicador_id FOREIGN KEY (indicador_id) REFERENCES indicador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_faixa_indicador_meta_indicador_id FOREIGN KEY (meta_indicador_id) REFERENCES meta_indicador (id) ON DELETE RESTRICT;
ALTER TABLE grupo_indicador
  ADD CONSTRAINT fk_grupo_indicador_grupo_pai_id FOREIGN KEY (grupo_pai_id) REFERENCES grupo_indicador (id) ON DELETE RESTRICT;
ALTER TABLE indicador
  ADD CONSTRAINT fk_indicador_grupo_indicador_id FOREIGN KEY (grupo_indicador_id) REFERENCES grupo_indicador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_indicador_perspectiva_estrategica_id FOREIGN KEY (perspectiva_estrategica_id) REFERENCES perspectiva_estrategica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_indicador_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE indicador_referencia
  ADD CONSTRAINT fk_indicador_referencia_indicador_id FOREIGN KEY (indicador_id) REFERENCES indicador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_indicador_referencia_fonte_referencia_indicador_id FOREIGN KEY (fonte_referencia_indicador_id) REFERENCES fonte_referencia_indicador (id) ON DELETE RESTRICT;
ALTER TABLE indicador_relacao
  ADD CONSTRAINT fk_indicador_relacao_indicador_origem_id FOREIGN KEY (indicador_origem_id) REFERENCES indicador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_indicador_relacao_indicador_destino_id FOREIGN KEY (indicador_destino_id) REFERENCES indicador (id) ON DELETE RESTRICT;
ALTER TABLE indicador_versao
  ADD CONSTRAINT fk_indicador_versao_indicador_id FOREIGN KEY (indicador_id) REFERENCES indicador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_indicador_versao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_indicador_versao_documento_arquivo_id FOREIGN KEY (documento_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE iniciativa_estrategica
  ADD CONSTRAINT fk_iniciativa_estrategica_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_iniciativa_estrategica_mapa_estrategico_id FOREIGN KEY (mapa_estrategico_id) REFERENCES mapa_estrategico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_iniciativa_estrategica_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_iniciativa_estrategica_patrocinador_usuario_id FOREIGN KEY (patrocinador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_iniciativa_estrategica_solicitante_usuario_id FOREIGN KEY (solicitante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_iniciativa_estrategica_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_iniciativa_estrategica_calendario_trabalho_id FOREIGN KEY (calendario_trabalho_id) REFERENCES calendario_trabalho (id) ON DELETE RESTRICT;
ALTER TABLE iniciativa_estrategica_acao
  ADD CONSTRAINT fk_iniciativa_estrategica_acao_iniciativa_estrategica_id FOREIGN KEY (iniciativa_estrategica_id) REFERENCES iniciativa_estrategica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_iniciativa_estrategica_acao_acao_pai_id FOREIGN KEY (acao_pai_id) REFERENCES iniciativa_estrategica_acao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_iniciativa_estrategica_acao_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE iniciativa_estrategica_indicador
  ADD CONSTRAINT fk_iniciativa_estrategica_indicador_iniciativa_estrategica_id FOREIGN KEY (iniciativa_estrategica_id) REFERENCES iniciativa_estrategica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_iniciativa_estrategica_indicador_iniciativa_estrateg_94598d7d FOREIGN KEY (iniciativa_estrategica_acao_id) REFERENCES iniciativa_estrategica_acao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_iniciativa_estrategica_indicador_indicador_id FOREIGN KEY (indicador_id) REFERENCES indicador (id) ON DELETE RESTRICT;
ALTER TABLE iniciativa_estrategica_nota
  ADD CONSTRAINT fk_iniciativa_estrategica_nota_iniciativa_estrategica_id FOREIGN KEY (iniciativa_estrategica_id) REFERENCES iniciativa_estrategica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_iniciativa_estrategica_nota_iniciativa_estrategica_acao_id FOREIGN KEY (iniciativa_estrategica_acao_id) REFERENCES iniciativa_estrategica_acao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_iniciativa_estrategica_nota_autor_usuario_id FOREIGN KEY (autor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE iniciativa_estrategica_objetivo
  ADD CONSTRAINT fk_iniciativa_estrategica_objetivo_iniciativa_estrategica_id FOREIGN KEY (iniciativa_estrategica_id) REFERENCES iniciativa_estrategica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_iniciativa_estrategica_objetivo_objetivo_estrategico_id FOREIGN KEY (objetivo_estrategico_id) REFERENCES objetivo_estrategico (id) ON DELETE RESTRICT;
ALTER TABLE iniciativa_estrategica_participante
  ADD CONSTRAINT fk_iniciativa_estrategica_participante_iniciativa_estrategica_id FOREIGN KEY (iniciativa_estrategica_id) REFERENCES iniciativa_estrategica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_iniciativa_estrategica_participante_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_iniciativa_estrategica_participante_perfil_acesso_id FOREIGN KEY (perfil_acesso_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT;
ALTER TABLE mapa_estrategico
  ADD CONSTRAINT fk_mapa_estrategico_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mapa_estrategico_imagem_arquivo_id FOREIGN KEY (imagem_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE meta_indicador
  ADD CONSTRAINT fk_meta_indicador_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_meta_indicador_indicador_id FOREIGN KEY (indicador_id) REFERENCES indicador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_meta_indicador_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_meta_indicador_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_meta_indicador_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE modelo_pagina_inicial
  ADD CONSTRAINT fk_modelo_pagina_inicial_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE modelo_pagina_inicial_bloco
  ADD CONSTRAINT fk_modelo_pagina_inicial_bloco_modelo_pagina_inicial_id FOREIGN KEY (modelo_pagina_inicial_id) REFERENCES modelo_pagina_inicial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_pagina_inicial_bloco_painel_gerencial_id FOREIGN KEY (painel_gerencial_id) REFERENCES painel_gerencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_pagina_inicial_bloco_indicador_id FOREIGN KEY (indicador_id) REFERENCES indicador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_pagina_inicial_bloco_relatorio_id FOREIGN KEY (relatorio_id) REFERENCES relatorio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_pagina_inicial_bloco_analise_salva_id FOREIGN KEY (analise_salva_id) REFERENCES analise_salva (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_pagina_inicial_bloco_tela_sistema_id FOREIGN KEY (tela_sistema_id) REFERENCES tela_sistema (id) ON DELETE RESTRICT;
ALTER TABLE modelo_pagina_inicial_perfil
  ADD CONSTRAINT fk_modelo_pagina_inicial_perfil_modelo_pagina_inicial_id FOREIGN KEY (modelo_pagina_inicial_id) REFERENCES modelo_pagina_inicial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_pagina_inicial_perfil_perfil_acesso_id FOREIGN KEY (perfil_acesso_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT;
ALTER TABLE modelo_pauta_analise_critica_item
  ADD CONSTRAINT fk_modelo_pauta_analise_critica_item_modelo_pauta_anali_e8cdd752 FOREIGN KEY (modelo_pauta_analise_critica_id) REFERENCES modelo_pauta_analise_critica (id) ON DELETE RESTRICT;
ALTER TABLE objetivo_estrategico
  ADD CONSTRAINT fk_objetivo_estrategico_mapa_estrategico_id FOREIGN KEY (mapa_estrategico_id) REFERENCES mapa_estrategico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_objetivo_estrategico_perspectiva_estrategica_id FOREIGN KEY (perspectiva_estrategica_id) REFERENCES perspectiva_estrategica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_objetivo_estrategico_tema_estrategico_id FOREIGN KEY (tema_estrategico_id) REFERENCES tema_estrategico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_objetivo_estrategico_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE objetivo_estrategico_indicador
  ADD CONSTRAINT fk_objetivo_estrategico_indicador_objetivo_estrategico_id FOREIGN KEY (objetivo_estrategico_id) REFERENCES objetivo_estrategico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_objetivo_estrategico_indicador_indicador_id FOREIGN KEY (indicador_id) REFERENCES indicador (id) ON DELETE RESTRICT;
ALTER TABLE objetivo_estrategico_relacao
  ADD CONSTRAINT fk_objetivo_estrategico_relacao_objetivo_causa_id FOREIGN KEY (objetivo_causa_id) REFERENCES objetivo_estrategico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_objetivo_estrategico_relacao_objetivo_efeito_id FOREIGN KEY (objetivo_efeito_id) REFERENCES objetivo_estrategico (id) ON DELETE RESTRICT;
ALTER TABLE ocorrencia_risco_clinico
  ADD CONSTRAINT fk_ocorrencia_risco_clinico_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_risco_clinico_regra_risco_clinico_id FOREIGN KEY (regra_risco_clinico_id) REFERENCES regra_risco_clinico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_risco_clinico_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_risco_clinico_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_risco_clinico_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_risco_clinico_leito_hospitalar_id FOREIGN KEY (leito_hospitalar_id) REFERENCES leito_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_risco_clinico_reconhecido_por_usuario_id FOREIGN KEY (reconhecido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_risco_clinico_resolvido_por_usuario_id FOREIGN KEY (resolvido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_risco_clinico_aviso_clinico_id FOREIGN KEY (aviso_clinico_id) REFERENCES aviso_clinico (id) ON DELETE RESTRICT;
ALTER TABLE painel_gerencial
  ADD CONSTRAINT fk_painel_gerencial_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_gerencial_categoria_relatorio_id FOREIGN KEY (categoria_relatorio_id) REFERENCES categoria_relatorio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_gerencial_dono_usuario_id FOREIGN KEY (dono_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE painel_gerencial_item
  ADD CONSTRAINT fk_painel_gerencial_item_painel_gerencial_id FOREIGN KEY (painel_gerencial_id) REFERENCES painel_gerencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_gerencial_item_indicador_id FOREIGN KEY (indicador_id) REFERENCES indicador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_gerencial_item_analise_salva_id FOREIGN KEY (analise_salva_id) REFERENCES analise_salva (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_gerencial_item_relatorio_id FOREIGN KEY (relatorio_id) REFERENCES relatorio (id) ON DELETE RESTRICT;
