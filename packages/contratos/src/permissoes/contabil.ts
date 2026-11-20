// Permissões da contabilidade, etapa 1 (M54-F1; ficha, seção 7; convencoes.md §12): plano de contas e plano
// referencial, publicação da regra de contabilização versionada e o acompanhamento da leitura dos fatos. Quem tem a
// opção no outro sistema tem a permissão no novo (regra 1 do M06). Opções da árvore TBOPCOES (catalogo-legado.json, pc;
// no pc só o grupo MASTER tem as opções do módulo Contabilidade, conferido em acesso-legado.pc.json em 24/10/2026):
//   - Contabilidade 3; Tabelas 12 (Parâmetros 13, Empresas 14, Histórico padrão 15, Plano de contas 4297, Plano de
//     contas referencial 4312 com Manutenção 4313, Contas 4314, Referências 4315, Plano referencial x próprio 4316);
//   - Tabelas › Integração 19 (Integração 4302, Eventos 4300, Convênios 4298, Grupos 4305): o de-para das regras;
//   - Utilitários › Integrar lançamentos 82 (Contas a pagar e receber 83, Lançamentos bancários 84); Consulta de
//     lançamentos 81: a leitura dos fatos.
// As etapas seguintes (lançamento, estorno, encerramento, demonstrações, SPED, custos, patrimônio e orçamento) declaram
// as suas no mesmo arquivo.
import type { DeclaracaoPermissao } from './tipos.js';

export const OPCOES_CONTABIL = {
  modulo: 3,
  tabelas: 12,
  parametros: 13,
  empresas: 14,
  historicoPadrao: 15,
  planoContas: 4297,
  planoReferencial: 4312,
  planoReferencialManutencao: 4313,
  planoReferencialContas: 4314,
  planoReferencialReferencias: 4315,
  referencialXProprio: 4316,
  integracao: 19,
  integracaoIntegracao: 4302,
  integracaoEventos: 4300,
  integracaoConvenios: 4298,
  integracaoGrupos: 4305,
  integrarLancamentos: 82,
  integrarPagarReceber: 83,
  integrarBancarios: 84,
  consultaLancamentos: 81,
  // Etapa 2 (F2): Lançamentos 21 (Lançamentos 22, Novo 4326, Conciliação contábil 4328, Consulta de saldos 27 com
  // Simples 28 e Detalhada 29); Relatórios › Razão 35 (Modelos 36, 37, 4330) e Diário 31; Utilitários › Reclassificação
  // de lançamentos 80 e Encerramento de exercício 85 (Efetivo 86, Desfazer 88).
  lancamentos: 21,
  lancamentosLancamentos: 22,
  lancamentosNovo: 4326,
  conciliacaoContabil: 4328,
  consultaSaldos: 27,
  consultaSaldosSimples: 28,
  consultaSaldosDetalhada: 29,
  diario: 31,
  razao: 35,
  razaoModelo1: 36,
  razaoModelo2: 37,
  razaoModelo3: 4330,
  reclassificacao: 80,
  encerramentoExercicio: 85,
  encerramentoEfetivo: 86,
  encerramentoDesfazer: 88,
  // Etapa 3 (F3): Relatórios 30 (Balancete 38 com Modelos 39-41 e 4331; Balanço Patrimonial 43 com Modelos 44-47; DRE 54
  // com Modelos 55, 56 e 4332; Diário 31 com Modelos 32-34 e 4329; Demonstrativo de Saldos 49 com Modelos 50-52;
  // Publicação 68 com Balanço 70 e DRE 69; Termos de Abertura e Encerramento 57); Gráficos › Demonstrativo de saldos 72,
  // 4336 e 74; Utilitários › SPED Contábil 99 (Acessar PVA 4337, Gerar arquivos 4339).
  relatorios: 30, // pasta do menu: agrupador, não concede permissão (D-PASTA-543)
  balancete: 38,
  balanceteModelo1: 39,
  balanceteModelo2: 40,
  balanceteModelo3: 41,
  balanceteModelo4: 4331,
  balanco: 43,
  balancoModelo1: 44,
  balancoModelo2: 45,
  balancoModelo3: 46,
  balancoModelo4: 47,
  dre: 54,
  dreModelo1: 55,
  dreModelo2: 56,
  dreModelo3: 4332,
  diarioModelo1: 32,
  diarioModelo2: 33,
  diarioModelo3: 34,
  diarioModelo4: 4329,
  demonstrativoSaldos: 49,
  demonstrativoSaldosModelo1: 50,
  demonstrativoSaldosModelo2: 51,
  demonstrativoSaldosModelo3: 52,
  publicacao: 68,
  publicacaoBalanco: 70,
  publicacaoDre: 69,
  termosAberturaEncerramento: 57,
  graficoSaldos1: 72,
  graficoSaldos2: 4336,
  graficoSaldos3: 74,
  sped: 99,
  spedPva: 4337,
  spedGerar: 4339,
} as const;

const O = OPCOES_CONTABIL;

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
  categoria: 'financeira',
  criticidade: 'normal',
  escopos: [],
  ...extra,
});

export const PERMISSOES_CONTABIL_M54_F1: readonly DeclaracaoPermissao[] = [
  p('contabil.plano.ler', 'Consultar o plano de contas, o plano referencial e as regras de contabilização', [
    O.planoContas,
    O.planoReferencial,
    O.planoReferencialContas,
    O.planoReferencialReferencias,
    O.referencialXProprio,
    O.integracao,
    O.integracaoIntegracao,
  ]),
  p(
    'contabil.plano.editar',
    'Incluir e alterar contas do plano e o vínculo com o plano referencial',
    [O.planoContas, O.planoReferencialManutencao, O.referencialXProprio],
    { criticidade: 'sensivel' },
  ),
  p(
    'contabil.regra.publicar',
    'Publicar nova versão de regra de contabilização (a versão publicada não muda; reprocessa só período aberto)',
    [O.integracaoIntegracao, O.integracaoEventos, O.integracaoConvenios, O.integracaoGrupos],
    { criticidade: 'critica' },
  ),
  p(
    'contabil.fato.ler',
    'Acompanhar a leitura dos fatos dos módulos (pendentes, sem regra, contabilizados) e o reprocessamento',
    [O.integrarLancamentos, O.integrarPagarReceber, O.integrarBancarios, O.consultaLancamentos],
  ),
];

