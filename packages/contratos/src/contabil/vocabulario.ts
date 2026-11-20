// Vocabulário da contabilidade (M54-F1; ficha, seções 4, 6 e 8; cap-07 §7.2). Os códigos de origem são os que o
// outro sistema grava em COTP_ORIGEM_LANCAMENTO (11 linhas na cópia pc, conferidas em 24/10/2026, só configuração):
// a tela mostra o rótulo, nunca o código cru nem o nome da tabela.
//
// Regra 1 da ficha: nenhum módulo grava direto na contabilidade. A contabilização LÊ os fatos nas tabelas onde eles
// estão (gravados por qualquer sistema) e grava o resultado só em SGH_CTB_*. As fontes abaixo são as da seção 4
// ("Fatos contábeis novos"), com a chave, o carimbo e a situação do índice levantados no catálogo do banco.

/** Origem do lançamento (COTP_ORIGEM_LANCAMENTO.ID → rótulo de produto). */
export const ORIGENS_LANCAMENTO = {
  1: 'Financeiro',
  2: 'Faturamento',
  3: 'Convênio',
  4: 'Internação SUS',
  5: 'Ambulatório',
  6: 'Alta complexidade ambulatorial',
  7: 'Patrimônio',
  8: 'Folha de pagamento',
  9: 'Estoque',
  10: 'Recibo de autônomo',
  11: 'Contabilidade',
} as const;
export type OrigemLancamento = keyof typeof ORIGENS_LANCAMENTO;
export const CODIGOS_ORIGEM_LANCAMENTO = Object.keys(ORIGENS_LANCAMENTO).map(Number) as OrigemLancamento[];

/**
 * Tipo de fato contábil, derivado da linha lida (dominio-contabil/fatos.ts). Cada tipo tem uma origem e é a chave da
 * regra de contabilização (origem + tipo + vigência).
 */
export const TIPOS_FATO = {
  receitaConta: { origem: 3, rotulo: 'Receita da conta fechada' },
  ajusteGlosa: { origem: 3, rotulo: 'Ajuste de receita por glosa' },
  ajusteRecurso: { origem: 3, rotulo: 'Ajuste de receita por recurso acatado' },
  tituloPagar: { origem: 1, rotulo: 'Título a pagar' },
  baixaTituloPagar: { origem: 1, rotulo: 'Pagamento de título' },
  tituloReceber: { origem: 1, rotulo: 'Título a receber' },
  baixaTituloReceber: { origem: 1, rotulo: 'Recebimento de título' },
  movimentoBancario: { origem: 1, rotulo: 'Movimento bancário' },
  saidaEstoque: { origem: 9, rotulo: 'Saída de estoque (consumo)' },
  notaEntrada: { origem: 9, rotulo: 'Nota fiscal de entrada' },
  recibo: { origem: 10, rotulo: 'Recibo de autônomo' },
  depreciacao: { origem: 7, rotulo: 'Depreciação do mês' },
  impairment: { origem: 7, rotulo: 'Perda por impairment do bem' },
  folha: { origem: 8, rotulo: 'Folha e encargos' },
} as const satisfies Record<string, { origem: OrigemLancamento; rotulo: string }>;
export type TipoFato = keyof typeof TIPOS_FATO;
export const CODIGOS_TIPO_FATO = Object.keys(TIPOS_FATO) as TipoFato[];

/**
 * Fonte de fato no banco (seção 4). `carimbo` é a coluna de última atualização quando existe; nenhuma delas é indexada
 * no banco (indices-legados.json), por isso a leitura incremental anda pela chave (indexada) e o carimbo só filtra
 * dentro de uma faixa de chaves (nunca varredura pelo carimbo). `semCarimbo` é a contagem de linhas sem carimbo na cópia
 * pc em 24/10/2026: essas linhas só são vistas pela chave e pela impressão do conteúdo.
 */
