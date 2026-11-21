// Permissões do M53-F0 (ficha do M53, seção 7; convencoes.md §12): ler a folha da competência e os lotes de interface,
// exportar o lote à folha externa e importar o retorno. Quem tem a opção no outro sistema tem a permissão no novo
// (regra 1 do M06). Opções da árvore do menu de origem levantadas no preparo (catalogo-legado.json, pc):
//   - Folha de pagamento 351 (e as entradas 553 e 4259 do mesmo módulo); Lançamentos 372; Lançamentos › Folha Mensal
//     384; Lançamentos › Afastamento 389; Exportações 523; Rotinas › Integração 397; Utilitarios › Importações 547 (Importação inicial 548);
//   - Ponto eletrônico (novo) › Integrações › Integração com folha de pagamento 5084.
// As demais permissões da ficha (pessoas.folha.calcular, M53-F2, abaixo; pessoas.folha.fechar, M53-F6; pessoas.rubrica.*, M53-F1;
// pessoas.esocial.*, pessoas.obrigacao.*, pessoas.integracao.*, fatias seguintes) entram com a fatia que as usa.
// D-PERM-53 (POL-5): `pessoas.folha.exportar` não está na tabela da ficha, que põe a interface sob
// `pessoas.folha.importar`. Exportar manda dado de colaborador (CPF, lotação, conselho) para fora do sistema, o que é
// outra decisão de acesso e outro registro na trilha; por isso é permissão própria, sensível.
import type { DeclaracaoPermissao } from './tipos.js';

export const OPCOES_FOLHA = {
  modulo: 351,
  moduloEntrada2: 553,
  moduloEntrada3: 4259,
  lancamentos: 372,
  folhaMensal: 384,
  rotinaIntegracao: 397,
  exportacoes: 523,
  importacoes: 547,
  importacaoInicial: 548,
  pontoIntegracaoFolha: 5084,
  afastamento: 389,
  // M53.2 (F1): as opções dos cadastros da folha que a tela das rubricas mostra (domínios do lote do M53).
  eventos: 367,
  eventosAlterar: 368,
  tabelaCalculo: 370,
  parametros: 355,
  integracao: 371,
  // M53.3 (F2): o processamento da folha mensal, as manutenções da folha, a alteração de salário, o funcionário e os
  // parâmetros do módulo por empresa.
  processamento: 391,
  manutencaoIndividual: 385,
  manutencaoColetiva: 386,
  alteracaoSalario: 392,
  funcionario: 358,
  funcionarioEntrada2: 4224,
  parametrosModulo: 354,
  // M53.4 (F3): férias (lançamento, liberação, agenda, ajuste e os relatórios de férias) e 13º salário (o lançamento
  // automático e os relatórios do 13º).
  ferias: 387,
  liberacaoFerias: 395,
  agendaFerias: 4236,
  ajusteFerias: 539,
  relatoriosFerias: 438,
  reciboAvisoFerias: 439,
  escalaFerias: 443,
  feriasVencidas: 442,
  controleFerias: 447,
  listagemFerias: 451,
  lancamentosAutomaticos: 373,
  decimoTerceiro: 382,
  relatoriosDecimo: 471,
  provisaoDecimo: 472,
  // M53.5 (F4): rescisão (o lançamento e os relatórios de rescisão: termo, aviso prévio, comunicado e guias).
  rescisao: 388,
  relatoriosRescisao: 453,
  avisoPrevioIndenizado: 454,
  avisoPrevioEmpregador: 455,
  reducaoAvisoPrevio: 458,
  pedidoDemissao: 459,
  termoRescisao: 462,
  seguroDesemprego: 463,
  grfc: 464,
  comunicadoExtincao: 465,
  // M53.6 (F5): o módulo do eSocial (envio, pendências, lotes, histórico, importação do XML, tabelas, parâmetros e o
  // certificado) e os relatórios de conferência da carga inicial dos eventos de tabela e de admissão.
  esocialModulo: 5105,
  esocialTabelas: 5107,
  esocialEnvio: 5108,
  esocialPendencias: 5109,
  esocialPainelEnvio: 5110,
  esocialConsultaLotes: 5111,
  esocialParametros: 5113,
  esocialCertificado: 6977,
  esocialImportarXml: 6978,
  esocialHistoricoEnvio: 6979,
  conferenciaEsocial: 4288,
  cargaInicialS1000: 4281,
  cargaInicialS1005: 4282,
  cargaInicialS1010: 4283,
  cargaInicialS1020: 4284,
  cargaInicialS2200: 4292,
  cargaInicialS2300: 4293,
  // M53.7 (F6): a liberação do mês (fechamento da competência) e a abertura do mês/ano (reabertura).
  liberacaoMes: 396,
  aberturaMesAno: 545,
  // M53.8 (F7): as exportações e os aplicativos das obrigações legais e os relatórios do FGTS.
  exportacaoCaged: 525,
  exportacaoSefip: 526,
  exportacaoGrrf: 527,
  exportacaoRais: 528,
  aplicativoCaged: 533,
  aplicativoSefip: 534,
  aplicativoRais: 535,
  relatorioFgts: 415,
  fgtsConsolidadoEsocial: 5133,
  baseFgtsSghEsocial: 5643,
  // M53.9 (F8): a integração da folha com o financeiro e o contábil (o cadastro de rotinas, o de-para por empresa e
  // rotina em Tabelas › Administrativo › Integração › Folha de pagamento, a rotina de integração e a importação da folha
  // na contabilidade).
  tabelasIntegracao: 371,
  integracaoAdmFolha: 4876,
  integracaoAdmSindical: 4877,
  integracaoAdmConsignado: 4878,
  integracaoAdmPensao: 4879,
  integracaoAdmTributos: 4880,
  integracaoAdmVales: 4881,
  integracaoAdmFolhas: 4882,
  importacaoFolhaContabil: 93,
} as const;

