// Agência transfusional, etapa 2 (M47; ficha, seções 4 a 8; construída e DESLIGADA pela chave `agencia.completa` até a
// DP-21): imuno-hematologia do receptor (tipagem ABO e Rh com a prova direta e a reversa, pesquisa de anticorpos
// irregulares), prova cruzada da bolsa com a amostra da requisição e o estoque de hemocomponentes (recebimento do
// hemocentro, quarentena, liberação, reserva para a requisição, devolução e descarte; a transfusão dá baixa pelo ato da
// etapa 1). Perfil da cópia pc (só agregados, 2026-10-25): no cadastro de exames do laboratório, a tipagem ABO e Rh está
// em uso (74 lançamentos em 2026), o Coombs indireto e o direto também (5 cada); a prova cruzada pré-transfusional está
// inativa (0); nenhuma bolsa, doação ou movimento de estoque registrado no outro sistema (só a linha fictícia). A
// interface de equipamento da imuno-hematologia espera a DP-17: o resultado é digitado.
// Nenhum nome de tabela do legado sai daqui para a tela (ADR 0023).
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import {
  classeDoHemocomponente,
  esquemaNumeroBolsa,
  FATORES_RH,
  GRUPOS_ABO,
  type ClasseHemocomponente,
  type FatorRh,
  type GrupoAbo,
  type TipagemSanguinea,
} from './transfusao.js';
import { idBanco, idBancoOuZero } from '../validacao/id-banco.js';

// ── Vocabulário ──────────────────────────────────────────────────────────────────────────────────────

/** Exames imuno-hematológicos do receptor registrados na agência. */
export const TIPOS_EXAME_IMUNO = [
  { codigo: 'aboRh', rotulo: 'Tipagem ABO e Rh' },
  { codigo: 'pai', rotulo: 'Pesquisa de anticorpos irregulares' },
  { codigo: 'provaCruzada', rotulo: 'Prova cruzada' },
] as const;
export type TipoExameImuno = (typeof TIPOS_EXAME_IMUNO)[number]['codigo'];
export const CODIGOS_TIPO_EXAME_IMUNO = TIPOS_EXAME_IMUNO.map((t) => t.codigo) as [
  TipoExameImuno,
  ...TipoExameImuno[],
];

/** Situação do resultado: digitado (registrado), conferido por outro profissional (liberado) ou invalidado. */
export const ESTADOS_IMUNO = [
  { codigo: 'registrado', rotulo: 'Registrado, a liberar' },
  { codigo: 'liberado', rotulo: 'Liberado' },
  { codigo: 'invalidado', rotulo: 'Invalidado' },
] as const;
export type EstadoImuno = (typeof ESTADOS_IMUNO)[number]['codigo'];
export const CODIGOS_ESTADO_IMUNO = ESTADOS_IMUNO.map((e) => e.codigo) as [EstadoImuno, ...EstadoImuno[]];

/** Método da técnica (gel-teste, tubo ou microplaca). */
export const METODOS_IMUNO = [
  { codigo: 'gelTeste', rotulo: 'Gel-teste (cartão)' },
  { codigo: 'tubo', rotulo: 'Tubo' },
  { codigo: 'microplaca', rotulo: 'Microplaca' },
] as const;
export type MetodoImuno = (typeof METODOS_IMUNO)[number]['codigo'];
export const CODIGOS_METODO_IMUNO = METODOS_IMUNO.map((m) => m.codigo) as [MetodoImuno, ...MetodoImuno[]];

/**
 * De onde veio o resultado. A interface de equipamento (DP-17) está desligada: só o digitado é aceito; o código do
 * equipamento fica previsto para quando a interface for ligada.
 */
export const ORIGENS_RESULTADO_IMUNO = ['digitado', 'equipamento'] as const;
export type OrigemResultadoImuno = (typeof ORIGENS_RESULTADO_IMUNO)[number];

export const RESULTADOS_PAI = [
  { codigo: 'negativo', rotulo: 'Negativa' },
  { codigo: 'positivo', rotulo: 'Positiva (anticorpo irregular)' },
] as const;
export type ResultadoPai = (typeof RESULTADOS_PAI)[number]['codigo'];

export const RESULTADOS_PROVA_CRUZADA = [
  { codigo: 'compativel', rotulo: 'Compatível' },
  { codigo: 'incompativel', rotulo: 'Incompatível' },
] as const;
export type ResultadoProvaCruzada = (typeof RESULTADOS_PROVA_CRUZADA)[number]['codigo'];

