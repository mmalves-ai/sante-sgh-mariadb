// A restrição clínica dos exames escolhidos no atendimento, vista na hora pela aba Exames do prontuário (05-SADT
// linha 5; nada gravado). O paciente vai na rota, para o filtro do paciente com acesso restrito e o vínculo
// assistencial valerem como nas demais rotas do prontuário; o atendimento vai no corpo e tem de ser desse paciente.
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import type { AvaliacaoRestricaoExame } from './api-documentos.js';

export async function avaliarRestricoesDoPaciente(
  paciente: number,
  e: { atendimento: number; exames: readonly number[]; confirmado: boolean; justificativa: string | null },
  buscar: typeof fetch = fetch,
): Promise<AvaliacaoRestricaoExame> {
  const r = await buscar(`/api/sadt/pedidos/avaliar-prontuario/${paciente}`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'x-csrf': tokenCsrf() },
    body: JSON.stringify(e),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as AvaliacaoRestricaoExame;
}
