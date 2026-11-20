// Comunicação interna do M27 (ficha, seções 6 e 7; regras 6 a 8): mensagens entre usuários, perfis, setores e
// unidades; comunicados com vigência e ciência obrigatória; a central de avisos (sino); as mensagens do sistema
// anterior (só consulta, `TBMENSAG`, parada desde 2024); e o dicionário ortográfico pessoal (`TBDICIONARIO_TBUSERS`,
// o mesmo nos dois sistemas). Regra 7 (cap-08 §8.13): a mensagem não carrega dado clínico no texto; o paciente entra
// só como link de contexto (o atendimento), que abre pela autorização normal; o conteúdo nunca vai para a trilha.
import { z } from 'zod';
import { esquemaLogin } from '../acesso/entrada.js';
import { problemasCp1252, textoCp1252 } from '../texto-cp1252.js';
import { TAMANHO_PALAVRA_DICIONARIO } from '../texto/fonetica.js';

// ── Mensagens e comunicados ──────────────────────────────────────────────────────────────────────────────

/** Para quem: um usuário (login), os usuários de um grupo do legado (perfil), de um setor ou de uma unidade. */
export const TIPOS_DESTINO_MENSAGEM = ['usuario', 'grupo', 'setor', 'unidade'] as const;
export type TipoDestinoMensagem = (typeof TIPOS_DESTINO_MENSAGEM)[number];

/** Teto de destinatários de uma mensagem depois de expandir grupos, setores e unidades. */
export const TETO_DESTINATARIOS = 2000;
export const TAMANHO_ASSUNTO = 120;
export const TAMANHO_TEXTO_MENSAGEM = 2000;

/**
 * Regra 7: sinais de dado clínico ou de identificação no texto (CPF, CNS, número de prontuário ou de atendimento
 * escrito por extenso). A mensagem é recusada e a tela pede o link de contexto no lugar.
 */
const SINAIS_DADO_PESSOAL: readonly { padrao: RegExp; motivo: string }[] = [
  { padrao: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/, motivo: 'um CPF' },
  { padrao: /\b\d{15}\b/, motivo: 'um cartão do SUS' },
  {
    padrao: /\b(prontu[aá]rio|pront\.?|atendimento|reg\.?|registro)\s*(n[ºo°.]?\s*)?:?\s*\d{3,}/i,
    motivo: 'um número de prontuário ou de atendimento',
  },
];

/** O que no texto parece dado do paciente (vazio: nada). */
export function dadoPessoalNoTexto(texto: string): string | null {
  for (const s of SINAIS_DADO_PESSOAL) if (s.padrao.test(texto)) return s.motivo;
  return null;
}

const textoMensagem = textoCp1252(TAMANHO_TEXTO_MENSAGEM)
  .pipe(z.string().trim().min(1, 'Escreva a mensagem.'))
  .superRefine((t, ctx) => {
    const m = dadoPessoalNoTexto(t);
    if (m)
      ctx.addIssue({
        code: 'custom',
        message: `O texto parece ter ${m}. Não escreva dado do paciente na mensagem: use o campo "Paciente (contexto)".`,
      });
  });

export const esquemaDestinoMensagem = z.object({
  tipo: z.enum(TIPOS_DESTINO_MENSAGEM),
  /** Login, nome do grupo, sigla do setor (bloco) ou código da unidade. */
  valor: textoCp1252(31).pipe(z.string().trim().min(1)),
});
export type DestinoMensagem = z.infer<typeof esquemaDestinoMensagem>;

/** POST /api/acesso/mensagens. */
export const esquemaEnviarMensagem = z.object({
  assunto: textoCp1252(TAMANHO_ASSUNTO).pipe(z.string().trim().min(1, 'Informe o assunto.')),
  texto: textoMensagem,
  destinos: z.array(esquemaDestinoMensagem).min(1, 'Escolha ao menos um destinatário.').max(20),
  cienciaObrigatoria: z.boolean().default(false),
  /** Link de contexto: o atendimento (ATCABECATEND.ID); abre pela autorização normal do prontuário. */
  contextoAtendimento: z.number().int().positive().nullable().default(null),
});
export type EnviarMensagem = z.infer<typeof esquemaEnviarMensagem>;

const dataHora = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, 'Data e hora inválidas.');

