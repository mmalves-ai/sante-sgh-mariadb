// W0-03, mercado M3 (plano-final.json, item W0-03): os protocolos gerenciados do pronto atendimento (M44.3) estendidos
// ao paciente internado — unidades de internação e UTI. A definição é a mesma (versão publicada pela diretoria
// clínica, com as metas e o checklist); muda a inclusão: pelo alerta do NEWS2 (o escore que disparou e a hora dele são
// o tempo zero) ou por suspeita clínica do enfermeiro ou do médico (com a hora do reconhecimento). Os indicadores saem
// por origem (PA, internação, UTI), cada um com o numerador e o denominador impressos. Base brasileira: RDC 36/2013
// (protocolos de segurança do paciente e indicadores) e a linha "Registro clínico finalizado" da matriz (o registro
// não se edita; a inclusão por engano se inativa com justificativa e continua visível). Nenhum nome de tabela nem do
// sistema anterior em texto visto pelo usuário (ADR 0023).
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import {
  CODIGOS_DESFECHO_PROTOCOLO,
  type TipoProtocoloGerenciado,
} from '../recepcao/protocolo-gerenciado.js';

// ── Vocabulário ────────────────────────────────────────────────────────────────────────────────

/** Os protocolos que valem no internado (sepse e AVC intra-hospitalares; TEV). */
export const TIPOS_PROTOCOLO_INTERNADO = [
  'sepse',
  'avc',
  'tev',
] as const satisfies readonly TipoProtocoloGerenciado[];
export type TipoProtocoloInternado = (typeof TIPOS_PROTOCOLO_INTERNADO)[number];

/** Onde o paciente estava quando foi incluído (a origem dos indicadores). */
export const LOCAIS_PROTOCOLO = ['pa', 'internacao', 'uti'] as const;
export type LocalProtocolo = (typeof LOCAIS_PROTOCOLO)[number];
export const ROTULOS_LOCAL_PROTOCOLO: Readonly<Record<LocalProtocolo, string>> = {
  pa: 'Pronto atendimento',
  internacao: 'Unidade de internação',
  uti: 'UTI',
};
/** Os locais do internado (o PA tem o seu relógio próprio). */
export const LOCAIS_INTERNADO = ['internacao', 'uti'] as const;
export type LocalInternado = (typeof LOCAIS_INTERNADO)[number];

/** Como o paciente internado entrou no protocolo. */
export const ORIGENS_INCLUSAO_INTERNADO = ['news2', 'suspeita'] as const;
export type OrigemInclusaoInternado = (typeof ORIGENS_INCLUSAO_INTERNADO)[number];
export const ROTULOS_ORIGEM_INTERNADO: Readonly<Record<OrigemInclusaoInternado, string>> = {
  news2: 'Pelo alerta do NEWS2',
  suspeita: 'Por suspeita clínica',
};

/** Limiar padrão do NEWS2 para sugerir o protocolo de sepse (padrão de mercado; parâmetro da instituição). */
export const LIMIAR_NEWS2_PROTOCOLO_PADRAO = 5;

const id = z.number().int().positive().max(2_147_483_647);
const idLongo = z.number().int().positive();
const codigo = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9-]{1,39}$/, 'Código em minúsculas, sem espaço (letras, números e hífen).');
const horaLocal = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, 'Hora no formato AAAA-MM-DDTHH:mm.');
const motivo = textoCp1252(300)
  .overwrite((t) => t.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(10, 'Descreva o motivo (10 caracteres ou mais).'));
const motivoOpcional = textoCp1252(300)
  .overwrite((t) => t.replace(/\s+/g, ' ').trim())
  .nullable()
  .default(null);

// ── Entradas ───────────────────────────────────────────────────────────────────────────────────

/**
 * A inclusão do paciente internado. Pelo NEWS2: o escore que alertou (o servidor confere que é do paciente, válido e
 * acima do limiar; a hora dele é o tempo zero). Por suspeita: a hora do reconhecimento (nunca no futuro).
 */
export const esquemaIncluirProtocoloInternado = z
  .object({
    atendimento: id,
    tipo: z.enum(TIPOS_PROTOCOLO_INTERNADO),
    /** A versão vigente vista na tela (colisão se outra foi publicada no meio). */
    versao: idLongo,
    origem: z.enum(ORIGENS_INCLUSAO_INTERNADO),
    escore: idLongo.nullable().default(null),
    reconhecidoEm: horaLocal.nullable().default(null),
    criterios: z.array(codigo).min(1).max(20),
    observacao: motivoOpcional,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.origem === 'news2' && v.escore === null)
      ctx.addIssue({
        code: 'custom',
        path: ['escore'],
        message: 'Escolha o alerta do NEWS2 que motivou a inclusão.',
      });
    if (v.origem === 'suspeita' && v.reconhecidoEm === null)
      ctx.addIssue({
        code: 'custom',
        path: ['reconhecidoEm'],
        message: 'Informe a hora em que a suspeita surgiu.',
      });
    if (v.origem === 'news2' && v.tipo !== 'sepse')
      ctx.addIssue({
        code: 'custom',
        path: ['tipo'],
        message: 'O alerta do NEWS2 abre o protocolo de sepse.',
      });
  });
export type IncluirProtocoloInternadoEntrada = z.infer<typeof esquemaIncluirProtocoloInternado>;