/** Situações da bolsa no estoque (a transfundida vem do ato da etapa 1). */
export const SITUACOES_BOLSA = [
  { codigo: 'quarentena', rotulo: 'Em quarentena' },
  { codigo: 'liberada', rotulo: 'Liberada' },
  { codigo: 'reservada', rotulo: 'Reservada' },
  { codigo: 'transfundida', rotulo: 'Transfundida' },
  { codigo: 'descartada', rotulo: 'Descartada' },
  { codigo: 'devolvida', rotulo: 'Devolvida ao hemocentro' },
] as const;
export type SituacaoBolsaEstoque = (typeof SITUACOES_BOLSA)[number]['codigo'];
export const CODIGOS_SITUACAO_BOLSA = SITUACOES_BOLSA.map((s) => s.codigo) as [
  SituacaoBolsaEstoque,
  ...SituacaoBolsaEstoque[],
];

/** Movimentos do estoque feitos na tela (o recebimento e a transfusão têm a própria operação). */
export const ACOES_BOLSA = [
  { codigo: 'liberar', rotulo: 'Liberar para uso' },
  { codigo: 'bloquear', rotulo: 'Bloquear (quarentena)' },
  { codigo: 'reservar', rotulo: 'Reservar para a requisição' },
  { codigo: 'cancelarReserva', rotulo: 'Cancelar a reserva' },
  { codigo: 'descartar', rotulo: 'Descartar' },
  { codigo: 'devolver', rotulo: 'Devolver ao hemocentro' },
] as const;
export type AcaoBolsa = (typeof ACOES_BOLSA)[number]['codigo'];
export const CODIGOS_ACAO_BOLSA = ACOES_BOLSA.map((a) => a.codigo) as [AcaoBolsa, ...AcaoBolsa[]];

/** Tipo de cada linha do histórico da bolsa (o que a tela mostra). */
export const TIPOS_MOVIMENTO_BOLSA = [
  'recebimento',
  'liberacao',
  'bloqueio',
  'reserva',
  'cancelamentoReserva',
  'descarte',
  'devolucao',
  'transfusao',
] as const;
export type TipoMovimentoBolsa = (typeof TIPOS_MOVIMENTO_BOLSA)[number];

/**
 * Tipo de movimentação do cadastro do estabelecimento ligado a cada movimento (os 10 tipos do cadastro: 1 estoque
 * bloqueado, 2 desbloqueado, 3 transfundida total, 4 perda, 5 devolução); a reserva e o recebimento não têm tipo no
 * cadastro (0, não informado).
 */
export const TIPO_CADASTRO_DO_MOVIMENTO: Readonly<Record<TipoMovimentoBolsa, number>> = Object.freeze({
  recebimento: 0,
  liberacao: 2,
  bloqueio: 1,
  reserva: 0,
  cancelamentoReserva: 0,
  descarte: 4,
  devolucao: 5,
  transfusao: 3,
});

export const MENSAGENS_ESTOQUE: Readonly<Record<string, string>> = {
  'bolsa-vencida': 'A bolsa está vencida: não pode ser liberada nem reservada.',
  'bolsa-vencida-no-recebimento': 'A bolsa chegou vencida: devolva ao hemocentro sem dar entrada.',
  'movimento-invalido': 'Este movimento não vale para a situação atual da bolsa.',
  'bolsa-transfundida': 'A bolsa já foi transfundida: não se movimenta mais.',
  'inspecao-pendente':
    'A inspeção da bolsa foi reprovada na chegada: libere só registrando a reinspeção aprovada, com o motivo; senão, descarte ou devolva.',
  'motivo-da-liberacao':
    'A bolsa entrou em quarentena por temperatura de chegada ou inspeção: escreva o motivo da liberação.',
  'local-inexistente': 'O local de armazenagem escolhido não existe no cadastro da agência.',
  'motivo-inexistente': 'O motivo de devolução ou perda escolhido não existe no cadastro da agência.',
  'prova-cruzada-pendente':
    'A bolsa não tem prova cruzada compatível liberada para esta requisição: faça a prova antes de reservar.',
  'prova-incompativel': 'A prova cruzada desta bolsa foi incompatível: escolha outra bolsa.',
  'temperatura-fora-da-faixa': 'Temperatura de chegada fora da faixa: a bolsa fica em quarentena.',
  'inspecao-reprovada': 'Inspeção reprovada: a bolsa fica em quarentena.',
  'bolsa-ja-recebida': 'Já há uma bolsa com este número no estoque.',
  'versao-desatualizada': 'Outra pessoa mexeu nesta bolsa: recarregue a tela.',
  'bolsa-nao-encontrada': 'Bolsa não encontrada no estoque.',
  'requisicao-de-outro-hemocomponente': 'A requisição é de outro hemocomponente.',
  'requisicao-encerrada': 'A requisição está cancelada ou já atendida.',
  'reserva-excedente': 'A requisição já tem reservadas todas as bolsas pedidas.',
};

