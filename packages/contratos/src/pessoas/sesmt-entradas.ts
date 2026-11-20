// Entradas das telas do SESMT, fatia F5 (M52; ficha, seções 6 a 8, regras 16 a 19): ASO e exames do PCMSO, vacinas e
// anti-HBs, acidente (profilaxia, sorologia, CAT, encerramento), mapa de riscos e EPI por função, entregas de EPI,
// dosimetria e exposição a quimioterápico. O mesmo Zod vale na tela e no servidor; o vínculo vai na URL. Nenhum campo
// identifica paciente (a fonte do material biológico é só "conhecida" ou "desconhecida").
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import {
  CODIGOS_DOSE_VACINA_SESMT,
  CODIGOS_MARCO_SOROLOGIA,
  CODIGOS_PENDENCIA_SESMT,
  CODIGOS_VACINA_SESMT,
  type DoseVacinaSesmt,
  type MarcoSorologia,
  type PendenciaSesmt,
  type VacinaSesmt,
} from './sesmt-vocabulario.js';

const id = z.number().int().positive();
const smallint = z.number().int().min(0).max(32_767);
const data = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Data no formato AAAA-MM-DD.');
/** Instante local no fuso do estabelecimento (AAAA-MM-DDTHH:MM). */
const instante = z
  .string()
  .regex(
    /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d$/,
    'Data e hora no formato AAAA-MM-DDTHH:MM.',
  );
const motivo = textoCp1252(400).pipe(z.string().min(10, 'Explique com pelo menos 10 caracteres.'));
const textoOpcional = (n: number) => textoCp1252(n).nullable().default(null);

/** Retificação de um registro de saúde (só inclusão): o ID corrigido e o motivo, juntos. */
const retificacao = {
  retifica: id.nullable().default(null),
  motivoRetificacao: motivo.nullable().default(null),
};
const exigirMotivo = <T extends { retifica: number | null; motivoRetificacao: string | null }>(v: T) =>
  v.retifica === null || v.motivoRetificacao !== null;
const msgMotivo = { message: 'A retificação pede o motivo.', path: ['motivoRetificacao'] };

