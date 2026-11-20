-- Chaves do módulo HOT, lote 04 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE tipo_pendencia_prontuario_setor
  ADD CONSTRAINT fk_tipo_pendencia_prontuario_setor_tipo_pendencia_prontuario_id FOREIGN KEY (tipo_pendencia_prontuario_id) REFERENCES tipo_pendencia_prontuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_tipo_pendencia_prontuario_setor_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT;
ALTER TABLE triagem_nutricional
  ADD CONSTRAINT fk_triagem_nutricional_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_triagem_nutricional_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_triagem_nutricional_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_triagem_nutricional_instrumento_triagem_nutricional_id FOREIGN KEY (instrumento_triagem_nutricional_id) REFERENCES instrumento_triagem_nutricional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_triagem_nutricional_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_triagem_nutricional_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_triagem_nutricional_substitui_triagem_nutricional_id FOREIGN KEY (substitui_triagem_nutricional_id) REFERENCES triagem_nutricional (id) ON DELETE RESTRICT;
ALTER TABLE triagem_nutricional_resposta
  ADD CONSTRAINT fk_triagem_nutricional_resposta_triagem_nutricional_id FOREIGN KEY (triagem_nutricional_id) REFERENCES triagem_nutricional (id) ON DELETE RESTRICT;
ALTER TABLE vale_refeicao
  ADD CONSTRAINT fk_vale_refeicao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vale_refeicao_refeicao_do_dia_id FOREIGN KEY (refeicao_do_dia_id) REFERENCES refeicao_do_dia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vale_refeicao_tipo_destinatario_beneficio_id FOREIGN KEY (tipo_destinatario_beneficio_id) REFERENCES tipo_destinatario_beneficio (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vale_refeicao_pessoa_portaria_id FOREIGN KEY (pessoa_portaria_id) REFERENCES pessoa_portaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vale_refeicao_acompanhante_internacao_id FOREIGN KEY (acompanhante_internacao_id) REFERENCES acompanhante_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vale_refeicao_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vale_refeicao_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vale_refeicao_sessao_caixa_id FOREIGN KEY (sessao_caixa_id) REFERENCES sessao_caixa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vale_refeicao_recebimento_particular_id FOREIGN KEY (recebimento_particular_id) REFERENCES recebimento_particular (id) ON DELETE RESTRICT;
ALTER TABLE valor_hora_tecnico_manutencao
  ADD CONSTRAINT fk_valor_hora_tecnico_manutencao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_hora_tecnico_manutencao_colaborador_id FOREIGN KEY (colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_hora_tecnico_manutencao_oficina_manutencao_id FOREIGN KEY (oficina_manutencao_id) REFERENCES oficina_manutencao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_valor_hora_tecnico_manutencao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE visita
  ADD CONSTRAINT fk_visita_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_visita_pessoa_portaria_id FOREIGN KEY (pessoa_portaria_id) REFERENCES pessoa_portaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_visita_tipo_visitante_id FOREIGN KEY (tipo_visitante_id) REFERENCES tipo_visitante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_visita_tipo_visitado_id FOREIGN KEY (tipo_visitado_id) REFERENCES tipo_visitado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_visita_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_visita_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_visita_internacao_id FOREIGN KEY (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_visita_acompanhante_internacao_id FOREIGN KEY (acompanhante_internacao_id) REFERENCES acompanhante_internacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_visita_setor_funcional_id FOREIGN KEY (setor_funcional_id) REFERENCES setor_funcional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_visita_visitado_colaborador_id FOREIGN KEY (visitado_colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_visita_tipo_parentesco_id FOREIGN KEY (tipo_parentesco_id) REFERENCES tipo_parentesco (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_visita_forma_identificacao_visitante_id FOREIGN KEY (forma_identificacao_visitante_id) REFERENCES forma_identificacao_visitante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_visita_cracha_visitante_id FOREIGN KEY (cracha_visitante_id) REFERENCES cracha_visitante (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_visita_entrada_ponto_acesso_id FOREIGN KEY (entrada_ponto_acesso_id) REFERENCES ponto_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_visita_saida_ponto_acesso_id FOREIGN KEY (saida_ponto_acesso_id) REFERENCES ponto_acesso (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_visita_entrada_usuario_id FOREIGN KEY (entrada_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_visita_saida_usuario_id FOREIGN KEY (saida_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_visita_autorizador_usuario_id FOREIGN KEY (autorizador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE volume_prontuario
  ADD CONSTRAINT fk_volume_prontuario_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_volume_prontuario_paciente_id FOREIGN KEY (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_volume_prontuario_tipo_documento_arquivo_id FOREIGN KEY (tipo_documento_arquivo_id) REFERENCES tipo_documento_arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_volume_prontuario_atendimento_id FOREIGN KEY (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_volume_prontuario_local_arquivo_id FOREIGN KEY (local_arquivo_id) REFERENCES local_arquivo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_volume_prontuario_abertura_usuario_id FOREIGN KEY (abertura_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_volume_prontuario_encerramento_usuario_id FOREIGN KEY (encerramento_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_volume_prontuario_portador_colaborador_id FOREIGN KEY (portador_colaborador_id) REFERENCES colaborador (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_volume_prontuario_extravio_usuario_id FOREIGN KEY (extravio_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
