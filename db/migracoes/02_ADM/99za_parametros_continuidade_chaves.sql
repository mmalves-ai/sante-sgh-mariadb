-- Recusas da carga (fase 2, K2, C7): catálogo do produto dos parâmetros que a importação usa para continuar a
-- configuração do hospital (ADR 0006; listas do hospital em parametro_opcao, valores em parametro_valor). Sem a
-- definição, a carga recusava as opções e os valores (PRCADRESP e cerca de 20 tabelas pequenas). Reúne as propostas
-- das fatias L6-03 a L6-06 e L6-11 (docs/obra/fatias/f4/saida) e as chaves da hotelaria e da hemoterapia
-- (as do financeiro já vêm de 14_FIN/14_chaves.sql). Espelha packages/contratos/src/parametros/continuidade.ts. Semente idempotente, válida em qualquer
-- ordem (ADR 0002): só inclui o que falta e nunca altera o que o cliente já tem.

INSERT INTO modulo_sistema (codigo, descricao, ativo, ordem, criado_em)
  SELECT 'agenda', 'Agenda', TRUE, 0, UTC_TIMESTAMP(3) FROM DUAL
  WHERE NOT EXISTS (SELECT 1 FROM modulo_sistema WHERE codigo = 'agenda');
INSERT INTO modulo_sistema (codigo, descricao, ativo, ordem, criado_em)
  SELECT 'hotelaria', 'Hotelaria', TRUE, 0, UTC_TIMESTAMP(3) FROM DUAL
  WHERE NOT EXISTS (SELECT 1 FROM modulo_sistema WHERE codigo = 'hotelaria');
INSERT INTO modulo_sistema (codigo, descricao, ativo, ordem, criado_em)
  SELECT 'pep', 'Prontuário eletrônico', TRUE, 0, UTC_TIMESTAMP(3) FROM DUAL
  WHERE NOT EXISTS (SELECT 1 FROM modulo_sistema WHERE codigo = 'pep');
INSERT INTO modulo_sistema (codigo, descricao, ativo, ordem, criado_em)
  SELECT 'sadt', 'Apoio diagnóstico e terapêutico', TRUE, 0, UTC_TIMESTAMP(3) FROM DUAL
  WHERE NOT EXISTS (SELECT 1 FROM modulo_sistema WHERE codigo = 'sadt');
