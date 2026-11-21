// Permissões do M33 (ficha, seção 7; convencoes.md §12): regras de repasse e simulador, apuração e demonstrativo,
// lançamento de eventos, RPA, integração contábil, configurações, cooperativas e o extrato do médico. Quem tem a opção no
// outro sistema tem a permissão no novo (regra 1 do M06). Opções da árvore do menu de origem levantadas no preparo do marco
// (conector/mapa/permissoes.tsv):
//   - Tabelas › Geral M - Z › Percentual de repasse 3728 (regras); Tabelas › Geral A - L › Cooperativas 3675;
//   - Gestão de repasses e terceiros 6609: Tabelas 3025 (Parâmetros 3026, Cadastro de eventos 3027, Integração 3031,
//     Parâmetros usuário/empresa 5608); Lançamentos 3032 (Lançamento de eventos 3033, Apuração de impostos 3034,
//     Visualizar apuração 3035, Listagem 3036); Relatórios › Demonstrativo de pagamento 3044; Utilitários › Desfazer
//     apuração 4807, Empresas 4811;
//   - Faturamento convênios › Lançamentos › R.P.A. 1212 (Com valor 1214, Modelo I 1215, Modelo II 1216).
// Supervisor do repasse (aprovar regra e apuração): Apuração de impostos (3034) ou Desfazer apuração (4807) (D-SUP-33,
// a confirmar com o setor); quem propôs ou apurou não aprova (regras 3 e 9, conferidas no serviço).
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
  escopos: [],
  ...extra,
});

export const PERMISSOES_REPASSE_M33: readonly DeclaracaoPermissao[] = [
  p('repasse.regra.ler', 'Consultar as regras de repasse e simular o valor de um item'),
  p(
    'repasse.regra.propor',
    'Propor regra nova ou nova versão (rascunho com simulação; só vale aprovada)',

    { criticidade: 'sensivel' },
  ),
  p(
    'repasse.regra.aprovar',
    'Aprovar ou recusar a regra proposta (supervisor; quem propôs não aprova)',

    { criticidade: 'critica' },
  ),
  p('repasse.apuracao.ler', 'Consultar a apuração do período, a memória de cálculo e o demonstrativo'),
  p(
    'repasse.apuracao.apurar',
    'Apurar o período (um sistema por período e empresa) e conferir',

    { criticidade: 'sensivel' },
  ),
  p(
    'repasse.apuracao.aprovar',
    'Aprovar ou devolver a apuração (supervisor; quem apurou não aprova)',

    { criticidade: 'critica' },
  ),
  p('repasse.lancamento.ler', 'Consultar os lançamentos de eventos do repasse'),
  p(
    'repasse.lancamento.criar',
    'Lançar evento de repasse (da apuração aprovada ou ajuste avulso com justificativa) e o estorno por glosa',

    { criticidade: 'sensivel' },
  ),
  p('repasse.rpa.ler', 'Consultar RPA, retenções e o demonstrativo de pagamento'),
  p('repasse.rpa.emitir', 'Emitir o RPA (INSS, IRRF e ISS) com o título a pagar', {
    criticidade: 'critica',
  }),
  p('repasse.evento.ler', 'Consultar os eventos de RPA, a natureza eSocial e a integração contábil'),
  p('repasse.evento.editar', 'Manter os eventos de RPA e a integração contábil do repasse'),
  p('repasse.parametro.ler', 'Consultar as configurações do repasse'),
  p(
    'repasse.parametro.editar',
    'Editar as configurações do repasse (parâmetros, empresas que somam impostos)',

    { criticidade: 'sensivel' },
  ),
  p('repasse.cooperativa.ler', 'Consultar cooperativas, cooperados e credenciamentos'),
  p('repasse.cooperativa.editar', 'Manter cooperativas, cooperados e credenciamentos'),
  // Extrato do médico (regra 12): todo perfil de pessoa pode abrir, mas só vê o que é do próprio vínculo com o
  // usuário com o profissional (o filtro é do servidor; sem vínculo, a lista vem vazia; o escopo 'vinculo' do
  // catálogo é o assistencial, com paciente, e não serve aqui). Nenhum outro perfil assistencial vê repasse.
  p('repasse.extrato.ler', 'Ver o próprio extrato de produção e repasse', {
    concessaoPorPerfil: 'todos-os-perfis-de-pessoa',
  }),
];