export interface FonteFato {
  readonly tabela: string;
  readonly chave: string;
  readonly carimbo: string | null;
  readonly tipos: readonly TipoFato[];
  /** Linhas e linhas sem carimbo na cópia pc (24/10/2026). */
  readonly linhasPc: number;
  readonly semCarimboPc: number | null;
  /** Dona da fonte (marco que a lê) quando é tabela SGH_ de outro marco. */
  readonly marcoFonte?: string;
}

export const FONTES_FATO: readonly FonteFato[] = [
  {
    tabela: 'FCCTAEXT',
    chave: 'ID',
    carimbo: 'DATA_HORA_ULTIMA_ATUALIZACAO',
    tipos: ['receitaConta'],
    linhasPc: 213_641,
    semCarimboPc: 2_425,
  },
  {
    tabela: 'FCLANEXT',
    chave: 'ID',
    carimbo: 'DATA_HORA_ULTIMA_ATUALIZACAO',
    tipos: ['ajusteGlosa', 'ajusteRecurso'],
    linhasPc: 4_322_504,
    semCarimboPc: 3_528,
  },
  {
    tabela: 'MFCONPAG',
    chave: 'ID',
    carimbo: 'DATA_HORA_ULTIMA_ATUALIZACAO',
    tipos: ['tituloPagar', 'baixaTituloPagar'],
    linhasPc: 71_267,
    semCarimboPc: 2_687,
  },
  {
    tabela: 'MFCTAREC',
    chave: 'ID',
    carimbo: 'DATA_HORA_ULTIMA_ATUALIZACAO',
    tipos: ['tituloReceber', 'baixaTituloReceber'],
    linhasPc: 25_059,
    semCarimboPc: 2_869,
  },
  {
    tabela: 'MFLANCTO',
    chave: 'ID',
    carimbo: 'DATA_HORA_ULTIMA_ATUALIZACAO',
    tipos: ['movimentoBancario'],
    linhasPc: 36_385,
    semCarimboPc: 26_571,
  },
  {
    tabela: 'GELANSAI',
    chave: 'ID_GELANSAI',
    carimbo: 'DATA_HORA_ULTIMA_ATUALIZACAO',
    tipos: ['saidaEstoque'],
    linhasPc: 3_558_508,
    semCarimboPc: 67,
  },
  {
    tabela: 'GECADNFS',
    chave: 'ID',
    carimbo: 'DATA_HORA_ULTIMA_ATUALIZACAO',
    tipos: ['notaEntrada'],
    linhasPc: 13_794,
    semCarimboPc: 0,
  },
  {
    tabela: 'RPRPA',
    chave: 'ID_RPRPA',
    carimbo: null,
    tipos: ['recibo'],
    linhasPc: 5_243,
    semCarimboPc: null,
  },
  {
    // D-M54-CUSTO-539 (M53.9): o custo de pessoal da folha calculada fica em SGH_PES_FOLHA_FATO (por centro de custo,
    // rotina e natureza); SGH_PES_FOLHA_RESUMO só recebe o retorno da folha externa e não é fonte (D-FOLHAFATO-541).
    tabela: 'SGH_PES_FOLHA_FATO',
    chave: 'ID',
    carimbo: null,
    tipos: ['folha'],
    linhasPc: 0,
    semCarimboPc: null,
    marcoFonte: 'M53',
  },
  {
    // M54.6 (F6, regra 12): a cota mensal da depreciação de cada bem, gravada pelo cálculo do patrimônio (imutável:
    // só SELECT e INSERT); um fato de origem 7 (Patrimônio) por cota, pelo centro de custo onde o bem estava.
    tabela: 'SGH_PAT_DEPRECIACAO',
    chave: 'ID',
    carimbo: null,
    tipos: ['depreciacao'],
    linhasPc: 0,
    semCarimboPc: null,
    marcoFonte: 'M54',
  },
  {
    // W0-08 (M1, script 1105; CPC 01): o ajuste do valor do bem (imutável: só SELECT e INSERT). Só a perda por
    // impairment vira fato (origem 7); a revisão de estimativa e a reavaliação são eventos sem lançamento. O estorno
    // (SGH_PAT_AJUSTE_ESTORNO) faz a conciliação lançar o estorno, como na depreciação.
    tabela: 'SGH_PAT_AJUSTE',
    chave: 'ID',
    carimbo: null,
    tipos: ['impairment'],
    linhasPc: 0,
    semCarimboPc: null,
    marcoFonte: 'W0-08',
  },
];

