// Cliente da etapa 2 do portal do paciente (M50): agendar, pré-check-in, pagamento e pesquisa, sobre a sessão do portal
// (cookie HttpOnly e o CSRF próprio, como a etapa 1); e as telas internas da configuração da agenda online e da
// conferência do pré-check-in (sessão interna, CSRF da plataforma e Idempotency-Key). Cada ação do portal que grava
// manda a sua chave de idempotência (o duplo clique não marca duas vezes).
import type {
  AgendamentoPortal,
  CobrancaPortal,
  ConfigAgendaOnlineDetalhe,
  DetalhePreCheckin,
  FilaPreCheckin,
  HorariosPortal,
  ListaAgendamentosPortal,
  ListaConfigAgendaOnline,
  ListaPagamentosPortal,
  ListaTesourariaPortal,
  ModalidadeMarcacao,
  PagamentoTesourariaPortal,
  OpcoesAgendarPortal,
  PreCheckinDoPortal,
  ResultadoAgendamentoPortal,
  TipoAgendaOnline,
} from '@sgh/contratos';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const P = '/api/paciente';
const JSON_ACEITO = { accept: 'application/json' };

const chave = () => {
  try {
    return `web-${crypto.randomUUID()}`;
  } catch {
    return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
};
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
const portal = <T>(metodo: string, url: string, corpo?: unknown) =>
  fetch(url, {
    method: metodo,
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf-paciente': csrfPaciente(),
      'idempotency-key': chave(),
    },
    body: JSON.stringify(corpo ?? {}),
  }).then((r) => json<T>(r));
const interno = <T>(metodo: string, url: string, corpo?: unknown) =>
  fetch(url, {
    method: metodo,
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chave(),
    },
    body: JSON.stringify(corpo ?? {}),
  }).then((r) => json<T>(r));

// ── Portal: agendar ──
export const opcoesAgendar = (tipo: TipoAgendaOnline) =>
  ler<OpcoesAgendarPortal>(`${P}/agenda/opcoes?tipo=${tipo}`);
export function horariosPortal(f: {
  tipo: TipoAgendaOnline;
  convenio: number;
  servico: number | null;
  agenda: number | null;
  de: string | null;
  modalidade?: ModalidadeMarcacao;
}): Promise<HorariosPortal> {
  const q = new URLSearchParams({ tipo: f.tipo, convenio: String(f.convenio) });
  if (f.modalidade === 'teleconsulta') q.set('modalidade', 'teleconsulta');
  if (f.servico !== null) q.set('servico', String(f.servico));
  if (f.agenda !== null) q.set('agenda', String(f.agenda));
  if (f.de) q.set('de', f.de);
  return ler<HorariosPortal>(`${P}/agenda/horarios?${q.toString()}`);
}
export const meusAgendamentos = () => ler<ListaAgendamentosPortal>(`${P}/agenda/marcacoes`);
export const agendarPortal = (corpo: {
  tipo: TipoAgendaOnline;
  agenda: number;
  data: string;
  hora: string;
  convenio: number;
  servico: number | null;
  modalidade?: ModalidadeMarcacao;
}) => portal<ResultadoAgendamentoPortal>('POST', `${P}/agenda/marcacoes`, corpo);
export const cancelarPortal = (a: Pick<AgendamentoPortal, 'tipo' | 'id'>, motivo: string) =>
  portal<ListaAgendamentosPortal>('POST', `${P}/agenda/marcacoes/${a.tipo}/${a.id}/cancelamento`, { motivo });
// W0-10: consulta ou exame (agenda.remarcarConsulta / agenda.remarcarExame), com o motivo escolhido na tela.
export const remarcarPortal = (
  a: Pick<AgendamentoPortal, 'tipo' | 'id'>,
  destino: { agenda: number; data: string; hora: string },
  motivo: string,
) =>
  portal<ResultadoAgendamentoPortal>('POST', `${P}/agenda/marcacoes/${a.tipo}/${a.id}/remarcacao`, {
    destino,
    motivo,
  });