/** POST /api/acesso/comunicados (gestor): com vigência; a ciência obrigatória é opcional. */
export const esquemaPublicarComunicado = z
  .object({
    assunto: textoCp1252(TAMANHO_ASSUNTO).pipe(z.string().trim().min(1, 'Informe o assunto.')),
    texto: textoMensagem,
    destinos: z.array(esquemaDestinoMensagem).min(1).max(20),
    cienciaObrigatoria: z.boolean().default(true),
    vigenciaInicio: dataHora,
    vigenciaFim: dataHora,
  })
  .refine((c) => c.vigenciaFim > c.vigenciaInicio, {
    message: 'O fim da vigência tem de ser depois do início.',
    path: ['vigenciaFim'],
  });
export type PublicarComunicado = z.infer<typeof esquemaPublicarComunicado>;

// W0-09: o ciclo de vida do comunicado. Toda ação pede o motivo (vai ao evento do comunicado; a trilha leva só o evento).
const motivoComunicado = textoCp1252(200).pipe(
  z.string().trim().min(5, 'Informe o motivo (ao menos 5 caracteres).'),
);
/** Corrige o texto ainda não lido por ninguém (lido ou com ciência: 409; corrigir é encerrar e publicar outro). */
export const esquemaCorrigirComunicado = z
  .object({
    assunto: textoCp1252(TAMANHO_ASSUNTO).pipe(z.string().trim().min(1, 'Informe o assunto.')),
    texto: textoMensagem,
    motivo: motivoComunicado,
  })
  .strict();
export type CorrigirComunicado = z.infer<typeof esquemaCorrigirComunicado>;
/** Encurta a vigência (nunca estende). */
export const esquemaVigenciaComunicado = z
  .object({ vigenciaFim: dataHora, motivo: motivoComunicado })
  .strict();
export type VigenciaComunicado = z.infer<typeof esquemaVigenciaComunicado>;
/** Encerra com o motivo; o comunicado e as ciências continuam visíveis. */
export const esquemaEncerrarComunicado = z.object({ motivo: motivoComunicado }).strict();
export type EncerrarComunicado = z.infer<typeof esquemaEncerrarComunicado>;

export const EVENTOS_COMUNICADO = ['correcao', 'vigencia', 'encerramento'] as const;
export type EventoComunicado = (typeof EVENTOS_COMUNICADO)[number];

/** O comunicado por inteiro, para quem publica: texto, vigência, destinatários com a ciência e os eventos. */
export interface ComunicadoDetalhe {
  readonly id: number;
  readonly remetente: string;
  readonly assunto: string;
  readonly texto: string;
  readonly cienciaObrigatoria: boolean;
  readonly publicadoEm: string;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string;
  readonly encerradoEm: string | null;
  readonly encerradoPor: string | null;
  readonly motivoEncerramento: string | null;
  readonly destinatarios: readonly {
    readonly login: string;
    readonly via: string;
    readonly lidaEm: string | null;
    readonly cienciaEm: string | null;
  }[];
  readonly eventos: readonly {
    readonly evento: EventoComunicado;
    readonly antes: string | null;
    readonly motivo: string;
    readonly por: string;
    readonly em: string;
  }[];
  /** O texto só se corrige enquanto ninguém leu (nem deu ciência) e o comunicado não está encerrado. */
  readonly podeCorrigir: boolean;
}

export const TIPOS_MENSAGEM = ['mensagem', 'comunicado'] as const;
export type TipoMensagem = (typeof TIPOS_MENSAGEM)[number];

export interface MensagemRecebida {
  readonly id: number;
  readonly tipo: TipoMensagem;
  readonly assunto: string;
  readonly texto: string;
  readonly remetente: string;
  readonly enviadaEm: string;
  readonly cienciaObrigatoria: boolean;
  readonly lidaEm: string | null;
  readonly cienciaEm: string | null;
  /** O atendimento de contexto (o link abre o prontuário pela autorização normal). */
  readonly contextoAtendimento: number | null;
  /** O paciente desse atendimento (só o identificador, para o link do prontuário). */
  readonly contextoPaciente: number | null;
  readonly vigenciaInicio: string | null;
  readonly vigenciaFim: string | null;
  /** Por onde chegou ("usuario", "grupo MEDICOS", "setor UTI", "unidade 1"). */
  readonly via: string;
  /** W0-09: o comunicado encerrado continua visível a quem já o leu, com o motivo. */
  readonly encerradoEm: string | null;
  readonly motivoEncerramento: string | null;
}

