// Cadastros da estrutura de custos no CRUD genérico (M54, etapa 4 "estrutura de custos e coleta de estatísticas"; ficha,
// seção 5, "Receita genérica do CRUD (M08) nas 15 migrar-crud do marco", as 5 do grupo `custos`): contas de receita
// do custeio, grupos de exportação do custeio (próprio, ApuraSUS, Federassantas), tipos de dado
// da estatística (1 variável, 2 referência), tipos de regra de rateio e unidades de mensuração.
// D-CRUD-544: os grupos de exportação, os tipos de dado e os tipos de regra são lidos por código pelas regras
// do custeio (a coleta herda a estatística de referência; a exportação ApuraSUS e Federassantas sai pelo grupo): só se
// altera o nome. Opções do outro sistema (menu de origem, Gestão de custos 4258): Tabelas 295, Parâmetros 296, Centros de custo
// 298, Unidade de mensuração 299 (a das unidades é a da árvore; as demais, inferidas da área Tabelas: conferir na
// validação). Gravam também o perfil complementar `analista-custos`.
import type { DominioPublico } from './tipos.js';

const LER = [295, 298, 321];
const TABELAS = [295, 296];
const UNIDADES = [299, 295];
const CIE = ['ler', 'criar', 'editar', 'exportar'] as const;
const IE = ['ler', 'editar', 'exportar'] as const;

const opcoes = (acoes: DominioPublico['acoes'], gravar: readonly number[]): DominioPublico['opcoesLegado'] =>
  Object.fromEntries(acoes.map((a) => [a, a === 'ler' || a === 'exportar' ? LER : gravar])) as never;

const cus = (
  recurso: string,
  singular: string,
  plural: string,
  acoes: DominioPublico['acoes'],
  gravar: readonly number[],
  origem: DominioPublico['origemOpcoes'],
  extra: Partial<DominioPublico> = {},
): DominioPublico => ({
  modulo: 'custos',
  recurso,
  rotulo: { singular, plural },
  subitem: 'custosCadastros',
  natureza: 'editavel',
  acoes,
  opcoesLegado: opcoes(acoes, gravar),
  origemOpcoes: origem,
  perfis: { ler: ['analista-custos'], gravar: ['analista-custos'] },
  marco: 'M54',
  ...extra,
});

const LIDO_PELO_CUSTEIO = (o: string) =>
  `${o} são lidos por código pelas regras do custeio: só se altera o nome`;

export const DOMINIOS_M54_CUSTOS: readonly DominioPublico[] = [
  cus('contaReceita', 'Conta de receita', 'Contas de receita', CIE, TABELAS, 'inferida'),
  cus(
    'grupoExportacao',
    'Grupo de exportação do custeio',
    'Grupos de exportação do custeio',
    IE,
    TABELAS,
    'inferida',
    {
      semInclusao: LIDO_PELO_CUSTEIO('os grupos (próprio, ApuraSUS e Federassantas)'),
    },
  ),
  cus('tipoDado', 'Tipo de dado da estatística', 'Tipos de dado da estatística', IE, TABELAS, 'inferida', {
    semInclusao: LIDO_PELO_CUSTEIO('os tipos de dado (variável e referência)'),
  }),
  cus('tipoRegraRateio', 'Tipo de regra de rateio', 'Tipos de regra de rateio', IE, TABELAS, 'inferida', {
    semInclusao: LIDO_PELO_CUSTEIO('os tipos de regra de rateio'),
  }),
  cus('unidadeMensuracao', 'Unidade de mensuração', 'Unidades de mensuração', CIE, UNIDADES, 'tbopcoes'),
];
