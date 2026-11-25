// 02-REC linha 33 (C2-005): cliente do cadastro dos locais de atendimento e dos encaminhamentos entre locais,
// validado pelos contratos. As gravações vão com o CSRF; a recusa de negócio chega como Problem Details (ErroApi).
import {
  esquemaEstruturaGravada,
  esquemaLocaisDaRecepcao,
  type EstruturaGravada,
  type LocaisDaRecepcao,
} from '@sgh/contratos';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const R = '/api/recepcao/locais';
const JSON_ACEITO = { accept: 'application/json' };

export async function lerLocais(): Promise<LocaisDaRecepcao> {
  const r = await fetch(R, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return esquemaLocaisDaRecepcao.parse(await r.json());
}

async function enviar(caminho: string, corpo: unknown, metodo: 'POST' | 'PUT'): Promise<EstruturaGravada> {
  const r = await fetch(`${R}${caminho}`, {
    method: metodo,
    headers: { ...JSON_ACEITO, 'content-type': 'application/json', 'x-csrf': tokenCsrf() },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return esquemaEstruturaGravada.parse(await r.json());
}

export const incluirLocal = (ponto: number, corpo: unknown) => enviar(`/pontos/${ponto}`, corpo, 'POST');
export const alterarLocal = (id: number, corpo: unknown) => enviar(`/${id}`, corpo, 'PUT');
export const gravarDestinos = (id: number, corpo: { destinos: number[]; versao: number }) =>
  enviar(`/${id}/destinos`, corpo, 'PUT');
/** Desativa (com motivo) ou reativa; nada é apagado. */
export const situacaoLocal = (id: number, corpo: { ativo: boolean; motivo: string | null; versao: number }) =>
  enviar(`/${id}/situacao`, corpo, 'POST');
