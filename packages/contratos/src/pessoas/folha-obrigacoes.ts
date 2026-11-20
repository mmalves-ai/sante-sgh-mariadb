// FGTS Digital e obrigações legais (M53-F7; ficha do M53, seções 1, 6 a 8; regras 3 e 7; cap-07 §7.1). Do período
// FECHADO na folha saem:
// - a apuração do FGTS Digital da competência (depósito mensal e rescisório por trabalhador, conferida com os eventos
//   do eSocial que alimentam o FGTS Digital) e a conciliação da guia (GFD) emitida no portal do governo;
// - os arquivos das obrigações anteriores ao eSocial, só nas competências em que ainda são exigidas (SEFIP do FGTS
//   até a chegada do FGTS Digital, CAGED e RAIS até a substituição pelo eSocial), conforme os regimes que o
//   departamento pessoal registra por empresa, com vigência (DP-47: leiaute e marcos legais em parâmetro, nunca
//   constante no código; a sugestão abaixo traz as fontes e não vale até ser gravada).
// O Sante SGH não transmite nada ao governo: gera o arquivo (cifrado no banco: tem CPF, NIS e nome) e registra a
// entrega que o departamento pessoal faz no programa oficial, com o protocolo. Arquivo de leiaute ainda não conferido
// no validador oficial não pode ter a entrega registrada (como a receita não provada, POL-3). Nenhuma lista traz CPF,
// NIS ou nome: vínculo (ID), matrícula, quantidades e valores agregados. Valores em centavos.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';

const competencia = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Competência no formato AAAA-MM.');
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.');
const smallint = z.coerce.number().int().min(0).max(32_767);
const digitos = (n: number, rotulo: string) =>
  z.string().regex(new RegExp(`^\\d{${n}}$`), `${rotulo}: ${n} dígitos.`);
const centavos = z.number().int().min(0).max(99_999_999_999);
const motivo = textoCp1252(200).pipe(z.string().trim().min(5, 'Informe o motivo (ao menos 5 letras).'));
const obrigatorio = (n: number) => textoCp1252(n).pipe(z.string().trim().min(1, 'Campo obrigatório.'));

// ── Tipos de obrigação ────────────────────────────────────────────────────────────────────────────────────────

/**
 * - fgts-digital: a apuração do FGTS da competência e a conciliação da guia do FGTS Digital (Lei 14.438/2022);
 * - sefip: o arquivo SEFIP.RE do recolhimento do FGTS (GFIP) das competências anteriores ao FGTS Digital;
 * - caged: o arquivo do CAGED (admissões e desligamentos do mês, Lei 4.923/1965) antes do eSocial;
 * - rais: a declaração anual da RAIS (Decreto 76.900/1975) dos anos-base antes do eSocial.
 */
export const TIPOS_OBRIGACAO = ['fgts-digital', 'sefip', 'caged', 'rais'] as const;
export type TipoObrigacao = (typeof TIPOS_OBRIGACAO)[number];

/** A apuração de cada obrigação: mensal (AAAA-MM) ou anual (AAAA, o ano-base da RAIS). */
export const APURACAO_DA_OBRIGACAO: Readonly<Record<TipoObrigacao, 'mensal' | 'anual'>> = {
  'fgts-digital': 'mensal',
  sefip: 'mensal',
  caged: 'mensal',
  rais: 'anual',
};

export const PERIODO_OBRIGACAO_MENSAL = /^\d{4}-(0[1-9]|1[0-2])$/;
export const PERIODO_OBRIGACAO_ANUAL = /^\d{4}$/;
export const periodoObrigacaoValido = (tipo: TipoObrigacao, periodo: string): boolean =>
  (APURACAO_DA_OBRIGACAO[tipo] === 'anual' ? PERIODO_OBRIGACAO_ANUAL : PERIODO_OBRIGACAO_MENSAL).test(
    periodo,
  );

const comPeriodo = <T extends { tipo: TipoObrigacao; periodo: string }>(x: T, ctx: z.RefinementCtx) => {
  if (!periodoObrigacaoValido(x.tipo, x.periodo))
    ctx.addIssue({
      code: 'custom',
      path: ['periodo'],
      message:
        APURACAO_DA_OBRIGACAO[x.tipo] === 'anual'
          ? 'Ano-base no formato AAAA.'
          : 'Competência no formato AAAA-MM.',
    });
};

// ── Parâmetros das obrigações por empresa (vigência) ─────────────────────────────────────────────────────────────

