// Notificação por regra (01-ADM L76): leitura do painel e do histórico, gravações pela API.
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const P = '/api/administracao/notificacao-regras';

export const esquemaPainelNotificacao = z.object({
  regras: z.array(
    z.object({
      id: z.number(),
      versao: z.number(),
      codigo: z.string(),
      nome: z.string(),
      cenario: z.string(),
      mensagem: z.string(),
      gravidade: z.string(),
      repeticao: z.string(),
      ativo: z.boolean(),
      editavel: z.boolean(),
      consolidacao: z.string().nullable(),
      numeroVersao: z.number(),
      vigenciaInicio: z.string().nullable(),
      vigenciaFim: z.string().nullable(),
      notifica: z.object({
        tela: z.boolean(),
        email: z.boolean(),
        sms: z.boolean(),
        aplicativo: z.boolean(),
      }),
      destinatarios: z.array(z.object({ tipo: z.string(), codigo: z.string() })),
      // 01-ADM L75: a regra inteira (a tela regrava o que leu).
      descricao: z.string().nullable().default(null),
      bloqueante: z.boolean().default(false),
      exigeJustificativa: z.boolean().default(false),
      sexo: z.string().default('todos'),
      idadeMinima: z.number().nullable().default(null),
      idadeMaxima: z.number().nullable().default(null),
      intervaloMinutos: z.number().nullable().default(null),
      global: z.boolean().default(false),
      conteudoEditavel: z.boolean().default(true),
    }),
  ),
  perfis: z.array(z.object({ codigo: z.string(), nome: z.string() })).default([]),
  consolidacoes: z.array(
    z.object({
      id: z.number(),
      versao: z.number(),
      codigo: z.string(),
      nome: z.string(),
      janelaMinutos: z.number(),
      campos: z.array(z.string()),
      limitePorUsuario: z.number().nullable(),
      periodoLimiteMinutos: z.number().nullable(),
      horarioResumo: z.string().nullable(),
      formato: z.string(),
      ativo: z.boolean(),
    }),
  ),
  cenarios: z.array(z.object({ codigo: z.string(), descricao: z.string() })),
  canais: z.array(
    z.object({ codigo: z.string(), descricao: z.string(), tipo: z.string(), externo: z.boolean() }),
  ),
});
export type PainelNotificacao = z.infer<typeof esquemaPainelNotificacao>;

const esquemaEnvio = z.object({
  id: z.number(),
  versao: z.number(),
  usuario: z.string(),
  canal: z.string(),
  consolidacao: z.string().nullable(),
  quantidadeAvisos: z.number(),
  avisos: z.array(z.number()),
  situacao: z.string(),
  tentativas: z.number(),
  ocorridoEm: z.string().nullable(),
  enviadoEm: z.string().nullable(),
  entregueEm: z.string().nullable(),
  lidoEm: z.string().nullable(),
  erro: z.string().nullable(),
});
export type EnvioNotificacao = z.infer<typeof esquemaEnvio>;
export const esquemaHistorico = z.object({
  envios: z.array(esquemaEnvio),
  medicao: z.array(
    z.object({
      canal: z.string(),
      envios: z.number(),
      avisos: z.number(),
      lidos: z.number(),
      falhas: z.number(),
      aguardando: z.number(),
      taxaLeituraPercentual: z.number().nullable(),
      medianaMinutosAteLeitura: z.number().nullable(),
    }),
  ),
});
export type HistoricoNotificacao = z.infer<typeof esquemaHistorico>;
const esquemaResultado = z.object({ resultado: z.record(z.string(), z.unknown()), repetida: z.boolean() });

async function json<T>(r: Response, e: z.ZodType<T>): Promise<T> {
  if (!r.ok) throw await erroDaResposta(r);
  return e.parse(await r.json());
}
const ler = async <T>(url: string, e: z.ZodType<T>) =>
  json(await fetch(url, { headers: { accept: 'application/json' } }), e);
const postar = async (url: string, corpo: unknown, chave: string) =>
  json(
    await fetch(url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-csrf': tokenCsrf(),
        'idempotency-key': chave,
      },
      body: JSON.stringify(corpo),
    }),
    esquemaResultado,
  );

export const lerPainelNotificacao = () => ler(P, esquemaPainelNotificacao);
export const lerHistoricoNotificacao = (canal?: string) =>
  ler(`${P}/envios${canal ? `?canal=${encodeURIComponent(canal)}` : ''}`, esquemaHistorico);
export const gravarRegraAlerta = (corpo: Record<string, unknown>, chave: string) =>
  postar(`${P}/regras-alerta`, corpo, chave);
export const gravarConsolidacao = (corpo: Record<string, unknown>, chave: string) =>
  postar(`${P}/consolidacoes`, corpo, chave);
export const consolidarCanal = (canal: string, chave: string) => postar(`${P}/consolidar`, { canal }, chave);
export const lerMeusEnvios = () =>
  ler('/api/acesso/notificacoes/meus-envios', z.object({ envios: z.array(esquemaEnvio) }));
export const responderEnvio = (envio: number, versao: number, resolver: boolean, chave: string) =>
  postar(`/api/acesso/notificacoes/meus-envios/${envio}/resposta`, { versao, resolver }, chave);
