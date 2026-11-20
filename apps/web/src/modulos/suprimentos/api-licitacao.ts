// Cliente da tela da licitação e do pregão (M55, etapa 4). As leituras vêm tipadas pelos contratos; as gravações levam
// o CSRF e a Idempotency-Key, que vai também no corpo como `chave` (o mesmo pedido reenviado não grava duas vezes). A
// alteração do termo e a situação da proposta vão pela versão (PUT, sem chave). A decisão do recurso tem rota própria
// (`/decisoes`, da autoridade), separada dos demais atos (`/eventos`, de quem conduz).
import type {
  GravacaoAgenda,
  LicitacaoDetalhe,
  LicitacaoResumo,
  PainelLicitacoes,
  PedidoMarcadoLicitacao,
} from '@sgh/contratos';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const L = '/api/suprimentos/licitacoes';
const JSON_ACEITO = { accept: 'application/json' };

let sequencia = 0;
/** Idempotency-Key de uma intenção de gravar (aleatória e única neste navegador). */
export function novaChaveLicitacao(rotulo: string): string {
  const aleatorio =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 14);
  return `m55.e4.${rotulo}.${Date.now().toString(36)}.${(sequencia++).toString(36)}.${aleatorio}`.slice(
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

export interface ListaLicitacoes {
  readonly hoje: string;
  readonly itens: LicitacaoResumo[];
  readonly pagina: number;
  readonly cortada: boolean;
  readonly painel: PainelLicitacoes;
  readonly gravacao: GravacaoAgenda;
}

export interface FiltroTelaLicitacoes {
  etapa?: string | null;
  modalidade?: string | null;
  termo?: string | null;
  pagina?: number | null;
}

export interface ResultadoLicitacaoTela {
  readonly ok: true;
  readonly id: number;
  readonly registro: number;
  readonly etapa: string;
  readonly repetido: boolean;
  readonly mensagem: string;
}

export type DetalheLicitacaoTela = LicitacaoDetalhe & { gravacao: GravacaoAgenda };

export const listarLicitacoesTela = (f: FiltroTelaLicitacoes) => ler<ListaLicitacoes>(`${L}${qs({ ...f })}`);
export const lerLicitacaoTela = (id: number) => ler<DetalheLicitacaoTela>(`${L}/${id}`);
export const lerPedidosMarcadosLicitacao = () =>
  ler<{ itens: PedidoMarcadoLicitacao[] }>(`${L}/pedidos-marcados`);
export const buscarFornecedoresLicitacao = (termo: string) =>
  ler<{ itens: { codigo: number; nome: string }[]; cortada: boolean }>(`${L}/fornecedores${qs({ termo })}`);
export const buscarUsuariosLicitacao = (termo: string) =>
  ler<{ itens: { login: string; nome: string }[] }>(`${L}/usuarios${qs({ termo })}`);

export const criarLicitacaoTela = (corpo: Record<string, unknown>, chave = novaChaveLicitacao('criar')) =>
  enviar<ResultadoLicitacaoTela>('POST', L, corpo, chave);
export const alterarLicitacaoTela = (id: number, corpo: Record<string, unknown>) =>
  enviar<ResultadoLicitacaoTela>('PUT', `${L}/${id}`, corpo, null);
export const registrarPrecoLicitacaoTela = (
  id: number,
  corpo: Record<string, unknown>,
  chave = novaChaveLicitacao('preco'),
) => enviar<ResultadoLicitacaoTela>('POST', `${L}/${id}/precos`, corpo, chave);
/** O descarte de um preço da pesquisa, com a justificativa (fica no registro, fora da estimativa). */
export const descartarPrecoLicitacaoTela = (
  id: number,
  preco: number,
  corpo: Record<string, unknown>,
  chave = novaChaveLicitacao('descarte'),
) => enviar<ResultadoLicitacaoTela>('PUT', `${L}/${id}/precos/${preco}/descarte`, corpo, chave);
export const registrarPropostaLicitacaoTela = (
  id: number,
  corpo: Record<string, unknown>,
  chave = novaChaveLicitacao('proposta'),
) => enviar<ResultadoLicitacaoTela>('POST', `${L}/${id}/propostas`, corpo, chave);
export const situacaoPropostaLicitacaoTela = (id: number, proposta: number, corpo: Record<string, unknown>) =>
  enviar<ResultadoLicitacaoTela>('PUT', `${L}/${id}/propostas/${proposta}`, corpo, null);
export const avancarLicitacaoTela = (
  id: number,
  corpo: Record<string, unknown> & { para: string },
  chave = novaChaveLicitacao(corpo.para),
) => enviar<ResultadoLicitacaoTela>('POST', `${L}/${id}/etapas`, corpo, chave);
export const registrarEventoLicitacaoTela = (
  id: number,
  corpo: Record<string, unknown> & { tipo: string },
  chave = novaChaveLicitacao(corpo.tipo),
) =>
  enviar<ResultadoLicitacaoTela>(
    'POST',
    `${L}/${id}/${corpo.tipo === 'decisao-recurso' ? 'decisoes' : 'eventos'}`,
    corpo,
    chave,
  );
export const homologarLicitacaoTela = (
  id: number,
  corpo: Record<string, unknown>,
  chave = novaChaveLicitacao('homologar'),
) => enviar<ResultadoLicitacaoTela>('POST', `${L}/${id}/homologacao`, corpo, chave);
export const encerrarLicitacaoTela = (
  id: number,
  corpo: Record<string, unknown> & { para: string },
  chave = novaChaveLicitacao(corpo.para),
) => enviar<ResultadoLicitacaoTela>('POST', `${L}/${id}/encerramentos`, corpo, chave);

/** Regra 10: o documento do processo em PDF/A (termo de referência, registro da etapa ou ata do julgamento). */
export interface DocumentoLicitacaoTela {
  readonly tipo: 'termo' | 'etapa' | 'ata';
  readonly formato: 'pdf';
  readonly conteudo: string;
  readonly nomeArquivo: string;
  readonly emissao: string;
  readonly sha256: string;
  readonly identificadorQr: string;
  /** Ficou ligado ao processo (listado nos documentos emitidos)? Falso em consulta (chave desligada). */
  readonly ligadoAoProcesso: boolean;
}
export const emitirDocumentoLicitacaoTela = (
  id: number,
  tipo: DocumentoLicitacaoTela['tipo'],
  chave = novaChaveLicitacao(`doc-${tipo}`),
) => enviar<DocumentoLicitacaoTela>('POST', `${L}/${id}/documentos`, { tipo }, chave);
