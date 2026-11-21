// Entradas das operações da checagem de enfermagem (checar a administração, aprazar o horário e estornar a checagem):
// o Zod que a porta própria (Executor do @sgh/nucleo) e a memória de dev/ci aplicam igual, antes de qualquer gravação.
// Melhoria: texto validado na entrada (comprimento e espaços), hora real com segundos opcionais, uma marcação principal
// por checagem e nenhum horário repetido; o motivo do estorno é da lista do contrato (sem texto livre no lugar dele).
import { MOTIVOS_ESTORNO_CHECAGEM, type MotivoEstornoChecagem } from '@sgh/contratos';
import { type ErroOperacao, recusa } from '@sgh/nucleo';
import type { BaixaDeEstoque } from './tipos.js';
import { z } from 'zod';

const ID = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const texto = (max: number) => z.string().trim().max(max);
const HORA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

export const OPERACAO_CHECAR = 'enfermagem.checarAdministracao';
export const OPERACAO_APRAZAR = 'enfermagem.aprazarHorario';
export const OPERACAO_ESTORNAR = 'enfermagem.estornarChecagem';
export const OPERACOES_CHECAGEM = [OPERACAO_CHECAR, OPERACAO_APRAZAR, OPERACAO_ESTORNAR] as const;

const esquemaMarcacao = z
  .object({
    horario: ID,
    item: ID,
    /** Situação que a tela leu: a checagem só grava se ainda for esta. */
    situacaoLida: z.string().length(1),
    /** A = administrado; N = não administrado (o contrato das telas). */
    situacao: z.enum(['A', 'N']),
    quantidade: z.number().min(0).max(1_000_000),
    justificativa: texto(200).nullable(),
    /** principal: o horário que a pessoa checou; faixa: a faixa da escala de glicemia do mesmo horário. */
    papel: z.enum(['principal', 'faixa']),
  })
  .strict();

/** O ato à beira do leito que acompanha a checagem (pulseira, dose lida, conferente, aparelho). */
const esquemaAtoChecagem = z
  .object({
    horaReal: z.string().regex(HORA),
    pulseiraLida: z.boolean(),
    motivoSemPulseira: z.string().max(20).nullable(),
    gtin: z
      .string()
      .regex(/^\d{8,14}$/)
      .nullable(),
    lote: texto(20).nullable(),
    validade: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    conferente: z.string().max(60).nullable(),
    dispositivo: z.string().max(64).nullable(),
    /** O aparelho foi exigido e conferido no começo (a gravação recusa sem ele). */
    aparelhoExigido: z.boolean().optional(),
    origemOffline: z.boolean(),
    avisos: z.array(z.string().max(200)).max(10),
    motivo: z.string().max(20).nullable(),
    observacao: texto(200).nullable(),
  })
  .strict();

const instanteHemo = z.string().regex(HORA);
/** O ato transfusional que começa com a checagem do horário do item de hemoterapia (dupla checagem da bolsa). */
export const esquemaHemoNaChecagem = z
  .object({
    requisicao: ID,
    bolsa: z
      .object({
        numero: z.string().regex(/^[0-9A-Z][0-9A-Z-]{3,23}$/),
        hemocomponente: z.string().min(1).max(4),
        abo: z.number().int().min(1).max(4),
        rh: z.number().int().min(1).max(2),
        validade: instanteHemo,
        volumeMl: z.number().int().min(1).max(1_000),
      })
      .strict(),
    inicioEm: instanteHemo,
    pulseiraLida: z.boolean(),
    motivoSemPulseira: z.string().max(20).nullable(),
    profissional: z.string().min(1).max(60),
    conferente: z.string().min(1).max(60),
    alertas: z.array(z.string().max(40)).max(5),
    justificativaRh: texto(300).nullable(),
    sinaisAntes: z
      .object({
        pas: z.number(),
        pad: z.number(),
        fc: z.number(),
        temperatura: z.number(),
        fr: z.number().optional(),
        spo2: z.number().optional(),
      })
      .strict(),
    sinaisAntesEm: instanteHemo,
    chave: z.string().max(80).nullable(),
    /** A bolsa conferida no estoque da agência na mesma transação. */
    estoque: z.boolean().optional(),
  })
  .strict();
export type HemoNaChecagem = z.infer<typeof esquemaHemoNaChecagem>;

