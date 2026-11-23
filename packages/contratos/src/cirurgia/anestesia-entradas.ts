// Entradas das operações só do novo da anestesia (ficha do M46, seção 5, operações próprias do sistema; etapa 1):
// cirurgia.registrarApa, cirurgia.registrarFichaAnestesica (lançamentos por parte, marcos, passagem e assinatura) e
// cirurgia.registrarSrpa. Validadas na tela, na API e no executor (o mesmo Zod). O agendamento é o id do agendamento
// cirúrgico; o profissional é o id do registro profissional (o mesmo do M18); o medicamento é o id do item do estoque.
// Datas e horas locais AAAA-MM-DDTHH:mm (o servidor confere contra o relógio do banco).
import { z } from 'zod';
import { esquemaChaveAto, esquemaDataHoraLocal } from '../enfermagem/entradas.js';
import { textoCp1252 } from '../texto-cp1252.js';
import {
  CODIGOS_ITEM_ALDRETE,
  CONCLUSOES_APA,
  CRITERIOS_LEE,
  DESTINOS_ALTA_SRPA,
  EVENTOS_FICHA,
  FLUIDOS_FICHA,
  MARCOS_FICHA,
  MOMENTOS_SRPA,
  PERDAS_FICHA,
  TIPOS_GAS_FICHA,
  TIPOS_INGESTAO,
  TIPOS_SINAL_FICHA,
  VIAS_FICHA,
} from './anestesia-vocabulario.js';
import { esquemaProfissional } from './entradas.js';
import { idBanco } from '../validacao/id-banco.js';

const id = idBanco;
const smallint = z.number().int().min(0).max(32767);
const livre = (max: number) => textoCp1252(max).overwrite((t) => t.replace(/\s+/g, ' ').trim());
const opcional = (max: number) => livre(max).nullable().default(null);
const enumDe = <T extends readonly { codigo: string }[]>(l: T) =>
  z.enum(l.map((x) => x.codigo) as [T[number]['codigo'], ...T[number]['codigo'][]]);

/** Versão lida (concorrência otimista): a gravação recusa se outra pessoa mudou o registro depois da leitura. */
const esquemaVersao = z.number().int().min(0);

// ── cirurgia.registrarApa ────────────────────────────────────────────────────────────────────────────────────────

export const esquemaViaAerea = z
  .object({
    mallampati: z.number().int().min(1).max(4),
    aberturaBucalCm: z.number().min(0).max(10).nullable().default(null),
    distanciaTireomentonianaCm: z.number().min(0).max(15).nullable().default(null),
    mobilidadeCervicalReduzida: z.boolean().default(false),
    protesesOuDentesSoltos: z.boolean().default(false),
    historicoViaAereaDificil: z.boolean().default(false),
    observacao: opcional(200),
  })
  .strict();

/** Última ingestão de cada tipo (null = não ingeriu desde a véspera ou não se aplica). */
export const esquemaJejum = z
  .object(
    Object.fromEntries(TIPOS_INGESTAO.map((t) => [t, esquemaDataHoraLocal.nullable().default(null)])) as {
      [K in (typeof TIPOS_INGESTAO)[number]]: z.ZodDefault<z.ZodNullable<typeof esquemaDataHoraLocal>>;
    },
  )
  .strict();

export const esquemaPlanoAnestesico = z
  .object({
    /** Tipo de anestesia planejado (id do cadastro de tipos de anestesia; lido da tabela). */
    tipoAnestesia: smallint,
    tecnica: opcional(400),
    medicacaoPreAnestesica: opcional(400),
    reservaUti: z.boolean().default(false),
    reservaHemocomponente: z.boolean().default(false),
    orientacoes: opcional(400),
  })
  .strict();

