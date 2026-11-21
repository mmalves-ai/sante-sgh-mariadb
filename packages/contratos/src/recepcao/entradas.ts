// Entradas das operações de gravação compatível da recepção (M19, ficha seção 5), validadas na tela, na API e no
// executor (o mesmo Zod). Vocabulário do produto: o gerador é o id do gerador de senha, a recepção o do ponto de
// recepção, o local o do local de atendimento e a senha o da senha emitida; o guichê é o número (1 a 99). A data e a hora vêm sempre
// do relógio do banco (nunca da tela).
import { z } from 'zod';
import { esquemaDataIso } from '../preco/entradas.js';
import { textoCp1252 } from '../texto-cp1252.js';
import {
  CODIGOS_EVENTO_SENHA,
  CODIGOS_MOTIVO_SUSPENSAO,
  GRUPOS_PRIORIDADE,
  ORDENS_FILA,
  ORIGENS_SENHA,
  PRIORIDADES_SENHA,
  TIPOS_CHEGADA,
  TIPOS_DISPOSITIVO,
} from './vocabulario.js';

const id = z.number().int().positive().max(2_147_483_647);
const smallint = z.number().int().positive().max(32_767);
export const esquemaGuiche = z.number().int().min(1).max(99);
const codigosPrioridade = PRIORIDADES_SENHA.map((p) => p.codigo) as ['0', '1', '2'];
const grupos = GRUPOS_PRIORIDADE.map((g) => g.grupo);
const complemento = textoCp1252(40)
  .overwrite((t) => t.replace(/\s+/g, ' ').trim())
  .nullable();

// ── recepcao.emitirSenha ─────────────────────────────────────────────────────────────────────────

/**
 * A senha nasce no gerador (o botão do totem ou do balcão). A prioridade gravada é 0/1/2; o grupo legal detalhado
 * (3 a 9) vai só ao novo. O totem informa o dispositivo (o usuário técnico dele vai à coluna de usuário).
 */
export const esquemaEmitirSenha = z
  .object({
    gerador: id,
    prioridade: z.enum(codigosPrioridade),
    grupo: z
      .number()
      .int()
      .refine((g) => grupos.includes(g as never), 'Grupo de prioridade inexistente.')
      .nullable()
      .optional(),
    origem: z.enum(ORIGENS_SENHA),
    dispositivo: id.nullable().optional(),
    /** Emite mesmo acima do limite diário do gerador (só no balcão, com a permissão de emitir). */
    forcarLimite: z.boolean().optional(),
  })
  .strict()
  .superRefine((e, ctx) => {
    if (e.grupo !== undefined && e.grupo !== null) {
      const g = GRUPOS_PRIORIDADE.find((x) => x.grupo === e.grupo);
      if (g && g.prioridade !== e.prioridade)
        ctx.addIssue({ code: 'custom', path: ['grupo'], message: 'O grupo não corresponde à prioridade.' });
    }
    if (e.origem === 'totem' && !e.dispositivo)
      ctx.addIssue({
        code: 'custom',
        path: ['dispositivo'],
        message: 'A senha do totem informa o dispositivo.',
      });
    if (e.origem === 'totem' && e.forcarLimite)
      ctx.addIssue({
        code: 'custom',
        path: ['forcarLimite'],
        message: 'O totem não passa do limite diário.',
      });
  });
export type EmitirSenhaEntrada = z.infer<typeof esquemaEmitirSenha>;

// ── recepcao.chamarSenha ─────────────────────────────────────────────────────────────────────────

/**
 * Chamar a próxima da fila do guichê (os geradores escolhidos, no dia, na ordem da fila) ou uma senha escolhida da
 * lista. A trava é sem espera: a senha ocupada por outro guichê (deste ou do outro sistema) passa à seguinte.
 */
export const esquemaChamarSenha = z
  .object({
    recepcao: smallint,
    local: smallint,
    guiche: esquemaGuiche,
    geradores: z.array(id).min(1).max(40),
    senha: id.nullable().optional(),
  })
  .strict();
export type ChamarSenhaEntrada = z.infer<typeof esquemaChamarSenha>;

// ── recepcao.registrarEventoSenha ────────────────────────────────────────────────────────────────

export const esquemaRegistrarEventoSenha = z
  .object({
    senha: id,
    evento: z.enum(CODIGOS_EVENTO_SENHA),
    /** Local onde o evento acontece (o do guichê aberto, ou o local de atendimento). */
    local: smallint,
    guiche: z.number().int().min(0).max(99),
    motivo: z.enum(CODIGOS_MOTIVO_SUSPENSAO).nullable().optional(),
    complemento: complemento.optional(),
    /** Destino do encaminhamento (só entre os locais permitidos). */
    destino: smallint.nullable().optional(),
  })
  .strict()
  .superRefine((e, ctx) => {
    if (e.evento === 'suspender' && !e.motivo)
      ctx.addIssue({ code: 'custom', path: ['motivo'], message: 'Informe o motivo da suspensão.' });
    if (e.evento === 'encaminhar' && !e.destino)
      ctx.addIssue({ code: 'custom', path: ['destino'], message: 'Informe o local de destino.' });
    if (e.evento !== 'encaminhar' && e.destino)
      ctx.addIssue({ code: 'custom', path: ['destino'], message: 'Só o encaminhamento tem destino.' });
    if (e.motivo === 'OUTRO' && !e.complemento)
      ctx.addIssue({ code: 'custom', path: ['complemento'], message: 'Descreva o motivo.' });
  });