/** Máquina de situações do estoque (a transfusão sai do ato; o recebimento da operação própria). */
export const TRANSICOES_BOLSA: Readonly<
  Record<AcaoBolsa, { readonly de: readonly SituacaoBolsaEstoque[]; readonly para: SituacaoBolsaEstoque }>
> = {
  liberar: { de: ['quarentena'], para: 'liberada' },
  bloquear: { de: ['liberada', 'reservada'], para: 'quarentena' },
  reservar: { de: ['liberada'], para: 'reservada' },
  cancelarReserva: { de: ['reservada'], para: 'liberada' },
  descartar: { de: ['quarentena', 'liberada', 'reservada'], para: 'descartada' },
  devolver: { de: ['quarentena', 'liberada', 'reservada'], para: 'devolvida' },
};

export const TIPO_DO_MOVIMENTO: Readonly<Record<AcaoBolsa, TipoMovimentoBolsa>> = {
  liberar: 'liberacao',
  bloquear: 'bloqueio',
  reservar: 'reserva',
  cancelarReserva: 'cancelamentoReserva',
  descartar: 'descarte',
  devolver: 'devolucao',
};

/**
 * Faixa de temperatura aceita no recebimento, por classe (°C; manuais técnicos do hemocentro; o comitê transfusional
 * confere): hemácias no transporte de 1 a 10; plaquetas de 20 a 24; plasma e crioprecipitado congelados a −18 ou menos.
 */
export const FAIXA_TEMPERATURA_RECEBIMENTO: Readonly<
  Record<ClasseHemocomponente, { readonly min: number; readonly max: number }>
> = Object.freeze({
  hemacias: { min: 1, max: 10 },
  plaquetas: { min: 20, max: 24 },
  plasma: { min: -60, max: -18 },
  crioprecipitado: { min: -60, max: -18 },
  outro: { min: -60, max: 24 },
});

/** A temperatura de chegada está na faixa da classe do hemocomponente. */
export function temperaturaNaFaixaDoHemocomponente(hemocomponente: string, temperaturaC: number): boolean {
  const f = FAIXA_TEMPERATURA_RECEBIMENTO[classeDoHemocomponente(hemocomponente)];
  return temperaturaC >= f.min && temperaturaC <= f.max;
}

/**
 * A máquina de situações do estoque, a mesma na tela, na API e na transação do adaptador. Liberar da quarentena a bolsa
 * que entrou com a temperatura de chegada fora da faixa ou com a inspeção reprovada pede o motivo (vai ao histórico); a
 * de inspeção reprovada pede, além disso, a reinspeção aprovada (`inspecaoConferida`), que a gravação registra na bolsa.
 */
export function conferirMovimentoBolsa(c: {
  readonly acao: AcaoBolsa;
  readonly situacao: SituacaoBolsaEstoque;
  readonly vencida: boolean;
  readonly inspecaoOk: boolean;
  readonly temperaturaNaFaixa: boolean;
  readonly inspecaoConferida?: boolean | undefined;
  readonly motivo?: string | null | undefined;
}): {
  readonly para: SituacaoBolsaEstoque | null;
  readonly bloqueios: readonly string[];
  /** A liberação registra a reinspeção aprovada (a inspeção da bolsa passa a valer como aprovada). */
  readonly reinspecao: boolean;
} {
  if (c.situacao === 'transfundida')
    return { para: null, bloqueios: ['bolsa-transfundida'], reinspecao: false };
  const t = TRANSICOES_BOLSA[c.acao];
  const b: string[] = [];
  if (!t.de.includes(c.situacao)) b.push('movimento-invalido');
  if (c.vencida && (c.acao === 'liberar' || c.acao === 'reservar')) b.push('bolsa-vencida');
  const reinspecao = c.acao === 'liberar' && !c.inspecaoOk && c.inspecaoConferida === true;
  if (c.acao === 'liberar') {
    if (!c.inspecaoOk && !reinspecao) b.push('inspecao-pendente');
    if ((!c.inspecaoOk || !c.temperaturaNaFaixa) && (c.motivo ?? '').trim().length < 5)
      b.push('motivo-da-liberacao');
  }
  return b.length > 0
    ? { para: null, bloqueios: b, reinspecao: false }
    : { para: t.para, bloqueios: [], reinspecao };
}

