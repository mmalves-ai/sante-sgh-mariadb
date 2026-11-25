// 02-REC linha 33: cliente do cadastro da estrutura da recepção (pontos de recepção, guichês e serviços de senha),
// validado pelos contratos. As gravações vão com o CSRF; a recusa de negócio chega como Problem Details (ErroApi).
import {
  esquemaEstruturaGravada,
  esquemaEstruturaRecepcao,
  type EstruturaGravada,
  type EstruturaRecepcao,
} from '@sgh/contratos';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const R = '/api/recepcao/estrutura';
const JSON_ACEITO = { accept: 'application/json' };

/** `soServicos`: a leitura de quem cuida só dos serviços de senha (permissão do gerador). */
export async function lerEstrutura(soServicos = false): Promise<EstruturaRecepcao> {
  const r = await fetch(soServicos ? `${R}/servicos` : R, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return esquemaEstruturaRecepcao.parse(await r.json());
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

export type ItemEstrutura = 'ponto' | 'guiche' | 'servico';
const PLURAL: Readonly<Record<ItemEstrutura, string>> = {
  ponto: 'pontos',
  guiche: 'guiches',
  servico: 'servicos',
};

/** Inclui a recepção (sem ponto) ou o guichê e o serviço dentro de uma recepção. */
export const incluirNaEstrutura = (item: ItemEstrutura, ponto: number | null, corpo: unknown) =>
  enviar(item === 'ponto' ? '/pontos' : `/pontos/${ponto}/${PLURAL[item]}`, corpo, 'POST');
export const alterarNaEstrutura = (item: ItemEstrutura, id: number, corpo: unknown) =>
  enviar(`/${PLURAL[item]}/${id}`, corpo, 'PUT');
/** Desativa (com motivo) ou reativa; nada é apagado. */
export const situacaoNaEstrutura = (
  item: ItemEstrutura,
  id: number,
  corpo: { ativo: boolean; motivo: string | null; versao: number },
) => enviar(`/${PLURAL[item]}/${id}/situacao`, corpo, 'POST');
