// Cliente da telemedicina na tela do médico (M50, etapa 4): a sessão interna, o CSRF da plataforma e a Idempotency-Key
// (uma por ação: o duplo clique não abre dois atendimentos).
import type {
  ApoioTelemedicina,
  AtendimentoResumo,
  CancelarTeleinterconsulta,
  EncerrarTeleconsulta,
  IniciarTeleconsulta,
  ListaTelemedicina,
  ResponderTeleinterconsulta,
  ResultadoTeleconsulta,
  SolicitarTeleinterconsulta,
  TeleconsultaDetalhe,
} from '@sgh/contratos';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const P = '/api/telemedicina';
const JSON_ACEITO = { accept: 'application/json' };
const chave = () => {
  try {
    return `web-${crypto.randomUUID()}`;
  } catch {
    return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
};
async function json<T>(r: Response): Promise<T> {
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}
const ler = <T>(url: string) => fetch(url, { headers: JSON_ACEITO }).then((r) => json<T>(r));
const gravar = <T>(url: string, corpo?: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chave(),
    },
    body: JSON.stringify(corpo ?? {}),
  }).then((r) => json<T>(r));

export function listaTelemedicina(f: { data: string | null; minhas: boolean }): Promise<ListaTelemedicina> {
  const q = new URLSearchParams();
  if (f.data) q.set('data', f.data);
  if (f.minhas) q.set('minhas', '1');
  const s = q.toString();
  return ler<ListaTelemedicina>(s ? `${P}?${s}` : P);
}
export const apoioTelemedicina = () => ler<ApoioTelemedicina>(`${P}/apoio`);
export const buscarCidTelemedicina = (termo: string) =>
  ler<{ id: number; codigo: string; nome: string }[]>(`${P}/cid?termo=${encodeURIComponent(termo)}`);
export const atendimentosAbertos = (termo: string) =>
  ler<AtendimentoResumo[]>(`${P}/atendimentos?termo=${encodeURIComponent(termo)}`);
export const detalheTeleconsulta = (id: number) => ler<TeleconsultaDetalhe>(`${P}/${id}`);
export const iniciarTeleconsulta = (id: number, corpo: IniciarTeleconsulta) =>
  gravar<ResultadoTeleconsulta>(`${P}/${id}/inicio`, corpo);
export const encerrarTeleconsulta = (id: number, corpo: EncerrarTeleconsulta) =>
  gravar<ResultadoTeleconsulta>(`${P}/${id}/encerramento`, corpo);
export const solicitarTeleinterconsulta = (corpo: SolicitarTeleinterconsulta) =>
  gravar<ResultadoTeleconsulta>(`${P}/interconsultas`, corpo);
export const abrirSalaInterconsulta = (id: number, versao: number) =>
  gravar<ResultadoTeleconsulta>(`${P}/interconsultas/${id}/sala`, { versao });
export const responderTeleinterconsulta = (id: number, corpo: ResponderTeleinterconsulta) =>
  gravar<ResultadoTeleconsulta>(`${P}/interconsultas/${id}/parecer`, corpo);
export const cancelarTeleinterconsulta = (id: number, corpo: CancelarTeleinterconsulta) =>
  gravar<ResultadoTeleconsulta>(`${P}/interconsultas/${id}/cancelamento`, corpo);
