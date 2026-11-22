-- Semente do catálogo de parâmetros do produto (parametro_definicao) pedida pelas fatias L6-03 a L6-06 (rodada 5,
-- ADR 0006). Idempotente, no mesmo formato de 14_FIN/14_chaves.sql. PROPOSTA para o integrador mover para
-- db/migracoes (02_ADM ou o módulo dono) e levar a todo cliente pelo criar_cliente. A conferência das fatias roda
-- exatamente este arquivo no PREPARO_DESTINO (sintetica_d/l6_06.py: preparo_parametros).
-- Tipos pelo formato que a carga grava hoje: lista (opções em parametro_opcao, origem migracao), booleano ('sim'/'nao'),
-- inteiro (minutos nas durações), texto (código como na origem). Os itens de AGPARAM e PRPAROFTALMO marcados
-- 'aguarda regra por item' mudam de tipo quando o motor aceitar regra e de-para por item no desdobrar (pedido L6-06).
INSERT INTO modulo_sistema (codigo, descricao, ativo, ordem, criado_em)
  SELECT 'agenda', 'Agenda', TRUE, 0, CURRENT_TIMESTAMP(3) FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM modulo_sistema WHERE codigo = 'agenda');
INSERT INTO modulo_sistema (codigo, descricao, ativo, ordem, criado_em)
  SELECT 'prontuario', 'Prontuário', TRUE, 0, CURRENT_TIMESTAMP(3) FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM modulo_sistema WHERE codigo = 'prontuario');