/**
 * Exames imuno-hematológicos do cadastro de exames do laboratório (ato 15) vistos no perfil da cópia pc: tipagem ABO e
 * Rh (em uso), fator Rh, Coombs indireto e direto (em uso) e a prova cruzada pré-transfusional (inativa). Quando o
 * laboratório já lançou o exame na conta (o lançamento do setor, M26), o resultado da agência se liga a ele.
 */
export const ATO_LABORATORIO_IMUNO = 15;
export const EXAMES_IMUNO_LABORATORIO = ['TIPS', 'FRHU', 'CBDI', 'COOD', 'PCRZ'] as const;

export interface ExameImunoLancado {
  readonly id: number;
  readonly exame: string;
  readonly nome: string;
  readonly data: string | null;
}

// ── Entradas ─────────────────────────────────────────────────────────────────────────────────────────

const id = idBanco;
const idLongo = idBanco;
const livre = (max: number) => textoCp1252(max).overwrite((t) => t.replace(/\s+/g, ' ').trim());
const instante = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?/, 'Data e hora no formato ISO.');
/** Intensidade da aglutinação (0 a 4 cruzes). */
const grau = z.number().int().min(0).max(4);

const comum = {
  paciente: id,
  /** Requisição transfusional a que o exame serve (a amostra dela); sem ela, a tipagem do paciente para o histórico. */
  requisicao: idLongo.nullable(),
  metodo: z.enum(CODIGOS_METODO_IMUNO),
  origem: z.literal('digitado', {
    message: 'A interface de equipamento ainda não está ligada: digite o resultado.',
  }),
  /** Exame do laboratório já lançado na conta (lançamento do setor), quando a tipagem também é cobrada como exame. */
  exameLancado: id.nullable(),
  observacao: livre(500).nullable(),
};

export const esquemaRegistrarAboRh = z
  .object({
    tipo: z.literal('aboRh'),
    ...comum,
    /** Prova direta (hemácias do paciente com os soros): anti-A, anti-B, anti-D e o controle. */
    direta: z.object({ antiA: grau, antiB: grau, antiD: grau, controle: grau }).strict(),
    /** Prova reversa (soro do paciente com as hemácias A1 e B). */
    reversa: z.object({ hemaciaA1: grau, hemaciaB: grau }).strict(),
  })
  .strict();

export const esquemaRegistrarPai = z
  .object({
    tipo: z.literal('pai'),
    ...comum,
    resultado: z.enum(['negativo', 'positivo']),
    /** Anticorpo identificado (texto livre do painel; ex.: anti-E), só na positiva. */
    anticorpos: livre(200).nullable(),
  })
  .strict()
  .refine((x) => x.resultado === 'positivo' || x.anticorpos === null, {
    message: 'Anticorpo identificado só na pesquisa positiva.',
    path: ['anticorpos'],
  });

export const esquemaRegistrarProvaCruzada = z
  .object({
    tipo: z.literal('provaCruzada'),
    ...comum,
    requisicao: idLongo,
    bolsa: esquemaNumeroBolsa,
    resultado: z.enum(['compativel', 'incompativel']),
    /** A prova inclui a fase da antiglobulina humana (obrigatória com a pesquisa de anticorpos positiva). */
    faseAntiglobulina: z.boolean(),
  })
  .strict();

/** sadt.registrarImunoHematologia: um exame por pedido (o mesmo Zod na tela, na API e no serviço). */
export const esquemaRegistrarImunoHematologia = z.union([
  esquemaRegistrarAboRh,
  esquemaRegistrarPai,
  esquemaRegistrarProvaCruzada,
]);
export type RegistrarImunoHematologiaEntrada = z.infer<typeof esquemaRegistrarImunoHematologia>;
export type RegistrarAboRhEntrada = z.infer<typeof esquemaRegistrarAboRh>;

/** A liberação é de outro profissional habilitado (biomédico ou médico hemoterapeuta), que confere o resultado. */
export const esquemaLiberarImunoHematologia = z
  .object({ conferido: z.literal(true, { message: 'Confira o resultado antes de liberar.' }) })
  .strict();
export const esquemaInvalidarImunoHematologia = z
  .object({ motivo: livre(300).pipe(z.string().min(5)) })
  .strict();