export const esquemaRegistrarApa = z
  .object({
    agendamento: id,
    /** Idempotência do ato (o mesmo valor do cabeçalho Idempotency-Key). */
    chave: esquemaChaveAto,
    versao: esquemaVersao.default(0),
    avaliadoEm: esquemaDataHoraLocal,
    asa: z.number().int().min(1).max(6),
    emergencia: z.boolean().default(false),
    pesoKg: z.number().min(0.3).max(400).nullable().default(null),
    alturaCm: z.number().min(20).max(250).nullable().default(null),
    viaAerea: esquemaViaAerea,
    jejum: esquemaJejum,
    /** Critérios de Lee presentes (o índice e a classe são calculados). */
    criteriosLee: z
      .array(z.enum(CRITERIOS_LEE.map((c) => c.codigo) as [string, ...string[]]))
      .max(6)
      .default([]),
    /** O anestesista conferiu a lista de alergias do paciente (lida do prontuário) antes de concluir. */
    alergiasConferidas: z.boolean(),
    comorbidades: opcional(800),
    medicacoesEmUso: opcional(800),
    examesConsiderados: opcional(800),
    anestesiasAnteriores: opcional(400),
    plano: esquemaPlanoAnestesico,
    conclusao: enumDe(CONCLUSOES_APA),
    ressalvas: opcional(400),
  })
  .strict()
  .refine((a) => a.conclusao !== 'apto-ressalvas' || (a.ressalvas ?? '').length >= 5, {
    message: 'Diga as ressalvas.',
    path: ['ressalvas'],
  });
export type RegistrarApaEntrada = z.infer<typeof esquemaRegistrarApa>;

// ── cirurgia.registrarFichaAnestesica ────────────────────────────────────────────────────────────────────────────

const momento = esquemaDataHoraLocal;
const quantidade = z.number().positive().max(100_000);
const volumeMl = z.number().positive().max(50_000);

export const esquemaLancamentoSinal = z
  .object({
    parte: z.literal('sinal'),
    momento,
    tipo: z.enum(TIPOS_SINAL_FICHA as [string, ...string[]]),
    valor: z.number(),
  })
  .strict();

export const esquemaLancamentoMedicamento = z
  .object({
    parte: z.literal('medicamento'),
    momento,
    /** Item do estoque (id). */
    item: id,
    dose: quantidade,
    unidade: livre(10).pipe(z.string().min(1)),
    via: enumDe(VIAS_FICHA),
    /** Infusão contínua (fica aberta até ganhar o fim; impede a assinatura enquanto aberta). */
    continua: z.boolean().default(false),
    /** Fim da infusão contínua (na dose única, sempre null). */
    fim: momento.nullable().default(null),
    observacao: opcional(255),
  })
  .strict();

export const esquemaLancamentoGas = z
  .object({
    parte: z.literal('gas'),
    momento,
    gas: z.enum(TIPOS_GAS_FICHA as [string, ...string[]]),
    valor: z.number().min(0).max(100),
    fim: momento.nullable().default(null),
  })
  .strict();

export const esquemaLancamentoFluido = z
  .object({
    parte: z.literal('fluido'),
    momento,
    fluido: enumDe(FLUIDOS_FICHA),
    /** Item do estoque quando houver (soro, coloide); hemocomponente vem da agência transfusional (M47). */
    item: id.nullable().default(null),
    volumeMl,
    fim: momento.nullable().default(null),
    observacao: opcional(255),
  })
  .strict();

export const esquemaLancamentoPerda = z
  .object({
    parte: z.literal('perda'),
    momento,
    perda: enumDe(PERDAS_FICHA),
    volumeMl,
    observacao: opcional(255),
  })
  .strict();

export const esquemaLancamentoEvento = z
  .object({
    parte: z.literal('evento'),
    momento,
    evento: enumDe(EVENTOS_FICHA),
    fim: momento.nullable().default(null),
    descricao: opcional(255),
  })
  .strict()
  .refine((e) => e.evento !== 'outro' || (e.descricao ?? '').length >= 3, {
    message: 'Descreva o evento.',
    path: ['descricao'],
  });

export const esquemaLancamentoModoRespiratorio = z
  .object({ parte: z.literal('modoRespiratorio'), momento, modo: smallint, observacao: opcional(255) })
  .strict();

