// Inventário dos domínios da operadora própria (M56, etapa F0; ficha, seções 3 e 6; DP-11 decidida em 2026-10-19:
// construir). São as 80 tabelas do ramo em tools/matriz/marcos.yaml (78 do módulo de operadora e 2 do portal do
// prestador), com o destino da matriz, as linhas e os gatilhos na cópia pc (contagem só leitura em 24/10/2026; os
// gatilhos do retrato homologado tools/schema-check/homologado/pc.json). Tudo é domínio pequeno, lido onde está; os
// dados novos da operadora vão para as tabelas SGH_OPE_*. Os 6 registros fictícios de beneficiário ficam fora do
// inventário e nunca são lidos nem alterados (regra 4; `pnpm guardas:legado`, regra `beneficiario-ficticio`).

/** Tela (item da árvore do menu) que atende a tabela; o resto vai a "Domínios da operadora e do plano próprio". */
export const TELAS_OPERADORA = {
  beneficiarios: 'faturamento.operadora-propria-sgo-se-a-rede-tiver-plano.beneficiarios-planos-e-contratos',
  rede: 'faturamento.operadora-propria-sgo-se-a-rede-tiver-plano.rede-credenciada-e-prestadora',
  atendimento: 'faturamento.operadora-propria-sgo-se-a-rede-tiver-plano.atendimento-autorizacao-e-protocolos',
  cobranca: 'faturamento.operadora-propria-sgo-se-a-rede-tiver-plano.cobranca-e-mensalidades',
  ans: 'faturamento.operadora-propria-sgo-se-a-rede-tiver-plano.envios-a-ans-sib-sip-e-exportacoes',
  dominios:
    'faturamento.operadora-propria-sgo-se-a-rede-tiver-plano.dominios-da-operadora-e-do-plano-proprio',
  portal: 'faturamento.operadora-propria-sgo-se-a-rede-tiver-plano.portal-do-prestador-credenciado',
} as const;
export type TelaOperadora = keyof typeof TELAS_OPERADORA;

/**
 * Destino na matriz: `crud` (migrar-crud: CRUD genérico do M08 no grupo `operadora`), `referencia` (carga-referencia:
 * importador de catálogo, padrão do M13) e `leitura` (migrar-leitura: só consulta).
 */
export type DestinoInventario = 'crud' | 'referencia' | 'leitura';

export interface TabelaInventarioOperadora {
  readonly tabela: string;
  readonly tela: TelaOperadora;
  readonly destino: DestinoInventario;
  /** Linhas na cópia pc (24/10/2026). */
  readonly linhas: number;
  /** Gatilhos da tabela no retrato homologado (pc). */
  readonly gatilhos: number;
  readonly rotulo: string;
  readonly escrita: EscritaInventario;
}

/**
 * Escrita que os gatilhos da tabela admitem (levantamento do M14, tools/matriz/dados/levantamento-m14.pc.json):
 * `bloqueada` (gatilho BEFORE INSERT/UPDATE/DELETE que recusa sempre, com a exceção geral do sistema: domínio fixo do
 * fornecedor, só leitura no novo), `condicionada` (gatilho com generator ou recusa condicional: a receita precisa da
 * assinatura) ou `livre` (sem gatilho).
 */
export type EscritaInventario = 'bloqueada' | 'condicionada' | 'livre';

type Linha = readonly [string, TelaOperadora, DestinoInventario, number, number, string, EscritaInventario];