export type RegistrarEventoSenhaEntrada = z.infer<typeof esquemaRegistrarEventoSenha>;

// ── recepcao.registrarChegada (check-in do agendado) ─────────────────────────────────────────────

export const esquemaRegistrarChegada = z
  .object({
    senha: id,
    tipo: z.enum(TIPOS_CHEGADA),
    /** Id da marcação (da agenda de consultas ou da agenda de exames). */
    marcacao: id,
  })
  .strict();
export type RegistrarChegadaEntrada = z.infer<typeof esquemaRegistrarChegada>;

// ── recepcao.desfazerChegada (chegada registrada por engano) ─────────────────────────────────────

/**
 * Desfazer a chegada é um fato novo com o motivo (trilha e evento da senha): o vínculo da senha com a marcação sai e
 * a marcação volta ao estado anterior à chegada. Recusado quando já há ficha de atendimento (quem a exclui é o
 * atendimento).
 */
export const esquemaDesfazerChegada = z
  .object({
    senha: id,
    motivo: textoCp1252(200)
      .overwrite((t) => t.replace(/\s+/g, ' ').trim())
      .refine((t) => t.length >= 10, 'Diga por que a chegada é desfeita (10 caracteres ou mais).'),
  })
  .strict();
export type DesfazerChegadaEntrada = z.infer<typeof esquemaDesfazerChegada>;

// ── recepcao.abrirGuiche / recepcao.fecharGuiche ────────────────────────────────────────────────

export const esquemaAbrirGuiche = z
  .object({ recepcao: smallint, local: smallint, guiche: esquemaGuiche })
  .strict();
export type AbrirGuicheEntrada = z.infer<typeof esquemaAbrirGuiche>;

export const esquemaFecharGuiche = z
  .object({
    recepcao: smallint,
    local: smallint,
    guiche: esquemaGuiche,
    /** Fechar o guichê de outra pessoa (supervisor: liberação de guichê bloqueado) exige a justificativa. */
    justificativa: textoCp1252(200)
      .overwrite((t) => t.replace(/\s+/g, ' ').trim())
      .nullable()
      .optional(),
  })
  .strict();
export type FecharGuicheEntrada = z.infer<typeof esquemaFecharGuiche>;

// ── Configuração só do novo (SGH_) ───────────────────────────────────────────────────────────────

/** Fila por gerador (SGH_REC_FILA_CFG): ordem de chamada, intercalação e tempo-alvo. */
export const esquemaFilaConfig = z
  .object({
    gerador: id,
    ordem: z.enum(ORDENS_FILA.map((o) => o.codigo) as ['prioridade', 'intercalada', 'chegada']),
    /** Na ordem intercalada: quantas prioritárias antes de uma normal (1 a 9). */
    intercalar: z.number().int().min(1).max(9),
    /** Tempo-alvo de espera da chegada à chamada, em minutos (0 = sem meta). */
    tempoAlvoMinutos: z.number().int().min(0).max(600),
    /** Rótulo do botão no totem (vazio = o nome do serviço). */
    rotuloTotem: textoCp1252(40)
      .overwrite((t) => t.replace(/\s+/g, ' ').trim())
      .nullable(),
    noTotem: z.boolean(),
  })
  .strict();
export type FilaConfigEntrada = z.infer<typeof esquemaFilaConfig>;

/** Dispositivo do perfil Painel/Totem (SGH_ACESSO_DISPOSITIVO): o token sai uma vez, na criação. */
export const esquemaDispositivo = z
  .object({
    tipo: z.enum(TIPOS_DISPOSITIVO),
    nome: textoCp1252(60).overwrite((t) => t.replace(/\s+/g, ' ').trim()),
    recepcao: smallint.nullable(),
    /** Locais que o painel mostra (vazio = todos os da recepção). */
    locais: z.array(smallint).max(40),
    /** Geradores que o totem oferece. */
    geradores: z.array(id).max(40),
    /** Painel de TV de setor (tipo paineltv): o que mostra (leitos ao vivo, higienização, bloco cirúrgico). */
    conteudo: z.enum(['leitos', 'higienizacao', 'bloco', 'pa']).nullable(),
    /** O painel do outro sistema que este substitui (a ordem do painel de TV de setor), só para o nome. */
    portalOrdem: z.number().int().min(0).max(99).nullable(),
    /** Usuário técnico do totem (o login do sistema que vai à coluna de usuário da senha). */
    usuarioLegado: textoCp1252(31).nullable(),
    /** Validade em dias (1 a 730). */
    validadeDias: z.number().int().min(1).max(730),
    voz: z.boolean(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.tipo === 'totem' && !d.usuarioLegado)
      ctx.addIssue({
        code: 'custom',
        path: ['usuarioLegado'],
        message: 'O totem precisa do usuário técnico.',
      });
    if (d.tipo === 'totem' && d.geradores.length === 0)
      ctx.addIssue({ code: 'custom', path: ['geradores'], message: 'Escolha os serviços do totem.' });
    if (d.tipo !== 'paineltv' && !d.recepcao)
      ctx.addIssue({ code: 'custom', path: ['recepcao'], message: 'Escolha a recepção.' });
    if (d.tipo === 'paineltv' && !d.conteudo)
      ctx.addIssue({ code: 'custom', path: ['conteudo'], message: 'Escolha o que o painel mostra.' });
  });