/**
 * Etapa 2 (M54-F2; ficha, seção 7): lançamentos (automáticos, manual, estorno), razão, conciliação de contas e o
 * encerramento do período. `contabil.conciliacao.registrar` e `contabil.periodo.reabrir` não estão na ficha: a
 * conciliação e o "desfazer encerramento" têm opção própria no outro sistema (4328 e 88), e quem tem a opção tem a
 * permissão (D-PERM-CONCILIA-542).
 */
export const PERMISSOES_CONTABIL_M54_F2: readonly DeclaracaoPermissao[] = [
  p(
    'contabil.lancamento.ler',
    'Consultar os lançamentos contábeis, o razão das contas, a conciliação e os períodos',
    [
      O.lancamentos,
      O.lancamentosLancamentos,
      O.consultaSaldos,
      O.consultaSaldosSimples,
      O.consultaSaldosDetalhada,
      O.diario,
      O.razao,
      O.razaoModelo1,
      O.razaoModelo2,
      O.razaoModelo3,
      O.consultaLancamentos,
      // Correção da revisão (D-PERM-FATOS-542): a aba dos fatos e o Contabilizar ficam dentro da tela dos
      // lançamentos; quem tem só Integrar lançamentos (82), Contas a pagar e receber (83) ou Lançamentos bancários
      // (84) tinha a tela dos fatos na F1 e continua a abrir a tela (e a aba Fatos pela `contabil.fato.ler`).
      O.integrarLancamentos,
      O.integrarPagarReceber,
      O.integrarBancarios,
    ],
  ),
  p(
    'contabil.lancamento.criar',
    'Incluir lançamento manual e contabilizar os fatos dos módulos (só em período aberto)',
    [O.lancamentosNovo, O.lancamentosLancamentos, O.integrarLancamentos],
    { criticidade: 'sensivel' },
  ),
  p(
    'contabil.lancamento.estornar',
    'Estornar lançamento contábil (outro lançamento, que inverte as partidas; o original fica)',
    [O.reclassificacao, O.lancamentosLancamentos],
    { criticidade: 'sensivel' },
  ),
  p('contabil.conciliacao.registrar', 'Conciliar e desfazer a conciliação das partidas de uma conta', [
    O.conciliacaoContabil,
  ]),
  p(
    'contabil.periodo.encerrar',
    'Encerrar o período contábil (depois do encerramento, nenhum lançamento entra na competência)',
    [O.encerramentoExercicio, O.encerramentoEfetivo],
    { criticidade: 'critica' },
  ),
  p(
    'contabil.periodo.reabrir',
    'Reabrir o último período contábil encerrado, com justificativa',
    [O.encerramentoDesfazer],
    { criticidade: 'critica' },
  ),
];

/**
 * Etapa 3 (M54-F3; ficha, seção 7): balancete, diário, DRE e balanço (`contabil.demonstracao.ler`) e o SPED contábil
 * (`contabil.sped.ler` e `contabil.sped.gerar`). A apuração do resultado do exercício usa a `contabil.periodo.encerrar`
 * da etapa 2 (é o "Encerramento de exercício" do outro sistema, opções 85 e 86). Baixar o arquivo gerado exige a
 * `contabil.sped.gerar`: o arquivo traz o CPF dos signatários (D-BAIXAR-543).
 */
export const PERMISSOES_CONTABIL_M54_F3: readonly DeclaracaoPermissao[] = [
  // A pasta Relatórios (30) não entra: quem tem só o Razão (35-37, contabil.lancamento.ler) também tem a pasta para
  // chegar a ele, e ganharia o balancete, o diário, a DRE e o balanço sem ter as opções deles (D-PASTA-543).
  p('contabil.demonstracao.ler', 'Consultar o balancete, o diário, a DRE e o balanço patrimonial', [
    O.balancete,
    O.balanceteModelo1,
    O.balanceteModelo2,
    O.balanceteModelo3,
    O.balanceteModelo4,
    O.balanco,
    O.balancoModelo1,
    O.balancoModelo2,
    O.balancoModelo3,
    O.balancoModelo4,
    O.dre,
    O.dreModelo1,
    O.dreModelo2,
    O.dreModelo3,
    O.diario,
    O.diarioModelo1,
    O.diarioModelo2,
    O.diarioModelo3,
    O.diarioModelo4,
    O.demonstrativoSaldos,
    O.demonstrativoSaldosModelo1,
    O.demonstrativoSaldosModelo2,
    O.demonstrativoSaldosModelo3,
    O.publicacao,
    O.publicacaoBalanco,
    O.publicacaoDre,
    O.termosAberturaEncerramento,
    O.graficoSaldos1,
    O.graficoSaldos2,
    O.graficoSaldos3,
  ]),
  p('contabil.sped.ler', 'Consultar os arquivos da ECD e da ECF gerados e a prévia da geração', [
    O.sped,
    O.spedPva,
    O.spedGerar,
  ]),
  p(
    'contabil.sped.gerar',
    'Gerar e baixar a ECD e a ECF do exercício e registrar o recibo da transmissão',
    [O.spedGerar],
    { criticidade: 'sensivel' },
  ),
];
