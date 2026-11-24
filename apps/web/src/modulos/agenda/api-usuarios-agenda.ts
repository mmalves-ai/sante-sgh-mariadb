// Lista nominal de usuários por agenda (02-AGE linha 40): leitura, busca de usuários e manutenção.
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const P = '/api/agenda/consultas';

export const esquemaListaUsuariosAgenda = z.object({
  agenda: z.number(),
  restrita: z.boolean(),
  usuarios: z.array(
    z.object({ usuario: z.number(), login: z.string(), nome: z.string(), podeMarcar: z.boolean() }),
  ),
  meuAcesso: z.enum(['livre', 'marca', 'consulta', 'gestor', 'sem-acesso']),
});
export type ListaUsuariosAgenda = z.infer<typeof esquemaListaUsuariosAgenda>;

const esquemaCandidatos = z.array(z.object({ usuario: z.number(), login: z.string(), nome: z.string() }));
const esquemaGravacao = z.object({ ok: z.boolean(), mensagem: z.string().optional() }).passthrough();

async function json<T>(r: Response, e: z.ZodType<T>): Promise<T> {
  if (!r.ok) throw await erroDaResposta(r);
  return e.parse(await r.json());
}

export const lerUsuariosAgenda = async (agenda: number) =>
  json(
    await fetch(`${P}/agendas/${agenda}/usuarios`, { headers: { accept: 'application/json' } }),
    esquemaListaUsuariosAgenda,
  );

export const buscarUsuarios = async (termo: string) =>
  json(
    await fetch(`${P}/usuarios-candidatos?termo=${encodeURIComponent(termo)}`, {
      headers: { accept: 'application/json' },
    }),
    esquemaCandidatos,
  );

export type MudancaUsuarioAgenda =
  | { acao: 'incluir' | 'alterar'; usuario: number; podeMarcar: boolean }
  | { acao: 'remover'; usuario: number }
  | { acao: 'liberarTodos' };

export const definirUsuarioAgenda = async (agenda: number, m: MudancaUsuarioAgenda, chave: string) =>
  json(
    await fetch(`${P}/agendas/${agenda}/usuarios`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-csrf': tokenCsrf(),
        'idempotency-key': chave,
      },
      body: JSON.stringify(m),
    }),
    esquemaGravacao,
  );