export const esquemaChecagemAdministracao = z
  .object({
    prescricao: ID,
    atendimento: ID,
    paciente: ID,
    /** Ocupação (id) do profissional da sessão (o vínculo de enfermagem do usuário). */
    cbo: ID,
    marcacoes: z.array(esquemaMarcacao).min(1).max(30),
    /** O ato à beira do leito (a hora real, a pulseira, a dose lida, o conferente e o aparelho). */
    sgh: esquemaAtoChecagem,
    /** Glicemia medida: o valor vai aos sinais vitais. */
    glicemia: z.number().min(10).max(900).nullable(),
    hemocomponente: esquemaHemoNaChecagem.optional(),
  })
  .strict()
  .refine((e) => e.marcacoes.filter((m) => m.papel === 'principal').length === 1, {
    message: 'Uma marcação principal por checagem.',
  })
  .refine((e) => new Set(e.marcacoes.map((m) => m.horario)).size === e.marcacoes.length, {
    message: 'Horário repetido na checagem.',
  })
  .refine(
    (e) =>
      !e.hemocomponente ||
      (e.marcacoes.length === 1 &&
        e.marcacoes[0]?.situacao === 'A' &&
        e.sgh.conferente !== null &&
        e.sgh.conferente.toUpperCase() === e.hemocomponente.conferente.toUpperCase()),
    {
      message:
        'A transfusão começa com o horário administrado e a dupla checagem do mesmo segundo profissional.',
    },
  );
export type ChecagemAdministracao = z.infer<typeof esquemaChecagemAdministracao>;

export const esquemaAprazamentoHorario = z
  .object({
    horario: ID,
    item: ID,
    prescricao: ID,
    paciente: ID,
    cbo: ID,
    acao: z.enum(['aprazar', 'reaprazar', 'suprimir']),
    confirmado: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
      .nullable(),
    motivo: texto(200).nullable(),
  })
  .strict()
  .refine((e) => e.acao === 'suprimir' || e.confirmado !== null, {
    message: 'Aprazar e reaprazar exigem a hora confirmada.',
  });
export type AprazamentoHorario = z.infer<typeof esquemaAprazamentoHorario>;

export const esquemaEstornoChecagem = z
  .object({
    horario: ID,
    paciente: ID,
    cbo: ID,
    motivo: z.enum(MOTIVOS_ESTORNO_CHECAGEM),
    justificativa: texto(200).pipe(z.string().min(10)),
    /** A dose já baixou estoque e a devolução fica pendente; sem isto, a baixa recusa o estorno. */
    devolucaoPendente: z.boolean().default(false),
  })
  .strict();
export type EstornoChecagem = z.infer<typeof esquemaEstornoChecagem>;

export const ESQUEMAS_CHECAGEM: Readonly<Record<(typeof OPERACOES_CHECAGEM)[number], z.ZodType>> = {
  [OPERACAO_CHECAR]: esquemaChecagemAdministracao,
  [OPERACAO_APRAZAR]: esquemaAprazamentoHorario,
  [OPERACAO_ESTORNAR]: esquemaEstornoChecagem,
};

const ROTULO_MOTIVO_ESTORNO: Readonly<Record<MotivoEstornoChecagem, string>> = {
  'nao-administrado': 'Estorno: não administrado',
  'checado-por-engano': 'Estorno: checado por engano',
};

/** O texto do estorno no histórico do horário: o motivo da lista e a justificativa. */
export function justificativaDoEstorno(e: Pick<EstornoChecagem, 'motivo' | 'justificativa'>): string {
  return `${ROTULO_MOTIVO_ESTORNO[e.motivo]} - ${e.justificativa.trim()}`.slice(0, 500);
}

/** A recusa do estorno com a dose que já baixou estoque, com a contagem e a oferta da devolução. */
export function recusaEstoqueBaixado(b: BaixaDeEstoque): ErroOperacao {
  const partes = [
    b.integracoes > 0 ? `${b.integracoes} baixa(s) de estoque da dose` : '',
    b.dispensacoes > 0 ? `${b.dispensacoes} dose(s) dispensada(s) pela farmácia` : '',
  ].filter(Boolean);
  const dependentes = [
    ...(b.integracoes > 0
      ? [
          {
            rotulo: 'baixa de estoque da dose',
            quantidade: b.integracoes,
            amostra: [],
            origem: 'logica' as const,
          },
        ]
      : []),
    ...(b.dispensacoes > 0
      ? [
          {
            rotulo: 'dose dispensada pela farmácia',
            quantidade: b.dispensacoes,
            amostra: [],
            origem: 'logica' as const,
          },
        ]
      : []),
  ];
  return recusa(
    'estoque-baixado',
    `A dose deste horário já baixou estoque (${partes.join(' e ')}): o estorno não devolve a dose. Devolva a dose agora ou estorne registrando a devolução como pendente.`,
    { dependentes },
  );
}
