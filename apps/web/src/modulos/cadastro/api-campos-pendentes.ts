// Campos do cadastro do paciente que faltam para abrir o atendimento no escopo da tela (F3.1, 02-CAD linha 2):
// GET /api/cadastros/pacientes/:id/campos-pendentes?modulo=&tipoAtendimento=&fontePagadora=&local=. A mesma regra é
// conferida pelo servidor na gravação da abertura; aqui a tela avisa na hora, antes de a pessoa preencher a ficha
// inteira. Com o local de atendimento (a senha chamada no guichê), o servidor resolve o módulo de recepção do local e
// o devolve em `modulo`, para o atalho da ficha levar o mesmo escopo.
import { z } from 'zod';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { consultaDoEscopo, type EscopoRegraCampo } from './escopo-regra-campo.js';

const esquema = z.object({
  pendentes: z.array(z.object({ campo: z.string(), rotulo: z.string() })),
  modulo: z.number().int().positive().nullable().optional(),
});
export type CampoPendente = z.infer<typeof esquema>['pendentes'][number];
export interface CamposPendentes {
  readonly pendentes: CampoPendente[];
  /** O módulo de recepção que o servidor aplicou (o do local, ou o informado). */
  readonly modulo: number | null;
}

export async function lerCamposPendentes(
  paciente: number,
  escopo: EscopoRegraCampo,
  local: number | null = null,
  buscar: typeof fetch = fetch,
): Promise<CamposPendentes> {
  const q = new URLSearchParams(consultaDoEscopo(escopo).slice(1));
  if (local !== null && local > 0) q.set('local', String(local));
  const consulta = q.toString();
  const r = await buscar(
    `/api/cadastros/pacientes/${paciente}/campos-pendentes${consulta ? `?${consulta}` : ''}`,
    { headers: { accept: 'application/json' } },
  );
  if (!r.ok) throw await erroDaResposta(r);
  const d = esquema.parse(await r.json());
  return { pendentes: d.pendentes, modulo: d.modulo ?? escopo.modulo };
}
