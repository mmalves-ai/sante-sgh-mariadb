// Cliente do pedido de vaga do médico no prontuário (02-AGE linha 53):
// GET  /api/agenda/pedidos-vaga/paciente/:paciente  pedidos do paciente com os itens, opções e o solicitante
// POST /api/agenda/pedidos-vaga                     pedir a vaga (lista de espera com os procedimentos pedidos)
// A gravação leva a chave de idempotência e o x-csrf (como as demais do prontuário).
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { novaChave } from './api-registro.js';

const P = '/api/agenda/pedidos-vaga';
const JSON_ACEITO = { accept: 'application/json' };

const esquemaPedido = z.object({
  id: z.number(),
  situacao: z.string(),
  prioridade: z.string(),
  entradaEm: z.string().nullable(),
  prazoLimite: z.string().nullable(),
  especialidade: z.string().nullable(),
  agenda: z.string().nullable(),
  solicitante: z.string().nullable(),
  regulacao: z.string().nullable(),
  observacao: z.string().nullable(),
  itens: z.array(
    z.object({ sequencia: z.number(), descricao: z.string(), quantidade: z.number(), situacao: z.string() }),
  ),
});
export type PedidoVagaTela = z.infer<typeof esquemaPedido>;

export const esquemaPedidosVaga = z.object({
  pedidos: z.array(esquemaPedido),
  especialidades: z.array(z.object({ id: z.number(), nome: z.string() })),
  itens: z.array(z.object({ id: z.number(), nome: z.string(), tipo: z.string() })),
  solicitante: z.object({ id: z.number(), nome: z.string() }).nullable(),
});
export type PedidosVagaTela = z.infer<typeof esquemaPedidosVaga>;

export interface NovoPedidoVaga {
  readonly paciente: number;
  readonly especialidade: number | null;
  readonly prioridade: 'normal' | 'urgente';
  readonly prazoLimite: string | null;
  readonly observacao: string | null;
  readonly itens: readonly { itemAgendavel: number; quantidade: number }[];
}

export async function lerPedidosVaga(
  paciente: number,
  buscar: typeof fetch = fetch,
): Promise<PedidosVagaTela> {
  const r = await buscar(`${P}/paciente/${paciente}`, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return esquemaPedidosVaga.parse(await r.json());
}

export async function pedirVaga(corpo: NovoPedidoVaga, buscar: typeof fetch = fetch) {
  const r = await buscar(P, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': novaChave('agenda.pedidoVaga'),
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return z
    .object({ ok: z.boolean(), resultado: z.object({ id: z.number(), itens: z.number() }) })
    .passthrough()
    .parse(await r.json());
}