/**
 * O regime de uma obrigação na empresa: as competências (ou anos-base, na RAIS) em que ela é exigida, a versão do
 * leiaute do arquivo e se o leiaute já foi conferido no validador oficial (sem isso, a entrega não se registra).
 * `exigidaDe` nulo: desde sempre; `exigidaAte` nulo: sem fim.
 */
export const esquemaRegimeObrigacao = z
  .object({
    exigidaDe: z
      .string()
      .regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/)
      .nullable(),
    exigidaAte: z
      .string()
      .regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/)
      .nullable(),
    leiaute: obrigatorio(20),
    leiauteConferido: z.boolean(),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.exigidaDe && r.exigidaAte && r.exigidaDe > r.exigidaAte)
      ctx.addIssue({ code: 'custom', path: ['exigidaAte'], message: 'O fim vem antes do início.' });
  });
export type RegimeObrigacao = z.infer<typeof esquemaRegimeObrigacao>;

export const esquemaEnderecoObrigacao = z
  .object({
    logradouro: obrigatorio(50),
    bairro: obrigatorio(20),
    cep: digitos(8, 'CEP'),
    cidade: obrigatorio(20),
    uf: z.string().regex(/^[A-Z]{2}$/, 'UF com 2 letras.'),
    /** Código do município do IBGE (7 dígitos). */
    municipio: digitos(7, 'Município'),
  })
  .strict();

/** O responsável pelas informações (o contato que os arquivos levam no cabeçalho). */
export const esquemaContatoObrigacao = z
  .object({
    nome: obrigatorio(20),
    /** DDD + número (10 a 12 dígitos). */
    telefone: z.string().regex(/^\d{10,12}$/, 'Telefone com DDD: 10 a 12 dígitos.'),
    email: textoCp1252(60).pipe(z.string().trim().email('E-mail inválido.')),
  })
  .strict();

export const esquemaParametrosObrigacoes = z
  .object({
    empresa: smallint,
    /** Início da vigência (AAAA-MM); a correção é uma vigência nova. */
    inicio: competencia,
    razaoSocial: obrigatorio(52),
    endereco: esquemaEnderecoObrigacao,
    contato: esquemaContatoObrigacao,
    /** Natureza jurídica (tabela da Receita, 4 dígitos; a RAIS a exige). */
    naturezaJuridica: digitos(4, 'Natureza jurídica'),
    /** Código de recolhimento da SEFIP (115: recolhimento ao FGTS e informações à Previdência). */
    codigoRecolhimentoSefip: digitos(3, 'Código de recolhimento'),
    /** Código de pagamento da GPS na SEFIP (2100: empresas em geral, CNPJ; catálogo FPCOD_GPS). */
    codigoPagamentoGps: digitos(4, 'Código de pagamento da GPS'),
    regimes: z
      .object({
        'fgts-digital': esquemaRegimeObrigacao,
        sefip: esquemaRegimeObrigacao,
        caged: esquemaRegimeObrigacao,
        rais: esquemaRegimeObrigacao,
      })
      .strict(),
  })
  .strict();
export type ParametrosObrigacoes = z.infer<typeof esquemaParametrosObrigacoes>;

export interface ParametrosObrigacoesLidos extends ParametrosObrigacoes {
  readonly id: number;
  readonly criadoPor: string;
  readonly criadoEm: string;
}

export const esquemaFiltroParametrosObrigacoes = z.object({ empresa: smallint }).strict();
export type FiltroParametrosObrigacoes = z.infer<typeof esquemaFiltroParametrosObrigacoes>;

export interface ListaParametrosObrigacoes {
  readonly empresa: number;
  readonly itens: readonly ParametrosObrigacoesLidos[];
}

/**
 * Sugestão dos regimes, com as fontes (DP-47: cada dono confere antes de gravar; a sugestão não vale até ser gravada):
 * - FGTS Digital: competências a partir de 03/2024 (Portaria MTE 240/2024; Lei 14.438/2022);
 * - SEFIP (FGTS): até a competência 02/2024, a última antes do FGTS Digital;
 * - CAGED: até a competência 12/2019 (Portaria SEPRT 1.127/2019: o eSocial substitui o CAGED a partir de 01/2020
 *   para os empregadores obrigados a ele);
 * - RAIS: até o ano-base 2018 (Portaria SEPRT 1.127/2019: o eSocial substitui a RAIS a partir do ano-base 2019 para
 *   os empregadores dos grupos já obrigados; o DP confere o grupo da empresa).
 * Os leiautes nascem NÃO conferidos: o arquivo é gerado, mas a entrega só se registra depois da conferência no
 * validador oficial (SEFIP 8.4, ACI do CAGED, GDRAIS).
 */