export const esquemaLancamentoPosicao = z
  .object({ parte: z.literal('posicao'), momento, posicao: smallint, observacao: opcional(255) })
  .strict();

export const esquemaLancamentoEquipe = z
  .object({
    parte: z.literal('equipe'),
    momento,
    profissional: esquemaProfissional,
    /** Função na equipe (id do cadastro de funções da equipe cirúrgica; lida da tabela). */
    funcao: smallint,
  })
  .strict();

/** Procedimento feito na sala durante a anestesia (o procedimento de enfermagem do cadastro, quando houver). */
export const esquemaLancamentoProcedimento = z
  .object({
    parte: z.literal('procedimento'),
    momento,
    /** Id do procedimento quando ele está no cadastro; null = descrito. */
    codigo: id.nullable().default(null),
    descricao: livre(120).pipe(z.string().min(3, 'Descreva o procedimento.')),
    fim: momento.nullable().default(null),
    observacao: opcional(255),
  })
  .strict();

/** Exame feito na sala (ex.: gasometria, glicemia capilar), com o resultado quando já houver. */
export const esquemaLancamentoExame = z
  .object({
    parte: z.literal('exame'),
    momento,
    exame: livre(60).pipe(z.string().min(2, 'Diga o exame.')),
    resultado: opcional(255),
  })
  .strict();

/** Item avulso da ficha (o que não cabe nas outras partes). */
export const esquemaLancamentoAvulso = z
  .object({
    parte: z.literal('avulso'),
    momento,
    descricao: livre(255).pipe(z.string().min(3, 'Descreva o item.')),
    quantidade: quantidade.nullable().default(null),
  })
  .strict();

/** Bomba de infusão: o item, a vazão e a unidade; fica aberta até ganhar o fim (impede a assinatura enquanto aberta). */
export const esquemaLancamentoBomba = z
  .object({
    parte: z.literal('bi'),
    momento,
    item: id,
    vazao: quantidade,
    unidade: livre(10).pipe(z.string().min(1)),
    fim: momento.nullable().default(null),
    observacao: opcional(255),
  })
  .strict();

export const esquemaLancamentoFicha = z.union([
  esquemaLancamentoSinal,
  esquemaLancamentoMedicamento,
  esquemaLancamentoGas,
  esquemaLancamentoFluido,
  esquemaLancamentoPerda,
  esquemaLancamentoEvento,
  esquemaLancamentoModoRespiratorio,
  esquemaLancamentoPosicao,
  esquemaLancamentoEquipe,
  esquemaLancamentoProcedimento,
  esquemaLancamentoExame,
  esquemaLancamentoAvulso,
  esquemaLancamentoBomba,
]);
export type LancamentoFichaEntrada = z.infer<typeof esquemaLancamentoFicha>;

/** Lote de lançamentos (o tablet envia o que juntou desde o último envio; a chave torna o reenvio inofensivo). */
export const esquemaLancarFicha = z
  .object({
    agendamento: id,
    chave: esquemaChaveAto,
    lancamentos: z.array(esquemaLancamentoFicha).min(1).max(200),
  })
  .strict();
export type LancarFichaEntrada = z.infer<typeof esquemaLancarFicha>;

export const esquemaMarcarTempoFicha = z
  .object({
    agendamento: id,
    chave: esquemaChaveAto,
    marco: enumDe(MARCOS_FICHA),
    momento,
  })
  .strict();
export type MarcarTempoFichaEntrada = z.infer<typeof esquemaMarcarTempoFicha>;

/** Transferência de responsabilidade entre anestesistas (regra 3): quem entrega, quem assume e o resumo. */
export const esquemaPassarResponsabilidade = z
  .object({
    agendamento: id,
    chave: esquemaChaveAto,
    momento,
    para: esquemaProfissional,
    resumo: livre(800).pipe(z.string().min(10, 'Resuma o estado do paciente (ao menos 10 caracteres).')),
  })
  .strict();