const O = OPCOES_FOLHA;

const p = (
  codigo: string,
  descricao: string,
  opcoesLegado: readonly number[],
  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,
  opcoesLegado,
  concessaoPorPerfil: null,
  categoria: 'administrativa',
  criticidade: 'normal',
  escopos: [],
  ...extra,
});

export const PERMISSOES_FOLHA_M53: readonly DeclaracaoPermissao[] = [
  p('pessoas.folha.ler', 'Consultar a folha da competência e os lotes trocados com a folha externa', [
    O.modulo,
    O.moduloEntrada2,
    O.moduloEntrada3,
    O.lancamentos,
    O.folhaMensal,
    O.exportacoes,
    O.rotinaIntegracao,
  ]),
  p(
    'pessoas.folha.exportar',
    'Gerar e baixar o lote da competência para a folha externa (colaboradores, lotação, afastamentos, ponto e plantões)',
    [O.exportacoes, O.rotinaIntegracao, O.pontoIntegracaoFolha],
    { criticidade: 'sensivel' },
  ),
  p(
    'pessoas.folha.importar',
    'Importar o retorno da folha externa (folha líquida e encargos) e conferir contagem e soma',
    [O.importacoes, O.importacaoInicial, O.rotinaIntegracao],
    { categoria: 'financeira', criticidade: 'sensivel' },
  ),
  // M53.2 (D-ABRIR-532): o item `Gestão de pessoas > Folha de pagamento` e as duas telas da área (a folha da competência
  // e as rubricas e tabelas legais) abrem para quem tem QUALQUER parte da área no outro sistema: a folha mensal (as
  // opções de `pessoas.folha.ler`), os eventos (367/368, `pessoas.rubrica.ler`), a tabela de cálculo (370,
  // `pessoas.tabelaLegalFolha.ler`), os parâmetros (355) ou a integração (371). Só abre a área e o apoio (rótulos e o
  // estado da gravação): cada aba e cada dado seguem pedindo a sua permissão.
  p(
    'pessoas.folha.abrir',
    'Abrir a área da folha de pagamento (menu e telas); cada parte pede a sua permissão de consulta',
    [
      O.modulo,
      O.moduloEntrada2,
      O.moduloEntrada3,
      O.lancamentos,
      O.folhaMensal,
      O.exportacoes,
      O.rotinaIntegracao,
      O.eventos,
      O.eventosAlterar,
      O.tabelaCalculo,
      O.parametros,
      O.integracao,
      O.processamento,
      O.manutencaoIndividual,
      O.manutencaoColetiva,
      O.alteracaoSalario,
      O.parametrosModulo,
      O.ferias,
      O.liberacaoFerias,
      O.agendaFerias,
      O.ajusteFerias,
      O.relatoriosFerias,
      O.reciboAvisoFerias,
      O.escalaFerias,
      O.feriasVencidas,
      O.controleFerias,
      O.listagemFerias,
      O.lancamentosAutomaticos,
      O.decimoTerceiro,
      O.relatoriosDecimo,
      O.provisaoDecimo,
      O.rescisao,
      O.relatoriosRescisao,
      O.avisoPrevioIndenizado,
      O.avisoPrevioEmpregador,
      O.reducaoAvisoPrevio,
      O.pedidoDemissao,
      O.termoRescisao,
      O.seguroDesemprego,
      O.grfc,
      O.comunicadoExtincao,
      O.liberacaoMes,
      O.aberturaMesAno,
      O.exportacaoCaged,
      O.exportacaoSefip,
      O.exportacaoGrrf,
      O.exportacaoRais,
      O.aplicativoCaged,
      O.aplicativoSefip,
      O.aplicativoRais,
      O.relatorioFgts,
    ],
  ),
  // M53.1 (D-AFAST-531): o afastamento (motivo do domínio de afastamentos) é registrado no novo; a exportação o leva.
  p(
    'pessoas.afastamento.registrar',
    'Registrar, encerrar e cancelar o afastamento do colaborador (motivo, início e fim)',
    [O.afastamento, O.lancamentos],
    { criticidade: 'sensivel' },
  ),
  // M53.3 (F2, cálculo mensal). D-PERM-533 (POL-5): o salário contratual é dado do colaborador que só o departamento
  // pessoal vê (permissão própria, sensível, e não `pessoas.folha.ler`); quem processa a folha no outro sistema vê o
  // salário que entra nela. Os parâmetros da folha por empresa (percentuais, alíquotas patronais, papéis das rubricas)
  // seguem a opção dos parâmetros do módulo.
  p(
    'pessoas.folha.calcular',
    'Calcular, recalcular e descartar a folha mensal da competência (prévia e processamento gravado)',
    [O.processamento, O.folhaMensal, O.manutencaoIndividual, O.manutencaoColetiva],
    { categoria: 'financeira', criticidade: 'sensivel' },
  ),
  p(
    'pessoas.salario.ler',
    'Consultar o salário contratual do colaborador (vigências, dependentes e adicionais)',
    [O.alteracaoSalario, O.funcionario, O.funcionarioEntrada2, O.processamento, O.folhaMensal],
    { criticidade: 'sensivel' },
  ),
  p(
    'pessoas.salario.editar',
    'Registrar nova vigência do salário contratual do colaborador (valor, dependentes e adicionais)',
    [O.alteracaoSalario],
    { categoria: 'financeira', criticidade: 'sensivel' },
  ),
  p(
    'pessoas.parametroFolha.editar',
    'Registrar nova vigência dos parâmetros da folha da empresa (percentuais, alíquotas patronais e rubricas do cálculo)',
    [O.parametros, O.parametrosModulo],
    { categoria: 'financeira', criticidade: 'sensivel' },
  ),
  // M53.4 (F3, férias e 13º). D-PERM-534 (POL-5): consultar os períodos e a escala de férias não revela salário
  // (`pessoas.ferias.ler`, normal); os valores do recibo seguem `pessoas.salario.ler` (D-PERM-SAL-533). Programar (datas,
  // abono) e calcular o recibo são permissões separadas, como no outro sistema (lançamento × liberação de férias); o 13º
  // da empresa é processamento como a folha mensal (lista, detalhe e descarte pelas rotas do cálculo).
  p(
    'pessoas.ferias.ler',
    'Consultar os períodos aquisitivos, o saldo e a escala de férias dos colaboradores',
    [
      O.ferias,
      O.liberacaoFerias,
      O.agendaFerias,
      O.relatoriosFerias,
      O.reciboAvisoFerias,
      O.escalaFerias,
      O.feriasVencidas,
      O.controleFerias,
      O.listagemFerias,
    ],
  ),
  p(
    'pessoas.ferias.programar',
    'Programar e cancelar as férias do colaborador (frações, abono pecuniário e adiantamento do 13º)',
    [O.ferias, O.agendaFerias, O.ajusteFerias],
  ),
  p(
    'pessoas.ferias.calcular',
    'Calcular, gravar e cancelar o recibo de férias do colaborador',
    [O.ferias, O.liberacaoFerias, O.ajusteFerias],
    { categoria: 'financeira', criticidade: 'sensivel' },
  ),
  p(
    'pessoas.decimo.calcular',
    'Calcular e descartar as parcelas do 13º salário da empresa (adiantamento e parcela final)',
    [O.decimoTerceiro, O.lancamentosAutomaticos, O.processamento],
    { categoria: 'financeira', criticidade: 'sensivel' },
  ),
  // M53.5 (F4, rescisão). D-PERM-535 (POL-5): consultar as rescisões e a fila dos desligados (datas, modalidade, situação)
  // não revela salário (`pessoas.rescisao.ler`, normal); os valores do termo seguem `pessoas.salario.ler` (D-PERM-SAL-533).
  // Calcular, gravar, recalcular e cancelar a rescisão é a permissão sensível, como o lançamento de rescisão do outro sistema.
  p('pessoas.rescisao.ler', 'Consultar os colaboradores desligados e as rescisões calculadas', [
    O.rescisao,
    O.relatoriosRescisao,
    O.avisoPrevioIndenizado,
    O.avisoPrevioEmpregador,
    O.reducaoAvisoPrevio,
    O.pedidoDemissao,
    O.termoRescisao,
    O.seguroDesemprego,
    O.grfc,
    O.comunicadoExtincao,
  ]),
  p(
    'pessoas.rescisao.calcular',
    'Calcular, gravar, recalcular e cancelar a rescisão do colaborador desligado',
    [O.rescisao],
    { categoria: 'financeira', criticidade: 'sensivel' },
  ),
  // M53.6 (F5, eSocial de tabela e não periódicos). D-PERM-536 (POL-5): a ficha propõe só `pessoas.esocial.ler` e
  // `.transmitir`; gerar o evento (e gravar a ficha do eSocial do colaborador e os parâmetros do empregador) é decisão
  // própria, sensível, porque o XML leva CPF, nome e endereço, como as tabelas e os parâmetros do módulo do outro
  // sistema. Consultar a lista de eventos, os lotes, as pendências e a conciliação não revela dado pessoal (normal).
  // Transmitir (montar e enviar lotes, registrar o retorno) é o painel de envio do outro sistema: em `producao` só com a
  // chave `pessoas.esocial` ligada (certificado do empregador como pré-requisito).
  p('pessoas.esocial.ler', 'Consultar os eventos, os lotes, as pendências e a conciliação do eSocial', [
    O.esocialModulo,
    O.esocialEnvio,
    O.esocialPendencias,
    O.esocialPainelEnvio,
    O.esocialConsultaLotes,
    O.esocialHistoricoEnvio,
    O.conferenciaEsocial,
    O.cargaInicialS1000,
    O.cargaInicialS1005,
    O.cargaInicialS1010,
    O.cargaInicialS1020,
    O.cargaInicialS2200,
    O.cargaInicialS2300,
  ]),
  p(
    'pessoas.esocial.gerar',
    'Gerar e descartar eventos do eSocial, ver o XML e gravar a ficha do eSocial do colaborador e os parâmetros do empregador',
    [O.esocialTabelas, O.esocialParametros, O.esocialImportarXml, O.esocialPainelEnvio],
    { criticidade: 'sensivel' },
  ),
  p(
    'pessoas.esocial.transmitir',
    'Montar, enviar e cancelar lotes do eSocial e registrar o retorno (em produção, só com a transmissão liberada)',
    [O.esocialEnvio, O.esocialPainelEnvio, O.esocialCertificado],
    { criticidade: 'sensivel' },
  ),
  // M53.7 (F6, periódicos e fechamento). Fechar o período fixa a folha (nenhum recálculo até a reabertura) e libera os
  // periódicos do eSocial; reabrir desfaz isso, com motivo. É a liberação do mês e a abertura do mês/ano do outro
  // sistema. Gerar os periódicos segue `pessoas.esocial.gerar`; o S-1299 e o S-1298 também.
  p(
    'pessoas.folha.fechar',
    'Fechar e reabrir o período da folha (mensal e 13º) para os periódicos do eSocial',
    [O.liberacaoMes, O.aberturaMesAno],
    { categoria: 'financeira', criticidade: 'sensivel' },
  ),
  // M53.8 (F7, FGTS Digital e obrigações legais). Consultar as obrigações geradas, os parâmetros e a apuração do FGTS
  // (quantidades; os valores seguem `pessoas.salario.ler`) é o relatório do FGTS e os aplicativos do outro sistema.
  // D-PERM-OBR-538 (POL-5): gerar o arquivo, baixá-lo (leva CPF, NIS, nome e remuneração), registrar a entrega e gravar
  // os parâmetros das obrigações é a exportação delas: sensível.
  p(
    'pessoas.obrigacao.ler',
    'Consultar as obrigações legais geradas (FGTS Digital, SEFIP, CAGED e RAIS), os parâmetros e a apuração do FGTS',
    [
      O.relatorioFgts,
      O.fgtsConsolidadoEsocial,
      O.baseFgtsSghEsocial,
      O.aplicativoCaged,
      O.aplicativoSefip,
      O.aplicativoRais,
    ],
  ),
  p(
    'pessoas.obrigacao.gerar',
    'Gerar e baixar os arquivos das obrigações legais, registrar a entrega e gravar os parâmetros das obrigações',
    [O.exportacaoCaged, O.exportacaoSefip, O.exportacaoGrrf, O.exportacaoRais],
    { criticidade: 'sensivel' },
  ),
  // M53.9 (F8, títulos e fatos contábeis). Consultar a integração (o de-para, os lançamentos, o custo de pessoal por
  // centro de custo) é quem tem qualquer parte da integração no outro sistema. Configurar o de-para (credor,
  // classificação e vencimento de cada rotina) é a tabela de integração da folha (D-PERM-INTG-539: permissão própria,
  // porque decide para quem o dinheiro vai). Lançar os títulos é a rotina de integração (financeira, sensível).
  p(
    'pessoas.integracao.ler',
    'Consultar a integração da folha com o financeiro e o contábil (de-para, títulos lançados, custo de pessoal)',
    [
      O.tabelasIntegracao,
      O.rotinaIntegracao,
      O.integracaoAdmFolha,
      O.integracaoAdmSindical,
      O.integracaoAdmConsignado,
      O.integracaoAdmPensao,
      O.integracaoAdmTributos,
      O.integracaoAdmVales,
      O.integracaoAdmFolhas,
      O.importacaoFolhaContabil,
    ],
  ),
  p(
    'pessoas.integracao.configurar',
    'Configurar o de-para da folha para o contas a pagar (credor, classificação gerencial e vencimento por rotina)',
    [
      O.tabelasIntegracao,
      O.integracaoAdmFolha,
      O.integracaoAdmSindical,
      O.integracaoAdmConsignado,
      O.integracaoAdmPensao,
      O.integracaoAdmTributos,
      O.integracaoAdmFolhas,
    ],
    { categoria: 'financeira', criticidade: 'sensivel' },
  ),
  p(
    'pessoas.integracao.lancar',
    'Lançar no contas a pagar os títulos da folha (líquido e encargos) de um período fechado ou de um retorno conferido',
    [O.rotinaIntegracao],
    { categoria: 'financeira', criticidade: 'sensivel' },
  ),
];
