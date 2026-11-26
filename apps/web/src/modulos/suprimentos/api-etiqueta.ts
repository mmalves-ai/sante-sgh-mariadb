// Cliente da etiqueta de identificação do estoque e da leitura do código (F3.6, 05-SUP linha 14). As gravações levam o
// CSRF e a Idempotency-Key; a recusa volta como problema com os campos.
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const S = '/api/suprimentos';

export interface ItemLido {
  readonly codigo: number;
  readonly nome: string;
  readonly unidade: string;
  readonly rastreavel: boolean;
  readonly controlado: boolean;
  readonly antimicrobiano: boolean;
  readonly consignado: boolean;
  readonly ativo: boolean;
}
export interface LeituraCodigo {
  readonly item: ItemLido;
  readonly quantidade: number;
  readonly lote: string | null;
  readonly loteId: number | null;
  readonly validade: string | null;
  readonly identificador: string | null;
  readonly origem: 'etiqueta' | 'codigo-item';
  readonly padrao: number | null;
  readonly alertas: readonly string[];
}
export interface EtiquetaEmitida {
  readonly id: number;
  readonly identificador: string;
  readonly datamatrix: string;
  readonly barras: string;
  readonly legivel: string;
}
export interface ResultadoEmissao {
  readonly id: number;
  readonly etiquetas: readonly EtiquetaEmitida[];
  readonly zpl: string;
}
export type TipoEtiqueta = 'unidade' | 'embalagem' | 'dose' | 'caixa';

const chave = (rotulo: string) =>
  `${rotulo}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`.slice(0, 80);

async function enviar<T>(url: string, rotulo: string, corpo: unknown): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
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

export async function lerCodigoEstoque(codigo: string): Promise<LeituraCodigo> {
  const r = await fetch(`${S}/leitura?codigo=${encodeURIComponent(codigo)}`, {
    headers: { accept: 'application/json' },
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as LeituraCodigo;
}

export const emitirEtiquetas = (e: {
  insumo: number;
  lote: number | null;
  local: number | null;
  quantidade: number;
  etiquetas: number;
  tipo: TipoEtiqueta;
}) => enviar<ResultadoEmissao>(`${S}/etiquetas`, 'etiquetas', e);

export const baixarEtiquetas = (e: {
  identificadores: readonly string[];
  situacao: 'consumida' | 'devolvida' | 'descartada' | 'cancelada' | 'reativar';
  movimento?: number | null;
}) => enviar<{ id: number; baixadas: number }>(`${S}/etiquetas/baixa`, 'etiquetas-baixa', e);

export interface MotivoReimpressao {
  readonly codigo: number;
  readonly descricao: string;
  readonly exigeComplemento: boolean;
}
export interface ResultadoReimpressao {
  readonly id: number;
  readonly via: number;
  readonly impressoes: number;
  readonly registro: number;
  readonly zpl: string;
}

/** Os motivos ativos da reimpressão (o catálogo da impressão padrão). */
export async function motivosReimpressao(): Promise<MotivoReimpressao[]> {
  const r = await fetch(`${S}/etiquetas/motivos-reimpressao`, { headers: { accept: 'application/json' } });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as MotivoReimpressao[];
}

/** A reimpressão registrada com o motivo: volta a via seguinte e o arquivo da impressora. */
export const reimprimirEtiqueta = (id: number, e: { motivo: number; complemento: string | null }) =>
  enviar<ResultadoReimpressao>(`${S}/etiquetas/${id}/reimpressao`, 'etiqueta-reimpressao', e);
