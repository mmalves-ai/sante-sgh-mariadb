// Permissões do M30 (ficha, seção 7; convencoes.md §12): conta do paciente, lançamentos, auditoria de contas, pacotes,
// particular, regras de faturabilidade, simulador e nota de sala. Quem tem a opção no legado tem a permissão no novo
// (regra 1 do M06). Opções da árvore do menu de origem levantadas na primeira hora do marco (retrato
// tools/verificadores/dados/acesso-legado.pc.json):
//   - Faturamento convênios (4): Tabelas 1115 (Parâmetros 1116); Lançamentos 1121 › Cadastro de Contas 1122 (Internas
//     1123: Manutenção 1124, Consulta 1125; Externas 1126: Manutenção 1127, Consulta 1128); Pesquisa de Contas 1166
//     (Contas do Convênio 1168); Irregularidades 1170 (Manutenção 4438, Listagem 1173); Recibo 1198 (e 1195, 1258);
//     Contas Pacote 1427 (Por Conta 1428, Por Procedimento 1429); Auditoria de Contas 1456 (relatório) e 1605
//     (utilitário); Orçamentos 1577 (Tabela 1578, Cadastro 1579, Pagamentos 1580, Por Orçamento 1584); Utilitários ›
//     Fechamento de Fatura 1590 (Fechamento 1591, Apresentação 1592); Ajustes 1594 (Valores 1595, C.P.F. 1596);
//     Exclusão Contas/Lançamentos 1601;
//   - Faturamento ambulatório (3): Lançamentos 709 › Cadastro de Boletins 710 (Manutenção 711, Consulta 712);
//     Irregularidades 4396 (Manutenção 4397, Listagem 4398);
//   - Bloco cirúrgico (0): Lançamentos 2258; Emissão da folha de sala 2240.
// O escopo por convênio (convênios liberados ao usuário) vale em toda leitura e gravação da conta (regra 13, `convenio`).
// "Supervisor" do faturamento (reabrir conta, decidir o lançamento tardio, preço manual): quem tem a opção de
// Fechamento de Fatura (1591) ou de Ajustes de valores (1595) no outro sistema (D-SUP-30).
import type { DeclaracaoPermissao } from './tipos.js';

export const OPCOES_FATURAMENTO = {
  parametros: 1116,
  lancamentos: 1121,
  cadastroContas: 1122,
  internas: 1123,
  internasManutencao: 1124,
  internasConsulta: 1125,
  externas: 1126,
  externasManutencao: 1127,
  externasConsulta: 1128,
  pesquisaContas: 1166,
  contasDoConvenio: 1168,
  irregularidades: 1170,
  irregularidadesManutencao: 4438,
  irregularidadesListagem: 1173,
  reciboNota: 1195,
  recibo: 1198,
  reciboModelo: 1258,
  contasPacote: 1427,
  pacotePorConta: 1428,
  pacotePorProcedimento: 1429,
  auditoriaRelatorio: 1456,
  orcamentos: 1577,
  orcamentoTabela: 1578,
  orcamentoCadastro: 1579,
  orcamentoPagamentos: 1580,
  orcamentoRelatorio: 1584,
  fechamentoFatura: 1590,
  fechamento: 1591,
  ajustes: 1594,
  ajusteValores: 1595,
  ajusteCpf: 1596,
  exclusaoLancamentos: 1601,
  auditoriaUtilitario: 1605,
  ambLancamentos: 709,
  ambBoletins: 710,
  ambBoletimManutencao: 711,
  ambBoletimConsulta: 712,
  ambIrregularidades: 4396,
  ambIrregularidadesManutencao: 4397,
  ambIrregularidadesListagem: 4398,
  blocoLancamentos: 2258,
  blocoFolhaSala: 2240,
} as const;

const O = OPCOES_FATURAMENTO;

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
  escopos: ['convenio'],
  ...extra,
});

const LER_CONTA = [
  O.cadastroContas,
  O.internasManutencao,
  O.internasConsulta,
  O.externasManutencao,
  O.externasConsulta,
  O.pesquisaContas,
  O.contasDoConvenio,
  O.ambBoletimManutencao,
  O.ambBoletimConsulta,
];
const MANTER_CONTA = [O.internasManutencao, O.externasManutencao, O.ambBoletimManutencao];
const SUPERVISOR = [O.fechamento, O.ajusteValores];

