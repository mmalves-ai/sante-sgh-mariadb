// E-mail do sistema (01-ADM L77): leitura do painel (servidores, modelos, finalidades e registro de envio) e
// gravações pela API. A senha do servidor nunca trafega: só a referência dela no cofre.
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const P = '/api/administracao/email';

const esquemaServidor = z.object({
  id: z.number(),
  versao: z.number(),
  todosEstabelecimentos: z.boolean(),
  finalidade: z.string().nullable(),
  codigo: z.string(),
  nome: z.string(),
  host: z.string(),
  porta: z.number(),
  seguranca: z.string(),
  exigeAutenticacao: z.boolean(),
  usuarioAutenticacao: z.string().nullable(),
  referenciaCofre: z.string().nullable(),
  remetenteEmail: z.string(),
  remetenteNome: z.string().nullable(),
  responderPara: z.string().nullable(),
  copiaRemetente: z.boolean(),
  tempoLimiteSegundos: z.number(),
  limiteEnvioHora: z.number().nullable(),
  padrao: z.boolean(),
  ativo: z.boolean(),
  ultimoTesteEm: z.string().nullable(),
  ultimoTesteSucesso: z.boolean().nullable(),
});
export type ServidorEmailTela = z.infer<typeof esquemaServidor>;

const esquemaModelo = z.object({
  id: z.number(),
  versao: z.number(),
  todosEstabelecimentos: z.boolean(),
  finalidade: z.string(),
  codigo: z.string(),
  nome: z.string(),
  assunto: z.string(),
  corpoHtml: z.string(),
  corpoTexto: z.string().nullable(),
  remetenteNome: z.string().nullable(),
  remetenteEmail: z.string().nullable(),
  responderPara: z.string().nullable(),
  enviaSms: z.boolean(),
  textoSms: z.string().nullable(),
  vigenciaInicio: z.string().nullable(),
  vigenciaFim: z.string().nullable(),
  ativo: z.boolean(),
  campos: z.array(z.object({ marcador: z.string(), descricao: z.string(), exemplo: z.string().nullable() })),
});
export type ModeloEmailTela = z.infer<typeof esquemaModelo>;

export const esquemaPainelEmail = z.object({
  saidaDeTeste: z.boolean(),
  finalidades: z.array(z.object({ codigo: z.string(), descricao: z.string() })),
  servidores: z.array(esquemaServidor),
  modelos: z.array(esquemaModelo),
  envios: z.array(
    z.object({
      id: z.number(),
      ocorridoEm: z.string().nullable(),
      finalidade: z.string().nullable(),
      modelo: z.string().nullable(),
      assunto: z.string(),
      situacao: z.string(),
      tentativas: z.number(),
      enviadoEm: z.string().nullable(),
      identificadorMensagem: z.string().nullable(),
      erro: z.string().nullable(),
      destinatarios: z.array(z.object({ tipo: z.string(), email: z.string(), situacao: z.string() })),
    }),
  ),
});
export type PainelEmail = z.infer<typeof esquemaPainelEmail>;

async function json<T>(r: Response, e: z.ZodType<T>): Promise<T> {
  if (!r.ok) throw await erroDaResposta(r);
  return e.parse(await r.json());
}
const gravar = async <T>(caminho: string, corpo: unknown, chave: string, e: z.ZodType<T>) =>
  json(
    await fetch(`${P}${caminho}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-csrf': tokenCsrf(),
        'idempotency-key': chave,
      },
      body: JSON.stringify(corpo),
    }),
    e,
  );

export const lerPainelEmail = async () =>
  json(await fetch(P, { headers: { accept: 'application/json' } }), esquemaPainelEmail);

export interface ServidorEmailEnvio {
  id?: number;
  versao?: number;
  todosEstabelecimentos: boolean;
  finalidade: string | null;
  codigo: string;
  nome: string;
  host: string;
  porta: number;
  seguranca: string;
  exigeAutenticacao: boolean;
  usuarioAutenticacao: string | null;
  referenciaCofre: string | null;
  remetenteEmail: string;
  remetenteNome: string | null;
  responderPara: string | null;
  copiaRemetente: boolean;
  tempoLimiteSegundos: number;
  limiteEnvioHora: number | null;
  padrao: boolean;
  ativo: boolean;
}
export const gravarServidorEmail = (s: ServidorEmailEnvio, chave: string) =>
  gravar('/servidores', s, chave, z.object({ resultado: z.object({ servidor: z.number() }) }));

export const testarServidorEmail = (servidor: number, chave: string) =>
  gravar(
    `/servidores/${servidor}/teste`,
    {},
    chave,
    z.object({ resultado: z.object({ servidor: z.number(), sucesso: z.boolean(), detalhe: z.string() }) }),
  );

export interface ModeloEmailEnvio {
  id?: number;
  versao?: number;
  todosEstabelecimentos: boolean;
  finalidade: string;
  codigo: string;
  nome: string;
  assunto: string;
  corpoHtml: string;
  corpoTexto: string | null;
  remetenteNome: string | null;
  remetenteEmail: string | null;
  responderPara: string | null;
  enviaSms: boolean;
  textoSms: string | null;
  vigenciaInicio: string | null;
  vigenciaFim: string | null;
  ativo: boolean;
  campos: { marcador: string; descricao: string; exemplo: string | null }[];
}
export const gravarModeloEmail = (m: ModeloEmailEnvio, chave: string) =>
  gravar('/modelos', m, chave, z.object({ resultado: z.object({ modelo: z.number(), campos: z.number() }) }));
