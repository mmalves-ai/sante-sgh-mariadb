// Cliente do painel da matriz de cobertura (M14), validado pelo contrato.
import { esquemaPainelMatriz, type PainelMatriz } from '@sgh/contratos';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

export async function buscarPainelMatriz(buscar: typeof fetch = fetch): Promise<PainelMatriz> {
  const r = await buscar('/api/administracao/coexistencia/matriz', {
    headers: { accept: 'application/json' },
  });
  if (!r.ok) throw await erroDaResposta(r);
  return esquemaPainelMatriz.parse(await r.json());
}