export type PassarResponsabilidadeEntrada = z.infer<typeof esquemaPassarResponsabilidade>;

/** Justificativa de lacuna na grade de 5 minutos (ex.: troca de monitor), registrada e mostrada na ficha. */
export const esquemaJustificarLacuna = z
  .object({
    agendamento: id,
    chave: esquemaChaveAto,
    inicio: momento,
    fim: momento,
    motivo: livre(255).pipe(z.string().min(10, 'Diga o motivo (ao menos 10 caracteres).')),
  })
  .strict();
export type JustificarLacunaEntrada = z.infer<typeof esquemaJustificarLacuna>;

/** Assinatura (só o anestesista da cirurgia; com a versão lida: nada muda entre conferir e assinar). */
export const esquemaAssinarFicha = z
  .object({
    agendamento: id,
    chave: esquemaChaveAto,
    versao: esquemaVersao,
    /** A assinatura é crítica: a senha conferida de novo (reautenticação). */
    senha: z.string().min(1).max(200),
  })
  .strict();
export type AssinarFichaEntrada = z.infer<typeof esquemaAssinarFicha>;

/**
 * Fim de um gás, de uma infusão contínua ou de um evento já lançado (o lançamento não é editado: ganha o fim). Vale
 * também com a ficha encerrada pelo fim da anestesia, até a assinatura.
 */
export const esquemaEncerrarLancamentoFicha = z
  .object({
    agendamento: id,
    chave: esquemaChaveAto,
    lancamento: id,
    fim: momento,
  })
  .strict();
export type EncerrarLancamentoFichaEntrada = z.infer<typeof esquemaEncerrarLancamentoFicha>;

/** Adendo à ficha já assinada (a ficha não muda; o adendo fica com autor e hora). */
export const esquemaAdendoFicha = z
  .object({
    agendamento: id,
    chave: esquemaChaveAto,
    texto: livre(2000).pipe(z.string().min(10, 'Escreva o adendo (ao menos 10 caracteres).')),
  })
  .strict();
export type AdendoFichaEntrada = z.infer<typeof esquemaAdendoFicha>;

// ── cirurgia.registrarSrpa ───────────────────────────────────────────────────────────────────────────────────────

export const esquemaAldrete = z
  .object(
    Object.fromEntries(CODIGOS_ITEM_ALDRETE.map((i) => [i, z.number().int().min(0).max(2)])) as {
      [K in (typeof CODIGOS_ITEM_ALDRETE)[number]]: z.ZodNumber;
    },
  )
  .strict();
export type AldreteEntrada = z.infer<typeof esquemaAldrete>;

export const esquemaRegistrarSrpa = z
  .object({
    agendamento: id,
    chave: esquemaChaveAto,
    /** A última avaliação que a tela viu (0: nenhuma): outra registrada no meio recusa. */
    ultimaVista: z.number().int().min(0).default(0),
    momento: z.enum(MOMENTOS_SRPA),
    em: momento,
    aldrete: esquemaAldrete,
    dor: z.number().int().min(0).max(10),
    nvpo: z.number().int().min(0).max(2),
    /** Sinais da avaliação (opcionais; a mesma faixa da ficha). */
    pas: z.number().min(20).max(300).nullable().default(null),
    pad: z.number().min(10).max(200).nullable().default(null),
    fc: z.number().min(10).max(300).nullable().default(null),
    spo2: z.number().min(30).max(100).nullable().default(null),
    temperatura: z.number().min(25).max(43).nullable().default(null),
    observacao: opcional(400),
    /** Só na alta. */
    destino: enumDe(DESTINOS_ALTA_SRPA).nullable().default(null),
    motivoDestino: opcional(255),
  })
  .strict()
  .refine((s) => (s.momento === 'alta') === (s.destino !== null), {
    message: 'O destino vai só na alta, e a alta exige o destino.',
    path: ['destino'],
  });
export type RegistrarSrpaEntrada = z.infer<typeof esquemaRegistrarSrpa>;
