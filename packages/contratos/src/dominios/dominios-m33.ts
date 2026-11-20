// Cadastros do repasse médico no CRUD genérico (M33; ficha, seção 5, "Receita genérica do CRUD"): eventos de RPA e a
// natureza eSocial do evento, os tipos de prestador, os parâmetros do RPA, a integração contábil dos eventos, o período
// por usuário e as empresas que somam impostos, as cooperativas, os cooperados e os credenciamentos de médico e de
// prestador por convênio. Os rendimentos isentos e os tipos de dedução são carga de referência (só consulta). As regras
// de repasse (TBREPGER) não entram aqui: a regra nova nasce como rascunho no novo e só é incluída depois da aprovação do
// supervisor (tela de regras). Opções do outro sistema (TBOPCOES, "Gestão de repasses e terceiros" 6609): Tabelas 3025,
// Parâmetros 3026, Cadastro de eventos 3027, Integração 3031, Parâmetros usuário/empresa 5608, Empresas 4811;
// Cooperativas 3675 (Tabelas › Geral A–L); Percentual de repasse 3728 (credenciamento). Conferir na validação.
import type { DominioPublico } from './tipos.js';

const CIE = ['ler', 'criar', 'editar', 'exportar'] as const;
const CIEI = ['ler', 'criar', 'editar', 'inativar', 'exportar'] as const;
const VINCULO = ['ler', 'criar', 'exportar'] as const;
const LER = ['ler', 'exportar'] as const;

const TABELAS = [3025];
const PARAMETROS = [3026, 3025];
const EVENTOS = [3027, 3025];
const INTEGRACAO = [3031, 3025];
const USUARIO_EMPRESA = [5608, 3025];
const EMPRESAS = [4811, 3025];
const COOPERATIVAS = [3675];
const CREDENCIAMENTO = [3728, 3675];

const todas = (ids: readonly number[], acoes: DominioPublico['acoes']) =>
  Object.fromEntries(acoes.map((a) => [a, ids])) as DominioPublico['opcoesLegado'];

const ed = (
  recurso: string,
  singular: string,
  plural: string,
  subitem: DominioPublico['subitem'],
  acoes: DominioPublico['acoes'],
  opcoes: readonly number[],
  extra: Partial<DominioPublico> = {},
): DominioPublico => ({
  modulo: 'repasse',
  recurso,
  rotulo: { singular, plural },
  subitem,
  natureza: 'editavel',
  acoes,
  opcoesLegado: todas(opcoes, acoes),
  origemOpcoes: 'tbopcoes',
  marco: 'M33',
  ...extra,
});

const referencia = (recurso: string, singular: string, plural: string): DominioPublico => ({
  modulo: 'repasse',
  recurso,
  rotulo: { singular, plural },
  subitem: 'repasseRpa',
  natureza: 'carga-referencia',
  acoes: LER,
  opcoesLegado: todas(TABELAS, LER),
  origemOpcoes: 'inferida',
  motivoSomenteLeitura: 'tabela oficial da Receita Federal e do eSocial: só consulta (carga de referência)',
  marco: 'M33',
});

export const DOMINIOS_M33: readonly DominioPublico[] = [
  ed('eventoRpa', 'Evento de RPA', 'Eventos de RPA', 'repasseRpa', CIEI, EVENTOS),
  ed(
    'naturezaEventoRpa',
    'Natureza eSocial do evento',
    'Naturezas eSocial dos eventos',
    'repasseRpa',
    CIE,
    EVENTOS,
  ),
  ed('tipoPrestadorRepasse', 'Tipo de prestador', 'Tipos de prestador', 'repasseRpa', CIE, TABELAS),
  ed(
    'parametroRpa',
    'Parâmetros do RPA',
    'Parâmetros do RPA',
    'repasseRpa',
    ['ler', 'editar', 'exportar'],
    PARAMETROS,
    {
      semInclusao: 'os parâmetros do RPA são um por empresa e já existem: só se alteram',
    },
  ),
  referencia('rendimentoIsento', 'Rendimento isento', 'Rendimentos isentos'),
  referencia('tipoDeducao', 'Tipo de dedução', 'Tipos de dedução'),
  ed(
    'integracaoEventoRpa',
    'Integração contábil do evento',
    'Integração contábil dos eventos',
    'repasseIntegracao',
    CIE,
    INTEGRACAO,
  ),
  ed(
    'periodoUsuarioRepasse',
    'Período de processamento do usuário',
    'Períodos de processamento por usuário',
    'repasseConfiguracoes',
    CIE,
    USUARIO_EMPRESA,
  ),
  ed(
    'empresaSomaImposto',
    'Empresa que soma impostos',
    'Empresas que somam impostos',
    'repasseConfiguracoes',
    VINCULO,
    EMPRESAS,
  ),
  ed('cooperativaMedica', 'Cooperativa', 'Cooperativas', 'repasseCooperativas', CIEI, COOPERATIVAS),
  ed(
    'cooperado',
    'Médico da cooperativa',
    'Médicos da cooperativa',
    'repasseCooperativas',
    CIE,
    COOPERATIVAS,
  ),
  ed(
    'credenciamentoMedico',
    'Credenciamento médico por convênio',
    'Credenciamentos médicos por convênio',
    'repasseCooperativas',
    CIE,
    CREDENCIAMENTO,
  ),
  ed(
    'credenciamentoPrestador',
    'Credenciamento de prestador por convênio',
    'Credenciamentos de prestador por convênio',
    'repasseCooperativas',
    CIE,
    CREDENCIAMENTO,
  ),
];