/** Painel do SESMT: colaboradores ativos com as pendências (ASO, vacinas, EPI, acidentes). */
export const esquemaFiltroSesmt = z
  .object({
    termo: textoCp1252(70).optional(),
    unidade: z.coerce.number().int().positive().max(32_767).optional(),
    pendencia: z.enum(CODIGOS_PENDENCIA_SESMT as [PendenciaSesmt, ...PendenciaSesmt[]]).optional(),
    /** Só os que têm alguma pendência (padrão) ou todos os ativos. */
    somentePendentes: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .transform((v) => v === true || v === 'true')
      .default(true),
    pagina: z.coerce.number().int().min(0).max(1000).default(0),
    limite: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export type FiltroSesmtEntrada = z.infer<typeof esquemaFiltroSesmt>;

/** Busca de colaborador para as telas do SESMT (nome ou matrícula; ativos e desligados). */
export const esquemaBuscaColaboradorSesmt = z
  .object({
    termo: textoCp1252(70).pipe(z.string().min(2, 'Digite ao menos 2 caracteres.')),
    estado: z.enum(['ativo', 'desligado', 'todos']).default('todos'),
  })
  .strict();
export type BuscaColaboradorSesmtEntrada = z.infer<typeof esquemaBuscaColaboradorSesmt>;

export const esquemaExameOcupacional = z
  .object({
    exame: textoCp1252(80).pipe(z.string().min(2, 'Informe o exame.')),
    data,
    resultado: z.enum(['normal', 'alterado']),
  })
  .strict();
export type ExameOcupacionalEntrada = z.infer<typeof esquemaExameOcupacional>;

/** ASO com os exames do PCMSO (regra 17). `proximo` vazio: o servidor calcula pela periodicidade. */
export const esquemaRegistrarAso = z
  .object({
    vinculo: id,
    tipo: smallint,
    data,
    conclusao: smallint,
    restricoes: textoOpcional(400),
    medico: textoCp1252(70).pipe(z.string().min(3, 'Informe o médico examinador.')),
    medicoConselho: textoOpcional(20),
    proximo: data.nullable().default(null),
    observacao: textoOpcional(400),
    exames: z.array(esquemaExameOcupacional).max(30).default([]),
    ...retificacao,
  })
  .strict()
  .refine(exigirMotivo, msgMotivo);
export type RegistrarAsoEntrada = z.infer<typeof esquemaRegistrarAso>;

/** Dose de vacina (com lote e validade) ou o resultado do anti-HBs (regra 17). */
export const esquemaRegistrarVacinaColaborador = z
  .object({
    vinculo: id,
    registro: z.enum(['dose', 'anti-hbs']),
    vacina: z.enum(CODIGOS_VACINA_SESMT as [VacinaSesmt, ...VacinaSesmt[]]),
    dose: z
      .enum(CODIGOS_DOSE_VACINA_SESMT as [DoseVacinaSesmt, ...DoseVacinaSesmt[]])
      .nullable()
      .default(null),
    data,
    lote: textoOpcional(30),
    validadeLote: data.nullable().default(null),
    antiHbs: z.number().min(0).max(100_000).nullable().default(null),
    observacao: textoOpcional(400),
    ...retificacao,
  })
  .strict()
  .refine(exigirMotivo, msgMotivo)
  .refine((v) => v.registro !== 'dose' || (v.dose !== null && v.lote !== null && v.validadeLote !== null), {
    message: 'A dose pede a dose, o lote e a validade do lote.',
    path: ['lote'],
  })
  .refine((v) => v.registro !== 'anti-hbs' || v.antiHbs !== null, {
    message: 'Informe o resultado do anti-HBs.',
    path: ['antiHbs'],
  });
export type RegistrarVacinaColaboradorEntrada = z.infer<typeof esquemaRegistrarVacinaColaborador>;

/** Acidente de trabalho (regra 18): os códigos da CAT do domínio do eSocial; a fonte nunca identificada. */
export const esquemaRegistrarAcidente = z
  .object({
    vinculo: id,
    ocorridoEm: instante,
    tipo: z.enum(['tipico', 'trajeto', 'doenca']),
    unidade: smallint.nullable().default(null),
    local: textoCp1252(80).pipe(z.string().min(2, 'Informe o local.')),
    descricao: textoCp1252(1000).pipe(
      z.string().min(10, 'Descreva o acidente com pelo menos 10 caracteres.'),
    ),
    biologico: z.boolean(),
    perfurocortante: z.boolean(),
    exposicao: z.enum(['percutanea', 'mucosa', 'pele-nao-integra', 'pele-integra']).nullable().default(null),
    material: z.enum(['sangue', 'fluido-com-sangue', 'fluido-sem-sangue', 'outro']).nullable().default(null),
    fonte: z.enum(['conhecida', 'desconhecida']).nullable().default(null),
    fonteTeste: z.enum(['reagente', 'nao-reagente', 'nao-testada']).nullable().default(null),
    parteCorpo: z.number().int().positive().nullable().default(null),
    natureza: z.number().int().positive().nullable().default(null),
    agente: z.number().int().positive().nullable().default(null),
    situacao: z.number().int().positive().nullable().default(null),
    afastamento: z.boolean().default(false),
    obito: z.boolean().default(false),
    profilaxia: z.enum(['nao-indicada', 'indicada', 'iniciada', 'recusada']).nullable().default(null),
    profilaxiaEm: instante.nullable().default(null),
    profilaxiaObs: textoOpcional(400),
  })
  .strict();
export type RegistrarAcidenteEntrada = z.infer<typeof esquemaRegistrarAcidente>;

export const esquemaProfilaxia = z
  .object({
    acidente: id,
    versao: z.number().int().min(0),
    profilaxia: z.enum(['nao-indicada', 'indicada', 'iniciada', 'recusada']),
    profilaxiaEm: instante.nullable().default(null),
    observacao: textoOpcional(400),
  })
  .strict();
export type ProfilaxiaEntrada = z.infer<typeof esquemaProfilaxia>;

export const esquemaSorologia = z
  .object({
    acidente: id,
    marco: z.enum(CODIGOS_MARCO_SOROLOGIA as [MarcoSorologia, ...MarcoSorologia[]]),
    realizada: data.nullable().default(null),
    resultado: z.enum(['sem-alteracao', 'soroconversao', 'nao-realizada']),
    observacao: textoOpcional(400),
  })
  .strict()
  .refine((v) => v.resultado === 'nao-realizada' || v.realizada !== null, {
    message: 'Informe a data da coleta.',
    path: ['realizada'],
  });
export type SorologiaEntrada = z.infer<typeof esquemaSorologia>;

/** Emissão da CAT (tipo inicial, reabertura ou óbito; o número do recibo do eSocial ou do INSS). */
const hhmm = z.string().regex(/^([01]\d|2[0-3])[0-5]\d$/, 'Hora no formato HHMM.');

/**
 * W0-06: os dados da CAT que o S-2210 do eSocial pede e o registro do acidente não pedia (local, atestado com o CID e o
 * emitente, horas trabalhadas antes, lateralidade). Tudo opcional: o que faltar vira pendência na geração do evento.
 */
export const esquemaDadosCat = z
  .object({
    horasAntes: z
      .string()
      .regex(/^\d{2}[0-5]\d$/, 'Horas trabalhadas no formato HHMM.')
      .nullable()
      .default(null),
    lateralidade: z.number().int().min(0).max(3).nullable().default(null),
    comunicouPolicia: z.boolean().default(false),
    dataObito: data.nullable().default(null),
    ultimoDiaTrabalhado: data.nullable().default(null),
    observacao: textoOpcional(999),
    reciboOrigem: z
      .string()
      .regex(/^[\d.-]{1,23}$/, 'Recibo do eSocial.')
      .nullable()
      .default(null),
    localTipo: z
      .union([
        z.literal(1),
        z.literal(2),
        z.literal(3),
        z.literal(4),
        z.literal(5),
        z.literal(6),
        z.literal(9),
      ])
      .nullable()
      .default(null),
    logradouro: textoOpcional(100),
    numero: textoOpcional(10),
    cep: z
      .string()
      .regex(/^\d{8}$/, 'CEP com 8 dígitos.')
      .nullable()
      .default(null),
    municipio: z
      .string()
      .regex(/^\d{7}$/, 'Código IBGE do município (7 dígitos).')
      .nullable()
      .default(null),
    uf: z
      .string()
      .regex(/^[A-Z]{2}$/, 'UF com 2 letras.')
      .nullable()
      .default(null),
    atestadoData: data.nullable().default(null),
    atestadoHora: hhmm.nullable().default(null),
    internacao: z.boolean().default(false),
    duracaoDias: z.number().int().min(0).max(9999).nullable().default(null),
    complementoLesao: textoOpcional(200),
    diagnostico: textoOpcional(100),
    cid: z
      .string()
      .regex(/^[A-Z]\d{2,3}$/, 'CID-10 sem ponto (ex.: W260).')
      .nullable()
      .default(null),
    emitenteNome: textoOpcional(70),
    emitenteConselho: z
      .union([z.literal(1), z.literal(2), z.literal(3)])
      .nullable()
      .default(null),
    emitenteNumero: textoOpcional(14),
    emitenteUf: z
      .string()
      .regex(/^[A-Z]{2}$/, 'UF com 2 letras.')
      .nullable()
      .default(null),
  })
  .strict();
export type DadosCatEntrada = z.infer<typeof esquemaDadosCat>;

export const esquemaEmitirCat = z
  .object({
    acidente: id,
    versao: z.number().int().min(0),
    tipoCat: smallint,
    iniciativa: smallint.nullable().default(null),
    numero: textoCp1252(30).pipe(z.string().min(1, 'Informe o número da CAT.')),
    emitidaEm: data,
    /** W0-06: os dados da CAT para o S-2210 (opcional na emissão). */
    cat: esquemaDadosCat.nullable().default(null),
  })
  .strict();
export type EmitirCatEntrada = z.infer<typeof esquemaEmitirCat>;

export const esquemaEncerrarAcidente = z
  .object({ acidente: id, versao: z.number().int().min(0), motivo })
  .strict();
export type EncerrarAcidenteEntrada = z.infer<typeof esquemaEncerrarAcidente>;

/**
 * W0-06: retificação do acidente e da CAT com motivo (o registro inteiro, como o S-2210 retificador). O valor anterior
 * fica guardado; se havia S-2210 aceito, a fila do eSocial ganha o retificador (indRetif 2 com o recibo).
 */
export const esquemaRetificarAcidente = z
  .object({
    acidente: id,
    versao: z.number().int().min(0),
    motivo,
    ocorridoEm: instante,
    tipo: z.enum(['tipico', 'trajeto', 'doenca']),
    local: textoCp1252(80).pipe(z.string().min(2, 'Informe o local.')),
    descricao: textoCp1252(1000).pipe(
      z.string().min(10, 'Descreva o acidente com pelo menos 10 caracteres.'),
    ),
    parteCorpo: z.number().int().positive().nullable().default(null),
    natureza: z.number().int().positive().nullable().default(null),
    agente: z.number().int().positive().nullable().default(null),
    situacao: z.number().int().positive().nullable().default(null),
    afastamento: z.boolean().default(false),
    obito: z.boolean().default(false),
    cat: esquemaDadosCat,
  })
  .strict();
export type RetificarAcidenteEntrada = z.infer<typeof esquemaRetificarAcidente>;

/** W0-06: anulação do acidente lançado por engano (S-3000 do S-2210 aceito; o gerado e não enviado se descarta). */
export const esquemaAnularAcidente = z
  .object({ acidente: id, versao: z.number().int().min(0), motivo })
  .strict();
export type AnularAcidenteEntrada = z.infer<typeof esquemaAnularAcidente>;

/** W0-06: o S-2210 original do acidente na fila do eSocial (prévia sem gravar, ou gravado). */
export const esquemaGerarCatEsocial = z
  .object({ acidente: id, empresa: smallint, gravar: z.boolean().default(false) })
  .strict();
export type GerarCatEsocialEntrada = z.infer<typeof esquemaGerarCatEsocial>;

export const esquemaFiltroAcidentes = z
  .object({
    estado: z.enum(['aberto', 'encerrado', 'todos']).default('aberto'),
    vinculo: z.coerce.number().int().positive().optional(),
    depois: z.coerce.number().int().positive().optional(),
    limite: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export type FiltroAcidentesEntrada = z.infer<typeof esquemaFiltroAcidentes>;

/** Linha do mapa de riscos por função (fator de risco do eSocial ou EPI exigido). */
export const esquemaLinhaRisco = z
  .object({
    unidade: smallint.nullable().default(null),
    setor: textoOpcional(60),
    funcao: textoCp1252(60).pipe(z.string().min(2, 'Informe a função.')),
    tipo: z.enum(['risco', 'epi']),
    fatorRisco: z.string().max(10).nullable().default(null),
    grupoRisco: z.string().length(1).nullable().default(null),
    epc: smallint.nullable().default(null),
    epi: textoOpcional(80),
    descricao: textoOpcional(400),
    inicio: data,
  })
  .strict()
  .refine((v) => v.tipo !== 'risco' || (v.fatorRisco !== null && v.grupoRisco !== null), {
    message: 'O fator de risco pede o código e o grupo.',
    path: ['fatorRisco'],
  })
  .refine((v) => v.tipo !== 'epi' || v.epi !== null, { message: 'Informe o EPI exigido.', path: ['epi'] });
export type LinhaRiscoEntrada = z.infer<typeof esquemaLinhaRisco>;

export const esquemaEncerrarLinhaRisco = z.object({ id, fim: data, motivo }).strict();
export type EncerrarLinhaRiscoEntrada = z.infer<typeof esquemaEncerrarLinhaRisco>;

export const esquemaFiltroRiscos = z
  .object({
    funcao: textoCp1252(60).optional(),
    unidade: z.coerce.number().int().positive().max(32_767).optional(),
    vigentes: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .transform((v) => v === true || v === 'true')
      .default(true),
  })
  .strict();
export type FiltroRiscosEntrada = z.infer<typeof esquemaFiltroRiscos>;

export const esquemaBuscaFatorRisco = z
  .object({ termo: z.string().trim().min(2, 'Digite ao menos 2 caracteres.').max(60) })
  .strict();
export type BuscaFatorRiscoEntrada = z.infer<typeof esquemaBuscaFatorRisco>;

/** Entrega de EPI, leitura do dosímetro ou exposição a quimioterápico (regra 19). */
export const esquemaRegistroEpi = z.discriminatedUnion('tipo', [
  z
    .object({
      tipo: z.literal('epi'),
      vinculo: id,
      data,
      epi: textoCp1252(80).pipe(z.string().min(2, 'Informe o EPI.')),
      caNumero: z.string().trim().min(1, 'Informe o número do CA.').max(12),
      caValidade: data,
      quantidade: z.number().int().min(1).max(999),
      observacao: textoOpcional(400),
    })
    .strict(),
  z
    .object({
      tipo: z.literal('dosimetria'),
      vinculo: id,
      periodoInicio: data,
      data,
      doseMsv: z.number().min(0).max(1000),
      dosimetro: textoCp1252(30).pipe(z.string().min(1, 'Informe o dosímetro.')),
      observacao: textoOpcional(400),
    })
    .strict(),
  z
    .object({
      tipo: z.literal('quimio'),
      vinculo: id,
      data,
      agente: textoCp1252(80).pipe(z.string().min(2, 'Informe o agente.')),
      duracaoMin: z.number().int().min(1).max(1440),
      observacao: textoOpcional(400),
    })
    .strict(),
]);
export type RegistroEpiEntrada = z.infer<typeof esquemaRegistroEpi>;

/** A assinatura do colaborador no comprovante de entrega (conferida pelo SESMT no papel assinado). */
export const esquemaAssinaturaEpi = z.object({ entrega: id, conferida: z.literal(true) }).strict();
export type AssinaturaEpiEntrada = z.infer<typeof esquemaAssinaturaEpi>;

/** W0-06: cancelamento da entrega de EPI (ou da leitura do dosímetro, ou da exposição) com motivo; nunca se apaga. */
export const esquemaCancelarEpi = z.object({ entrega: id, motivo }).strict();
export type CancelarEpiEntrada = z.infer<typeof esquemaCancelarEpi>;