const LINHAS: readonly Linha[] = [
  ['CDACOMODTIPO', 'dominios', 'crud', 3, 1, 'Tipos de acomodação do plano', 'bloqueada'],
  ['CDDIAVENCCOB', 'dominios', 'crud', 31, 1, 'Dias de vencimento de cobrança', 'condicionada'],
  ['CDFAIXAETATP', 'dominios', 'crud', 3, 1, 'Tipos de faixa etária', 'bloqueada'],
  ['CDGUIASTATUS', 'dominios', 'crud', 9, 1, 'Status de guia', 'bloqueada'],
  ['CDINCIDECOMIS', 'dominios', 'crud', 4, 1, 'Incidência de comissão', 'bloqueada'],
  ['CDMOTIVOBAIXA', 'dominios', 'crud', 1, 2, 'Motivos de baixa', 'condicionada'],
  ['CDMOTIVOSOLCART', 'dominios', 'crud', 3, 0, 'Motivos de solicitação de carteirinha', 'livre'],
  ['CDMOTMOVIMCAD', 'dominios', 'crud', 12, 1, 'Motivos de movimentação cadastral', 'bloqueada'],
  ['CDMSGCOBRANCA', 'dominios', 'crud', 9, 1, 'Mensagens de cobrança', 'condicionada'],
  ['CDMSGLINHA', 'dominios', 'crud', 7, 1, 'Linhas de mensagem', 'bloqueada'],
  ['CDORIGEMCOBR', 'dominios', 'crud', 4, 1, 'Origem da cobrança', 'bloqueada'],
  ['CDORIGEMGUIA', 'dominios', 'crud', 5, 1, 'Origem da guia', 'bloqueada'],
  ['CDPARDIGOBG', 'dominios', 'crud', 4, 1, 'Obrigatoriedade de digitação', 'bloqueada'],
  ['CDPGTOBALCAOCP', 'dominios', 'crud', 4, 1, 'Pagamento de coparticipação no balcão', 'bloqueada'],
  ['CDPGTOCOOPART', 'dominios', 'crud', 2, 1, 'Pagamento de coparticipação', 'bloqueada'],
  ['CDPLANOCLASSIF', 'dominios', 'crud', 3, 1, 'Classificação do plano', 'bloqueada'],
  ['CDSTATUSCAD', 'dominios', 'crud', 4, 1, 'Status cadastral do beneficiário', 'bloqueada'],
  ['CDSTATUSSOLCART', 'dominios', 'crud', 4, 0, 'Status de solicitação de carteirinha', 'livre'],
  ['CDTPACUMULPOR', 'dominios', 'crud', 2, 1, 'Tipo de acumulação', 'bloqueada'],
  ['CDTPCOBRANCA', 'dominios', 'crud', 5, 1, 'Tipos de cobrança', 'bloqueada'],
  ['CDTPCONTRATO', 'dominios', 'crud', 2, 1, 'Tipos de contrato', 'bloqueada'],
  ['CDTPCONTRCAIXA', 'dominios', 'crud', 7, 1, 'Tipos de controle de caixa', 'bloqueada'],
  ['CDTPCOPART', 'dominios', 'crud', 3, 1, 'Tipos de coparticipação', 'bloqueada'],
  ['CDTPCTRCONTRAT', 'dominios', 'crud', 2, 1, 'Controle contratual', 'bloqueada'],
  ['CDTPDESCACR', 'dominios', 'crud', 2, 1, 'Desconto ou acréscimo', 'bloqueada'],
  ['CDTPDESPCTAPG', 'dominios', 'referencia', 17, 1, 'Tipos de despesa assistencial', 'bloqueada'],
  ['CDTPDESPCTAPGCM', 'dominios', 'crud', 2, 1, 'Tipos de despesa (complemento)', 'bloqueada'],
  ['CDTPEMISSAO', 'dominios', 'crud', 8, 1, 'Tipos de emissão', 'bloqueada'],
  ['CDTPENDERECO', 'dominios', 'crud', 4, 1, 'Tipos de endereço', 'bloqueada'],
  ['CDTPEVTCTAREC', 'dominios', 'crud', 5, 1, 'Eventos de contas a receber', 'bloqueada'],
  ['CDTPFRANQUIA', 'dominios', 'crud', 4, 1, 'Tipos de franquia', 'bloqueada'],
  ['CDTPGUIA', 'dominios', 'crud', 4, 1, 'Tipos de guia', 'bloqueada'],
  ['CDTPLANCAMEN', 'dominios', 'crud', 4, 1, 'Tipos de lançamento', 'bloqueada'],
  ['CDTPMOVVALOR', 'dominios', 'crud', 9, 1, 'Tipos de movimentação de valor', 'bloqueada'],
  ['CDTPPERIODO', 'dominios', 'crud', 2, 1, 'Tipos de período', 'bloqueada'],
  ['CDTPRETCONS', 'dominios', 'crud', 5, 1, 'Tipos de retorno de consulta', 'bloqueada'],
  ['CDVENDATPREP', 'dominios', 'crud', 6, 1, 'Papéis na venda', 'bloqueada'],
  ['PFPORTALOPCAO', 'portal', 'crud', 8, 1, 'Opções', 'bloqueada'],
  ['PFTPATEND', 'portal', 'crud', 5, 0, 'Tipos de atendimento', 'livre'],
  ['PSCOPARTTPGUIAQNDO', 'dominios', 'crud', 4, 1, 'Regras de coparticipação por guia', 'condicionada'],
  ['PSCRITICA', 'dominios', 'crud', 7, 0, 'Críticas de autorização', 'livre'],
  ['PSDOCIMPNOMESOCIAL', 'dominios', 'crud', 8, 0, 'Documentos com nome social', 'livre'],
  ['PSEMPEMITEOBS', 'dominios', 'crud', 5, 0, 'Emissão de observação por empresa', 'livre'],
  ['PSFORNEMEMSIT', 'dominios', 'crud', 6, 1, 'Situações de fornecimento', 'bloqueada'],
  ['PSGRUPOCLASSIF', 'dominios', 'crud', 5, 1, 'Grupos de classificação de procedimento', 'bloqueada'],
  ['PSMOTIVO', 'dominios', 'crud', 1, 0, 'Motivos de baixa de beneficiário', 'livre'],
  ['PSNATUREZAPS', 'dominios', 'crud', 5, 0, 'Naturezas de prestador', 'livre'],
  ['PSORIGEMCOBR', 'dominios', 'crud', 7, 1, 'Origens de cobrança', 'bloqueada'],
  ['PSORIGEMGUIA', 'dominios', 'crud', 6, 1, 'Origens de guia', 'bloqueada'],
  ['PSPRCANS', 'ans', 'referencia', 305, 0, 'Classificação de procedimentos', 'livre'],
  ['PSREEMBOLSOTP', 'dominios', 'crud', 4, 1, 'Tipos de reembolso', 'bloqueada'],
  ['PSSIBCAMPOALT', 'dominios', 'referencia', 19, 1, 'Campos alteráveis no SIB', 'bloqueada'],
  ['PSTIPMEN', 'dominios', 'crud', 5, 0, 'Tipos de mensalidade', 'livre'],
  ['PSTIPOGUIA', 'dominios', 'crud', 4, 1, 'Tipos de guia', 'bloqueada'],
  ['PSTPACUMULPOR', 'dominios', 'crud', 3, 0, 'Acúmulo de limite por', 'livre'],
  ['PSTPPERIODO', 'dominios', 'crud', 2, 0, 'Tipos de período', 'livre'],
  ['PSTPRETORNO', 'dominios', 'crud', 5, 0, 'Regras de retorno', 'livre'],
  ['PSTPSMESRECOL', 'dominios', 'referencia', 6, 1, 'Meses de recolhimento TPS', 'bloqueada'],
  ['PSTPSVIGENCIA', 'ans', 'referencia', 2, 0, 'Valores da TPS', 'livre'],
  ['SPMOTLIG', 'atendimento', 'crud', 1, 1, 'Motivos de ligação', 'condicionada'],
  ['SPORIGEM_ATEND', 'atendimento', 'leitura', 6, 0, 'Origens', 'livre'],
  ['SPVINCULOTITULAR', 'atendimento', 'crud', 8, 0, 'Vínculos com titular', 'livre'],
  ['TBCLASSIFCREPLS', 'rede', 'referencia', 3, 0, 'Classificação', 'livre'],
  ['TBDISPONIBILSERV', 'rede', 'referencia', 2, 0, 'Disponibilidade', 'livre'],
  ['TBENVCOBEMAIL', 'beneficiarios', 'leitura', 5, 1, 'Envio de cobrança por e-mail', 'bloqueada'],
  ['TBISENCAOONUS', 'rede', 'leitura', 3, 0, 'Isenção de ônus', 'livre'],
  ['TBREGIMEATEND', 'beneficiarios', 'crud', 3, 1, 'Regimes de atendimento', 'bloqueada'],
  ['TBSIPANSATO', 'ans', 'referencia', 75, 0, 'Grupos de eventos', 'livre'],
  ['TBSIPANSPROC', 'ans', 'referencia', 5767, 0, 'Procedimentos por grupo', 'livre'],
  ['TBSTATUSCREPLS', 'rede', 'crud', 4, 0, 'Status de movimentação', 'livre'],
  ['TBTIPOCOBRANCASGO', 'cobranca', 'crud', 4, 0, 'Tipos de cobrança', 'livre'],
  ['TBTISSREMUNERAOPERPS', 'beneficiarios', 'referencia', 7, 0, 'Modelos de remuneração', 'livre'],
  ['TBTPCONTRATOCREPLS', 'rede', 'crud', 2, 0, 'Tipo de contrato', 'livre'],
  ['TBTPEMAILPLS', 'cobranca', 'crud', 9, 1, 'Tipos de e-mail', 'bloqueada'],
  ['TBTPEXPIPERGS', 'ans', 'crud', 12, 0, 'Tipos de prestador IPERGS', 'livre'],
  ['TBTPFAVORECIDO', 'beneficiarios', 'referencia', 4, 1, 'Favorecido', 'bloqueada'],
  ['TBTPFORMAREAJ', 'beneficiarios', 'referencia', 8, 1, 'Formas de reajuste', 'bloqueada'],
  ['TBTPPRESTADOR', 'rede', 'crud', 8, 0, 'Tipos de prestador', 'livre'],
  ['TBTPUNIDTEMPO', 'beneficiarios', 'referencia', 5, 1, 'Unidades de tempo', 'bloqueada'],
  ['TBTPVIGCONTRATO', 'beneficiarios', 'referencia', 2, 1, 'Tipos de vigência', 'bloqueada'],
];