/** Situação do fato em SGH_CTB_FATO. */
export const SITUACOES_FATO = {
  pendente: 'Aguardando contabilização',
  contabilizado: 'Contabilizado',
  semRegra: 'Sem regra vigente',
  semConta: 'Regra sem conta (de-para incompleto)',
  substituido: 'Substituído por versão mais nova do fato',
  ignorado: 'Sem efeito contábil',
} as const;
export type SituacaoFato = keyof typeof SITUACOES_FATO;

/** Grupo da conta no plano (primeiro nível do plano, padrão do plano referencial). */
export const GRUPOS_CONTA = {
  ativo: { rotulo: 'Ativo', natureza: 'devedora' },
  passivo: { rotulo: 'Passivo', natureza: 'credora' },
  patrimonioLiquido: { rotulo: 'Patrimônio líquido', natureza: 'credora' },
  receita: { rotulo: 'Receitas', natureza: 'credora' },
  custo: { rotulo: 'Custos', natureza: 'devedora' },
  despesa: { rotulo: 'Despesas', natureza: 'devedora' },
  compensacao: { rotulo: 'Contas de compensação', natureza: 'devedora' },
} as const;
export type GrupoConta = keyof typeof GRUPOS_CONTA;
export const CODIGOS_GRUPO_CONTA = Object.keys(GRUPOS_CONTA) as GrupoConta[];

export const NATUREZAS_CONTA = { devedora: 'Devedora', credora: 'Credora' } as const;
export type NaturezaConta = keyof typeof NATUREZAS_CONTA;

/** Sintética agrupa (não recebe lançamento); analítica recebe lançamento. */
export const TIPOS_CONTA = { sintetica: 'Sintética', analitica: 'Analítica' } as const;
export type TipoConta = keyof typeof TIPOS_CONTA;

/**
 * Tipo de plano referencial (COTIPOPLANOCONTAREFERENCIAL: 14 linhas no pc; CODIGO e PLANOECF). O código "10" aparece
 * duas vezes no banco (Receita Federal e Financeiras - Lucro Presumido): a referência é sempre pelo ID.
 */
export const REFERENCIAL_POR_ID = true;

/** Lado da partida. */
export const LADOS_PARTIDA = { D: 'Débito', C: 'Crédito' } as const;
export type LadoPartida = keyof typeof LADOS_PARTIDA;

/** Situação da versão da regra: rascunho editável; publicada imutável; substituída quando outra a sucede. */
export const SITUACOES_REGRA = {
  rascunho: 'Rascunho',
  publicada: 'Publicada',
  substituida: 'Substituída',
} as const;
export type SituacaoRegra = keyof typeof SITUACOES_REGRA;

/** Máscara padrão do plano (níveis separados por ponto; tamanho de cada nível). Parametrizável por empresa. */
export const MASCARA_PLANO_PADRAO = '9.9.9.99.9999';

/** Tamanhos de lote da leitura incremental (seção 4: "lotes curtos no worker, fora do pico"). */
export const LOTE_FATOS_PADRAO = 500;
export const LOTE_FATOS_MAXIMO = 2_000;
/**
 * Folga da janela de revisão, em chaves: as últimas N chaves abaixo da marca são relidas a cada ciclo para ver
 * alteração (carimbo ou impressão). Linhas mais antigas alteradas entram pela varredura de revisão por faixa.
 */
export const FOLGA_REVISAO_PADRAO = 5_000;