export interface MensagemEnviada {
  readonly id: number;
  readonly tipo: TipoMensagem;
  readonly assunto: string;
  readonly enviadaEm: string;
  readonly destinatarios: number;
  readonly lidas: number;
  readonly ciencias: number;
  readonly cienciaObrigatoria: boolean;
  readonly vigenciaInicio: string | null;
  readonly vigenciaFim: string | null;
  readonly encerradoEm: string | null;
}

export interface CaixaMensagens {
  readonly recebidas: readonly MensagemRecebida[];
  readonly enviadas: readonly MensagemEnviada[];
  readonly naoLidas: number;
  readonly cienciasPendentes: number;
  readonly teto: number;
}

/** Mensagem do sistema anterior (TBMENSAG; só consulta; 98 linhas de 2020 a 2024 na cópia `pc`). */
export interface MensagemAnterior {
  readonly sequencia: number;
  readonly origem: string | null;
  readonly texto: string;
  readonly enviadaEm: string | null;
  readonly lidaEm: string | null;
}

// ── Central de avisos (sino) ─────────────────────────────────────────────────────────────────────────────

export const ESTADOS_AVISO = ['novo', 'lido', 'resolvido'] as const;
export type EstadoAviso = (typeof ESTADOS_AVISO)[number];

/** grave: interrompe (alergia, dose acima do limite, paciente errado; regra 6); os demais vão para a central. */
export const GRAVIDADES_AVISO = ['grave', 'atencao', 'informacao'] as const;
export type GravidadeAviso = (typeof GRAVIDADES_AVISO)[number];

/** Tipos de aviso que interrompem o trabalho (higiene de alertas, cap-03 §3.2; regra 6). */
export const TIPOS_AVISO_GRAVE = ['alergia', 'dose-acima-do-limite', 'paciente-errado'] as const;

export interface Aviso {
  readonly id: number;
  readonly tipo: string;
  readonly gravidade: GravidadeAviso;
  readonly modulo: string;
  readonly titulo: string;
  /** Rota da tela que resolve (sem dado do paciente na rota além do identificador). */
  readonly link: string | null;
  readonly estado: EstadoAviso;
  readonly criadoEm: string;
}

export interface CentralAvisos {
  readonly avisos: readonly Aviso[];
  readonly novos: number;
  /** Versão vista (o canal de eventos avisa uma nova; o cliente relê). */
  readonly versao: number;
}

/** Aviso emitido por um módulo (público na API: `CentralAvisos.emitir`). */
export const esquemaNovoAviso = z.object({
  login: esquemaLogin,
  tipo: z.string().regex(/^[a-z][a-z0-9-]{1,29}$/),
  gravidade: z.enum(GRAVIDADES_AVISO),
  modulo: z.string().regex(/^[a-z]{2,20}$/),
  evento: z.string().regex(/^[a-z]+\.[a-zA-Z]+\.[a-zA-Z]+$/),
  titulo: textoCp1252(120).pipe(z.string().trim().min(1)),
  link: z
    .string()
    .max(200)
    .regex(/^\/[A-Za-z0-9/_?=&.-]*$/)
    .nullable(),
  objetoTabela: z.string().max(31).nullable(),
  objetoChave: z.string().max(80),
});
export type NovoAviso = z.infer<typeof esquemaNovoAviso>;

// ── Dicionário ortográfico pessoal (TBDICIONARIO_TBUSERS) ────────────────────────────────────────────────────

/** Teto de palavras de um usuário (ficha, seção 4: 1.000 palavras). */
export const TETO_DICIONARIO = 1000;

/** Palavra do dicionário: uma palavra só (letras, hífen e apóstrofo), até 50 caracteres do CP1252. */
export const esquemaPalavraDicionario = z.object({
  palavra: textoCp1252(TAMANHO_PALAVRA_DICIONARIO)
    .pipe(z.string().trim().min(1, 'Informe a palavra.'))
    .refine((p) => /^[\p{L}][\p{L}'-]*$/u.test(p), {
      message: 'Uma palavra só, com letras (hífen e apóstrofo valem).',
    })
    .refine((p) => problemasCp1252(p).length === 0, { message: 'A palavra tem caractere não aceito.' }),
});
export type PalavraDicionario = z.infer<typeof esquemaPalavraDicionario>;

export interface DicionarioPessoal {
  readonly palavras: readonly { palavra: string; fonetica: string }[];
  readonly teto: number;
  /** A inclusão e a exclusão gravam no banco dos dois sistemas (receitas liberadas, ou o motivo). */
  readonly gravacao: { readonly incluir: string | null; readonly excluir: string | null };
}
