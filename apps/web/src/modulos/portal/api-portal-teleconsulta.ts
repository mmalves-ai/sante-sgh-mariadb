// Cliente da etapa 4 do portal do paciente (M50, telemedicina): as teleconsultas do titular, a sala de espera (o termo
// e o local) e a entrada na sala do médico, sobre a sessão do portal (cookie HttpOnly e o CSRF próprio).
import type { EntrarSalaEspera, ListaTeleconsultasPortal, TeleconsultaDoPortal } from '@sgh/contratos';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const P = '/api/paciente/teleconsultas';
const JSON_ACEITO = { accept: 'application/json' };

function csrfPaciente(): string {
  try {
    for (const par of document.cookie.split(';')) {
      const i = par.indexOf('=');
      if (i !== -1 && par.slice(0, i).trim() === 'sgh_pac_csrf') return par.slice(i + 1).trim();
    }
  } catch {
    /* sem document.cookie */
  }
  return '';
}
async function json<T>(r: Response): Promise<T> {
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}
const ler = <T>(url: string) => fetch(url, { headers: JSON_ACEITO }).then((r) => json<T>(r));
const gravar = <T>(url: string, corpo?: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: { ...JSON_ACEITO, 'content-type': 'application/json', 'x-csrf-paciente': csrfPaciente() },
    body: JSON.stringify(corpo ?? {}),
  }).then((r) => json<T>(r));

export const minhasTeleconsultas = () => ler<ListaTeleconsultasPortal>(P);
export const teleconsultaDoPortal = (id: number) => ler<TeleconsultaDoPortal>(`${P}/${id}`);
export const entrarSalaEspera = (id: number, corpo: EntrarSalaEspera) =>
  gravar<TeleconsultaDoPortal>(`${P}/${id}/espera`, corpo);
export const entrarNaSala = (id: number) => gravar<TeleconsultaDoPortal>(`${P}/${id}/entrada`);
