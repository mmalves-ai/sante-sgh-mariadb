-- Chaves do módulo SUS, lote 03 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE remessa_bpa
  ADD CONSTRAINT fk_remessa_bpa_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_bpa_competencia_sus_id FOREIGN KEY (competencia_sus_id) REFERENCES competencia_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_bpa_responsavel_setor_funcional_id FOREIGN KEY (responsavel_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_bpa_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_bpa_gerador_usuario_id FOREIGN KEY (gerador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_bpa_remetente_usuario_id FOREIGN KEY (remetente_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_bpa_substituta_remessa_bpa_id FOREIGN KEY (substituta_remessa_bpa_id) REFERENCES remessa_bpa (id) ON DELETE RESTRICT;
ALTER TABLE remessa_ciha
  ADD CONSTRAINT fk_remessa_ciha_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_ciha_competencia_sus_id FOREIGN KEY (competencia_sus_id) REFERENCES competencia_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_ciha_abertura_usuario_id FOREIGN KEY (abertura_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_ciha_fechamento_usuario_id FOREIGN KEY (fechamento_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_ciha_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_ciha_gerador_usuario_id FOREIGN KEY (gerador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_ciha_remetente_usuario_id FOREIGN KEY (remetente_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_ciha_substituta_remessa_ciha_id FOREIGN KEY (substituta_remessa_ciha_id) REFERENCES remessa_ciha (id) ON DELETE RESTRICT;
ALTER TABLE remessa_raas
  ADD CONSTRAINT fk_remessa_raas_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_raas_competencia_sus_id FOREIGN KEY (competencia_sus_id) REFERENCES competencia_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_raas_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_raas_gerador_usuario_id FOREIGN KEY (gerador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_raas_remetente_usuario_id FOREIGN KEY (remetente_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_raas_substituta_remessa_raas_id FOREIGN KEY (substituta_remessa_raas_id) REFERENCES remessa_raas (id) ON DELETE RESTRICT;
ALTER TABLE remessa_sisaih
  ADD CONSTRAINT fk_remessa_sisaih_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_sisaih_competencia_sus_id FOREIGN KEY (competencia_sus_id) REFERENCES competencia_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_sisaih_setor_faturamento_setor_funcional_id FOREIGN KEY (setor_faturamento_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_sisaih_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_sisaih_gerador_usuario_id FOREIGN KEY (gerador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_sisaih_remetente_usuario_id FOREIGN KEY (remetente_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_sisaih_substituta_remessa_sisaih_id FOREIGN KEY (substituta_remessa_sisaih_id) REFERENCES remessa_sisaih (id) ON DELETE RESTRICT;
ALTER TABLE retorno_sus
  ADD CONSTRAINT fk_retorno_sus_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_sus_competencia_sus_id FOREIGN KEY (competencia_sus_id) REFERENCES competencia_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_sus_remessa_bpa_id FOREIGN KEY (remessa_bpa_id) REFERENCES remessa_bpa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_sus_remessa_apac_id FOREIGN KEY (remessa_apac_id) REFERENCES remessa_apac (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_sus_remessa_raas_id FOREIGN KEY (remessa_raas_id) REFERENCES remessa_raas (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_sus_remessa_sisaih_id FOREIGN KEY (remessa_sisaih_id) REFERENCES remessa_sisaih (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_sus_remessa_ciha_id FOREIGN KEY (remessa_ciha_id) REFERENCES remessa_ciha (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_sus_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_sus_importador_usuario_id FOREIGN KEY (importador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_retorno_sus_conciliador_usuario_id FOREIGN KEY (conciliador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE teto_financeiro_sus
  ADD CONSTRAINT fk_teto_financeiro_sus_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teto_financeiro_sus_contrato_gestor_sus_id FOREIGN KEY (contrato_gestor_sus_id) REFERENCES contrato_gestor_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teto_financeiro_sus_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teto_financeiro_sus_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teto_financeiro_sus_grupo_sigtap_id FOREIGN KEY (grupo_sigtap_id) REFERENCES grupo_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_teto_financeiro_sus_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT;
ALTER TABLE tipo_laudo_apac
  ADD CONSTRAINT fk_tipo_laudo_apac_autorizador_sus_id FOREIGN KEY (autorizador_sus_id) REFERENCES autorizador_sus (id) ON DELETE RESTRICT;
ALTER TABLE transferencia_cota_sus
  ADD CONSTRAINT fk_transferencia_cota_sus_cota_procedimento_sus_id FOREIGN KEY (cota_procedimento_sus_id) REFERENCES cota_procedimento_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_cota_sus_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_cota_sus_destino_cota_procedimento_sus_id FOREIGN KEY (destino_cota_procedimento_sus_id) REFERENCES cota_procedimento_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_cota_sus_origem_setor_funcional_id FOREIGN KEY (origem_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_cota_sus_destino_setor_funcional_id FOREIGN KEY (destino_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_cota_sus_origem_municipio_ibge_id FOREIGN KEY (origem_municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_cota_sus_destino_municipio_ibge_id FOREIGN KEY (destino_municipio_ibge_id) REFERENCES municipio_ibge (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_cota_sus_origem_competencia_sus_id FOREIGN KEY (origem_competencia_sus_id) REFERENCES competencia_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_cota_sus_destino_competencia_sus_id FOREIGN KEY (destino_competencia_sus_id) REFERENCES competencia_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_cota_sus_solicitante_usuario_id FOREIGN KEY (solicitante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_cota_sus_aprovador_usuario_id FOREIGN KEY (aprovador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE valor_complementar_sus
  ADD CONSTRAINT fk_valor_complementar_sus_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_complementar_sus_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_complementar_sus_contrato_gestor_sus_id FOREIGN KEY (contrato_gestor_sus_id) REFERENCES contrato_gestor_sus (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_complementar_sus_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_complementar_sus_grupo_sigtap_id FOREIGN KEY (grupo_sigtap_id) REFERENCES grupo_sigtap (id) ON DELETE RESTRICT;