// ── Pré-check-in ──
export const preCheckinPortal = (tipo: string, id: string) =>
  ler<PreCheckinDoPortal>(`${P}/pre-checkin/${tipo}/${id}`);
export const enviarArquivoPreCheckin = (tipo: string, conteudo: string) =>
  portal<{ arquivo: string }>('POST', `${P}/pre-checkin/arquivo`, { tipo, conteudo });
export const enviarPreCheckinPortal = (tipo: string, id: string, corpo: unknown) =>
  portal<PreCheckinDoPortal>('PUT', `${P}/pre-checkin/${tipo}/${id}`, corpo);

// ── Pagamento e pesquisa ──
export const pagamentosPortal = () => ler<ListaPagamentosPortal>(`${P}/pagamentos`);
export const iniciarPagamentoPortal = (tipo: string, id: string, forma: string) =>
  portal<CobrancaPortal>('POST', `${P}/pagamentos/${tipo}/${id}`, { forma });
export const conferirPagamentoPortal = (id: string) =>
  portal<CobrancaPortal>('POST', `${P}/pagamentos/cobrancas/${id}/conferencia`);
export const simularPagamentoPortal = (id: string, aprovar: boolean) =>
  portal<CobrancaPortal>('POST', `${P}/pagamentos/cobrancas/${id}/simulacao`, { aprovar });
export const responderPesquisaPortal = (tipo: string, id: string, nota: number, comentario: string | null) =>
  portal<ListaAgendamentosPortal>('POST', `${P}/pesquisas/${tipo}/${id}`, { nota, comentario });

// ── Telas internas ──
export const configAgendaOnline = () => ler<ListaConfigAgendaOnline>('/api/agenda/online');
export const detalheConfigAgendaOnline = (tipo: string, agenda: number) =>
  ler<ConfigAgendaOnlineDetalhe>(`/api/agenda/online/${tipo}/${agenda}`);
export const gravarConfigAgendaOnline = (corpo: unknown) =>
  interno<ListaConfigAgendaOnline>('PUT', '/api/agenda/online', corpo);
export function filaPreCheckin(
  situacao: string,
  data: string | null,
  depoisDe: number | null,
  termo: string | null = null,
) {
  const q = new URLSearchParams({ situacao });
  if (data) q.set('data', data);
  if (termo) q.set('termo', termo);
  if (depoisDe !== null) q.set('depoisDe', String(depoisDe));
  return ler<FilaPreCheckin>(`/api/recepcao/pre-checkin?${q.toString()}`);
}
export const detalhePreCheckin = (id: string) => ler<DetalhePreCheckin>(`/api/recepcao/pre-checkin/${id}`);
export const documentoPreCheckin = (id: string, indice: number) =>
  ler<{ tipo: string; conteudo: string }>(`/api/recepcao/pre-checkin/${id}/documentos/${indice}`);
export const conferirPreCheckin = (id: string, corpo: unknown) =>
  interno<DetalhePreCheckin>('POST', `/api/recepcao/pre-checkin/${id}/conferencia`, corpo);
export const recusarPreCheckin = (id: string, corpo: unknown) =>
  interno<DetalhePreCheckin>('POST', `/api/recepcao/pre-checkin/${id}/recusa`, corpo);

// ── W0-10: tesouraria das cobranças do portal (sessão interna; o menu fica no W4-01) ──
export const tesourariaPortal = (de: string, ate: string) =>
  ler<ListaTesourariaPortal>(
    `/api/tesouraria/portal/pagamentos?${new URLSearchParams({ de, ate }).toString()}`,
  );
export const conciliarPagamentoPortal = (id: string, corpo: unknown) =>
  interno<PagamentoTesourariaPortal>('POST', `/api/tesouraria/portal/pagamentos/${id}/conciliacao`, corpo);
export const estornarPagamentoPortal = (id: string, corpo: { motivo: string; senha: string }) =>
  interno<PagamentoTesourariaPortal>('POST', `/api/tesouraria/portal/pagamentos/${id}/estorno`, corpo);
