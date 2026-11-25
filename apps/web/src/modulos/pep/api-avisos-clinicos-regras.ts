// Cliente da central de regras de aviso clínico (F3.3, linha 03-PEP L133): tipos de aviso (o evento clínico), regras
// (evento, setor e especialidade do evento, destinatários e canal) e a emissão do evento pelas regras.
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const P = '/api/pep/avisos-clinicos/regras';

async function pedir<T>(url: string, metodo = 'GET', corpo?: unknown): Promise<T> {
  const r = await fetch(url, {
    method: metodo,
    headers: {
      accept: 'application/json',
      ...(metodo === 'GET' ? {} : { 'content-type': 'application/json', 'x-csrf': tokenCsrf() }),
    },
    ...(metodo === 'GET' ? {} : { body: JSON.stringify(corpo ?? {}) }),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

export type CanalAviso = 'sistema' | 'email';
export type AlvoAviso = 'setor' | 'especialidade' | 'categoria_profissional' | 'perfil' | 'usuario';

export interface TipoAviso {
  id?: number;
  versao?: number;
  codigo: string;
  descricao: string;
  categoria: string;
  prioridade: string;
  enviaEmail: boolean;
  exigeCiencia: boolean;
  ativo: boolean;
}
export interface RegraAviso {
  id?: number;
  versao?: number;
  codigo: string;
  nome: string;
  tipoAviso: string | null;
  setorEvento: number | null;
  especialidadeEvento: number | null;
  mensagem: string;
  canais: CanalAviso[];
  alvos: { tipo: AlvoAviso; id: number }[];
  vigenciaInicio: string;
  vigenciaFim: string | null;
  ativo: boolean;
  numeroVersao?: number;
  motivo?: string | null;
}
export interface AvisoEmitido {
  id: number;
  regra: number | null;
  titulo: string;
  prioridade: string;
  geradoEm: string;
  paciente: number | null;
  sistema: number;
  email: number;
  cientes: number;
}
export interface PainelRegrasAviso {
  tipos: TipoAviso[];
  regras: RegraAviso[];
  recentes: AvisoEmitido[];
  opcoes: Record<AlvoAviso, { id: number; nome: string }[]>;
}
export interface EventoAviso {
  tipoAviso: string;
  setor: number | null;
  especialidade: number | null;
  paciente: number | null;
  titulo: string | null;
  mensagem: string | null;
}

export const lerPainelRegrasAviso = () => pedir<PainelRegrasAviso>(P);
export const gravarTipoAviso = (t: TipoAviso) => pedir<{ id: number }>(`${P}/tipos`, 'POST', t);
export function gravarRegraAviso(r: RegraAviso) {
  const corpo: Partial<RegraAviso> = { ...r };
  delete corpo.numeroVersao;
  return pedir<{ id: number; numeroVersao: number }>(P, 'POST', corpo);
}
export const emitirAviso = (e: EventoAviso) =>
  pedir<{ avisos: number[]; destinatarios: number }>(`${P}/emitir`, 'POST', e);