export const REGIMES_SUGERIDOS_OBRIGACOES: Readonly<Record<TipoObrigacao, RegimeObrigacao>> = {
  'fgts-digital': {
    exigidaDe: '2024-03',
    exigidaAte: null,
    leiaute: 'FGTS Digital 1.0',
    leiauteConferido: false,
  },
  sefip: { exigidaDe: null, exigidaAte: '2024-02', leiaute: 'SEFIP 8.4', leiauteConferido: false },
  caged: { exigidaDe: null, exigidaAte: '2019-12', leiaute: 'CAGED 2010', leiauteConferido: false },
  rais: { exigidaDe: null, exigidaAte: '2018', leiaute: 'RAIS 2018', leiauteConferido: false },
};

export const FONTES_REGIMES_OBRIGACOES: Readonly<Record<TipoObrigacao, string>> = {
  'fgts-digital': 'Lei 14.438/2022 e Portaria MTE 240/2024 (FGTS Digital a partir da competência 03/2024).',
  sefip:
    'Circular CAIXA do leiaute SEFIP 8.4; substituída pelo FGTS Digital a partir da competência 03/2024.',
  caged: 'Lei 4.923/1965; substituído pelo eSocial a partir de 01/2020 (Portaria SEPRT 1.127/2019).',
  rais: 'Decreto 76.900/1975; substituída pelo eSocial a partir do ano-base 2019 (Portaria SEPRT 1.127/2019).',
};

// ── Obrigação gerada ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * - gerada: o arquivo (ou a apuração) está pronto para a entrega;
 * - entregue: o DP registrou a entrega (protocolo; no FGTS Digital, a guia conciliada);
 * - substituida: uma geração nova do mesmo período tomou o lugar desta (a nova traz o número seguinte);
 * - cancelada: descartada com motivo, antes da entrega.
 */
export const SITUACOES_OBRIGACAO = ['gerada', 'entregue', 'substituida', 'cancelada'] as const;
export type SituacaoObrigacao = (typeof SITUACOES_OBRIGACAO)[number];

export interface TotaisObrigacao {
  readonly trabalhadores: number;
  /** Remuneração do período (a base do FGTS sem e com o 13º). */
  readonly remuneracao: number;
  readonly remuneracaoDecimo: number;
  readonly baseFgts: number;
  /** Depósito mensal do FGTS (8% da base, ou o percentual da categoria). */
  readonly fgts: number;
  /** FGTS rescisório (a multa de 40% ou 20% depositada na conta vinculada). */
  readonly rescisorio: number;
  /** Movimentações do período (CAGED, SEFIP, RAIS). */
  readonly admissoes: number;
  readonly desligamentos: number;
}

export interface EntregaObrigacao {
  readonly protocolo: string;
  readonly data: string;
  /** FGTS Digital: o valor da guia emitida e os acréscimos (juros e multa de atraso) informados. */
  readonly valorGuia: number | null;
  readonly acrescimos: number | null;
  readonly por: string;
  readonly em: string;
}

export interface ObrigacaoLegal {
  readonly id: number;
  readonly empresa: number;
  readonly tipo: TipoObrigacao;
  readonly periodo: string;
  readonly numero: number;
  readonly situacao: SituacaoObrigacao;
  readonly leiaute: string;
  readonly leiauteConferido: boolean;
  readonly nomeArquivo: string;
  readonly tamanho: number;
  /** SHA-256 do arquivo (a soma de verificação que o DP confere no programa oficial). */
  readonly resumo: string;
  /** Os totais (os valores saem nulos sem `pessoas.salario.ler`; as quantidades ficam). */
  readonly totais: TotaisObrigacao | null;
  readonly trabalhadores: number;
  /** Os fechamentos da folha de onde vieram os valores. */
  readonly fechamentos: readonly number[];
  readonly geradoPor: string;
  readonly geradoEm: string;
  readonly entrega: EntregaObrigacao | null;
  readonly motivo: string | null;
  readonly situacaoPor: string | null;
  readonly situacaoEm: string | null;
  readonly versao: number;
}

