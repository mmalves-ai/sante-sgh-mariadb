// Cliente do romaneio de entrega entre unidades (C1-120, 09-AREA linha 77): o painel (romaneios, motoristas, veículos,
// transportadoras e transferências disponíveis), o detalhe com os itens e as gravações (cadastro do motorista e do
// veículo, montagem, expedição, conferência por item e cancelamento), com CSRF e Idempotency-Key.
import type {
  CategoriaHabilitacao,
  DesfechoItem,
  MotoristaEntrada,
  SituacaoItemRomaneio,
  SituacaoRomaneio,
  VeiculoEntrada,
} from '@sgh/contratos/regras-suprimentos';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { novaChaveM464 } from './api-consignado.js';

const R = '/api/suprimentos/romaneios';

export interface MotoristaTela {
  readonly id: number;
  readonly versao: number;
  readonly nome: string;
  readonly tipoVinculo: 'proprio' | 'terceiro';
  readonly transportadora: number | null;
  readonly numeroHabilitacao: string;
  readonly categorias: CategoriaHabilitacao[];
  readonly vencimentoHabilitacao: string;
  readonly habilitacaoVencida: boolean;
  readonly transportaControlado: boolean;
  readonly situacao: string;
  readonly motivoInativacao: string | null;
}

export interface VeiculoTela {
  readonly id: number;
  readonly versao: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly placa: string;
  readonly proprio: boolean;
  readonly transportadora: number | null;
  readonly refrigerado: boolean;
  readonly capacidadeCargaKg: number | null;
  readonly ativo: boolean;
  readonly motivoInativacao: string | null;
}

export interface TransferenciaDisponivelTela {
  readonly documento: number;
  readonly numero: string;
  readonly situacao: string;
  readonly movimentadoEm: string | null;
  readonly origem: string;
  readonly destino: string;
  readonly destinoUnidade: string;
  readonly itens: number;
  readonly controlado: boolean;
  readonly termolabil: boolean;
}

export interface RomaneioResumoTela {
  readonly id: number;
  readonly versao: number;
  readonly numero: number;
  readonly descricao: string | null;
  readonly situacao: SituacaoRomaneio;
  readonly saidaPrevistaEm: string | null;
  readonly saidaEm: string | null;
  readonly chegadaEm: string | null;
  readonly veiculo: string | null;
  readonly motorista: string | null;
  readonly transportadora: string | null;
  readonly valorFrete: number | null;
  readonly itens: number;
  readonly pendentes: number;
}

export interface ItemRomaneioTela {
  readonly id: number;
  readonly sequencia: number;
  readonly documento: number | null;
  readonly numeroDocumento: string | null;
  readonly situacaoDocumento: string | null;
  readonly destinoUnidade: string;
  readonly destinoLocal: string | null;
  readonly volumes: number;
  readonly situacao: SituacaoItemRomaneio;
  readonly recebedor: string | null;
  readonly entregueEm: string | null;
  readonly observacao: string | null;
}

export interface RomaneioDetalheTela extends RomaneioResumoTela {
  readonly veiculoId: number | null;
  readonly motoristaId: number | null;
  readonly transportadoraId: number | null;
  readonly quilometragemSaida: number | null;
  readonly quilometragemChegada: number | null;
  readonly liberador: string | null;
  readonly conferente: string | null;
  readonly observacao: string | null;
  readonly levaControlado: boolean;
  readonly levaTermolabil: boolean;
  readonly lista: readonly ItemRomaneioTela[];
}

export interface PainelRomaneioTela {
  readonly hoje: string;
  readonly romaneios: readonly RomaneioResumoTela[];
  readonly motoristas: readonly MotoristaTela[];
  readonly veiculos: readonly VeiculoTela[];
  readonly transportadoras: readonly { readonly id: number; readonly nome: string }[];
  readonly transferencias: readonly TransferenciaDisponivelTela[];
}

export interface TransporteTela {
  readonly veiculo: number | null;
  readonly motorista: number | null;
  readonly transportadora: number | null;
  readonly valorFrete: number | null;
}

export interface RespostaRomaneio {
  readonly ok: true;
  readonly id?: number;
  readonly numero?: number;
  readonly mensagem: string;
}

async function ler<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

async function postar(url: string, corpo: unknown, chave: string): Promise<RespostaRomaneio> {
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chave,
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as RespostaRomaneio;
}

export const novaChaveRomaneio = (rotulo: string): string => novaChaveM464(`romaneio.${rotulo}`);
export const lerPainelRomaneio = (): Promise<PainelRomaneioTela> => ler(R);
export const lerRomaneio = (id: number): Promise<RomaneioDetalheTela> => ler(`${R}/${id}`);

export const gravarMotorista = (
  e: MotoristaEntrada,
  alvo: { id: number; versao: number } | null,
  chave = novaChaveRomaneio('motorista'),
): Promise<RespostaRomaneio> =>
  postar(
    alvo ? `${R}/motoristas/${alvo.id}` : `${R}/motoristas`,
    alvo ? { ...e, versao: alvo.versao } : e,
    chave,
  );

export const gravarVeiculo = (
  e: VeiculoEntrada,
  alvo: { id: number; versao: number } | null,
  chave = novaChaveRomaneio('veiculo'),
): Promise<RespostaRomaneio> =>
  postar(
    alvo ? `${R}/veiculos/${alvo.id}` : `${R}/veiculos`,
    alvo ? { ...e, versao: alvo.versao } : e,
    chave,
  );

export const montarRomaneio = (
  e: TransporteTela & {
    documentos: number[];
    descricao: string | null;
    saidaPrevista: string | null;
    observacao: string | null;
  },
  chave = novaChaveRomaneio('montar'),
): Promise<RespostaRomaneio> => postar(R, e, chave);

export const expedirRomaneio = (
  id: number,
  e: TransporteTela & { versao: number; quilometragemSaida: number | null },
  chave = novaChaveRomaneio('expedir'),
): Promise<RespostaRomaneio> => postar(`${R}/${id}/expedicao`, e, chave);

export const conferirRomaneio = (
  id: number,
  e: { versao: number; quilometragemChegada: number | null; desfechos: DesfechoItem[] },
  chave = novaChaveRomaneio('conferir'),
): Promise<RespostaRomaneio> => postar(`${R}/${id}/conferencia`, e, chave);

export const cancelarRomaneio = (
  id: number,
  e: { versao: number; motivo: string },
  chave = novaChaveRomaneio('cancelar'),
): Promise<RespostaRomaneio> => postar(`${R}/${id}/cancelamento`, e, chave);