INSERT INTO parametro_definicao (chave, modulo_sistema_id, descricao, tipo, permite_rede, permite_estabelecimento,
  minimo, maximo, area_dona, fundamento, ativo, criado_em)
  SELECT x.chave, (SELECT MIN(m.id) FROM modulo_sistema m WHERE m.codigo = x.modulo), x.descricao, x.tipo, TRUE, TRUE,
    x.minimo, x.maximo, x.modulo, 'Continuidade do hospital migrado (ADR 0006)', TRUE, UTC_TIMESTAMP(3)
  FROM (
    SELECT 'agenda.cadeira.agendamentoAutomaticoPlanejamento' AS chave, 'agenda' AS modulo, 'Agendamento automático pelo planejamento (S ou N da origem) - aguarda regra por item para booleano' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'agenda.cadeira.agendamentoPendenteAnterior' AS chave, 'agenda' AS modulo, 'Agendamento pendente do cadastro anterior (id)' AS descricao, 'inteiro' AS tipo, 0 AS minimo, NULL AS maximo
    UNION ALL SELECT 'agenda.cadeira.canalGeracaoPlanejamento' AS chave, 'agenda' AS modulo, 'Canal da marcação gerada pelo planejamento (id)' AS descricao, 'inteiro' AS tipo, 0 AS minimo, NULL AS maximo
    UNION ALL SELECT 'agenda.cadeira.digitarEnfermeiroResponsavel' AS chave, 'agenda' AS modulo, 'Digitar o enfermeiro responsável (S ou N da origem) - aguarda regra por item para booleano' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'agenda.cadeira.duracaoCurta' AS chave, 'agenda' AS modulo, 'Duração da sessão curta (hora da origem) - aguarda regra por item para minutos' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'agenda.cadeira.duracaoLonga' AS chave, 'agenda' AS modulo, 'Duração da sessão longa (hora da origem) - aguarda regra por item para minutos' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'agenda.cadeira.duracaoMedia' AS chave, 'agenda' AS modulo, 'Duração da sessão média (hora da origem) - aguarda regra por item para minutos' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'agenda.cadeira.exibirEspecialidadeCbo' AS chave, 'agenda' AS modulo, 'Exibe a especialidade pelo CBO (S ou N da origem) - aguarda regra por item para booleano' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'agenda.cadeira.motivoFeriado' AS chave, 'agenda' AS modulo, 'Motivo de bloqueio no feriado (id)' AS descricao, 'inteiro' AS tipo, 0 AS minimo, NULL AS maximo
    UNION ALL SELECT 'agenda.cadeira.motivoForaExpediente' AS chave, 'agenda' AS modulo, 'Motivo de bloqueio fora do expediente (id)' AS descricao, 'inteiro' AS tipo, 0 AS minimo, NULL AS maximo
    UNION ALL SELECT 'agenda.cadeira.motivoIndisponibilidade' AS chave, 'agenda' AS modulo, 'Motivo de bloqueio na indisponibilidade (id)' AS descricao, 'inteiro' AS tipo, 0 AS minimo, NULL AS maximo
    UNION ALL SELECT 'agenda.cadeira.motivoOcupada' AS chave, 'agenda' AS modulo, 'Motivo de bloqueio da cadeira ocupada (id)' AS descricao, 'inteiro' AS tipo, 0 AS minimo, NULL AS maximo
    UNION ALL SELECT 'agenda.cadeira.preferenciaAgenda' AS chave, 'agenda' AS modulo, 'Preferência pela agenda de cadeiras (S ou N da origem) - aguarda regra por item para booleano' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'agenda.cadeira.quantidadeAgendas' AS chave, 'agenda' AS modulo, 'Quantidade de agendas da agenda de cadeiras' AS descricao, 'inteiro' AS tipo, 0 AS minimo, NULL AS maximo
    UNION ALL SELECT 'agenda.cadeira.situacaoDesmarcada' AS chave, 'agenda' AS modulo, 'Situação da marcação desmarcada (código)' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'agenda.cadeira.situacaoGeracaoPlanejamento' AS chave, 'agenda' AS modulo, 'Situação da marcação gerada pelo planejamento (código)' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'agenda.cadeira.situacaoRealizada' AS chave, 'agenda' AS modulo, 'Situação da marcação realizada (código)' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'agenda.retorno.criterioRetorno' AS chave, 'agenda' AS modulo, 'Critério de contagem do retorno' AS descricao, 'lista' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'agenda.retorno.tipoRetorno' AS chave, 'agenda' AS modulo, 'Tipo de retorno da consulta' AS descricao, 'lista' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'hotelaria.higienizacao.materialLimpezaPadrao' AS chave, 'hotelaria' AS modulo, 'Hotelaria, higienização: material limpeza padrao (configuração do hospital migrado)' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'hotelaria.higienizacao.situacaoLeitoAposAlta' AS chave, 'hotelaria' AS modulo, 'Hotelaria, higienização: situacao leito apos alta (configuração do hospital migrado)' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'hotelaria.visita.corEmVisita' AS chave, 'hotelaria' AS modulo, 'Hotelaria, controle de visitas: cor em visita (configuração do hospital migrado)' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'hotelaria.visita.corSaidaPendente' AS chave, 'hotelaria' AS modulo, 'Hotelaria, controle de visitas: cor saida pendente (configuração do hospital migrado)' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'hotelaria.visita.corVisitaEmEspera' AS chave, 'hotelaria' AS modulo, 'Hotelaria, controle de visitas: cor visita em espera (configuração do hospital migrado)' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'hotelaria.visita.corVisitaFinalizada' AS chave, 'hotelaria' AS modulo, 'Hotelaria, controle de visitas: cor visita finalizada (configuração do hospital migrado)' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'hotelaria.visita.diretorioFotos' AS chave, 'hotelaria' AS modulo, 'Hotelaria, controle de visitas: diretorio fotos (configuração do hospital migrado)' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'hotelaria.visita.exigeCelular' AS chave, 'hotelaria' AS modulo, 'Hotelaria, controle de visitas: exige celular (configuração do hospital migrado)' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'hotelaria.visita.exigeDataNascimento' AS chave, 'hotelaria' AS modulo, 'Hotelaria, controle de visitas: exige data nascimento (configuração do hospital migrado)' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'hotelaria.visita.exigeDocumento' AS chave, 'hotelaria' AS modulo, 'Hotelaria, controle de visitas: exige documento (configuração do hospital migrado)' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'hotelaria.visita.gravarFotoNoBanco' AS chave, 'hotelaria' AS modulo, 'Hotelaria, controle de visitas: gravar foto no banco (configuração do hospital migrado)' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'hotelaria.visita.imprimirEtiquetaSemVisualizar' AS chave, 'hotelaria' AS modulo, 'Hotelaria, controle de visitas: imprimir etiqueta sem visualizar (configuração do hospital migrado)' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'hotelaria.visita.modeloEtiqueta' AS chave, 'hotelaria' AS modulo, 'Hotelaria, controle de visitas: modelo etiqueta (configuração do hospital migrado)' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'hotelaria.visita.situacaoAcessoPadrao' AS chave, 'hotelaria' AS modulo, 'Hotelaria, controle de visitas: situacao acesso padrao (configuração do hospital migrado)' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'oftalmologia.acuidade.graduacao' AS chave, 'pep' AS modulo, 'Graduações da acuidade visual' AS descricao, 'lista' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'oftalmologia.anexo.extensaoArquivo' AS chave, 'pep' AS modulo, 'Extensões de arquivo aceitas no anexo da oftalmologia' AS descricao, 'lista' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'oftalmologia.lancarAdicao' AS chave, 'pep' AS modulo, 'Lança a adição na prescrição ocular (1 sim, 0 não) - aguarda regra por item para booleano' AS descricao, 'inteiro' AS tipo, 0 AS minimo, 1 AS maximo
    UNION ALL SELECT 'oftalmologia.relatorioPrescricaoOcularAnterior' AS chave, 'pep' AS modulo, 'Relatório da prescrição ocular do sistema anterior (id guardado como referência)' AS descricao, 'inteiro' AS tipo, 0 AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.alergia.estadoConfirmacao' AS chave, 'pep' AS modulo, 'Estado de confirmação da alergia' AS descricao, 'lista' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.assinatura.assinaDigitalmente' AS chave, 'pep' AS modulo, 'Prontuário (assinatura): assina digitalmente' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.assinatura.habilitada' AS chave, 'pep' AS modulo, 'Prontuário (assinatura): habilitada' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.assinatura.semAvisoPendenteAoEntrar' AS chave, 'pep' AS modulo, 'Prontuário (assinatura): sem aviso pendente ao entrar' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.assinatura.tempoExibicaoPendente' AS chave, 'pep' AS modulo, 'Prontuário (assinatura): tempo exibicao pendente' AS descricao, 'inteiro' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.assinatura.textoEmailDocumentoAssinado' AS chave, 'pep' AS modulo, 'Prontuário (assinatura): texto email documento assinado' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.checagem.antecedenciaPermitida' AS chave, 'pep' AS modulo, 'Prontuário (checagem): antecedencia permitida' AS descricao, 'inteiro' AS tipo, 0 AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.checagem.dataInicioPendencias' AS chave, 'pep' AS modulo, 'Prontuário (checagem): data inicio pendencias' AS descricao, 'data' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.checagem.exigeChecagemEnfermagem' AS chave, 'pep' AS modulo, 'Prontuário (checagem): exige checagem enfermagem' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.checagem.exigeChecagemLaboratorio' AS chave, 'pep' AS modulo, 'Prontuário (checagem): exige checagem laboratorio' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.checagem.exigeChecagemMaterial' AS chave, 'pep' AS modulo, 'Prontuário (checagem): exige checagem material' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.checagem.exigeMotivoFalta' AS chave, 'pep' AS modulo, 'Prontuário (checagem): exige motivo falta' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.checagem.memorizaNaoAdministrado' AS chave, 'pep' AS modulo, 'Prontuário (checagem): memoriza nao administrado' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.checagem.quantidadeProfissionaisEnfermagem' AS chave, 'pep' AS modulo, 'Prontuário (checagem): quantidade profissionais enfermagem' AS descricao, 'lista' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.checagem.situacaoAnterior' AS chave, 'pep' AS modulo, 'Situações da checagem do cadastro anterior' AS descricao, 'lista' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.checagem.somenteItensAssinados' AS chave, 'pep' AS modulo, 'Prontuário (checagem): somente itens assinados' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.checagem.somenteItensConsolidados' AS chave, 'pep' AS modulo, 'Prontuário (checagem): somente itens consolidados' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.checagem.toleranciaHorario' AS chave, 'pep' AS modulo, 'Prontuário (checagem): tolerancia horario' AS descricao, 'inteiro' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.checagem.validaIntervalo' AS chave, 'pep' AS modulo, 'Prontuário (checagem): valida intervalo' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.checagem.validaIntervaloDose' AS chave, 'pep' AS modulo, 'Prontuário (checagem): valida intervalo dose' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.documento.processo' AS chave, 'pep' AS modulo, 'Processos do prontuário a que o documento pertence' AS descricao, 'lista' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.documentos.integracaoArquivoPor' AS chave, 'pep' AS modulo, 'Prontuário (documentos): integracao arquivo por' AS descricao, 'lista' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.documentos.tipoAtestadoRequerimento' AS chave, 'pep' AS modulo, 'Prontuário (documentos): tipo atestado requerimento' AS descricao, 'lista' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.documentos.usaServicoArmazenamento' AS chave, 'pep' AS modulo, 'Prontuário (documentos): usa servico armazenamento' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.email.opcaoEnvio' AS chave, 'pep' AS modulo, 'Opções de envio de documento por e-mail' AS descricao, 'lista' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.formulario.respostaPadrao' AS chave, 'pep' AS modulo, 'Respostas padrão dos formulários' AS descricao, 'lista' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.antimicrobiano.exibeFrequencia' AS chave, 'pep' AS modulo, 'Prontuário (impressao.antimicrobiano): exibe frequencia' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.duplex' AS chave, 'pep' AS modulo, 'Prontuário (impressao): duplex' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.exibeParametros' AS chave, 'pep' AS modulo, 'Prontuário (impressao): exibe parametros' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.mantemLancamentoMesmaPagina' AS chave, 'pep' AS modulo, 'Prontuário (impressao): mantem lancamento mesma pagina' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.prescricao.agrupaAtendimentoPsiquiatria' AS chave, 'pep' AS modulo, 'Prontuário (impressao.prescricao): agrupa atendimento psiquiatria' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.prescricao.agrupaPorTipoLancamento' AS chave, 'pep' AS modulo, 'Prontuário (impressao.prescricao): agrupa por tipo lancamento' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.prescricao.agrupamento' AS chave, 'pep' AS modulo, 'Prontuário (impressao.prescricao): agrupamento' AS descricao, 'lista' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.prescricao.assinatura' AS chave, 'pep' AS modulo, 'Prontuário (impressao.prescricao): assinatura' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.prescricao.cabecalhoMedico' AS chave, 'pep' AS modulo, 'Prontuário (impressao.prescricao): cabecalho medico' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.prescricao.codigoRegional' AS chave, 'pep' AS modulo, 'Prontuário (impressao.prescricao): codigo regional' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.prescricao.colunaData' AS chave, 'pep' AS modulo, 'Prontuário (impressao.prescricao): coluna data' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.prescricao.digitoConselho' AS chave, 'pep' AS modulo, 'Prontuário (impressao.prescricao): digito conselho' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.prescricao.duplex' AS chave, 'pep' AS modulo, 'Prontuário (impressao.prescricao): duplex' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.prescricao.exibeNomeComercial' AS chave, 'pep' AS modulo, 'Prontuário (impressao.prescricao): exibe nome comercial' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.prescricao.frenteVerso' AS chave, 'pep' AS modulo, 'Prontuário (impressao.prescricao): frente verso' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.prescricao.horarioMedicacao' AS chave, 'pep' AS modulo, 'Prontuário (impressao.prescricao): horario medicacao' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.prescricao.horariosPreCadastrados' AS chave, 'pep' AS modulo, 'Prontuário (impressao.prescricao): horarios pre cadastrados' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeBombaInfusao' AS chave, 'pep' AS modulo, 'Prontuário (impressao.prescricao): imprime bomba infusao' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeDatas' AS chave, 'pep' AS modulo, 'Prontuário (impressao.prescricao): imprime datas' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeDescricaoProtocolo' AS chave, 'pep' AS modulo, 'Prontuário (impressao.prescricao): imprime descricao protocolo' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeDoseTotal' AS chave, 'pep' AS modulo, 'Prontuário (impressao.prescricao): imprime dose total' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeEmitidoEm' AS chave, 'pep' AS modulo, 'Prontuário (impressao.prescricao): imprime emitido em' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeEvolucaoEnfermagem' AS chave, 'pep' AS modulo, 'Prontuário (impressao.prescricao): imprime evolucao enfermagem' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeHorarios' AS chave, 'pep' AS modulo, 'Prontuário (impressao.prescricao): imprime horarios' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeMateriais' AS chave, 'pep' AS modulo, 'Prontuário (impressao.prescricao): imprime materiais' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeNumeroDoses' AS chave, 'pep' AS modulo, 'Prontuário (impressao.prescricao): imprime numero doses' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeQuantidade' AS chave, 'pep' AS modulo, 'Prontuário (impressao.prescricao): imprime quantidade' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeQuantidadePadrao' AS chave, 'pep' AS modulo, 'Prontuário (impressao.prescricao): imprime quantidade padrao' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeRegistro' AS chave, 'pep' AS modulo, 'Prontuário (impressao.prescricao): imprime registro' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeRelacaoMedicamentos' AS chave, 'pep' AS modulo, 'Prontuário (impressao.prescricao): imprime relacao medicamentos' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeRequisicao' AS chave, 'pep' AS modulo, 'Prontuário (impressao.prescricao): imprime requisicao' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.prescricao.medicoNoRodape' AS chave, 'pep' AS modulo, 'Prontuário (impressao.prescricao): medico no rodape' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.prescricao.modelo' AS chave, 'pep' AS modulo, 'Prontuário (impressao.prescricao): modelo' AS descricao, 'lista' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.prescricao.paginasPadrao' AS chave, 'pep' AS modulo, 'Prontuário (impressao.prescricao): paginas padrao' AS descricao, 'inteiro' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.prescricao.referenciaBibliografica' AS chave, 'pep' AS modulo, 'Prontuário (impressao.prescricao): referencia bibliografica' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.prescricao.zebrado' AS chave, 'pep' AS modulo, 'Prontuário (impressao.prescricao): zebrado' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.prescricaoOncologica.assinatura' AS chave, 'pep' AS modulo, 'Prontuário (impressao.prescricaoOncologica): assinatura' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.prescricaoOncologica.data' AS chave, 'pep' AS modulo, 'Prontuário (impressao.prescricaoOncologica): data' AS descricao, 'lista' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.prescricaoOncologica.nomeCidade' AS chave, 'pep' AS modulo, 'Prontuário (impressao.prescricaoOncologica): nome cidade' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressao.solicitacaoExame.porConvenio' AS chave, 'pep' AS modulo, 'Prontuário (impressao.solicitacaoExame): por convenio' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressaoPrescricao.leiaute' AS chave, 'pep' AS modulo, 'Leiaute de impressão da prescrição' AS descricao, 'lista' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.impressaoPrescricao.tamanhoFonte' AS chave, 'pep' AS modulo, 'Tamanho da fonte na impressão da prescrição' AS descricao, 'lista' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.integracao.laboratorio.endereco' AS chave, 'pep' AS modulo, 'Prontuário (integracao.laboratorio): endereco' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.integracao.laboratorio.modo' AS chave, 'pep' AS modulo, 'Prontuário (integracao.laboratorio): modo' AS descricao, 'lista' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.internacao.exigeLaudoApos48Horas' AS chave, 'pep' AS modulo, 'Prontuário (internacao): exige laudo apos48horas' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.painel.colunaEsperaAtendimento' AS chave, 'pep' AS modulo, 'Prontuário (painel): coluna espera atendimento' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.painel.colunaEsperaLocal' AS chave, 'pep' AS modulo, 'Prontuário (painel): coluna espera local' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.painel.colunaEsperaSenha' AS chave, 'pep' AS modulo, 'Prontuário (painel): coluna espera senha' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.painel.colunaEsperaUltimaMovimentacao' AS chave, 'pep' AS modulo, 'Prontuário (painel): coluna espera ultima movimentacao' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.painel.exibeAtendimentoGeradoExame' AS chave, 'pep' AS modulo, 'Prontuário (painel): exibe atendimento gerado exame' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.painel.liberaPacienteIntegrado' AS chave, 'pep' AS modulo, 'Prontuário (painel): libera paciente integrado' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.painel.telaAuxiliarLocalizacao' AS chave, 'pep' AS modulo, 'Prontuário (painel): tela auxiliar localizacao' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.alertaExameRepetido' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): alerta exame repetido' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.antimicrobiano.complementoPedido' AS chave, 'pep' AS modulo, 'Prontuário (prescricao.antimicrobiano): complemento pedido' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.antimicrobiano.tipoLancamento' AS chave, 'pep' AS modulo, 'Prontuário (prescricao.antimicrobiano): tipo lancamento' AS descricao, 'lista' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.aprazamentoPelaEnfermagem' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): aprazamento pela enfermagem' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.avaliacaoFarmaceuticaForaPadrao' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): avaliacao farmaceutica fora padrao' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.cabecalhoHistorico' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): cabecalho historico' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.calculaVelocidadeInfusao' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): calcula velocidade infusao' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.consideraImpressa' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): considera impressa' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.consisteFrequenciaUnica' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): consiste frequencia unica' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.consisteItemDuplicado' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): consiste item duplicado' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.controlaCateter' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): controla cateter' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.diasPrescricaoAnterior' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): dias prescricao anterior' AS descricao, 'inteiro' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.documentoSeparadoConsignado' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): documento separado consignado' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.especialidadePsiquiatria' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): especialidade psiquiatria' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.exameForaPadrao' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): exame fora padrao' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.exibeMateriais' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): exibe materiais' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.exibeNomeKit' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): exibe nome kit' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.exibeProtocoloItemNaoPadronizado' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): exibe protocolo item nao padronizado' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.exibeReferenciaComercial' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): exibe referencia comercial' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.exibeReferenciaDiluente' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): exibe referencia diluente' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.exigeValidacaoAntimicrobiano' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): exige validacao antimicrobiano' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.exigeValidacaoFarmaceutica' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): exige validacao farmaceutica' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.fatorDietaBlend' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): fator dieta blend' AS descricao, 'decimal' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.geraDocumentoDevolucaoEstoque' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): gera documento devolucao estoque' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.geraFolhaSala' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): gera folha sala' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.geraRequisicaoEstoque' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): gera requisicao estoque' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.incluiDieta' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): inclui dieta' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.incluiKitMateriais' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): inclui kit materiais' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.incluiKitNaPrescricaoMedica' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): inclui kit na prescricao medica' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.lancaKit' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): lanca kit' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.lancaNaConta' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): lanca na conta' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.lembraViaAcessoItem' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): lembra via acesso item' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.observacaoMedicaLonga' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): observacao medica longa' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.percentualExigeJustificativa' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): percentual exige justificativa' AS descricao, 'inteiro' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.permiteCorrigirPrescricaoValidada' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): permite corrigir prescricao validada' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.permiteIncluirItensPrescricao' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): permite incluir itens prescricao' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.permitePercentualAcimaLimite' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): permite percentual acima limite' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.permitePrescricaoUrgencia' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): permite prescricao urgencia' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.planejamento.alertaPendente' AS chave, 'pep' AS modulo, 'Prontuário (prescricao.planejamento): alerta pendente' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.planejamento.diasAlertaPendente' AS chave, 'pep' AS modulo, 'Prontuário (prescricao.planejamento): dias alerta pendente' AS descricao, 'inteiro' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.planejamento.exigeSenhaAlteracao' AS chave, 'pep' AS modulo, 'Prontuário (prescricao.planejamento): exige senha alteracao' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.protocoloOncologicoConvertido' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): protocolo oncologico convertido' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.protocoloSequencial' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): protocolo sequencial' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.registraTrilhaMinima' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): registra trilha minima' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.requisicaoACriterioMedico' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): requisicao acriterio medico' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.requisicaoSeNecessario' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): requisicao se necessario' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.solucao.iniciaAdministracaoAgora' AS chave, 'pep' AS modulo, 'Prontuário (prescricao.solucao): inicia administracao agora' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.suprimeItensManipulacao' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): suprime itens manipulacao' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.unidadeConsumoGotas' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): unidade consumo gotas' AS descricao, 'lista' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.unidadeConsumoMililitro' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): unidade consumo mililitro' AS descricao, 'lista' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.validaDose24Horas' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): valida dose24horas' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.validaLancamentoDuplicado' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): valida lancamento duplicado' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.validaLancamentoIndicadorProgramado' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): valida lancamento indicador programado' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.validaPeriodoVigencia' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): valida periodo vigencia' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.verificaFatorConversao' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): verifica fator conversao' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.viaAcessoVenosoCentral' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): via acesso venoso central' AS descricao, 'lista' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.viaAcessoVenosoPeriferico' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): via acesso venoso periferico' AS descricao, 'lista' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.viaHipodermoclise' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): via hipodermoclise' AS descricao, 'lista' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.viaOralPadrao' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): via oral padrao' AS descricao, 'lista' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.viaVenosaPadrao' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): via venosa padrao' AS descricao, 'lista' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prescricao.visualizacaoPrevisto' AS chave, 'pep' AS modulo, 'Prontuário (prescricao): visualizacao previsto' AS descricao, 'lista' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prontuario.alertaPrevisaoAlta' AS chave, 'pep' AS modulo, 'Prontuário (prontuario): alerta previsao alta' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prontuario.corrigeHoraRespostaRascunho' AS chave, 'pep' AS modulo, 'Prontuário (prontuario): corrige hora resposta rascunho' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prontuario.exame.envioBateriaAgrupado' AS chave, 'pep' AS modulo, 'Prontuário (prontuario.exame): envio bateria agrupado' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prontuario.exigeInformacaoComplementarClinica' AS chave, 'pep' AS modulo, 'Prontuário (prontuario): exige informacao complementar clinica' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prontuario.exportacao.comSenha' AS chave, 'pep' AS modulo, 'Prontuário (prontuario.exportacao): com senha' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prontuario.exportacao.exigeJustificativa' AS chave, 'pep' AS modulo, 'Prontuário (prontuario.exportacao): exige justificativa' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prontuario.historicoExame.separaBateria' AS chave, 'pep' AS modulo, 'Prontuário (prontuario.historicoExame): separa bateria' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prontuario.instrucaoRegistroProducaoPublica' AS chave, 'pep' AS modulo, 'Prontuário (prontuario): instrucao registro producao publica' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prontuario.intercorrencia.notificaResponsavel' AS chave, 'pep' AS modulo, 'Prontuário (prontuario.intercorrencia): notifica responsavel' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prontuario.locaisPorUsuario' AS chave, 'pep' AS modulo, 'Prontuário (prontuario): locais por usuario' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prontuario.permiteConsentimentoNoLancamento' AS chave, 'pep' AS modulo, 'Prontuário (prontuario): permite consentimento no lancamento' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prontuario.restringeAcessoForaDoAtendimento' AS chave, 'pep' AS modulo, 'Prontuário (prontuario): restringe acesso fora do atendimento' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prontuario.toleranciaLancamentoRascunho' AS chave, 'pep' AS modulo, 'Prontuário (prontuario): tolerancia lancamento rascunho' AS descricao, 'inteiro' AS tipo, 0 AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.prontuario.validaAposConfirmar' AS chave, 'pep' AS modulo, 'Prontuário (prontuario): valida apos confirmar' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.receita.psicotropicoPadrao' AS chave, 'pep' AS modulo, 'Prontuário (receita): psicotropico padrao' AS descricao, 'lista' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.receita.tipo' AS chave, 'pep' AS modulo, 'Prontuário (receita): tipo' AS descricao, 'lista' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.receitaDigital.ambienteProducao' AS chave, 'pep' AS modulo, 'Prontuário (receitaDigital): ambiente producao' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.receitaDigital.enderecoLogotipo' AS chave, 'pep' AS modulo, 'Prontuário (receitaDigital): endereco logotipo' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'pep.sinaisVitais.toleranciaLancamentoAtrasado' AS chave, 'pep' AS modulo, 'Prontuário (sinaisVitais): tolerancia lancamento atrasado' AS descricao, 'inteiro' AS tipo, 0 AS minimo, NULL AS maximo
    UNION ALL SELECT 'prescricao.checagem.loteValidadeObrigatorioHemocomponente' AS chave, 'pep' AS modulo, 'Lote e validade obrigatórios na checagem de hemocomponente' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'prescricao.checagem.loteValidadeObrigatorioMedicamento' AS chave, 'pep' AS modulo, 'Lote e validade obrigatórios na checagem de medicamento' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'prescricao.checagem.loteValidadeObrigatorioSolucao' AS chave, 'pep' AS modulo, 'Lote e validade obrigatórios na checagem de solução' AS descricao, 'booleano' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'prescricao.futura.antecedenciaAvaliacao' AS chave, 'pep' AS modulo, 'Antecedência da avaliação da prescrição futura (minutos)' AS descricao, 'inteiro' AS tipo, 0 AS minimo, NULL AS maximo
    UNION ALL SELECT 'prescricao.futura.tempoAvaliacao' AS chave, 'pep' AS modulo, 'Tempo de avaliação da prescrição futura (minutos)' AS descricao, 'inteiro' AS tipo, 0 AS minimo, NULL AS maximo
    UNION ALL SELECT 'sadt.hemoterapia.codigoCevs' AS chave, 'sadt' AS modulo, 'Hemoterapia: codigo cevs (configuração do hospital migrado)' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'sadt.hemoterapia.codigoRegionalSaude' AS chave, 'sadt' AS modulo, 'Hemoterapia: codigo regional saude (configuração do hospital migrado)' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'sadt.hemoterapia.diretorioImagens' AS chave, 'sadt' AS modulo, 'Hemoterapia: diretorio imagens (configuração do hospital migrado)' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'sadt.hemoterapia.exigeCpfDoador' AS chave, 'sadt' AS modulo, 'Hemoterapia: exige cpf doador (configuração do hospital migrado)' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'sadt.hemoterapia.formulaSuperficieCorporal' AS chave, 'sadt' AS modulo, 'Hemoterapia: formula superficie corporal (configuração do hospital migrado)' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'sadt.hemoterapia.gravarImagemNoBanco' AS chave, 'sadt' AS modulo, 'Hemoterapia: gravar imagem no banco (configuração do hospital migrado)' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'sadt.hemoterapia.lancarTransfusaoApos24h' AS chave, 'sadt' AS modulo, 'Hemoterapia: lancar transfusao apos24h (configuração do hospital migrado)' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'sadt.hemoterapia.lancarTransfusaoNaPreTransfusao' AS chave, 'sadt' AS modulo, 'Hemoterapia: lancar transfusao na pre transfusao (configuração do hospital migrado)' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'sadt.hemoterapia.modeloImpressaoBolsa' AS chave, 'sadt' AS modulo, 'Hemoterapia: modelo impressao bolsa (configuração do hospital migrado)' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'sadt.hemoterapia.modeloImpressaoDoacao' AS chave, 'sadt' AS modulo, 'Hemoterapia: modelo impressao doacao (configuração do hospital migrado)' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'sadt.hemoterapia.modeloImpressaoPreTransfusao' AS chave, 'sadt' AS modulo, 'Hemoterapia: modelo impressao pre transfusao (configuração do hospital migrado)' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'sadt.hemoterapia.modeloImpressaoRequisicaoHemocentro' AS chave, 'sadt' AS modulo, 'Hemoterapia: modelo impressao requisicao hemocentro (configuração do hospital migrado)' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'sadt.hemoterapia.modeloImpressaoRequisicaoPaciente' AS chave, 'sadt' AS modulo, 'Hemoterapia: modelo impressao requisicao paciente (configuração do hospital migrado)' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'sadt.hemoterapia.modeloImpressaoTransferencia' AS chave, 'sadt' AS modulo, 'Hemoterapia: modelo impressao transferencia (configuração do hospital migrado)' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'sadt.hemoterapia.modeloImpressaoTransfusao' AS chave, 'sadt' AS modulo, 'Hemoterapia: modelo impressao transfusao (configuração do hospital migrado)' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'sadt.hemoterapia.prazoDias' AS chave, 'sadt' AS modulo, 'Hemoterapia: prazo dias (configuração do hospital migrado)' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
    UNION ALL SELECT 'sadt.hemoterapia.sexoPadrao' AS chave, 'sadt' AS modulo, 'Hemoterapia: sexo padrao (configuração do hospital migrado)' AS descricao, 'texto' AS tipo, NULL AS minimo, NULL AS maximo
  ) x
  WHERE NOT EXISTS (SELECT 1 FROM parametro_definicao d WHERE d.chave = x.chave);
