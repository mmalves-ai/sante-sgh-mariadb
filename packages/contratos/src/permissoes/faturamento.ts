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

const p = (
  codigo: string,
  descricao: string,

  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,

  concessaoPorPerfil: null,
  categoria: 'financeira',
  criticidade: 'normal',
  escopos: ['convenio'],
  ...extra,
});

export const PERMISSOES_FATURAMENTO_M30: readonly DeclaracaoPermissao[] = [
  p(
    'faturamento.conta.ler',
    'Consultar as contas do paciente (situação, beneficiário mascarado, guias, parciais e etapas)',
  ),
  p(
    'faturamento.conta.fechar',
    'Fechar a conta do paciente (com os vetos e o pré-voo do banco)',

    {
      criticidade: 'sensivel',
    },
  ),
  p(
    'faturamento.conta.reabrir',
    'Reabrir conta fechada e não apresentada (supervisor, com motivo)',

    {
      criticidade: 'sensivel',
    },
  ),
  p('faturamento.item.ler', 'Consultar os lançamentos da conta (origem, explicação do preço, itens SUS)'),
  p('faturamento.item.lancar', 'Lançar item manual na conta (procedimento, taxa, mat/med)', {
    criticidade: 'sensivel',
  }),
  p('faturamento.item.conferir', 'Conferir itens da conta (item a item ou em bloco)'),
  p('faturamento.preco.manual', 'Preço manual fora da faixa da tabela (com aprovação)', {
    criticidade: 'critica',
  }),
  p(
    'faturamento.lancamento.ler',
    'Consultar o que os gatilhos lançaram e a fila de lançamento após o fechamento',
  ),
  p(
    'faturamento.lancamentoTardio.decidir',
    'Decidir o lançamento feito depois do fechamento (reabrir, complementar ou descartar)',

    {
      criticidade: 'sensivel',
    },
  ),
  p('faturamento.auditoria.ler', 'Consultar a auditoria de contas (versões, diferenças e evidências)'),
  p(
    'faturamento.auditoria.ajustar',
    'Ajustar a conta na auditoria (glosa interna, inclusão, troca de código)',

    {
      criticidade: 'sensivel',
    },
  ),
  p('faturamento.pendencia.ler', 'Consultar pendências da conta e os tipos de pendência'),
  p('faturamento.pendencia.editar', 'Registrar e resolver pendências; manter os tipos de pendência'),
  p('faturamento.pacote.ler', 'Consultar pacotes e orçamentos-padrão'),
  p(
    'faturamento.pacote.editar',
    'Manter os pacotes vigentes do contrato e os orçamentos-padrão',

    {
      criticidade: 'sensivel',
    },
  ),
  p('faturamento.orcamento.ler', 'Consultar orçamentos de particular'),
  p('faturamento.orcamento.criar', 'Registrar orçamento de particular'),
  p('faturamento.recibo.ler', 'Consultar o caixa e os recibos (inclusive os antigos)'),
  p(
    'faturamento.recibo.emitir',
    'Abrir e fechar o caixa, receber e emitir recibo de particular',

    {
      criticidade: 'sensivel',
    },
  ),
  p('faturamento.pagamento.ler', 'Consultar pagamentos por Pix e cartão'),
  p(
    'faturamento.pagamento.registrar',
    'Registrar pagamento por Pix e cartão (conector simulado fora de produção)',

    {
      criticidade: 'sensivel',
    },
  ),
  p('faturamento.regra.ler', 'Consultar as regras de faturabilidade (senha, carteira, guia)'),
  p('faturamento.regra.editar', 'Manter as regras de faturabilidade', {
    criticidade: 'sensivel',
  }),
  p('faturamento.preco.simular', 'Simular preço e explicar o preço de um item (somente leitura)'),
  // Centro cirúrgico: os escopos são os do módulo (sem o convênio do faturamento).
  {
    codigo: 'cirurgia.nota.ler',
    descricao: 'Consultar a nota de sala (consumo e honorários; itens gerados na conta)',

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
