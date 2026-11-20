// Cliente da tela dos contratos com fornecedores (M55, etapa 3). As leituras vêm tipadas pelos contratos; as gravações
// levam o CSRF e a Idempotency-Key, que vai também no corpo como `chave` (o mesmo pedido reenviado não grava duas
// vezes). A alteração do cadastro vai pela versão (PUT, sem chave).
import type {
  CandidatoVinculo,
  ContratoDetalhe,
  ContratoResumo,
  GravacaoAgenda,
  PainelContratos,
} from '@sgh/contratos';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const C = '/api/suprimentos/contratos';
const JSON_ACEITO = { accept: 'application/json' };

let sequencia = 0;
/** Idempotency-Key de uma intenção de gravar (aleatória e única neste navegador). */
export function novaChaveContrato(rotulo: string): string {
  const aleatorio =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 14);
  return `m55.e3.${rotulo}.${Date.now().toString(36)}.${(sequencia++).toString(36)}.${aleatorio}`.slice(
    0,
    80,
  );
}

async function ler<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

async function enviar<T>(
  metodo: 'POST' | 'PUT',
  url: string,
  corpo: Record<string, unknown>,
  chave: string | null,
): Promise<T> {
  const r = await fetch(url, {
    method: metodo,
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      ...(chave ? { 'idempotency-key': chave } : {}),
    },
    body: JSON.stringify(chave ? { ...corpo, chave } : corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

const qs = (o: Record<string, string | number | null | undefined>) => {
  const p = Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== '');
  return p.length ? `?${new URLSearchParams(p.map(([k, v]) => [k, String(v)])).toString()}` : '';
};

export interface ListaContratos {
  readonly hoje: string;
  readonly itens: ContratoResumo[];
  readonly pagina: number;
  readonly cortada: boolean;
  readonly painel: PainelContratos;
  readonly gravacao: GravacaoAgenda;
}

export interface FiltroTelaContratos {
  situacao?: string | null;
  faixa?: string | null;
  fornecedor?: number | null;
  termo?: string | null;
  pagina?: number | null;
}

export interface ResultadoContratoTela {
  readonly ok: true;
  readonly id: number;
  readonly repetido: boolean;
  readonly mensagem: string;
  readonly saldo: number | null;
}

export type DetalheContratoTela = ContratoDetalhe & { gravacao: GravacaoAgenda };

/** A ação de cada evento (a rota e a permissão de agir: aditar, avaliar ou editar). */
export const ROTA_DO_EVENTO: Readonly<Record<string, 'aditamentos' | 'avaliacoes' | 'eventos'>> = {
  aditivo: 'aditamentos',
  reajuste: 'aditamentos',
  renovacao: 'aditamentos',
  excecao: 'aditamentos',
  avaliacao: 'avaliacoes',
  ocorrencia: 'eventos',
  anexo: 'eventos',
  encerramento: 'eventos',
  rescisao: 'eventos',
};

export const listarContratosTela = (f: FiltroTelaContratos) => ler<ListaContratos>(`${C}${qs({ ...f })}`);
export const lerContratoTela = (id: number) => ler<DetalheContratoTela>(`${C}/${id}`);
export const lerCandidatosContrato = (id: number) =>
  ler<{ itens: CandidatoVinculo[] }>(`${C}/${id}/candidatos`);
export const buscarFornecedoresContrato = (termo: string) =>
  ler<{ itens: { codigo: number; nome: string }[]; cortada: boolean }>(`${C}/fornecedores${qs({ termo })}`);
export const buscarUsuariosContrato = (termo: string) =>
  ler<{ itens: { login: string; nome: string }[] }>(`${C}/usuarios${qs({ termo })}`);
export const lerCentrosContrato = () => ler<{ itens: { codigo: number; nome: string }[] }>(`${C}/centros`);

export const criarContratoTela = (corpo: Record<string, unknown>, chave = novaChaveContrato('criar')) =>
  enviar<ResultadoContratoTela>('POST', C, corpo, chave);
export const alterarContratoTela = (id: number, corpo: Record<string, unknown>) =>
  enviar<ResultadoContratoTela>('PUT', `${C}/${id}`, corpo, null);
export const registrarEventoContratoTela = (
  id: number,
  corpo: Record<string, unknown> & { tipo: string },
  chave = novaChaveContrato(corpo.tipo),
) =>
  enviar<ResultadoContratoTela>(
    'POST',
    `${C}/${id}/${ROTA_DO_EVENTO[corpo.tipo] ?? 'eventos'}`,
    corpo,
    chave,
  );
export const vincularContratoTela = (
  id: number,
  corpo: {
    tipo: 'pedido' | 'titulo';
    ids: readonly number[];
    excecao?: number | null;
    pedidoDeOrigem?: number | null;
  },
  chave = novaChaveContrato('vinculo'),
) => enviar<ResultadoContratoTela>('POST', `${C}/${id}/vinculos`, { ...corpo }, chave);
