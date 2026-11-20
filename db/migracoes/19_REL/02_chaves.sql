-- Chaves do módulo REL, lote 02 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE painel_gerencial_permissao
  ADD CONSTRAINT fk_painel_gerencial_permissao_painel_gerencial_id FOREIGN KEY (painel_gerencial_id) REFERENCES painel_gerencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_gerencial_permissao_perfil_acesso_id FOREIGN KEY (perfil_acesso_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_gerencial_permissao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE painel_tv
  ADD CONSTRAINT fk_painel_tv_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_tv_tipo_painel_tv_id FOREIGN KEY (tipo_painel_tv_id) REFERENCES tipo_painel_tv (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_tv_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_tv_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE painel_tv_bloco
  ADD CONSTRAINT fk_painel_tv_bloco_painel_tv_id FOREIGN KEY (painel_tv_id) REFERENCES painel_tv (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_tv_bloco_indicador_id FOREIGN KEY (indicador_id) REFERENCES indicador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_tv_bloco_relatorio_id FOREIGN KEY (relatorio_id) REFERENCES relatorio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_tv_bloco_perspectiva_estrategica_id FOREIGN KEY (perspectiva_estrategica_id) REFERENCES perspectiva_estrategica (id) ON DELETE RESTRICT;
ALTER TABLE painel_tv_dispositivo
  ADD CONSTRAINT fk_painel_tv_dispositivo_painel_tv_id FOREIGN KEY (painel_tv_id) REFERENCES painel_tv (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_painel_tv_dispositivo_estacao_trabalho_id FOREIGN KEY (estacao_trabalho_id) REFERENCES estacao_trabalho (id) ON DELETE RESTRICT;
ALTER TABLE ponderacao_procedimento
  ADD CONSTRAINT fk_ponderacao_procedimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ponderacao_procedimento_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ponderacao_procedimento_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ponderacao_procedimento_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ponderacao_procedimento_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT;
ALTER TABLE proposta_iniciativa
  ADD CONSTRAINT fk_proposta_iniciativa_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_proposta_iniciativa_mapa_estrategico_id FOREIGN KEY (mapa_estrategico_id) REFERENCES mapa_estrategico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_proposta_iniciativa_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_proposta_iniciativa_solicitante_usuario_id FOREIGN KEY (solicitante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_proposta_iniciativa_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_proposta_iniciativa_aprovador_usuario_id FOREIGN KEY (aprovador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_proposta_iniciativa_iniciativa_estrategica_id FOREIGN KEY (iniciativa_estrategica_id) REFERENCES iniciativa_estrategica (id) ON DELETE RESTRICT;
ALTER TABLE proposta_iniciativa_recurso
  ADD CONSTRAINT fk_proposta_iniciativa_recurso_proposta_iniciativa_id FOREIGN KEY (proposta_iniciativa_id) REFERENCES proposta_iniciativa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_proposta_iniciativa_recurso_cargo_id FOREIGN KEY (cargo_id) REFERENCES cargo (id) ON DELETE RESTRICT;
ALTER TABLE regra_conversao_tabela_preco
  ADD CONSTRAINT fk_regra_conversao_tabela_preco_cenario_simulacao_receita_id FOREIGN KEY (cenario_simulacao_receita_id) REFERENCES cenario_simulacao_receita (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_conversao_tabela_preco_atual_fonte_pagadora_id FOREIGN KEY (atual_fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_conversao_tabela_preco_atual_plano_fonte_pagadora_id FOREIGN KEY (atual_plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_conversao_tabela_preco_atual_tabela_preco_id FOREIGN KEY (atual_tabela_preco_id) REFERENCES tabela_preco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_conversao_tabela_preco_destino_fonte_pagadora_id FOREIGN KEY (destino_fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_conversao_tabela_preco_destino_plano_fonte_pagadora_id FOREIGN KEY (destino_plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_conversao_tabela_preco_destino_tabela_preco_id FOREIGN KEY (destino_tabela_preco_id) REFERENCES tabela_preco (id) ON DELETE RESTRICT;
ALTER TABLE regra_conversao_procedimento
  ADD CONSTRAINT fk_regra_conversao_procedimento_regra_conversao_tabela_preco_id FOREIGN KEY (regra_conversao_tabela_preco_id) REFERENCES regra_conversao_tabela_preco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_conversao_procedimento_atual_item_faturavel_id FOREIGN KEY (atual_item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_conversao_procedimento_destino_item_faturavel_id FOREIGN KEY (destino_item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_conversao_procedimento_destino_pacote_id FOREIGN KEY (destino_pacote_id) REFERENCES pacote (id) ON DELETE RESTRICT;
ALTER TABLE regra_risco_clinico
  ADD CONSTRAINT fk_regra_risco_clinico_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_risco_clinico_tema_clinico_id FOREIGN KEY (tema_clinico_id) REFERENCES tema_clinico (id) ON DELETE RESTRICT;
ALTER TABLE regra_risco_clinico_criterio
  ADD CONSTRAINT fk_regra_risco_clinico_criterio_regra_risco_clinico_id FOREIGN KEY (regra_risco_clinico_id) REFERENCES regra_risco_clinico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_risco_clinico_criterio_exame_id FOREIGN KEY (exame_id) REFERENCES exame (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_risco_clinico_criterio_item_prescritivel_id FOREIGN KEY (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_risco_clinico_criterio_frequencia_administracao_id FOREIGN KEY (frequencia_administracao_id) REFERENCES frequencia_administracao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_regra_risco_clinico_criterio_parametro_vital_id FOREIGN KEY (parametro_vital_id) REFERENCES parametro_vital (id) ON DELETE RESTRICT;
ALTER TABLE relatorio
  ADD CONSTRAINT fk_relatorio_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_relatorio_modulo_sistema_id FOREIGN KEY (modulo_sistema_id) REFERENCES modulo_sistema (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_relatorio_categoria_relatorio_id FOREIGN KEY (categoria_relatorio_id) REFERENCES categoria_relatorio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_relatorio_dono_papel_seguranca_id FOREIGN KEY (dono_papel_seguranca_id) REFERENCES papel_seguranca (id) ON DELETE RESTRICT;
ALTER TABLE relatorio_coluna
  ADD CONSTRAINT fk_relatorio_coluna_relatorio_id FOREIGN KEY (relatorio_id) REFERENCES relatorio (id) ON DELETE RESTRICT;
ALTER TABLE relatorio_modelo_documento
  ADD CONSTRAINT fk_relatorio_modelo_documento_relatorio_id FOREIGN KEY (relatorio_id) REFERENCES relatorio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_relatorio_modelo_documento_modelo_documento_clinico_id FOREIGN KEY (modelo_documento_clinico_id) REFERENCES modelo_documento_clinico (id) ON DELETE RESTRICT;
ALTER TABLE relatorio_parametro
  ADD CONSTRAINT fk_relatorio_parametro_relatorio_id FOREIGN KEY (relatorio_id) REFERENCES relatorio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_relatorio_parametro_relatorio_parametro_pesquisa_id FOREIGN KEY (relatorio_parametro_pesquisa_id) REFERENCES relatorio_parametro_pesquisa (id) ON DELETE RESTRICT;
ALTER TABLE relatorio_permissao
  ADD CONSTRAINT fk_relatorio_permissao_relatorio_id FOREIGN KEY (relatorio_id) REFERENCES relatorio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_relatorio_permissao_perfil_acesso_id FOREIGN KEY (perfil_acesso_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_relatorio_permissao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE relatorio_tela
  ADD CONSTRAINT fk_relatorio_tela_relatorio_id FOREIGN KEY (relatorio_id) REFERENCES relatorio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_relatorio_tela_tela_sistema_id FOREIGN KEY (tela_sistema_id) REFERENCES tela_sistema (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_relatorio_tela_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_relatorio_tela_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE relatorio_tela_parametro
  ADD CONSTRAINT fk_relatorio_tela_parametro_relatorio_tela_id FOREIGN KEY (relatorio_tela_id) REFERENCES relatorio_tela (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_relatorio_tela_parametro_relatorio_parametro_id FOREIGN KEY (relatorio_parametro_id) REFERENCES relatorio_parametro (id) ON DELETE RESTRICT;
ALTER TABLE relatorio_versao
  ADD CONSTRAINT fk_relatorio_versao_relatorio_id FOREIGN KEY (relatorio_id) REFERENCES relatorio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_relatorio_versao_leiaute_arquivo_id FOREIGN KEY (leiaute_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_relatorio_versao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE reuniao_analise_critica
  ADD CONSTRAINT fk_reuniao_analise_critica_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reuniao_analise_critica_mapa_estrategico_id FOREIGN KEY (mapa_estrategico_id) REFERENCES mapa_estrategico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reuniao_analise_critica_modelo_pauta_analise_critica_id FOREIGN KEY (modelo_pauta_analise_critica_id) REFERENCES modelo_pauta_analise_critica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reuniao_analise_critica_centro_custo_id FOREIGN KEY (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reuniao_analise_critica_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reuniao_analise_critica_registrante_usuario_id FOREIGN KEY (registrante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE reuniao_analise_critica_deliberacao
  ADD CONSTRAINT fk_reuniao_analise_critica_deliberacao_reuniao_id FOREIGN KEY (reuniao_analise_critica_id) REFERENCES reuniao_analise_critica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reuniao_analise_critica_deliberacao_objetivo_estrategico_id FOREIGN KEY (objetivo_estrategico_id) REFERENCES objetivo_estrategico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reuniao_analise_critica_deliberacao_indicador_id FOREIGN KEY (indicador_id) REFERENCES indicador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reuniao_analise_critica_deliberacao_iniciativa_estrategica_id FOREIGN KEY (iniciativa_estrategica_id) REFERENCES iniciativa_estrategica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reuniao_analise_critica_deliberacao_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE reuniao_analise_critica_participante
  ADD CONSTRAINT fk_reuniao_analise_critica_participante_reuniao_id FOREIGN KEY (reuniao_analise_critica_id) REFERENCES reuniao_analise_critica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reuniao_analise_critica_participante_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_reuniao_analise_critica_participante_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT;
ALTER TABLE simulacao_receita
  ADD CONSTRAINT fk_simulacao_receita_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_simulacao_receita_cenario_simulacao_receita_id FOREIGN KEY (cenario_simulacao_receita_id) REFERENCES cenario_simulacao_receita (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_simulacao_receita_solicitante_usuario_id FOREIGN KEY (solicitante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE simulacao_receita_inconsistencia
  ADD CONSTRAINT fk_simulacao_receita_inconsistencia_simulacao_receita_id FOREIGN KEY (simulacao_receita_id) REFERENCES simulacao_receita (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_simulacao_receita_inconsistencia_regra_conversao_id FOREIGN KEY (regra_conversao_procedimento_id) REFERENCES regra_conversao_procedimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_simulacao_receita_inconsistencia_atual_item_faturavel_id FOREIGN KEY (atual_item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_simulacao_receita_inconsistencia_destino_item_faturavel_id FOREIGN KEY (destino_item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_simulacao_receita_inconsistencia_destino_pacote_id FOREIGN KEY (destino_pacote_id) REFERENCES pacote (id) ON DELETE RESTRICT;
ALTER TABLE simulacao_receita_resultado
  ADD CONSTRAINT fk_simulacao_receita_resultado_simulacao_receita_id FOREIGN KEY (simulacao_receita_id) REFERENCES simulacao_receita (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_simulacao_receita_resultado_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_simulacao_receita_resultado_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_simulacao_receita_resultado_destino_fonte_pagadora_id FOREIGN KEY (destino_fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_simulacao_receita_resultado_destino_plano_fonte_pagadora_id FOREIGN KEY (destino_plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_simulacao_receita_resultado_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_simulacao_receita_resultado_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT;
ALTER TABLE tema_estrategico
  ADD CONSTRAINT fk_tema_estrategico_mapa_estrategico_id FOREIGN KEY (mapa_estrategico_id) REFERENCES mapa_estrategico (id) ON DELETE RESTRICT;
ALTER TABLE triagem_relatorio_legado
  ADD CONSTRAINT fk_triagem_relatorio_legado_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_triagem_relatorio_legado_modulo_sistema_id FOREIGN KEY (modulo_sistema_id) REFERENCES modulo_sistema (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_triagem_relatorio_legado_relatorio_id FOREIGN KEY (relatorio_id) REFERENCES relatorio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_triagem_relatorio_legado_indicador_id FOREIGN KEY (indicador_id) REFERENCES indicador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_triagem_relatorio_legado_painel_gerencial_id FOREIGN KEY (painel_gerencial_id) REFERENCES painel_gerencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_triagem_relatorio_legado_dono_papel_seguranca_id FOREIGN KEY (dono_papel_seguranca_id) REFERENCES papel_seguranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_triagem_relatorio_legado_decidido_por_usuario_id FOREIGN KEY (decidido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_triagem_relatorio_legado_aceito_por_usuario_id FOREIGN KEY (aceito_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
