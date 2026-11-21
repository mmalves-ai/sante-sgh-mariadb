-- PROPOSTA da fatia L6-11 (F4 rodada 5) à trilha de modelo: catálogo do produto dos parâmetros do prontuário
-- (módulo pep) que o conector usa para continuar a configuração do hospital (ADR 0006). Tipo inferido pela forma da
-- coluna da origem e pelo nome (booleano = sim/não; lista = código de uma opção; duracao_minutos = hora de duração);
-- a trilha de modelo confirma o tipo, o domínio, o padrão e a tela antes de versionar em db/migracoes/06_PEP.
-- Idempotente (INSERT IGNORE pela chave). Nenhum nome da origem: só chaves e descrições do produto.
INSERT INTO modulo_sistema (codigo, descricao, criado_em) SELECT 'pep', 'Prontuário eletrônico', CURRENT_TIMESTAMP(3) FROM DUAL
  WHERE NOT EXISTS (SELECT 1 FROM modulo_sistema WHERE codigo = 'pep');
INSERT IGNORE INTO parametro_definicao (chave, modulo_sistema_id, descricao, tipo, permite_rede, ativo, criado_em)
  SELECT x.chave, m.id, x.descricao, x.tipo, TRUE, TRUE, CURRENT_TIMESTAMP(3)
  FROM (
    SELECT 'pep.prescricao.unidadeConsumoMililitro' AS chave, 'Prontuário (prescricao): unidade consumo mililitro' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'pep.prescricao.unidadeConsumoGotas' AS chave, 'Prontuário (prescricao): unidade consumo gotas' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'pep.prescricao.protocoloSequencial' AS chave, 'Prontuário (prescricao): protocolo sequencial' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.visualizacaoPrevisto' AS chave, 'Prontuário (prescricao): visualizacao previsto' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'pep.prescricao.controlaCateter' AS chave, 'Prontuário (prescricao): controla cateter' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.checagem.exigeChecagemLaboratorio' AS chave, 'Prontuário (checagem): exige checagem laboratorio' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.exibeReferenciaComercial' AS chave, 'Prontuário (prescricao): exibe referencia comercial' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.geraRequisicaoEstoque' AS chave, 'Prontuário (prescricao): gera requisicao estoque' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.checagem.exigeMotivoFalta' AS chave, 'Prontuário (checagem): exige motivo falta' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.checagem.exigeChecagemEnfermagem' AS chave, 'Prontuário (checagem): exige checagem enfermagem' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.diasPrescricaoAnterior' AS chave, 'Prontuário (prescricao): dias prescricao anterior' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'pep.prescricao.exibeReferenciaDiluente' AS chave, 'Prontuário (prescricao): exibe referencia diluente' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.percentualExigeJustificativa' AS chave, 'Prontuário (prescricao): percentual exige justificativa' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'pep.prescricao.exibeMateriais' AS chave, 'Prontuário (prescricao): exibe materiais' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.viaVenosaPadrao' AS chave, 'Prontuário (prescricao): via venosa padrao' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeMateriais' AS chave, 'Prontuário (impressao.prescricao): imprime materiais' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.fatorDietaBlend' AS chave, 'Prontuário (prescricao): fator dieta blend' AS descricao, 'decimal' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeQuantidade' AS chave, 'Prontuário (impressao.prescricao): imprime quantidade' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeDatas' AS chave, 'Prontuário (impressao.prescricao): imprime datas' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeEvolucaoEnfermagem' AS chave, 'Prontuário (impressao.prescricao): imprime evolucao enfermagem' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeBombaInfusao' AS chave, 'Prontuário (impressao.prescricao): imprime bomba infusao' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeRequisicao' AS chave, 'Prontuário (impressao.prescricao): imprime requisicao' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.checagem.memorizaNaoAdministrado' AS chave, 'Prontuário (checagem): memoriza nao administrado' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeDescricaoProtocolo' AS chave, 'Prontuário (impressao.prescricao): imprime descricao protocolo' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.especialidadePsiquiatria' AS chave, 'Prontuário (prescricao): especialidade psiquiatria' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.incluiDieta' AS chave, 'Prontuário (prescricao): inclui dieta' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.checagem.exigeChecagemMaterial' AS chave, 'Prontuário (checagem): exige checagem material' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.permitePrescricaoUrgencia' AS chave, 'Prontuário (prescricao): permite prescricao urgencia' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.lancaNaConta' AS chave, 'Prontuário (prescricao): lanca na conta' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.exigeValidacaoFarmaceutica' AS chave, 'Prontuário (prescricao): exige validacao farmaceutica' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.permiteCorrigirPrescricaoValidada' AS chave, 'Prontuário (prescricao): permite corrigir prescricao validada' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeRelacaoMedicamentos' AS chave, 'Prontuário (impressao.prescricao): imprime relacao medicamentos' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.permitePercentualAcimaLimite' AS chave, 'Prontuário (prescricao): permite percentual acima limite' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.permiteIncluirItensPrescricao' AS chave, 'Prontuário (prescricao): permite incluir itens prescricao' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.checagem.dataInicioPendencias' AS chave, 'Prontuário (checagem): data inicio pendencias' AS descricao, 'data' AS tipo
    UNION ALL SELECT 'pep.checagem.validaIntervalo' AS chave, 'Prontuário (checagem): valida intervalo' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.requisicaoSeNecessario' AS chave, 'Prontuário (prescricao): requisicao se necessario' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.requisicaoACriterioMedico' AS chave, 'Prontuário (prescricao): requisicao acriterio medico' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.validaDose24Horas' AS chave, 'Prontuário (prescricao): valida dose24horas' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.checagem.validaIntervaloDose' AS chave, 'Prontuário (checagem): valida intervalo dose' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.registraTrilhaMinima' AS chave, 'Prontuário (prescricao): registra trilha minima' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.medicoNoRodape' AS chave, 'Prontuário (impressao.prescricao): medico no rodape' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.checagem.toleranciaHorario' AS chave, 'Prontuário (checagem): tolerancia horario' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeEmitidoEm' AS chave, 'Prontuário (impressao.prescricao): imprime emitido em' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.lancaKit' AS chave, 'Prontuário (prescricao): lanca kit' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeRegistro' AS chave, 'Prontuário (impressao.prescricao): imprime registro' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeDoseTotal' AS chave, 'Prontuário (impressao.prescricao): imprime dose total' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.cabecalhoHistorico' AS chave, 'Prontuário (prescricao): cabecalho historico' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.planejamento.exigeSenhaAlteracao' AS chave, 'Prontuário (prescricao.planejamento): exige senha alteracao' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.planejamento.alertaPendente' AS chave, 'Prontuário (prescricao.planejamento): alerta pendente' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.verificaFatorConversao' AS chave, 'Prontuário (prescricao): verifica fator conversao' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.agrupamento' AS chave, 'Prontuário (impressao.prescricao): agrupamento' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'pep.prescricao.planejamento.diasAlertaPendente' AS chave, 'Prontuário (prescricao.planejamento): dias alerta pendente' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'pep.prescricao.lembraViaAcessoItem' AS chave, 'Prontuário (prescricao): lembra via acesso item' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeQuantidadePadrao' AS chave, 'Prontuário (impressao.prescricao): imprime quantidade padrao' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.validaPeriodoVigencia' AS chave, 'Prontuário (prescricao): valida periodo vigencia' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prontuario.instrucaoRegistroProducaoPublica' AS chave, 'Prontuário (prontuario): instrucao registro producao publica' AS descricao, 'texto' AS tipo
    UNION ALL SELECT 'pep.prescricao.exigeValidacaoAntimicrobiano' AS chave, 'Prontuário (prescricao): exige validacao antimicrobiano' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.solicitacaoExame.porConvenio' AS chave, 'Prontuário (impressao.solicitacaoExame): por convenio' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.checagem.quantidadeProfissionaisEnfermagem' AS chave, 'Prontuário (checagem): quantidade profissionais enfermagem' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'pep.prescricao.antimicrobiano.complementoPedido' AS chave, 'Prontuário (prescricao.antimicrobiano): complemento pedido' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.viaOralPadrao' AS chave, 'Prontuário (prescricao): via oral padrao' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.exibeNomeComercial' AS chave, 'Prontuário (impressao.prescricao): exibe nome comercial' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.incluiKitMateriais' AS chave, 'Prontuário (prescricao): inclui kit materiais' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeNumeroDoses' AS chave, 'Prontuário (impressao.prescricao): imprime numero doses' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.incluiKitNaPrescricaoMedica' AS chave, 'Prontuário (prescricao): inclui kit na prescricao medica' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.frenteVerso' AS chave, 'Prontuário (impressao.prescricao): frente verso' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.checagem.somenteItensConsolidados' AS chave, 'Prontuário (checagem): somente itens consolidados' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.geraDocumentoDevolucaoEstoque' AS chave, 'Prontuário (prescricao): gera documento devolucao estoque' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.painel.liberaPacienteIntegrado' AS chave, 'Prontuário (painel): libera paciente integrado' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.assinatura.assinaDigitalmente' AS chave, 'Prontuário (assinatura): assina digitalmente' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.geraFolhaSala' AS chave, 'Prontuário (prescricao): gera folha sala' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.viaAcessoVenosoCentral' AS chave, 'Prontuário (prescricao): via acesso venoso central' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'pep.prescricao.viaAcessoVenosoPeriferico' AS chave, 'Prontuário (prescricao): via acesso venoso periferico' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'pep.prescricao.viaHipodermoclise' AS chave, 'Prontuário (prescricao): via hipodermoclise' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'pep.documentos.integracaoArquivoPor' AS chave, 'Prontuário (documentos): integracao arquivo por' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'pep.prescricao.solucao.iniciaAdministracaoAgora' AS chave, 'Prontuário (prescricao.solucao): inicia administracao agora' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.painel.exibeAtendimentoGeradoExame' AS chave, 'Prontuário (painel): exibe atendimento gerado exame' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prontuario.corrigeHoraRespostaRascunho' AS chave, 'Prontuário (prontuario): corrige hora resposta rascunho' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.horariosPreCadastrados' AS chave, 'Prontuário (impressao.prescricao): horarios pre cadastrados' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.suprimeItensManipulacao' AS chave, 'Prontuário (prescricao): suprime itens manipulacao' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.integracao.laboratorio.endereco' AS chave, 'Prontuário (integracao.laboratorio): endereco' AS descricao, 'texto' AS tipo
    UNION ALL SELECT 'pep.prescricao.consisteItemDuplicado' AS chave, 'Prontuário (prescricao): consiste item duplicado' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.validaLancamentoIndicadorProgramado' AS chave, 'Prontuário (prescricao): valida lancamento indicador programado' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.referenciaBibliografica' AS chave, 'Prontuário (impressao.prescricao): referencia bibliografica' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.cabecalhoMedico' AS chave, 'Prontuário (impressao.prescricao): cabecalho medico' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.calculaVelocidadeInfusao' AS chave, 'Prontuário (prescricao): calcula velocidade infusao' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.codigoRegional' AS chave, 'Prontuário (impressao.prescricao): codigo regional' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.digitoConselho' AS chave, 'Prontuário (impressao.prescricao): digito conselho' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prontuario.intercorrencia.notificaResponsavel' AS chave, 'Prontuário (prontuario.intercorrencia): notifica responsavel' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricaoOncologica.data' AS chave, 'Prontuário (impressao.prescricaoOncologica): data' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.agrupaAtendimentoPsiquiatria' AS chave, 'Prontuário (impressao.prescricao): agrupa atendimento psiquiatria' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.exameForaPadrao' AS chave, 'Prontuário (prescricao): exame fora padrao' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.colunaData' AS chave, 'Prontuário (impressao.prescricao): coluna data' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.agrupaPorTipoLancamento' AS chave, 'Prontuário (impressao.prescricao): agrupa por tipo lancamento' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricaoOncologica.nomeCidade' AS chave, 'Prontuário (impressao.prescricaoOncologica): nome cidade' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.painel.colunaEsperaSenha' AS chave, 'Prontuário (painel): coluna espera senha' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.painel.colunaEsperaAtendimento' AS chave, 'Prontuário (painel): coluna espera atendimento' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.painel.colunaEsperaLocal' AS chave, 'Prontuário (painel): coluna espera local' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.painel.colunaEsperaUltimaMovimentacao' AS chave, 'Prontuário (painel): coluna espera ultima movimentacao' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.zebrado' AS chave, 'Prontuário (impressao.prescricao): zebrado' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.antimicrobiano.tipoLancamento' AS chave, 'Prontuário (prescricao.antimicrobiano): tipo lancamento' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'pep.prontuario.exigeInformacaoComplementarClinica' AS chave, 'Prontuário (prontuario): exige informacao complementar clinica' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.protocoloOncologicoConvertido' AS chave, 'Prontuário (prescricao): protocolo oncologico convertido' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prontuario.permiteConsentimentoNoLancamento' AS chave, 'Prontuário (prontuario): permite consentimento no lancamento' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.antimicrobiano.exibeFrequencia' AS chave, 'Prontuário (impressao.antimicrobiano): exibe frequencia' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.integracao.laboratorio.modo' AS chave, 'Prontuário (integracao.laboratorio): modo' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'pep.painel.telaAuxiliarLocalizacao' AS chave, 'Prontuário (painel): tela auxiliar localizacao' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.observacaoMedicaLonga' AS chave, 'Prontuário (prescricao): observacao medica longa' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.documentoSeparadoConsignado' AS chave, 'Prontuário (prescricao): documento separado consignado' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.paginasPadrao' AS chave, 'Prontuário (impressao.prescricao): paginas padrao' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'pep.prescricao.exibeProtocoloItemNaoPadronizado' AS chave, 'Prontuário (prescricao): exibe protocolo item nao padronizado' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.exibeNomeKit' AS chave, 'Prontuário (prescricao): exibe nome kit' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.imprimeHorarios' AS chave, 'Prontuário (impressao.prescricao): imprime horarios' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.modelo' AS chave, 'Prontuário (impressao.prescricao): modelo' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'pep.prontuario.historicoExame.separaBateria' AS chave, 'Prontuário (prontuario.historicoExame): separa bateria' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.duplex' AS chave, 'Prontuário (impressao): duplex' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.assinatura.textoEmailDocumentoAssinado' AS chave, 'Prontuário (assinatura): texto email documento assinado' AS descricao, 'texto' AS tipo
    UNION ALL SELECT 'pep.assinatura.habilitada' AS chave, 'Prontuário (assinatura): habilitada' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.assinatura.tempoExibicaoPendente' AS chave, 'Prontuário (assinatura): tempo exibicao pendente' AS descricao, 'inteiro' AS tipo
    UNION ALL SELECT 'pep.receita.psicotropicoPadrao' AS chave, 'Prontuário (receita): psicotropico padrao' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'pep.prontuario.exportacao.exigeJustificativa' AS chave, 'Prontuário (prontuario.exportacao): exige justificativa' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prontuario.exame.envioBateriaAgrupado' AS chave, 'Prontuário (prontuario.exame): envio bateria agrupado' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.sinaisVitais.toleranciaLancamentoAtrasado' AS chave, 'Prontuário (sinaisVitais): tolerancia lancamento atrasado' AS descricao, 'duracao_minutos' AS tipo
    UNION ALL SELECT 'pep.prontuario.toleranciaLancamentoRascunho' AS chave, 'Prontuário (prontuario): tolerancia lancamento rascunho' AS descricao, 'duracao_minutos' AS tipo
    UNION ALL SELECT 'pep.impressao.exibeParametros' AS chave, 'Prontuário (impressao): exibe parametros' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.mantemLancamentoMesmaPagina' AS chave, 'Prontuário (impressao): mantem lancamento mesma pagina' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.consideraImpressa' AS chave, 'Prontuário (prescricao): considera impressa' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.receitaDigital.enderecoLogotipo' AS chave, 'Prontuário (receitaDigital): endereco logotipo' AS descricao, 'texto' AS tipo
    UNION ALL SELECT 'pep.documentos.tipoAtestadoRequerimento' AS chave, 'Prontuário (documentos): tipo atestado requerimento' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'pep.receita.tipo' AS chave, 'Prontuário (receita): tipo' AS descricao, 'lista' AS tipo
    UNION ALL SELECT 'pep.receitaDigital.ambienteProducao' AS chave, 'Prontuário (receitaDigital): ambiente producao' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.duplex' AS chave, 'Prontuário (impressao.prescricao): duplex' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prontuario.validaAposConfirmar' AS chave, 'Prontuário (prontuario): valida apos confirmar' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prontuario.locaisPorUsuario' AS chave, 'Prontuário (prontuario): locais por usuario' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.assinatura.semAvisoPendenteAoEntrar' AS chave, 'Prontuário (assinatura): sem aviso pendente ao entrar' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.validaLancamentoDuplicado' AS chave, 'Prontuário (prescricao): valida lancamento duplicado' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricaoOncologica.assinatura' AS chave, 'Prontuário (impressao.prescricaoOncologica): assinatura' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.assinatura' AS chave, 'Prontuário (impressao.prescricao): assinatura' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prontuario.exportacao.comSenha' AS chave, 'Prontuário (prontuario.exportacao): com senha' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.checagem.somenteItensAssinados' AS chave, 'Prontuário (checagem): somente itens assinados' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prontuario.alertaPrevisaoAlta' AS chave, 'Prontuário (prontuario): alerta previsao alta' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.avaliacaoFarmaceuticaForaPadrao' AS chave, 'Prontuário (prescricao): avaliacao farmaceutica fora padrao' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.aprazamentoPelaEnfermagem' AS chave, 'Prontuário (prescricao): aprazamento pela enfermagem' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.impressao.prescricao.horarioMedicacao' AS chave, 'Prontuário (impressao.prescricao): horario medicacao' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.documentos.usaServicoArmazenamento' AS chave, 'Prontuário (documentos): usa servico armazenamento' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.internacao.exigeLaudoApos48Horas' AS chave, 'Prontuário (internacao): exige laudo apos48horas' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prescricao.alertaExameRepetido' AS chave, 'Prontuário (prescricao): alerta exame repetido' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.prontuario.restringeAcessoForaDoAtendimento' AS chave, 'Prontuário (prontuario): restringe acesso fora do atendimento' AS descricao, 'booleano' AS tipo
    UNION ALL SELECT 'pep.checagem.antecedenciaPermitida' AS chave, 'Prontuário (checagem): antecedencia permitida' AS descricao, 'duracao_minutos' AS tipo
    UNION ALL SELECT 'pep.prescricao.consisteFrequenciaUnica' AS chave, 'Prontuário (prescricao): consiste frequencia unica' AS descricao, 'booleano' AS tipo
  ) x JOIN modulo_sistema m ON m.codigo = 'pep';