export type DispositivoEntrada = z.infer<typeof esquemaDispositivo>;

/**
 * W1-04: alteração do dispositivo (nome, conteúdo, locais, recepção, serviços do totem e voz) SEM reemitir o token: o
 * aparelho segue com o token que tem. Tipo, usuário técnico, validade e token não mudam aqui (renovar/revogar).
 * As regras que dependem do tipo são conferidas na rota com o tipo gravado (recusaCamposDispositivo).
 */
export const esquemaAlterarDispositivoRecepcao = z
  .object({
    nome: textoCp1252(60)
      .overwrite((t) => t.replace(/\s+/g, ' ').trim())
      .pipe(z.string().min(1, 'Informe o nome.')),
    recepcao: smallint.nullable(),
    locais: z.array(smallint).max(40),
    geradores: z.array(id).max(40),
    conteudo: z.enum(['leitos', 'higienizacao', 'bloco', 'pa']).nullable(),
    voz: z.boolean(),
  })
  .strict();
export type AlterarDispositivoRecepcaoEntrada = z.infer<typeof esquemaAlterarDispositivoRecepcao>;

/** Campos que dependem do tipo do dispositivo (as regras da criação): [campo, mensagem] ou null. */
export function recusaCamposDispositivo(
  tipo: string,
  d: {
    readonly recepcao: number | null;
    readonly geradores: readonly number[];
    readonly conteudo: string | null;
  },
): readonly [string, string] | null {
  if (tipo === 'totem' && d.geradores.length === 0) return ['geradores', 'Escolha os serviços do totem.'];
  if (tipo !== 'paineltv' && !d.recepcao) return ['recepcao', 'Escolha a recepção.'];
  if (tipo === 'paineltv' && !d.conteudo) return ['conteudo', 'Escolha o que o painel mostra.'];
  return null;
}

/**
 * M43 (regra 4; cap-08 §8.3): a TI confere no setor que o aparelho já mostra a tela com o token e registra o login de
 * TV ou de totem que ele substitui (um login do grupo de painéis). Depois disso o login pode ser bloqueado.
 */
export const esquemaConferirDispositivo = z
  .object({
    loginSubstituido: textoCp1252(31).pipe(z.string().trim().min(1, 'Escolha o login substituído.')),
  })
  .strict();
export type ConferirDispositivoEntrada = z.infer<typeof esquemaConferirDispositivo>;

/** Consulta dos indicadores da recepção (366 dias no máximo). */
export const esquemaConsultaIndicadoresRecepcao = z
  .object({ de: esquemaDataIso, ate: esquemaDataIso, recepcao: z.coerce.number().int().min(0).optional() })
  .strict();
export type ConsultaIndicadoresRecepcao = z.infer<typeof esquemaConsultaIndicadoresRecepcao>;

/** Busca dos agendados do dia para a chegada no guichê: CPF, prontuário e parte do nome da agenda (todos opcionais). */
export const esquemaConsultaAgendados = z
  .object({
    cpf: z
      .string()
      .regex(/^\d{11}$/)
      .optional(),
    prontuario: z.coerce.number().int().positive().max(2_147_483_647).optional(),
    agenda: z.string().trim().min(2).max(40).optional(),
  })
  .strict();
export type ConsultaAgendados = z.infer<typeof esquemaConsultaAgendados>;

/**
 * Check-in no totem: sempre o CPF (11 dígitos), que confirma de quem é o agendamento; o código do agendamento
 * (C consulta, E exame, com o número; o QR digita o código completo) só escolhe a marcação quando há mais de uma.
 * O código sozinho é um número sequencial e não identifica a pessoa: nunca basta.
 */
export const esquemaCheckinTotem = z
  .object({
    cpf: z.string().regex(/^\d{11}$/),
    codigo: z
      .string()
      .regex(/^[CE]\d{1,10}$/)
      .nullable()
      .optional(),
    gerador: id,
  })
  .strict();
export type CheckinTotemEntrada = z.infer<typeof esquemaCheckinTotem>;