export const esquemaRegistrarMetaInternado = z
  .object({
    tipo: z.enum(['meta', 'checklist']),
    codigo,
    situacao: z.enum(['cumprida', 'perdida']),
    quando: horaLocal.nullable().default(null),
    motivo: motivoOpcional,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.situacao === 'cumprida' && v.quando === null)
      ctx.addIssue({ code: 'custom', path: ['quando'], message: 'Informe a hora em que foi feito.' });
    if (v.situacao === 'perdida' && v.motivo === null)
      ctx.addIssue({ code: 'custom', path: ['motivo'], message: 'Meta perdida exige o motivo.' });
  });
export type RegistrarMetaInternadoEntrada = z.infer<typeof esquemaRegistrarMetaInternado>;

export const esquemaEncerrarProtocoloInternado = z
  .object({ desfecho: z.enum(CODIGOS_DESFECHO_PROTOCOLO), motivo: motivoOpcional })
  .strict();
export type EncerrarProtocoloInternadoEntrada = z.infer<typeof esquemaEncerrarProtocoloInternado>;

/** Inclusão por engano (paciente errado, critério lançado errado): inativa com justificativa e senha; fica visível. */
export const esquemaInativarProtocoloInternado = z
  .object({ motivo, senha: z.string().min(1).max(64) })
  .strict();
export type InativarProtocoloInternadoEntrada = z.infer<typeof esquemaInativarProtocoloInternado>;

// ── Respostas ──────────────────────────────────────────────────────────────────────────────────

const txt = z.string();
const n = z.number();

export const esquemaMetaInternadoNoRelogio = z.object({
  codigo: txt,
  titulo: txt,
  tipo: z.enum(['meta', 'checklist']),
  prazoEm: txt.nullable(),
  minutosRestantes: n.nullable(),
  situacao: z.enum(['no_prazo', 'vencendo', 'vencida', 'cumprida', 'perdida', 'pendente', 'feito']),
  quando: txt.nullable(),
  motivo: txt.nullable(),
  por: txt.nullable(),
});

export const esquemaProtocoloInternado = z.object({
  id: n,
  atendimento: n,
  paciente: txt,
  unidade: txt.nullable(),
  local: z.enum(LOCAIS_INTERNADO),
  tipo: z.enum(TIPOS_PROTOCOLO_INTERNADO),
  nomeTipo: txt,
  versao: n,
  origem: z.enum(ORIGENS_INCLUSAO_INTERNADO),
  escore: z.object({ id: n, total: n, em: txt, estornado: z.boolean() }).nullable(),
  criterios: z.array(txt),
  reconhecidoEm: txt,
  incluidoEm: txt,
  incluidoPor: txt,
  observacao: txt.nullable(),
  metas: z.array(esquemaMetaInternadoNoRelogio),
  atrasadas: n,
  encerramento: z
    .object({ desfecho: z.enum(CODIGOS_DESFECHO_PROTOCOLO), em: txt, por: txt, motivo: txt.nullable() })
    .nullable(),
  inativacao: z.object({ em: txt, por: txt, motivo: txt }).nullable(),
});
export type ProtocoloInternado = z.infer<typeof esquemaProtocoloInternado>;

/** Alerta do NEWS2 sem protocolo de sepse aberto (a sugestão da tela). */
export const esquemaSugestaoNews2 = z.object({
  escore: n,
  atendimento: n,
  paciente: txt,
  unidade: txt.nullable(),
  local: z.enum(LOCAIS_INTERNADO),
  total: n,
  em: txt,
});
export type SugestaoNews2 = z.infer<typeof esquemaSugestaoNews2>;

/** Indicadores por origem (PA, internação, UTI): cada taxa com o numerador e o denominador. */
export const esquemaIndicadorOrigemProtocolo = z.object({
  local: z.enum(LOCAIS_PROTOCOLO),
  tipo: txt,
  inclusoes: n,
  pelaNews2: n,
  metasCumpridas: n,
  metasRegistradas: n,
  adesaoPercentual: n.nullable(),
  /** Inclusões em que todas as metas foram cumpridas (o pacote completo) sobre as encerradas. */
  pacoteCompleto: n,
  encerradas: n,
  pacotePercentual: n.nullable(),
  obitos: n,
});
export type IndicadorOrigemProtocolo = z.infer<typeof esquemaIndicadorOrigemProtocolo>;

export const esquemaRelogioInternado = z.object({
  ativos: z.array(esquemaProtocoloInternado),
  encerrados: z.array(esquemaProtocoloInternado),
  sugestoes: z.array(esquemaSugestaoNews2),
  limiarNews2: n,
  /** Os internados da unidade (a inclusão por suspeita escolhe um deles). */
  pacientes: z.array(z.object({ atendimento: n, nome: txt, leito: txt, local: z.enum(LOCAIS_INTERNADO) })),
  /** As versões vigentes dos protocolos do internado (o id vai na inclusão; os critérios a conferir). */
  vigentes: z.array(
    z.object({
      tipo: z.enum(TIPOS_PROTOCOLO_INTERNADO),
      id: n,
      versao: n,
      nome: txt,
      criterios: z.array(z.object({ codigo: txt, titulo: txt })),
    }),
  ),
  indicadores: z.array(esquemaIndicadorOrigemProtocolo),
  periodo: z.object({ desde: txt, ate: txt }),
  acoes: z.object({ incluir: z.boolean(), registrar: z.boolean(), motivo: txt.nullable() }),
  lidoEm: txt,
});
export type RelogioInternado = z.infer<typeof esquemaRelogioInternado>;
