// Cliente do calendário de feriados e dias não úteis (F3.1, 02-CAD linha 28). Respostas do calendario.controller.ts da
// API; a gravação leva CSRF e Idempotency-Key.
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const objeto = z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]);

export type Abrangencia = 'nacional' | 'estadual' | 'municipal' | 'estabelecimento';
export type Recorrencia = 'anual' | 'data_unica' | 'movel';
export type BaseMovel = 'carnaval' | 'sexta_santa' | 'pascoa' | 'corpus_christi';

export interface EntradaDia {
  descricao: string;
  abrangencia: Abrangencia;
  ufId: number | null;
  municipio: number | null;
  estabelecimento: number | null;
  recorrencia: Recorrencia;
  dia: number | null;
  mes: number | null;
  data: string | null;
  facultativo: boolean;
  horaInicio: string | null;
  horaFim: string | null;
}
export interface ItemCalendario extends EntradaDia {
  id: number;
  versao: number;
  ativo: boolean;
  ufSigla: string | null;
  municipioNome: string | null;
  estabelecimentoNome: string | null;
  valeAqui: boolean;
  datasNoAno: string[];
}
export interface VisaoCalendario {
  ano: number;
  local: {
    estabelecimento: number;
    estabelecimentoNome: string;
    ufId: number | null;
    ufSigla: string | null;
    municipio: number | null;
    municipioNome: string | null;
  };
  itens: ItemCalendario[];
  semExpediente: { data: string; nome: string; horaInicio?: string | null; horaFim?: string | null }[];
  ufs: { id: number; sigla: string }[];
}

function chave(): string {
  try {
    return `web-${crypto.randomUUID()}`;
  } catch {
    return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

async function pedir<T>(url: string, metodo = 'GET', corpo?: unknown): Promise<T> {
  const aceito = { accept: 'application/json' };
  const r = await fetch(
    url,
    metodo === 'GET'
      ? { headers: aceito }
      : {
          method: metodo,
          headers: {
            ...aceito,
            'content-type': 'application/json',
            'x-csrf': tokenCsrf(),
            'idempotency-key': chave(),
          },
          body: JSON.stringify(corpo ?? {}),
        },
  );
  if (!r.ok) throw await erroDaResposta(r);
  return objeto.parse(await r.json()) as T;
}

const C = '/api/cadastros/calendario';
type Gravado = { id: number };
export const lerCalendario = (ano: number) =>
  pedir<VisaoCalendario>(`${C}?${new URLSearchParams({ ano: String(ano) })}`);
export const buscarMunicipios = (termo: string) =>
  pedir<{ id: number; nome: string; uf: string }[]>(`${C}/municipios?${new URLSearchParams({ termo })}`);
export const incluirDia = (e: EntradaDia) => pedir<Gravado>(C, 'POST', e);
export const alterarDia = (id: number, versao: number, e: EntradaDia) =>
  pedir<Gravado>(`${C}/${id}`, 'PUT', { ...e, versao });
export const mudarSituacaoDia = (id: number, versao: number, ativo: boolean, motivo: string) =>
  pedir<Gravado>(`${C}/${id}/situacao`, 'POST', { versao, ativo, motivo });
export const gerarMoveis = (c: {
  base: BaseMovel;
  anoInicio: number;
  anoFim: number;
  descricao: string | null;
  abrangencia: Abrangencia;
  ufId: number | null;
  municipio: number | null;
  estabelecimento: number | null;
  facultativo: boolean;
}) => pedir<{ incluidos: number[]; pulados: number }>(`${C}/moveis`, 'POST', c);
