// GERADO por tools/obra/gerar_tabelas_consulta.py (F2.2, lote 02-03). Não editar à mão: rode o gerador.
// A tabela do modelo próprio que atende cada consulta somente leitura declarada em @sgh/contratos, pelo mapa de
// destino da análise do modelo (uso interno). Tabela compartilhada por várias consultas: cada uma leva o filtro
// fixo que a distingue (`fixo`, coluna e valor de lista branca) ou mostra o mesmo conteúdo, com motivo no gerador.
// 171 consultas no índice; 23 sem destino no modelo e 207 em tabela compartilhada sem
// discriminador definido ficam fora do índice (404), em vez de devolver a tabela inteira:
//   aliquota_terceiros: 3
//   categoria_trabalhador: 4
//   codigo_esocial: 128
//   codigo_fiscal_oficial: 6
//   codigo_incidencia_rubrica: 6
//   codigo_retorno_esocial: 3
//   compatibilidade_codigo_esocial: 4
//   contrato_rede_prestador_clausula: 2
//   documento_prontuario: 2
//   dominio_sus: 1
//   envio_relatorio: 2
//   escala_clinica: 2
//   fator_risco_ocupacional: 4
//   gabarito_acuidade_visual: 2
//   indicador_biologico: 3
//   leiaute_esocial: 3
//   perfil_portal_resultado: 2
//   pergunta_triagem_doador: 2
//   ponto_integracao: 2
//   regra_consistencia_lancamento: 6
//   regra_obrigatoriedade_campo: 2
//   regra_validacao_esocial: 2
//   taxa_saude_suplementar_vigencia: 2
//   termo_terminologia: 8
//   termo_terminologia_vigencia: 1
//   tipo_evento_esocial: 3
//   visualizador_imagem: 2
import type { DestinoConsulta } from './declaracao.js';