export const INVENTARIO_OPERADORA: readonly TabelaInventarioOperadora[] = LINHAS.map(
  ([tabela, tela, destino, linhas, gatilhos, rotulo, escrita]) => ({
    tabela,
    tela,
    destino,
    linhas,
    gatilhos,
    rotulo,
    escrita,
  }),
);

/**
 * Registros fictícios de beneficiário (uma linha cada, data sentinela de 1899; Anexo B: descartar). Nunca lidos como
 * beneficiário real nem alterados (regra 4): nenhum SQL do projeto cita estas tabelas.
 */
export const TABELAS_BENEFICIARIO_FICTICIO = [
  'PSBENEFI',
  'PSBENCPL',
  'PSBENTMP',
  'PSPLNASS',
  'PSVENDAS',
  'PSATVASS',
] as const;

/** Tabelas do outro sistema que existem vazias e não são usadas (a identidade do portal fica em SGH_). */
export const TABELAS_OPERADORA_NAO_USADAS = ['PFPORTALLOGIN'] as const;

/** Tabelas novas da operadora (ficha, seção 6), criadas pelos scripts SGH_ das fatias F1 a F8. */
export const TABELAS_SGH_OPERADORA = {
  SGH_OPE_PRODUTO: 'F1',
  SGH_OPE_CONTRATO: 'F1',
  SGH_OPE_BENEFICIARIO: 'F1',
  SGH_OPE_COBRANCA: 'F2',
  SGH_OPE_PRESTADOR: 'F3',
  SGH_OPE_AUTORIZACAO: 'F4',
  SGH_OPE_CONTA: 'F5',
  SGH_OPE_ENVIO_ANS: 'F6',
  SGH_OPE_INTERFACE: 'F8',
} as const;
export type TabelaSghOperadora = keyof typeof TABELAS_SGH_OPERADORA;

/** Tabelas do inventário por destino (para o relatório da F0 e o grupo `operadora` do CRUD genérico). */
export function inventarioPorDestino(destino: DestinoInventario): readonly TabelaInventarioOperadora[] {
  return INVENTARIO_OPERADORA.filter((t) => t.destino === destino);
}