const tipagem = z.object({ abo: z.enum(GRUPOS_ABO), rh: z.enum(FATORES_RH) }).strict();

/** sadt.receberBolsa: a bolsa recebida do hemocentro, com a inspeção e a temperatura de chegada. */
export const esquemaReceberBolsa = z
  .object({
    numero: esquemaNumeroBolsa,
    hemocomponente: z.string().trim().toUpperCase().min(1).max(4),
    tipagem,
    volumeMl: z.number().int().min(1).max(1_000),
    validade: instante,
    /** Hemocentro ou serviço que forneceu (nome do serviço, não de pessoa). */
    origem: livre(80).pipe(z.string().min(2)),
    /** Local de armazenagem (código do cadastro de locais da agência). */
    local: z.number().int().min(0).max(32_767),
    irradiada: z.boolean(),
    leucorreduzida: z.boolean(),
    temperaturaC: z.number().min(-80).max(40),
    /** Inspeção na chegada: integridade, rótulo legível, aspecto sem hemólise ou coágulo. */
    inspecaoOk: z.boolean(),
    /** Liberar já no recebimento (só com a inspeção e a temperatura dentro da faixa); senão, entra em quarentena. */
    liberarNaEntrada: z.boolean(),
  })
  .strict();
export type ReceberBolsaEntrada = z.infer<typeof esquemaReceberBolsa>;

/** sadt.movimentarBolsa: liberar, bloquear, reservar, cancelar a reserva, descartar ou devolver. */
export const esquemaMovimentarBolsa = z
  .object({
    acao: z.enum(CODIGOS_ACAO_BOLSA),
    /** A requisição da reserva. */
    requisicao: idLongo.nullable(),
    /** Motivo do cadastro de motivos de devolução ou perda (código); 0 = não informado. */
    motivoCadastro: idBancoOuZero.nullable(),
    motivo: livre(300).nullable(),
    /** Na liberação da bolsa com a inspeção reprovada na chegada: a reinspeção foi feita e aprovou a bolsa. */
    inspecaoConferida: z.boolean().optional(),
    /** Versão lida pela tela (controle otimista: outra pessoa mexeu na bolsa). */
    versao: z.number().int().min(0),
  })
  .strict()
  .refine((x) => !x.inspecaoConferida || x.acao === 'liberar', {
    message: 'A reinspeção só se registra na liberação.',
    path: ['inspecaoConferida'],
  })
  .refine((x) => !x.inspecaoConferida || (x.motivo ?? '').length >= 5, {
    message: 'Escreva o motivo da liberação (o que a reinspeção conferiu).',
    path: ['motivo'],
  })
  .refine((x) => x.acao !== 'reservar' || x.requisicao !== null, {
    message: 'Escolha a requisição da reserva.',
    path: ['requisicao'],
  })
  .refine((x) => !['bloquear', 'descartar', 'devolver'].includes(x.acao) || (x.motivo ?? '').length >= 5, {
    message: 'Escreva o motivo.',
    path: ['motivo'],
  });
export type MovimentarBolsaEntrada = z.infer<typeof esquemaMovimentarBolsa>;

export const esquemaFiltroEstoque = z
  .object({
    situacao: z.enum(CODIGOS_SITUACAO_BOLSA).optional(),
    hemocomponente: z.string().trim().toUpperCase().max(4).optional(),
    abo: z.enum(GRUPOS_ABO).optional(),
    rh: z.enum(FATORES_RH).optional(),
    /** Só as que vencem nos próximos N dias (inclui as vencidas ainda no estoque). */
    venceEmDias: z.coerce.number().int().min(0).max(60).optional(),
    numero: z.string().trim().toUpperCase().max(24).optional(),
  })
  .strict();
export type FiltroEstoque = z.infer<typeof esquemaFiltroEstoque>;

export const esquemaFiltroImuno = z
  .object({
    estado: z.enum(CODIGOS_ESTADO_IMUNO).optional(),
    tipo: z.enum(CODIGOS_TIPO_EXAME_IMUNO).optional(),
    requisicao: z.coerce.number().int().positive().optional(),
    paciente: z.coerce.number().int().positive().optional(),
  })
  .strict();
export type FiltroImuno = z.infer<typeof esquemaFiltroImuno>;

// ── Respostas ────────────────────────────────────────────────────────────────────────────────────────