INSERT INTO parametro_definicao (chave, modulo_sistema_id, descricao, tipo, permite_rede, permite_estabelecimento, minimo, maximo, area_dona, fundamento, ativo, criado_em)
  SELECT x.chave, (SELECT MIN(m.id) FROM modulo_sistema m WHERE m.codigo = x.modulo), x.descricao, x.tipo, TRUE, TRUE, x.minimo, x.maximo, x.modulo, 'Continuidade do hospital migrado (ADR 0006)', TRUE, CURRENT_TIMESTAMP(3)
  FROM (
    SELECT 'agenda.retorno.tipoRetorno' AS chave, 'agenda' AS modulo, 'Tipo de retorno da consulta' AS descricao, 'lista' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'agenda.retorno.criterioRetorno', 'agenda', 'Critério de contagem do retorno', 'lista', NULL, NULL
    UNION ALL SELECT 'pep.alergia.estadoConfirmacao', 'prontuario', 'Estado de confirmação da alergia', 'lista', NULL, NULL
    UNION ALL SELECT 'pep.formulario.respostaPadrao', 'prontuario', 'Respostas padrão dos formulários', 'lista', NULL, NULL
    UNION ALL SELECT 'pep.email.opcaoEnvio', 'prontuario', 'Opções de envio de documento por e-mail', 'lista', NULL, NULL
    UNION ALL SELECT 'pep.impressaoPrescricao.leiaute', 'prontuario', 'Leiaute de impressão da prescrição', 'lista', NULL, NULL
    UNION ALL SELECT 'pep.impressaoPrescricao.tamanhoFonte', 'prontuario', 'Tamanho da fonte na impressão da prescrição', 'lista', NULL, NULL
    UNION ALL SELECT 'pep.documento.processo', 'prontuario', 'Processos do prontuário a que o documento pertence', 'lista', NULL, NULL
    UNION ALL SELECT 'pep.checagem.situacaoAnterior', 'prontuario', 'Situações da checagem do cadastro anterior', 'lista', NULL, NULL
    UNION ALL SELECT 'oftalmologia.acuidade.graduacao', 'prontuario', 'Graduações da acuidade visual', 'lista', NULL, NULL
    UNION ALL SELECT 'oftalmologia.anexo.extensaoArquivo', 'prontuario', 'Extensões de arquivo aceitas no anexo da oftalmologia', 'lista', NULL, NULL
    UNION ALL SELECT 'prescricao.checagem.loteValidadeObrigatorioMedicamento', 'prontuario', 'Lote e validade obrigatórios na checagem de medicamento', 'booleano', NULL, NULL
    UNION ALL SELECT 'prescricao.checagem.loteValidadeObrigatorioSolucao', 'prontuario', 'Lote e validade obrigatórios na checagem de solução', 'booleano', NULL, NULL
    UNION ALL SELECT 'prescricao.checagem.loteValidadeObrigatorioHemocomponente', 'prontuario', 'Lote e validade obrigatórios na checagem de hemocomponente', 'booleano', NULL, NULL
    UNION ALL SELECT 'prescricao.futura.tempoAvaliacao', 'prontuario', 'Tempo de avaliação da prescrição futura (minutos)', 'inteiro', 0, NULL
    UNION ALL SELECT 'prescricao.futura.antecedenciaAvaliacao', 'prontuario', 'Antecedência da avaliação da prescrição futura (minutos)', 'inteiro', 0, NULL
    UNION ALL SELECT 'oftalmologia.lancarAdicao', 'prontuario', 'Lança a adição na prescrição ocular (1 sim, 0 não) - aguarda regra por item para booleano', 'inteiro', 0, 1
    UNION ALL SELECT 'oftalmologia.relatorioPrescricaoOcularAnterior', 'prontuario', 'Relatório da prescrição ocular do sistema anterior (id guardado como referência)', 'inteiro', 0, NULL
    UNION ALL SELECT 'agenda.cadeira.quantidadeAgendas', 'agenda', 'Quantidade de agendas da agenda de cadeiras', 'inteiro', 0, NULL
    UNION ALL SELECT 'agenda.cadeira.situacaoDesmarcada', 'agenda', 'Situação da marcação desmarcada (código)', 'texto', NULL, NULL
    UNION ALL SELECT 'agenda.cadeira.agendamentoPendenteAnterior', 'agenda', 'Agendamento pendente do cadastro anterior (id)', 'inteiro', 0, NULL
    UNION ALL SELECT 'agenda.cadeira.duracaoMedia', 'agenda', 'Duração da sessão média (hora da origem) - aguarda regra por item para minutos', 'texto', NULL, NULL
    UNION ALL SELECT 'agenda.cadeira.duracaoLonga', 'agenda', 'Duração da sessão longa (hora da origem) - aguarda regra por item para minutos', 'texto', NULL, NULL
    UNION ALL SELECT 'agenda.cadeira.duracaoCurta', 'agenda', 'Duração da sessão curta (hora da origem) - aguarda regra por item para minutos', 'texto', NULL, NULL
    UNION ALL SELECT 'agenda.cadeira.motivoFeriado', 'agenda', 'Motivo de bloqueio no feriado (id)', 'inteiro', 0, NULL
    UNION ALL SELECT 'agenda.cadeira.motivoIndisponibilidade', 'agenda', 'Motivo de bloqueio na indisponibilidade (id)', 'inteiro', 0, NULL
    UNION ALL SELECT 'agenda.cadeira.motivoOcupada', 'agenda', 'Motivo de bloqueio da cadeira ocupada (id)', 'inteiro', 0, NULL
    UNION ALL SELECT 'agenda.cadeira.motivoForaExpediente', 'agenda', 'Motivo de bloqueio fora do expediente (id)', 'inteiro', 0, NULL
    UNION ALL SELECT 'agenda.cadeira.situacaoRealizada', 'agenda', 'Situação da marcação realizada (código)', 'texto', NULL, NULL
    UNION ALL SELECT 'agenda.cadeira.exibirEspecialidadeCbo', 'agenda', 'Exibe a especialidade pelo CBO (S ou N da origem) - aguarda regra por item para booleano', 'texto', NULL, NULL
    UNION ALL SELECT 'agenda.cadeira.preferenciaAgenda', 'agenda', 'Preferência pela agenda de cadeiras (S ou N da origem) - aguarda regra por item para booleano', 'texto', NULL, NULL
    UNION ALL SELECT 'agenda.cadeira.canalGeracaoPlanejamento', 'agenda', 'Canal da marcação gerada pelo planejamento (id)', 'inteiro', 0, NULL
    UNION ALL SELECT 'agenda.cadeira.situacaoGeracaoPlanejamento', 'agenda', 'Situação da marcação gerada pelo planejamento (código)', 'texto', NULL, NULL
    UNION ALL SELECT 'agenda.cadeira.agendamentoAutomaticoPlanejamento', 'agenda', 'Agendamento automático pelo planejamento (S ou N da origem) - aguarda regra por item para booleano', 'texto', NULL, NULL
    UNION ALL SELECT 'agenda.cadeira.digitarEnfermeiroResponsavel', 'agenda', 'Digitar o enfermeiro responsável (S ou N da origem) - aguarda regra por item para booleano', 'texto', NULL, NULL
  ) x
  WHERE NOT EXISTS (SELECT 1 FROM parametro_definicao d WHERE d.chave = x.chave);
