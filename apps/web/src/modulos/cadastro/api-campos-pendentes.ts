// Campos do cadastro do paciente que faltam para abrir o atendimento no escopo da tela (F3.1, 02-CAD linha 2):
// GET /api/cadastros/pacientes/:id/campos-pendentes?modulo=&tipoAtendimento=&fontePagadora=. A mesma regra é conferida
// pelo servidor na gravação da abertura; aqui a tela avisa na hora, antes de a pessoa preencher a ficha inteira.
import { z } from 'zod';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { consultaDoEscopo, type EscopoRegraCampo } from './escopo-regra-campo.js';

const esquema = z.object({ pendentes: z.array(z.object({ campo: z.string(), rotulo: z.string() })) });
export type CampoPendente = z.infer<typeof esquema>['pendentes'][number];

export async function lerCamposPendentes(
  paciente: number,
  escopo: EscopoRegraCampo,
  buscar: typeof fetch = fetch,
): Promise<CampoPendente[]> {
  const r = await buscar(`/api/cadastros/pacientes/${paciente}/campos-pendentes${consultaDoEscopo(escopo)}`, {
    headers: { accept: 'application/json' },
  });
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json()).pendentes;
}