export const esquemaFiltroObrigacoes = z
  .object({
    empresa: smallint.optional(),
    tipo: z.enum(TIPOS_OBRIGACAO).optional(),
    /** O ano (as competências dele e o ano-base). */
    ano: z.string().regex(PERIODO_OBRIGACAO_ANUAL, 'Ano com 4 dígitos.').optional(),
    situacao: z.enum(SITUACOES_OBRIGACAO).optional(),
  })
  .strict();
export type FiltroObrigacoes = z.infer<typeof esquemaFiltroObrigacoes>;

export interface ListaObrigacoes {
  readonly itens: readonly ObrigacaoLegal[];
  readonly limitado: boolean;
}

// ── Pendências e conferência ──────────────────────────────────────────────────────────────────────────────────

/**
 * Pendências que barram a geração (a tela traduz por `folha.obrigacoes.pendencia.<codigo>`):
 * - sem-parametros: a empresa não tem os parâmetros das obrigações vigentes no período;
 * - nao-exigida: a obrigação não é exigida no período pelo regime gravado (substituída pelo eSocial ou ainda não
 *   vigente);
 * - periodo-em-curso: o período ainda não terminou;
 * - folha-nao-fechada: o período mensal (ou, na RAIS, algum mês do ano) não está fechado na folha;
 * - sem-empregador: a empresa sem os parâmetros do eSocial vigentes (CNAE, FPAS, RAT, FAP, terceiros) ou sem CNPJ;
 * - sem-ficha: colaborador sem a ficha do eSocial (nascimento, sexo, categoria, CBO);
 * - sem-nis: colaborador sem o NIS (SEFIP, CAGED e RAIS exigem);
 * - sem-cbo: colaborador sem o CBO do cargo;
 * - categoria-sem-correspondencia: a categoria do eSocial do colaborador não tem correspondente no leiaute;
 * - codigo-fora-do-catalogo: o código do leiaute (categoria, movimentação, vínculo…) não está no catálogo oficial do
 *   banco;
 * - evento-esocial-pendente: FGTS Digital: o colaborador com base de FGTS sem o evento aceito no eSocial (S-1200 ou
 *   S-2299), de onde o FGTS Digital tira a guia;
 * - ja-entregue: o período já tem a obrigação entregue (registre a retificação no programa oficial e cancele antes);
 * - sem-trabalhadores: nenhum colaborador com valor no período;
 * - geracao-grande: colaboradores acima do teto de uma geração.
 */
export const CODIGOS_PENDENCIA_OBRIGACAO = [
  'sem-parametros',
  'nao-exigida',
  'periodo-em-curso',
  'folha-nao-fechada',
  'sem-empregador',
  'sem-ficha',
  'sem-nis',
  'sem-cbo',
  'categoria-sem-correspondencia',
  'codigo-fora-do-catalogo',
  'evento-esocial-pendente',
  'ja-entregue',
  'sem-trabalhadores',
  'geracao-grande',
] as const;
export type CodigoPendenciaObrigacao = (typeof CODIGOS_PENDENCIA_OBRIGACAO)[number];

export interface PendenciaObrigacao {
  readonly codigo: CodigoPendenciaObrigacao;
  readonly mensagem: string;
  /** Os vínculos (IDs) envolvidos; vazio quando é do período. */
  readonly vinculos: readonly number[];
}

/** Avisos que não barram (a tela os mostra): o leiaute não conferido e o 13º do ano ainda aberto. */
export const CODIGOS_AVISO_OBRIGACAO = ['leiaute-nao-conferido', 'decimo-em-aberto'] as const;
export type CodigoAvisoObrigacao = (typeof CODIGOS_AVISO_OBRIGACAO)[number];

/** Prova da soma (parcelas impressas: cada trabalhador ou processamento e o total). */
export interface ConferenciaObrigacao {
  readonly ok: boolean;
  readonly parcelas: readonly { readonly rotulo: string; readonly valor: number }[];
  readonly divergencias: readonly string[];
}

/** O trabalhador na apuração do FGTS (sem CPF nem nome). */
export interface TrabalhadorApuracaoFgts {
  readonly vinculo: number;
  readonly matricula: string | null;
  readonly categoria: string | null;
  readonly baseFgts: number;
  readonly fgts: number;
  readonly baseDecimo: number;
  readonly fgtsDecimo: number;
  readonly rescisorio: number;
  /** Os processamentos da folha que somam neste trabalhador. */
  readonly processos: readonly number[];
  /** Situação do evento do eSocial que alimenta o FGTS Digital: aceito, em andamento ou sem evento. */
  readonly esocial: 'aceito' | 'em-andamento' | 'sem-evento' | 'nao-se-aplica';
}

