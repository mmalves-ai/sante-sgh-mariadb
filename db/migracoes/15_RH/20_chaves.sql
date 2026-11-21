-- F2.4 (dívida da migração): DDL pendente dos pedidos da F2.2, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado.md

ALTER TABLE quadro_vaga ADD CONSTRAINT fk_quadro_vaga_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE quadro_vaga ADD CONSTRAINT fk_quadro_vaga_cargo_id FOREIGN KEY IF NOT EXISTS (cargo_id) REFERENCES cargo (id) ON DELETE RESTRICT;
ALTER TABLE quadro_vaga ADD CONSTRAINT fk_quadro_vaga_centro_custo_id FOREIGN KEY IF NOT EXISTS (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT;
ALTER TABLE quadro_vaga ADD CONSTRAINT fk_quadro_vaga_quadro_vaga_anterior_id FOREIGN KEY IF NOT EXISTS (quadro_vaga_anterior_id) REFERENCES quadro_vaga (id) ON DELETE RESTRICT;

ALTER TABLE faixa_salarial ADD CONSTRAINT fk_faixa_salarial_faixa_salarial_anterior_id FOREIGN KEY IF NOT EXISTS (faixa_salarial_anterior_id) REFERENCES faixa_salarial (id) ON DELETE RESTRICT;
ALTER TABLE plantao ADD CONSTRAINT fk_plantao_inscricao_conselho_id FOREIGN KEY IF NOT EXISTS (inscricao_conselho_id) REFERENCES inscricao_conselho (id) ON DELETE RESTRICT;
ALTER TABLE recibo_ferias ADD CONSTRAINT fk_recibo_ferias_processamento_folha_id FOREIGN KEY IF NOT EXISTS (processamento_folha_id) REFERENCES processamento_folha (id) ON DELETE RESTRICT;
ALTER TABLE rescisao ADD CONSTRAINT fk_rescisao_processamento_folha_id FOREIGN KEY IF NOT EXISTS (processamento_folha_id) REFERENCES processamento_folha (id) ON DELETE RESTRICT;
ALTER TABLE regra_banco_horas ADD CONSTRAINT fk_regra_banco_horas_regime_jornada_id FOREIGN KEY IF NOT EXISTS (regime_jornada_id) REFERENCES regime_jornada (id) ON DELETE RESTRICT;
ALTER TABLE movimento_banco_horas ADD CONSTRAINT fk_movimento_banco_horas_vinculo_trabalho_id FOREIGN KEY IF NOT EXISTS (vinculo_trabalho_id) REFERENCES vinculo_trabalho (id) ON DELETE RESTRICT;
ALTER TABLE movimento_banco_horas ADD CONSTRAINT fk_movimento_banco_horas_fechamento_ponto_id FOREIGN KEY IF NOT EXISTS (fechamento_ponto_id) REFERENCES fechamento_ponto (id) ON DELETE RESTRICT;
ALTER TABLE ajuste_ponto ADD CONSTRAINT fk_ajuste_ponto_vinculo_trabalho_id FOREIGN KEY IF NOT EXISTS (vinculo_trabalho_id) REFERENCES vinculo_trabalho (id) ON DELETE RESTRICT;
ALTER TABLE ajuste_ponto ADD CONSTRAINT fk_ajuste_ponto_tipo_movimento_ponto_id FOREIGN KEY IF NOT EXISTS (tipo_movimento_ponto_id) REFERENCES tipo_movimento_ponto (id) ON DELETE RESTRICT;

ALTER TABLE processamento_folha ADD CONSTRAINT fk_processamento_folha_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;

ALTER TABLE processamento_folha_linha ADD CONSTRAINT fk_processamento_folha_linha_processamento_folha_id FOREIGN KEY IF NOT EXISTS (processamento_folha_id) REFERENCES processamento_folha (id) ON DELETE RESTRICT;
ALTER TABLE processamento_folha_linha ADD CONSTRAINT fk_processamento_folha_linha_vinculo_trabalho_id FOREIGN KEY IF NOT EXISTS (vinculo_trabalho_id) REFERENCES vinculo_trabalho (id) ON DELETE RESTRICT;
ALTER TABLE processamento_folha_linha ADD CONSTRAINT fk_processamento_folha_linha_rubrica_id FOREIGN KEY IF NOT EXISTS (rubrica_id) REFERENCES rubrica (id) ON DELETE RESTRICT;
ALTER TABLE processamento_folha_linha ADD CONSTRAINT fk_processamento_folha_linha_centro_custo_id FOREIGN KEY IF NOT EXISTS (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT;

ALTER TABLE parametro_folha ADD CONSTRAINT fk_parametro_folha_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;

ALTER TABLE fechamento_periodo_folha ADD CONSTRAINT fk_fechamento_periodo_folha_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE fechamento_periodo_folha ADD CONSTRAINT fk_fechamento_periodo_folha_fechado_por_usuario_id FOREIGN KEY IF NOT EXISTS (fechado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE fechamento_periodo_folha ADD CONSTRAINT fk_fechamento_periodo_folha_reaberto_por_usuario_id FOREIGN KEY IF NOT EXISTS (reaberto_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;

ALTER TABLE obrigacao_fechamento ADD CONSTRAINT fk_obrigacao_fechamento_obrigacao_trabalhista_id FOREIGN KEY IF NOT EXISTS (obrigacao_trabalhista_id) REFERENCES obrigacao_trabalhista (id) ON DELETE RESTRICT;
ALTER TABLE obrigacao_fechamento ADD CONSTRAINT fk_obrigacao_fechamento_fechamento_periodo_folha_id FOREIGN KEY IF NOT EXISTS (fechamento_periodo_folha_id) REFERENCES fechamento_periodo_folha (id) ON DELETE RESTRICT;

ALTER TABLE evento_periodo_ponto ADD CONSTRAINT fk_evento_periodo_ponto_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE evento_periodo_ponto ADD CONSTRAINT fk_evento_periodo_ponto_vinculo_trabalho_id FOREIGN KEY IF NOT EXISTS (vinculo_trabalho_id) REFERENCES vinculo_trabalho (id) ON DELETE RESTRICT;
ALTER TABLE evento_periodo_ponto ADD CONSTRAINT fk_evento_periodo_ponto_fechamento_ponto_id FOREIGN KEY IF NOT EXISTS (fechamento_ponto_id) REFERENCES fechamento_ponto (id) ON DELETE RESTRICT;
ALTER TABLE evento_periodo_ponto ADD CONSTRAINT fk_evento_periodo_ponto_usuario_id FOREIGN KEY IF NOT EXISTS (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;

ALTER TABLE inscricao_conselho_unidade ADD CONSTRAINT fk_inscricao_conselho_unidade_inscricao_conselho_id FOREIGN KEY IF NOT EXISTS (inscricao_conselho_id) REFERENCES inscricao_conselho (id) ON DELETE RESTRICT;
ALTER TABLE inscricao_conselho_unidade ADD CONSTRAINT fk_inscricao_conselho_unidade_unidade_assistencial_id FOREIGN KEY IF NOT EXISTS (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT;

ALTER TABLE curso_publico_alvo ADD CONSTRAINT fk_curso_publico_alvo_curso_id FOREIGN KEY IF NOT EXISTS (curso_id) REFERENCES curso (id) ON DELETE RESTRICT;
ALTER TABLE curso_publico_alvo ADD CONSTRAINT fk_curso_publico_alvo_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE curso_publico_alvo ADD CONSTRAINT fk_curso_publico_alvo_setor_funcional_id FOREIGN KEY IF NOT EXISTS (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE curso_publico_alvo ADD CONSTRAINT fk_curso_publico_alvo_funcao_id FOREIGN KEY IF NOT EXISTS (funcao_id) REFERENCES funcao (id) ON DELETE RESTRICT;

