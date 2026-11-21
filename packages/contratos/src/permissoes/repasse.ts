// Permissões do M33 (ficha, seção 7; convencoes.md §12): regras de repasse e simulador, apuração e demonstrativo,
// lançamento de eventos, RPA, integração contábil, configurações, cooperativas e o extrato do médico. Quem tem a opção no
// outro sistema tem a permissão no novo (regra 1 do M06). Opções da árvore do menu de origem levantadas no preparo do marco
// (catalogo-legado.json, pc):
//   - Tabelas › Geral M - Z › Percentual de repasse 3728 (regras); Tabelas › Geral A - L › Cooperativas 3675;
//   - Gestão de repasses e terceiros 6609: Tabelas 3025 (Parâmetros 3026, Cadastro de eventos 3027, Integração 3031,
//     Parâmetros usuário/empresa 5608); Lançamentos 3032 (Lançamento de eventos 3033, Apuração de impostos 3034,
//     Visualizar apuração 3035, Listagem 3036); Relatórios › Demonstrativo de pagamento 3044; Utilitários › Desfazer
//     apuração 4807, Empresas 4811;
//   - Faturamento convênios › Lançamentos › R.P.A. 1212 (Com valor 1214, Modelo I 1215, Modelo II 1216).
// Supervisor do repasse (aprovar regra e apuração): Apuração de impostos (3034) ou Desfazer apuração (4807) (D-SUP-33,
// a confirmar com o setor); quem propôs ou apurou não aprova (regras 3 e 9, conferidas no serviço).
import type { DeclaracaoPermissao } from './tipos.js';

export const OPCOES_REPASSE = {
  percentualRepasse: 3728,
  cooperativas: 3675,
  modulo: 6609,
  tabelas: 3025,
  parametros: 3026,
  cadastroEventos: 3027,
  integracao: 3031,
  parametrosUsuarioEmpresa: 5608,
  lancamentos: 3032,
  lancamentoEventos: 3033,
  apuracaoImpostos: 3034,
  visualizarApuracao: 3035,
  listagem: 3036,
  demonstrativoPagamento: 3044,
  desfazerApuracao: 4807,
  empresas: 4811,
  rpa: 1212,
  rpaComValor: 1214,
  rpaModeloI: 1215,
  rpaModeloII: 1216,
} as const;

const O = OPCOES_REPASSE;

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

const SUPERVISOR = [O.apuracaoImpostos, O.desfazerApuracao];
const APURACAO_LER = [
  O.lancamentos,
  O.visualizarApuracao,
  O.listagem,
  O.demonstrativoPagamento,
  ...SUPERVISOR,
];
const RPA_EMITIR = [O.rpa, O.rpaComValor, O.rpaModeloI, O.rpaModeloII];

export const PERMISSOES_REPASSE_M33: readonly DeclaracaoPermissao[] = [
  p('repasse.regra.ler', 'Consultar as regras de repasse e simular o valor de um item', [
    O.percentualRepasse,
    ...SUPERVISOR,
  ]),
  p(
    'repasse.regra.propor',
    'Propor regra nova ou nova versão (rascunho com simulação; só vale aprovada)',
    [O.percentualRepasse],
    { criticidade: 'sensivel' },
  ),
  p(
    'repasse.regra.aprovar',
    'Aprovar ou recusar a regra proposta (supervisor; quem propôs não aprova)',
    SUPERVISOR,
    { criticidade: 'critica' },
  ),
  p(
    'repasse.apuracao.ler',
    'Consultar a apuração do período, a memória de cálculo e o demonstrativo',
    APURACAO_LER,
  ),
  p(
    'repasse.apuracao.apurar',
    'Apurar o período (um sistema por período e empresa) e conferir',
    [O.lancamentos, O.lancamentoEventos, ...SUPERVISOR],
    { criticidade: 'sensivel' },
  ),
  p(
    'repasse.apuracao.aprovar',
    'Aprovar ou devolver a apuração (supervisor; quem apurou não aprova)',
    SUPERVISOR,
    { criticidade: 'critica' },
  ),
  p('repasse.lancamento.ler', 'Consultar os lançamentos de eventos do repasse', [
    O.lancamentos,
    O.lancamentoEventos,
    O.listagem,
  ]),
  p(
    'repasse.lancamento.criar',
    'Lançar evento de repasse (da apuração aprovada ou ajuste avulso com justificativa) e o estorno por glosa',
    [O.lancamentoEventos],
    { criticidade: 'sensivel' },
  ),
  p('repasse.rpa.ler', 'Consultar RPA, retenções e o demonstrativo de pagamento', [
    ...RPA_EMITIR,
    O.demonstrativoPagamento,
    O.apuracaoImpostos,
  ]),
  p('repasse.rpa.emitir', 'Emitir o RPA (INSS, IRRF e ISS) com o título a pagar', RPA_EMITIR, {
    criticidade: 'critica',
  }),
  p('repasse.evento.ler', 'Consultar os eventos de RPA, a natureza eSocial e a integração contábil', [
    O.tabelas,
    O.cadastroEventos,
    O.integracao,
  ]),
  p('repasse.evento.editar', 'Manter os eventos de RPA e a integração contábil do repasse', [
    O.cadastroEventos,
    O.integracao,
  ]),
  p('repasse.parametro.ler', 'Consultar as configurações do repasse', [
    O.tabelas,
    O.parametros,
    O.parametrosUsuarioEmpresa,
    O.empresas,
  ]),
  p(
    'repasse.parametro.editar',
    'Editar as configurações do repasse (parâmetros, empresas que somam impostos)',
    [O.parametros, O.parametrosUsuarioEmpresa, O.empresas],
    { criticidade: 'sensivel' },
  ),
  p('repasse.cooperativa.ler', 'Consultar cooperativas, cooperados e credenciamentos', [
    O.cooperativas,
    O.percentualRepasse,
  ]),
  p('repasse.cooperativa.editar', 'Manter cooperativas, cooperados e credenciamentos', [O.cooperativas]),
  // Extrato do médico (regra 12): todo perfil de pessoa pode abrir, mas só vê o que é do próprio vínculo com o
  // usuário com o profissional (o filtro é do servidor; sem vínculo, a lista vem vazia; o escopo 'vinculo' do
  // catálogo é o assistencial, com paciente, e não serve aqui). Nenhum outro perfil assistencial vê repasse.
  p('repasse.extrato.ler', 'Ver o próprio extrato de produção e repasse', [], {
    concessaoPorPerfil: 'todos-os-perfis-de-pessoa',
  }),
];