/** A apuração do FGTS Digital da competência (prévia; a geração grava o mesmo). */
export interface ApuracaoFgtsDigital {
  readonly empresa: number;
  readonly competencia: string;
  readonly exigida: boolean;
  readonly fechamento: { readonly id: number; readonly numero: number } | null;
  readonly trabalhadores: readonly TrabalhadorApuracaoFgts[] | null;
  readonly totais: TotaisObrigacao | null;
  readonly conferencia: ConferenciaObrigacao | null;
  readonly pendencias: readonly PendenciaObrigacao[];
  readonly avisos: readonly CodigoAvisoObrigacao[];
  /** A obrigação em vigor do período (gerada ou entregue), se houver. */
  readonly vigente: ObrigacaoLegal | null;
}

// ── Entradas ──────────────────────────────────────────────────────────────────────────────────────────────────

export const esquemaFiltroApuracaoFgts = z.object({ empresa: smallint, competencia }).strict();
export type FiltroApuracaoFgts = z.infer<typeof esquemaFiltroApuracaoFgts>;

/** Gerar a obrigação do período (`pessoas.obrigacao.gerar`); `simular` devolve a prévia sem gravar. */
export const esquemaGerarObrigacao = z
  .object({
    empresa: smallint,
    tipo: z.enum(TIPOS_OBRIGACAO),
    periodo: z.string().min(4).max(7),
    simular: z.boolean().default(false),
    /** SEFIP: a data do recolhimento do FGTS (o vencimento ou a data em que será pago); nula nos demais. */
    recolhimento: data.nullable().default(null),
  })
  .strict()
  .superRefine(comPeriodo);
export type GerarObrigacaoEntrada = z.infer<typeof esquemaGerarObrigacao>;

export interface ResultadoGeracaoObrigacao {
  readonly gerado: boolean;
  readonly simulado: boolean;
  readonly obrigacao: ObrigacaoLegal | null;
  readonly nomeArquivo: string | null;
  readonly tamanho: number;
  readonly totais: TotaisObrigacao | null;
  readonly trabalhadores: number;
  readonly pendencias: readonly PendenciaObrigacao[];
  readonly avisos: readonly CodigoAvisoObrigacao[];
  readonly conferencia: ConferenciaObrigacao | null;
}

/**
 * Registrar a entrega feita no programa oficial: o protocolo (ou o número da guia do FGTS Digital) e a data. No
 * FGTS Digital, o valor da guia e os acréscimos: a guia tem de ser o FGTS apurado mais os acréscimos.
 */
export const esquemaRegistrarEntregaObrigacao = z
  .object({
    versao: z.number().int().min(0),
    protocolo: obrigatorio(40),
    data,
    valorGuia: centavos.nullable().default(null),
    acrescimos: centavos.nullable().default(null),
  })
  .strict();
export type RegistrarEntregaObrigacaoEntrada = z.infer<typeof esquemaRegistrarEntregaObrigacao>;

export const esquemaCancelarObrigacao = z.object({ versao: z.number().int().min(0), motivo }).strict();
export type CancelarObrigacaoEntrada = z.infer<typeof esquemaCancelarObrigacao>;

/** O que a tela das obrigações precisa para abrir (tipos, sugestão, fontes, empresas). */
export interface ApoioObrigacoes {
  readonly tipos: readonly TipoObrigacao[];
  readonly regimesSugeridos: Readonly<Record<TipoObrigacao, RegimeObrigacao>>;
  readonly fontes: Readonly<Record<TipoObrigacao, string>>;
  readonly empresas: readonly { readonly codigo: number; readonly rotulo: string }[];
  /** Competência sugerida (a anterior à de hoje) e o ano-base sugerido (o anterior ao de hoje). */
  readonly competenciaSugerida: string;
  readonly anoSugerido: string;
  /** O relógio do servidor (AAAA-MM-DD), para as listas de períodos e a data da entrega. */
  readonly hoje: string;
}

/** Recusas do servidor (a tela traduz por `folha.erro.<codigo>`). */
export const RECUSAS_OBRIGACAO = [
  'obrigacao-com-pendencias',
  'obrigacao-ja-entregue',
  'leiaute-nao-conferido',
  'guia-divergente',
  'entrega-sem-guia',
  'obrigacao-nao-gerada',
  'parametros-vigencia-repetida',
] as const;
export type RecusaObrigacao = (typeof RECUSAS_OBRIGACAO)[number];
