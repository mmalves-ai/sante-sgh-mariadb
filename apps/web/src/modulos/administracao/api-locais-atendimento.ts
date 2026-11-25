// Manutenção dos locais de atendimento (02-REC linha 34): leitura da unidade e gravação por ação.
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const P = '/api/atendimento/locais';

const faixa = z.object({
  diaSemana: z.number().nullable(),
  diaNaoUtil: z.boolean(),
  inicio: z.string(),
  fim: z.string(),
});
export const esquemaLocaisDaUnidade = z.object({
  recepcoes: z.array(z.object({ id: z.number(), descricao: z.string() })),
  modulos: z.array(z.object({ id: z.number(), descricao: z.string() })),
  locais: z.array(
    z.object({
      id: z.number(),
      codigo: z.string(),
      descricao: z.string(),
      recepcao: z.number(),
      recepcaoDescricao: z.string(),
      moduloRecepcao: z.number().nullable(),
      permiteEncaminhamento: z.boolean(),
      ativo: z.boolean(),
      horario: z.array(faixa),
      encaminhaPara: z.array(z.number()),
      consulta: z.array(z.number()),
      usuarios: z.array(
        z.object({
          usuario: z.number(),
          login: z.string(),
          nome: z.string(),
          atuaNoLocal: z.boolean(),
          podeOperar: z.boolean(),
        }),
      ),
    }),
  ),
});
export type LocaisDaUnidade = z.infer<typeof esquemaLocaisDaUnidade>;
export type LocalAtendimento = LocaisDaUnidade['locais'][number];
export type FaixaLocal = z.infer<typeof faixa>;

const esquemaGravacao = z
  .object({
    ok: z.boolean(),
    mensagem: z.string().optional(),
    resultado: z.object({ local: z.number() }).passthrough(),
  })
  .passthrough();

async function json<T>(r: Response, e: z.ZodType<T>): Promise<T> {
  if (!r.ok) throw await erroDaResposta(r);
  return e.parse(await r.json());
}

export const lerLocaisAtendimento = async () =>
  json(await fetch(P, { headers: { accept: 'application/json' } }), esquemaLocaisDaUnidade);

export type AcaoLocal =
  | {
      acao: 'incluir';
      codigo: string;
      descricao: string;
      recepcao: number;
      permiteEncaminhamento: boolean;
      moduloRecepcao: number | null;
    }
  | {
      acao: 'dados';
      local: number;
      descricao: string;
      permiteEncaminhamento: boolean;
      ativo: boolean;
      moduloRecepcao: number | null;
    }
  | { acao: 'horario'; local: number; faixas: FaixaLocal[] }
  | { acao: 'encaminhamentos'; local: number; destinos: number[] }
  | { acao: 'visibilidade'; local: number; consultados: number[] }
  | {
      acao: 'usuarios';
      local: number;
      usuarios: { usuario: number; atuaNoLocal: boolean; podeOperar: boolean }[];
    };

export const manterLocalAtendimento = async (a: AcaoLocal, chave: string) =>
  json(
    await fetch(P, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-csrf': tokenCsrf(),
        'idempotency-key': chave,
      },
      body: JSON.stringify(a),
    }),
    esquemaGravacao,
  );

const esquemaCandidatos = z.array(z.object({ usuario: z.number(), login: z.string(), nome: z.string() }));
export const buscarUsuariosLocal = async (termo: string) =>
  json(
    await fetch(`${P}/usuarios-candidatos?termo=${encodeURIComponent(termo)}`, {
      headers: { accept: 'application/json' },
    }),
    esquemaCandidatos,
  );
