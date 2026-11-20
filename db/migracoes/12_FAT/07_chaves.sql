-- Módulo FAT, lote 07: chaves estrangeiras (aplicadas depois de todos os tabelas.sql).

ALTER TABLE tipo_pendencia_conta
  ADD CONSTRAINT fk_tipo_pendencia_conta_responsavel_setor_funcional_id FOREIGN KEY (responsavel_setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tipo_pendencia_conta_regime_atendimento_id FOREIGN KEY (regime_atendimento_id) REFERENCES regime_atendimento (id) ON DELETE RESTRICT;
ALTER TABLE tipo_pendencia_conta_modulo
  ADD CONSTRAINT fk_tipo_pendencia_conta_modulo_tipo_pendencia_conta_id FOREIGN KEY (tipo_pendencia_conta_id) REFERENCES tipo_pendencia_conta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tipo_pendencia_conta_modulo_modulo_sistema_id FOREIGN KEY (modulo_sistema_id) REFERENCES modulo_sistema (id) ON DELETE RESTRICT;
ALTER TABLE tipo_servico_faturavel
  ADD CONSTRAINT fk_tipo_servico_faturavel_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT;
ALTER TABLE transferencia_conta
  ADD CONSTRAINT fk_transferencia_conta_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_conta_conta_origem_id FOREIGN KEY (conta_origem_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_conta_conta_destino_id FOREIGN KEY (conta_destino_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_conta_fonte_pagadora_origem_id FOREIGN KEY (fonte_pagadora_origem_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_conta_fonte_pagadora_destino_id FOREIGN KEY (fonte_pagadora_destino_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_conta_estabelecimento_destino_id FOREIGN KEY (estabelecimento_destino_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_conta_lote_tiss_origem_id FOREIGN KEY (lote_tiss_origem_id) REFERENCES lote_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_conta_lote_tiss_destino_id FOREIGN KEY (lote_tiss_destino_id) REFERENCES lote_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_conta_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_conta_estorno_usuario_id FOREIGN KEY (estorno_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE transferencia_conta_item
  ADD CONSTRAINT fk_transferencia_conta_item_transferencia_conta_id FOREIGN KEY (transferencia_conta_id) REFERENCES transferencia_conta (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_conta_item_item_origem_id FOREIGN KEY (item_origem_id) REFERENCES conta_hospitalar_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_conta_item_item_destino_id FOREIGN KEY (item_destino_id) REFERENCES conta_hospitalar_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_transferencia_conta_item_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE usuario_codigo_prestador
  ADD CONSTRAINT fk_usuario_codigo_prestador_codigo_prestador_fonte_pagadora_id FOREIGN KEY (codigo_prestador_fonte_pagadora_id) REFERENCES codigo_prestador_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_usuario_codigo_prestador_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE valor_atributo_guia
  ADD CONSTRAINT fk_valor_atributo_guia_guia_tiss_id FOREIGN KEY (guia_tiss_id) REFERENCES guia_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_atributo_guia_atributo_guia_fonte_pagadora_id FOREIGN KEY (atributo_guia_fonte_pagadora_id) REFERENCES atributo_guia_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_atributo_guia_atributo_guia_opcao_id FOREIGN KEY (atributo_guia_opcao_id) REFERENCES atributo_guia_opcao (id) ON DELETE RESTRICT;
ALTER TABLE valor_hora_plantao
  ADD CONSTRAINT fk_valor_hora_plantao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_hora_plantao_grupo_setor_plantao_id FOREIGN KEY (grupo_setor_plantao_id) REFERENCES grupo_setor_plantao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_hora_plantao_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_hora_plantao_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_hora_plantao_especialidade_medica_id FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT;
ALTER TABLE valor_indice
  ADD CONSTRAINT fk_valor_indice_indice_cobranca_id FOREIGN KEY (indice_cobranca_id) REFERENCES indice_cobranca (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_indice_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_indice_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_indice_tabela_preco_id FOREIGN KEY (tabela_preco_id) REFERENCES tabela_preco (id) ON DELETE RESTRICT;
ALTER TABLE valor_indice_atendimento
  ADD CONSTRAINT fk_valor_indice_atendimento_valor_indice_id FOREIGN KEY (valor_indice_id) REFERENCES valor_indice (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_indice_atendimento_regime_atendimento_id FOREIGN KEY (regime_atendimento_id) REFERENCES regime_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_indice_atendimento_origem_entrada_atendimento_id FOREIGN KEY (origem_entrada_atendimento_id) REFERENCES origem_entrada_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_indice_atendimento_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT;
ALTER TABLE valor_indice_grupo
  ADD CONSTRAINT fk_valor_indice_grupo_valor_indice_id FOREIGN KEY (valor_indice_id) REFERENCES valor_indice (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_indice_grupo_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_indice_grupo_regime_atendimento_id FOREIGN KEY (regime_atendimento_id) REFERENCES regime_atendimento (id) ON DELETE RESTRICT;
ALTER TABLE valor_indice_item
  ADD CONSTRAINT fk_valor_indice_item_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_indice_item_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_indice_item_indice_cobranca_id FOREIGN KEY (indice_cobranca_id) REFERENCES indice_cobranca (id) ON DELETE RESTRICT;
ALTER TABLE valor_indice_setor
  ADD CONSTRAINT fk_valor_indice_setor_valor_indice_id FOREIGN KEY (valor_indice_id) REFERENCES valor_indice (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_indice_setor_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_indice_setor_regime_atendimento_id FOREIGN KEY (regime_atendimento_id) REFERENCES regime_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_indice_setor_grupo_faturamento_id FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento (id) ON DELETE RESTRICT;
ALTER TABLE valor_padrao_campo_tiss
  ADD CONSTRAINT fk_valor_padrao_campo_tiss_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_padrao_campo_tiss_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_padrao_campo_tiss_regra_apresentacao_tiss_id FOREIGN KEY (regra_apresentacao_tiss_id) REFERENCES regra_apresentacao_tiss (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_padrao_campo_tiss_regime_atendimento_id FOREIGN KEY (regime_atendimento_id) REFERENCES regime_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_padrao_campo_tiss_origem_entrada_atendimento_id FOREIGN KEY (origem_entrada_atendimento_id) REFERENCES origem_entrada_atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_padrao_campo_tiss_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT;
ALTER TABLE valor_porte_anestesico
  ADD CONSTRAINT fk_valor_porte_anestesico_tabela_preco_id FOREIGN KEY (tabela_preco_id) REFERENCES tabela_preco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_porte_anestesico_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_porte_anestesico_porte_procedimento_id FOREIGN KEY (porte_procedimento_id) REFERENCES porte_procedimento (id) ON DELETE RESTRICT;
ALTER TABLE valor_porte_medico
  ADD CONSTRAINT fk_valor_porte_medico_porte_procedimento_id FOREIGN KEY (porte_procedimento_id) REFERENCES porte_procedimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_porte_medico_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_porte_medico_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_porte_medico_tabela_preco_id FOREIGN KEY (tabela_preco_id) REFERENCES tabela_preco (id) ON DELETE RESTRICT;
ALTER TABLE versao_tabela_preco
  ADD CONSTRAINT fk_versao_tabela_preco_tabela_preco_id FOREIGN KEY (tabela_preco_id) REFERENCES tabela_preco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_versao_tabela_preco_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_versao_tabela_preco_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE visita_auditoria_externa
  ADD CONSTRAINT fk_visita_auditoria_externa_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_visita_auditoria_externa_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_visita_auditoria_externa_fatura_fonte_pagadora_id FOREIGN KEY (fatura_fonte_pagadora_id) REFERENCES fatura_fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_visita_auditoria_externa_acompanhante_usuario_id FOREIGN KEY (acompanhante_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_visita_auditoria_externa_cancelamento_usuario_id FOREIGN KEY (cancelamento_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