export interface ImunoHematologiaLida {
  readonly id: number;
  readonly tipo: TipoExameImuno;
  readonly estado: EstadoImuno;
  readonly paciente: number;
  readonly requisicao: number | null;
  readonly amostra: string | null;
  readonly metodo: MetodoImuno;
  readonly origem: OrigemResultadoImuno;
  /** Tipagem ABO e Rh interpretada (só no aboRh). */
  readonly tipagem: TipagemSanguinea | null;
  readonly direta: {
    readonly antiA: number;
    readonly antiB: number;
    readonly antiD: number;
    readonly controle: number;
  } | null;
  readonly reversa: { readonly hemaciaA1: number; readonly hemaciaB: number } | null;
  readonly pai: ResultadoPai | null;
  readonly anticorpos: string | null;
  readonly bolsa: string | null;
  readonly provaCruzada: ResultadoProvaCruzada | null;
  readonly faseAntiglobulina: boolean | null;
  readonly exameLancado: number | null;
  readonly observacao: string | null;
  readonly registradoPor: string;
  readonly registradoEm: string;
  readonly liberadoPor: string | null;
  readonly liberadoEm: string | null;
  readonly motivoInvalidacao: string | null;
}

/** A tipagem que vale para a transfusão com a agência própria: a do novo (liberada) prevalece sobre a do cadastro. */
export interface TipagemDoReceptor {
  readonly tipagem: TipagemSanguinea;
  readonly origem: 'agencia' | 'cadastro' | null;
  /** Duas tipagens liberadas discordam: a transfusão fica bloqueada até nova amostra. */
  readonly divergente: boolean;
  readonly pai: ResultadoPai | null;
  readonly anticorpos: string | null;
}

export interface BolsaEstoqueLida {
  readonly id: number;
  readonly numero: string;
  readonly hemocomponente: {
    readonly codigo: string;
    readonly rotulo: string;
    readonly classe: ClasseHemocomponente;
  };
  readonly tipagem: { readonly abo: GrupoAbo | null; readonly rh: FatorRh | null };
  readonly volumeMl: number;
  readonly validade: string;
  readonly vencida: boolean;
  readonly situacao: SituacaoBolsaEstoque;
  readonly origem: string;
  readonly local: number;
  readonly irradiada: boolean;
  readonly leucorreduzida: boolean;
  readonly temperaturaC: number;
  readonly inspecaoOk: boolean;
  readonly reservadaPara: { readonly requisicao: number; readonly paciente: number } | null;
  readonly recebidaEm: string;
  readonly recebidaPor: string;
  /** O ato da etapa 1 que deu baixa na bolsa (transfundida). */
  readonly ato: number | null;
  readonly versao: number;
}

/** Um item dos cadastros que o estoque usa (local de armazenagem, motivo de devolução ou perda). */
export interface ItemCadastroEstoque {
  readonly codigo: number;
  readonly descricao: string;
}

/** Os cadastros da agência que o recebimento e os movimentos escolhem por combo. */
export interface CadastrosDoEstoque {
  readonly locais: readonly ItemCadastroEstoque[];
  readonly motivos: readonly ItemCadastroEstoque[];
  readonly cortada: boolean;
}

export interface MovimentoBolsaLido {
  readonly id: number;
  readonly tipo: TipoMovimentoBolsa;
  readonly situacaoAntes: SituacaoBolsaEstoque | null;
  readonly situacaoDepois: SituacaoBolsaEstoque;
  readonly tipoCadastro: number;
  readonly motivoCadastro: number | null;
  readonly motivo: string | null;
  readonly requisicao: number | null;
  readonly usuario: string;
  readonly em: string;
}

/** Contagem do estoque por hemocomponente, tipagem e situação (o painel da tela). */
export interface ResumoEstoque {
  readonly hemocomponente: string;
  readonly abo: GrupoAbo | null;
  readonly rh: FatorRh | null;
  readonly liberadas: number;
  readonly reservadas: number;
  readonly quarentena: number;
  readonly vencendo: number;
}

/** Resumo de um resultado imuno-hematológico para a regra da tipagem do receptor. */
export interface ResultadoImunoResumo {
  readonly tipo: TipoExameImuno;
  readonly estado: EstadoImuno;
  readonly tipagem: TipagemSanguinea | null;
  readonly pai: ResultadoPai | null;
  readonly anticorpos: string | null;
  readonly liberadoEm: string | null;
}

/** Resumo de uma prova cruzada para a reserva e o início do ato. */
export interface ProvaCruzadaResumo {
  readonly bolsa: string;
  readonly requisicao: number;
  readonly estado: EstadoImuno;
  readonly resultado: ResultadoProvaCruzada;
}
