// Campos do cadastro do paciente que faltam para abrir o atendimento no escopo da tela (F3.1, 02-CAD linha 2):
// GET /api/cadastros/pacientes/:id/campos-pendentes?modulo=&tipoAtendimento=&fontePagadora=&local=&senha=&marcacao=. A
// mesma regra é
// conferida pelo servidor na gravação da abertura; aqui a tela avisa na hora, antes de a pessoa preencher a ficha
// inteira. Com a origem da abertura (o local de atendimento, a senha chamada ou a marcação da agenda; sem nenhuma, o
// canal de entrada e o guichê da sessão), o servidor resolve o módulo de recepção como na gravação e o devolve em
// `modulo`, para o atalho da ficha levar o mesmo escopo.
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
  /** O módulo de recepção que o servidor aplicou (o da origem da abertura, ou o informado). */
  readonly modulo: number | null;
}

/** De onde a abertura vem: o local em que a recepção abre, a senha chamada e a marcação da agenda. */
export interface OrigemDaAbertura {
  readonly local?: number | null;
  readonly senha?: number | null;
  readonly marcacao?: number | null;
}

export async function lerCamposPendentes(
  paciente: number,
  escopo: EscopoRegraCampo,
  origem: number | null | OrigemDaAbertura = null,
  buscar: typeof fetch = fetch,
): Promise<CamposPendentes> {
  const q = new URLSearchParams(consultaDoEscopo(escopo).slice(1));
  const o: OrigemDaAbertura = typeof origem === 'number' || origem === null ? { local: origem } : origem;
  for (const chave of ['local', 'senha', 'marcacao'] as const) {
    const v = o[chave];
    if (typeof v === 'number' && Number.isInteger(v) && v > 0) q.set(chave, String(v));
  }
  const consulta = q.toString();
  const r = await buscar(
    `/api/cadastros/pacientes/${paciente}/campos-pendentes${consulta ? `?${consulta}` : ''}`,
    { headers: { accept: 'application/json' } },
  );
  if (!r.ok) throw await erroDaResposta(r);
  const d = esquema.parse(await r.json());
  return { pendentes: d.pendentes, modulo: d.modulo ?? escopo.modulo };
}
