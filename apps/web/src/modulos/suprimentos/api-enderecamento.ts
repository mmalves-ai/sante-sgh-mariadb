// Cliente do endereçamento do armazém e da reserva para a separação (F8, 05-SUP linha 4). As gravações levam o CSRF e
// a Idempotency-Key (o mesmo pedido reenviado não grava duas vezes); a recusa volta como problema com os campos.
import type { TipoNivelEndereco } from '@sgh/contratos/regras-suprimentos';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const B = '/api/suprimentos/enderecamento';

export interface OpcaoEnderecamento {
  readonly id: number;
  readonly codigo: string;
  readonly nome: string;
}
export interface ItemNoEndereco {
  readonly vinculo: number;
  readonly versao: number;
  readonly insumo: number;
  readonly codigo: string;
  readonly nome: string;
  readonly preferencial: boolean;
  readonly quantidadeMaxima: number | null;
}
export interface EnderecoArmazem {
  readonly id: number;
  readonly versao: number;
  readonly superior: number | null;
  readonly nivel: number;
  readonly tipoNivel: TipoNivelEndereco;
  readonly codigo: string;
  readonly codigoCompleto: string;
  readonly descricao: string | null;
  readonly capacidade: number | null;
  readonly bloqueado: boolean;
  readonly ativo: boolean;
  readonly itens: readonly ItemNoEndereco[];
}
export interface FichaEnderecamento {
  readonly local: OpcaoEnderecamento;
  readonly enderecos: readonly EnderecoArmazem[];
}
export interface ReservaDaRequisicao {
  readonly id: number;
  readonly itemRequisicao: number;
  readonly insumo: number;
  readonly nome: string;
  readonly lote: string | null;
  readonly validade: string | null;
  readonly endereco: string | null;
  readonly reservada: number;
  readonly atendida: number;
  readonly liberada: number;
  readonly situacao: 'ativa' | 'atendida' | 'liberada' | 'expirada';
}
export interface ResultadoReserva {
  readonly id: number;
  readonly reservas: number;
  readonly faltas: readonly {
    readonly itemRequisicao: number;
    readonly insumo: number;
    readonly falta: number;
  }[];
}

let sequencia = 0;
const chave = (rotulo: string) =>
  `c1118.${rotulo}.${Date.now().toString(36)}.${(sequencia++).toString(36)}.${
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 12) ??
    Math.random().toString(36).slice(2, 12)
  }`.slice(0, 80);

async function ler<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}
async function enviar<T>(
  metodo: 'POST' | 'PUT',
  url: string,
  rotulo: string,
  corpo: unknown = {},
): Promise<T> {
  const r = await fetch(url, {
    method: metodo,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chave(rotulo),
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

export const locaisEnderecamento = () => ler<OpcaoEnderecamento[]>(`${B}/locais`);
export const buscarItensEnderecamento = (termo: string) =>
  ler<OpcaoEnderecamento[]>(`${B}/itens?termo=${encodeURIComponent(termo)}`);
export const fichaEnderecamento = (local: number) => ler<FichaEnderecamento>(`${B}/locais/${local}`);
export const criarEndereco = (e: {
  local: number;
  superior: number | null;
  tipoNivel: TipoNivelEndereco;
  codigo: string;
  descricao: string | null;
  capacidade: number | null;
}) => enviar<{ id: number }>('POST', `${B}/enderecos`, 'criar', e);
export const alterarEndereco = (
  id: number,
  e: {
    versao: number;
    descricao: string | null;
    capacidade: number | null;
    bloqueado: boolean;
    ativo: boolean;
  },
) => enviar<{ id: number }>('PUT', `${B}/enderecos/${id}`, 'alterar', e);
export const vincularItemEndereco = (
  endereco: number,
  e: { insumo: number; preferencial: boolean; quantidadeMaxima: number | null },
) => enviar<{ id: number }>('POST', `${B}/enderecos/${endereco}/itens`, 'vincular', e);
export const tornarPreferencial = (vinculo: number) =>
  enviar<{ id: number }>('POST', `${B}/vinculos/${vinculo}/preferencial`, 'preferencial');
export const retirarVinculo = (vinculo: number) =>
  enviar<{ id: number }>('POST', `${B}/vinculos/${vinculo}/retirar`, 'retirar');
export const reservasDaRequisicao = (requisicao: number) =>
  ler<ReservaDaRequisicao[]>(`${B}/requisicoes/${requisicao}/reservas`);
export const reservarSeparacao = (requisicao: number) =>
  enviar<ResultadoReserva>('POST', `${B}/requisicoes/${requisicao}/reservar`, 'reservar');
export const liberarReservaSeparacao = (requisicao: number) =>
  enviar<{ id: number; liberadas: number }>('POST', `${B}/requisicoes/${requisicao}/liberar`, 'liberar');