export const PERMISSOES_FATURAMENTO_M30: readonly DeclaracaoPermissao[] = [
  p(
    'faturamento.conta.ler',
    'Consultar as contas do paciente (situação, beneficiário mascarado, guias, parciais e etapas)',
    LER_CONTA,
  ),
  p(
    'faturamento.conta.fechar',
    'Fechar a conta do paciente (com os vetos e o pré-voo do banco)',
    [...MANTER_CONTA, O.fechamento],
    {
      criticidade: 'sensivel',
    },
  ),
  p(
    'faturamento.conta.reabrir',
    'Reabrir conta fechada e não apresentada (supervisor, com motivo)',
    SUPERVISOR,
    {
      criticidade: 'sensivel',
    },
  ),
  p(
    'faturamento.item.ler',
    'Consultar os lançamentos da conta (origem, explicação do preço, itens SUS)',
    LER_CONTA,
  ),
  p('faturamento.item.lancar', 'Lançar item manual na conta (procedimento, taxa, mat/med)', MANTER_CONTA, {
    criticidade: 'sensivel',
  }),
  p('faturamento.item.conferir', 'Conferir itens da conta (item a item ou em bloco)', MANTER_CONTA),
  p('faturamento.preco.manual', 'Preço manual fora da faixa da tabela (com aprovação)', SUPERVISOR, {
    criticidade: 'critica',
  }),
  p(
    'faturamento.lancamento.ler',
    'Consultar o que os gatilhos lançaram e a fila de lançamento após o fechamento',
    [O.lancamentos, O.ambLancamentos, ...MANTER_CONTA],
  ),
  p(
    'faturamento.lancamentoTardio.decidir',
    'Decidir o lançamento feito depois do fechamento (reabrir, complementar ou descartar)',
    SUPERVISOR,
    {
      criticidade: 'sensivel',
    },
  ),
  p('faturamento.auditoria.ler', 'Consultar a auditoria de contas (versões, diferenças e evidências)', [
    O.auditoriaRelatorio,
    O.auditoriaUtilitario,
  ]),
  p(
    'faturamento.auditoria.ajustar',
    'Ajustar a conta na auditoria (glosa interna, inclusão, troca de código)',
    [O.auditoriaUtilitario],
    {
      criticidade: 'sensivel',
    },
  ),
  p('faturamento.pendencia.ler', 'Consultar pendências da conta e os tipos de pendência', [
    O.irregularidades,
    O.irregularidadesListagem,
    O.ambIrregularidades,
    O.ambIrregularidadesListagem,
  ]),
  p('faturamento.pendencia.editar', 'Registrar e resolver pendências; manter os tipos de pendência', [
    O.irregularidadesManutencao,
    O.ambIrregularidadesManutencao,
  ]),
  p('faturamento.pacote.ler', 'Consultar pacotes e orçamentos-padrão', [
    O.contasPacote,
    O.pacotePorConta,
    O.pacotePorProcedimento,
    O.orcamentoTabela,
  ]),
  p(
    'faturamento.pacote.editar',
    'Manter os pacotes vigentes do contrato e os orçamentos-padrão',
    [O.orcamentoTabela, O.contasPacote],
    {
      criticidade: 'sensivel',
    },
  ),
  p('faturamento.orcamento.ler', 'Consultar orçamentos de particular', [
    O.orcamentos,
    O.orcamentoCadastro,
    O.orcamentoRelatorio,
  ]),
  p('faturamento.orcamento.criar', 'Registrar orçamento de particular', [O.orcamentoCadastro]),
  p('faturamento.recibo.ler', 'Consultar o caixa e os recibos (inclusive os antigos)', [
    O.recibo,
    O.reciboNota,
    O.reciboModelo,
  ]),
  p(
    'faturamento.recibo.emitir',
    'Abrir e fechar o caixa, receber e emitir recibo de particular',
    [O.recibo, O.orcamentoPagamentos],
    {
      criticidade: 'sensivel',
    },
  ),
  p('faturamento.pagamento.ler', 'Consultar pagamentos por Pix e cartão', [O.orcamentoPagamentos, O.recibo]),
  p(
    'faturamento.pagamento.registrar',
    'Registrar pagamento por Pix e cartão (conector simulado fora de produção)',
    [O.orcamentoPagamentos],
    {
      criticidade: 'sensivel',
    },
  ),
  p('faturamento.regra.ler', 'Consultar as regras de faturabilidade (senha, carteira, guia)', [
    O.parametros,
    ...MANTER_CONTA,
  ]),
  p('faturamento.regra.editar', 'Manter as regras de faturabilidade', [O.parametros], {
    criticidade: 'sensivel',
  }),
  p('faturamento.preco.simular', 'Simular preço e explicar o preço de um item (somente leitura)', [
    O.lancamentos,
    O.ambLancamentos,
    O.parametros,
  ]),
  // Centro cirúrgico: os escopos são os do módulo (sem o convênio do faturamento).
  {
    codigo: 'cirurgia.nota.ler',
    descricao: 'Consultar a nota de sala (consumo e honorários; itens gerados na conta)',
    opcoesLegado: [O.blocoLancamentos, O.blocoFolhaSala],
    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'normal',
  },
];

/** Os códigos (para as rotas e os testes). */
export const PERMISSOES_FATURAMENTO = Object.fromEntries(
  PERMISSOES_FATURAMENTO_M30.map((x) => [
    x.codigo.replace(/\.(\w)/g, (_m, c: string) => c.toUpperCase()),
    x.codigo,
  ]),
) as Readonly<Record<string, string>>;