export const DESTINOS_CONSULTA: Readonly<Record<string, DestinoConsulta>> = Object.freeze({
  'agenda.cancelamento': { tabela: 'cancelamento_marcacao' },
  'agenda.estadoConfirmacao': { tabela: 'situacao_confirmacao' },
  'agenda.exclusaoMarcacaoSadt': {
    tabela: 'registro_excluido',
    fixo: { coluna: 'entidade', valor: 'marcacao_horario' },
  },
  'auditoria.aceite': { tabela: 'aceite_termo_uso' },
  'auditoria.alertaTrilha': { tabela: 'evento_auditoria_alerta' },
  'auditoria.atendimentoExcluido': { tabela: 'cancelamento_atendimento' },
  'auditoria.cancelamentoAlta': { tabela: 'cancelamento_alta' },
  'auditoria.detalheTrilha': { tabela: 'evento_auditoria_registro' },
  'auditoria.eventoAuditavel': { tabela: 'acao_sistema' },
  'auditoria.impressaoExportacaoProntuario': { tabela: 'exportacao_documento' },
  'auditoria.internacaoExcluida': { tabela: 'cancelamento_internacao' },
  'auditoria.leitorBiometrico': { tabela: 'modelo_leitor_biometrico' },
  'auditoria.marcacaoExcluida': { tabela: 'cancelamento_marcacao' },
  'auditoria.mensagemInterna': { tabela: 'mensagem_interna' },
  'auditoria.opcaoObrigatoriedadeCampo': { tabela: 'regra_obrigatoriedade_campo' },
  'auditoria.trilha': { tabela: 'evento_auditoria' },
  'auditoria.ultimaConexao': { tabela: 'ultimo_acesso_usuario' },
  'cadastro.capacidadeCivil': { tabela: 'capacidade_civil' },
  'cadastro.complexidadeHospital': { tabela: 'complexidade_estabelecimento' },
  'cadastro.historicoReferenciaBrasindiceItemMat': { tabela: 'preco_referencia_matmed' },
  'cadastro.retratoCid': {
    tabela: 'termo_terminologia_vigencia',
    fixo: {
      coluna: 'termo_terminologia_id',
      em: {
        tabela: 'termo_terminologia',
        filtro: {
          coluna: 'terminologia_id',
          em: { tabela: 'terminologia', filtro: { coluna: 'codigo', valor: 'cid10' } },
        },
      },
    },
  },
  'cadastro.retratoConvenio': { tabela: 'fonte_pagadora_versao' },
  'cadastro.retratoPaciente': { tabela: 'paciente_versao' },
  'cadastro.retratoProfissional': { tabela: 'profissional_versao' },
  'cadastro.retratoTelefonesPaciente': { tabela: 'paciente_versao' },
  'cadastro.retratoTelefonesProfissional': { tabela: 'profissional_versao' },
  'cadastro.unificacaoProntuarios': { tabela: 'unificacao_cadastro' },
  'cirurgia.cirurgiaExcluida': {
    tabela: 'registro_excluido',
    fixo: { coluna: 'entidade', valor: 'ato_cirurgico' },
  },
  'cirurgia.excluidosCancelados': { tabela: 'suspensao_cirurgia' },
  'cirurgia.funcaoEquipeCirurgica': { tabela: 'funcao_equipe_cirurgica' },
  'cirurgia.historicoInclusao': { tabela: 'reagendamento_cirurgico' },
  'cirurgia.modoRespiratorioFichaAnestesica': { tabela: 'modo_ventilatorio' },
  'cirurgia.posicaoCirurgica': { tabela: 'posicao_cirurgica' },
  'cirurgia.tipoSinalFichaAnestesica': { tabela: 'tipo_sinal_monitorado' },
  'faturamento.acessoVascular': {
    tabela: 'dominio_sus',
    fixo: { coluna: 'lista', valor: 'acesso_vascular' },
  },
  'faturamento.caracteristicaTratamento': {
    tabela: 'dominio_sus',
    fixo: { coluna: 'lista', valor: 'caracteristica_tratamento_dialitico' },
  },
  'faturamento.classificacaoDiagnostico': {
    tabela: 'dominio_sus',
    fixo: { coluna: 'lista', valor: 'classificacao_diagnostico' },
  },
  'faturamento.complexidade': {
    tabela: 'dominio_contratualizacao_sus',
    fixo: { coluna: 'lista', valor: 'complexidade' },
  },
  'faturamento.contraindicacaoTransplante': {
    tabela: 'dominio_sus',
    fixo: { coluna: 'lista', valor: 'contraindicacao_transplante' },
  },
  'faturamento.controleIrregularidades': { tabela: 'tipo_pendencia_conta' },
  'faturamento.escor': { tabela: 'dominio_contratualizacao_sus', fixo: { coluna: 'lista', valor: 'escore' } },
  'faturamento.esferaContrato': {
    tabela: 'dominio_contratualizacao_sus',
    fixo: { coluna: 'lista', valor: 'esfera' },
  },
  'faturamento.incentivo': { tabela: 'incentivo_contratual_sus' },
  'faturamento.irregularidade': { tabela: 'pendencia_conta' },
  'faturamento.itemIndicador': {
    tabela: 'dominio_contratualizacao_sus',
    fixo: { coluna: 'lista', valor: 'tipo_item_indicador' },
  },
  'faturamento.justificativaPacienteSemIdentificacao': {
    tabela: 'dominio_sus',
    fixo: { coluna: 'lista', valor: 'justificativa_paciente_sem_documento' },
  },
  'faturamento.orcamentoParticular': { tabela: 'orcamento_particular' },
  'faturamento.periodicidade': {
    tabela: 'dominio_contratualizacao_sus',
    fixo: { coluna: 'lista', valor: 'periodicidade' },
  },
  'faturamento.procedimentoExtrasApac': { tabela: 'conta_hospitalar_item' },
  'faturamento.profissionalConsideradoCobranca': { tabela: 'funcao_equipe_cobranca' },
  'faturamento.reciboParticular': { tabela: 'recibo' },
  'faturamento.redeAssistencial': {
    tabela: 'dominio_contratualizacao_sus',
    fixo: { coluna: 'lista', valor: 'rede_assistencial' },
  },
  'faturamento.situacaoTransplante': {
    tabela: 'dominio_sus',
    fixo: { coluna: 'lista', valor: 'situacao_transplante' },
  },
  'faturamento.tabelaTipoAtendimento': { tabela: 'tipo_atendimento_tabela' },
  'faturamento.tipoAfericao': {
    tabela: 'dominio_contratualizacao_sus',
    fixo: { coluna: 'lista', valor: 'tipo_afericao' },
  },
  'faturamento.tipoDado': {
    tabela: 'dominio_contratualizacao_sus',
    fixo: { coluna: 'lista', valor: 'tipo_dado' },
  },
  'faturamento.tipoIndicador': {
    tabela: 'dominio_contratualizacao_sus',
    fixo: { coluna: 'lista', valor: 'tipo_indicador' },
  },
  'faturamento.tipoOrcamento': {
    tabela: 'dominio_contratualizacao_sus',
    fixo: { coluna: 'lista', valor: 'componente_orcamento' },
  },
  'faturamento.tipoUti': { tabela: 'dominio_sus', fixo: { coluna: 'lista', valor: 'tipo_leito_uti' } },
  'financeiro.planoContasReferenciais': { tabela: 'plano_referencial' },
  'financeiro.renegociacaoTitulos': { tabela: 'renegociacao' },
  'financeiro.saldoDiario': { tabela: 'saldo_diario_conta' },
  'financeiro.vigenciaSituacaoEspecialEmpresaSped': { tabela: 'situacao_especial_empresa' },
  'integracao.campoArquivo': { tabela: 'esquema_mensagem' },
  'integracao.mapeamentoCampos': { tabela: 'assinatura_evento_parceiro' },
  'integracao.nexodataPrescricaoDigital': { tabela: 'envio_prescricao_plataforma' },
  'integracao.nexodataPrescricaoDigital2': { tabela: 'envio_prescricao_plataforma' },
  'integracao.portalCotacao': { tabela: 'vinculo_pedido_compra_portal' },
  'integracao.servico': { tabela: 'servico_regulacao' },
  'integracao.sistema': { tabela: 'central_reguladora' },
  'integracao.tabelaDominio': { tabela: 'tabela_codigo_regulacao' },
  'integracao.tipoIntegracao': { tabela: 'tipo_evento_publicado' },
  'integracao.valorTabelas': { tabela: 'valor_codigo_regulacao' },
  'integracao.webServiceEtiquetasLis': { tabela: 'modelo_etiqueta_amostra_biologica' },
  'integracao.webServiceEtiquetasLisLog': { tabela: 'etiqueta_amostra_apoio' },
  'internacao.ocupacaoLeitoObservacao': { tabela: 'ocupacao_leito_observacao' },
  'internacao.trocaClinica': {
    tabela: 'troca_internacao',
    fixo: {
      coluna: 'tipo_troca_internacao_id',
      em: { tabela: 'tipo_troca_internacao', filtro: { coluna: 'dado_trocado', valor: 'clinica' } },
    },
  },
  'internacao.trocaEspecialidade': {
    tabela: 'troca_internacao',
    fixo: {
      coluna: 'tipo_troca_internacao_id',
      em: { tabela: 'tipo_troca_internacao', filtro: { coluna: 'dado_trocado', valor: 'especialidade' } },
    },
  },
  'internacao.trocaMedico': {
    tabela: 'troca_internacao',
    fixo: {
      coluna: 'tipo_troca_internacao_id',
      em: {
        tabela: 'tipo_troca_internacao',
        filtro: { coluna: 'dado_trocado', valor: 'profissional_responsavel' },
      },
    },
  },
  'operadora.envioCobrancaMail': { tabela: 'preferencia_envio_cobranca' },
  'operadora.origem': { tabela: 'origem_protocolo' },
  'operadora.procedimentoGrupo': { tabela: 'termo_equivalencia' },
  'operadora.tipoVigencia': { tabela: 'contrato_rede_prestador' },
  'operadora.unidadeTempo': { tabela: 'unidade_prazo' },
  'pep.acaoGravidadeInteracao': { tabela: 'acao_gravidade_interacao' },
  'pep.classificacaoListaProblemas': { tabela: 'classificacao_problema' },
  'pep.classificacaoMetas': { tabela: 'classificacao_meta_enfermagem' },
  'pep.classificacaoRiscoManchester': { tabela: 'nivel_prioridade' },
  'pep.componente': { tabela: 'modelo_layout' },
  'pep.escalaLikert': { tabela: 'escala_resultado_enfermagem' },
  'pep.escopoManutencaoDiagnostico': { tabela: 'diagnostico_atendimento' },
  'pep.estadoDiagnosticoListaProblemas': { tabela: 'certeza_diagnostico' },
  'pep.exameOftalmologicoGrupo': { tabela: 'tipo_exame_oftalmologico' },
  'pep.extratoHorario': { tabela: 'horario_administracao_evento' },
  'pep.faixaPontuacao': { tabela: 'escala_clinica_opcao' },
  'pep.grupo': { tabela: 'grupo_balanco_hidrico' },
  'pep.grupoExame': { tabela: 'grupo_exame_oftalmologico' },
  'pep.historicoAlteracoesSituacaoChecagemApraz': { tabela: 'horario_administracao_evento' },
  'pep.intensidade': { tabela: 'intensidade_perda' },
  'pep.modeloImpressao': { tabela: 'modelo_impressao_clinica' },
  'pep.monitorizacao': { tabela: 'monitorizacao_paciente' },
  'pep.opcaoRespostaAnterior': { tabela: 'modelo_campo_opcao' },
  'pep.perguntaSinan': { tabela: 'agravo_pergunta' },
  'pep.periodicidadeNotificacao': { tabela: 'periodicidade_notificacao' },
  'pep.planejamentoPrescricao': { tabela: 'planejamento_prescricao' },
  'pep.politicaAssinaturaIcpBrasil': { tabela: 'formato_assinatura_icp' },
  'pep.rascunho': { tabela: 'registro_assistencial_rascunho' },
  'pep.registroTempoEvento': { tabela: 'registro_tempo_evento' },
  'pep.situacaoClinicaProblema': { tabela: 'situacao_problema' },
  'pep.statusDiagnosticoLancado': { tabela: 'situacao_problema' },
  'pep.sujeitoCuidadoDiagnostico': { tabela: 'sujeito_cuidado' },
  'pep.tipoAcuidade': { tabela: 'tipo_acuidade_visual' },
  'pep.tipoAgravo': { tabela: 'agravo_notificavel' },
  'pep.tipoArquivo': { tabela: 'tipo_anexo' },
  'pep.tipoDiagnosticoListaProblemas': { tabela: 'tipo_diagnostico' },
  'pep.tipoEliminacao': { tabela: 'tipo_ganho_perda' },
  'pep.tipoFechamento': { tabela: 'tipo_fechamento_balanco' },
  'pep.tipoNotificacao': { tabela: 'tipo_notificacao_agravo' },
  'pep.tipoProtocoloOncologia': { tabela: 'tipo_protocolo_oncologico' },
  'pep.tipoSurto': { tabela: 'tipo_surto_infeccao' },
  'pep.variavel': { tabela: 'escala_clinica_variavel' },
  'pep.versao': { tabela: 'modelo_documento_versao' },
  'pessoas.aliquotaRatCnae': { tabela: 'aliquota_rat_cnae' },
  'pessoas.codigoFpa': { tabela: 'fpas' },
  'pessoas.codigoPagamentoGps': { tabela: 'codigo_receita_federal' },
  'pessoas.estadoCivil': { tabela: 'estado_civil' },
  'pessoas.justificativa': { tabela: 'justificativa_ponto' },
  'pessoas.lotacaoTributariaEmpresa': { tabela: 'lotacao_tributaria' },
  'pessoas.motivoAfastamento2': { tabela: 'motivo_afastamento' },
  'pessoas.naturezaRendimentoDirf': { tabela: 'natureza_rendimento' },
  'pessoas.naturezaRubricas': { tabela: 'natureza_rubrica' },
  'pessoas.parametroUsuario': { tabela: 'contexto_trabalho_usuario' },
  'pessoas.remessaFolhaHistorico': { tabela: 'competencia_folha' },
  'pessoas.repHomologado': { tabela: 'tipo_relogio_ponto' },
  'pessoas.responsavelLegalEmpresa': { tabela: 'responsavel_legal_empregador' },
  'pessoas.tipoRescisao': { tabela: 'tipo_rescisao' },
  'pessoas.vale': { tabela: 'beneficio' },
  'recepcao.acaoFluxoSenha': { tabela: 'acao_fluxo_senha' },
  'recepcao.altaAtendimentoExterno': { tabela: 'atendimento' },
  'relatorio.layoutAnterior': { tabela: 'relatorio_versao' },
  'sadt.emissaoImpressaoLaudoAutenticacao': { tabela: 'emissao_laudo' },
  'sadt.exameDoador': { tabela: 'tipo_teste_imuno_hematologico' },
  'sadt.exameLaudo': { tabela: 'emissao_laudo_exame' },
  'sadt.fatorRh': { tabela: 'fator_rh' },
  'sadt.itemCadaVersaoHistoricaKit': { tabela: 'kit_exame_versao_item' },
  'sadt.layoutLaudoSetor': { tabela: 'modelo_impressao_laudo' },
  'sadt.parametroImpressaoRegrasHemoterapia': { tabela: 'configuracao_setor_diagnostico' },
  'sadt.tecnicoHemoterapia': { tabela: 'profissional' },
  'sadt.tipoMovimentacao': { tabela: 'tipo_movimento_bolsa' },
  'sadt.tipoTransfusao': { tabela: 'tipo_transfusao' },
  'sadt.versaoFaixasReferenciaElemento': { tabela: 'faixa_referencia_versao' },
  'sadt.versaoFaixasReferenciaExame': { tabela: 'faixa_referencia_versao' },
  'sadt.versaoHistoricaKitsExamesVigencia': { tabela: 'kit_exame_versao' },
  'sadt.versaoTextoValorReferenciaExame': { tabela: 'faixa_referencia_versao' },
  'suprimentos.capela': { tabela: 'capela_manipulacao' },
  'suprimentos.capelaGrupos': { tabela: 'capela_manipulacao_grupo' },
  'suprimentos.consumoCentroCusto': { tabela: 'consumo_centro_custo' },
  'suprimentos.consumoMensalLocal': { tabela: 'saldo_estoque_mensal' },
  'suprimentos.descricaoServicos': { tabela: 'pedido_compra_item' },
  'suprimentos.entregaProgramada': { tabela: 'pedido_compra_entrega' },
  'suprimentos.estoqueInicial': { tabela: 'inventario_estoque' },
  'suprimentos.fichaAntimicrobiano': { tabela: 'ficha_antimicrobiano' },
  'suprimentos.grupoManipulacao': { tabela: 'grupo_manipulacao' },
  'suprimentos.grupoUnidadeMedida': { tabela: 'grupo_unidade_medida' },
  'suprimentos.historicoComprasItemFornecedorNf': { tabela: 'nota_entrada_item' },
  'suprimentos.itemEstoqueInicialImplantacao': { tabela: 'inventario_estoque_item' },
  'suprimentos.loteEstoqueInicial': { tabela: 'inventario_estoque_lote' },
  'suprimentos.pedidoAntimicrobianos': { tabela: 'liberacao_antimicrobiano' },
  'suprimentos.recalcularSaldoLog': { tabela: 'recalculo_saldo_estoque' },
  'suprimentos.saldoFornecedor': { tabela: 'saldo_consignado' },
  'suprimentos.substituicaoItem': { tabela: 'substituicao_dispensacao' },
});
