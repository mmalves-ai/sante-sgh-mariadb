// Cliente do portal do médico externo (M50, etapa 3): a sessão é a do portal de resultados do M26 (cookie HttpOnly) com
// o CSRF por token duplo próprio do portal (o cookie sgh_portal_csrf repetido no cabeçalho x-csrf-portal). Nunca manda
// quem é o médico nem o profissional: o servidor tira os dois da sessão e do vínculo da conta. O lado interno (as contas
// e o vínculo) usa a sessão interna, com o CSRF da plataforma e a Idempotency-Key.
import type {
  AtoContaMedicoExternoEntrada,
  AtoContaMedicoExternoItem,
  ResultadoAtoContaMedicoExterno,
  AgendaPortalMedico,
  AssinarPortalMedico,
  AssinaturasPortalMedico,
  InicioAssinaturaPortalMedico,
  ResultadoAssinaturaPortalMedico,
  RetornoAssinaturaPortalMedico,
  ContaDoMedicoResposta,
  ContasMedicoExterno,
  ExtratoPortalMedico,
  CriticosPortalMedico,
  MeusPacientesPortalMedico,
  OpcoesPortalMedico,
  ProntuarioPortalMedico,
  AlterarPedidoPortal,
  PedidoCirurgiaPortal,
  PedirTrocaEmailMedicoEntrada,
  ResultadoPortalMedico,
  TrocaEmailMedicoPedida,
  TrocarSenhaMedicoEntrada,
} from '@sgh/contratos';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const P = '/api/portal/medico-externo';
const I = '/api/portal-medico';
const JSON_ACEITO = { accept: 'application/json' };

function csrfPortal(): string {
  try {
    for (const par of document.cookie.split(';')) {
      const i = par.indexOf('=');
      if (i !== -1 && par.slice(0, i).trim() === 'sgh_portal_csrf') return par.slice(i + 1).trim();
    }
  } catch {
    /* sem document.cookie */
  }
  return '';
}
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
const postarPortal = <T>(url: string, corpo: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: { ...JSON_ACEITO, 'content-type': 'application/json', 'x-csrf-portal': csrfPortal() },
    body: JSON.stringify(corpo ?? {}),
  }).then((r) => json<T>(r));
const postarInterno = <T>(url: string, corpo: unknown) =>
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
const q = (o: Record<string, string | null | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

// ── Portal ──
export const extratoPortalMedico = (competencia: string | null): Promise<ExtratoPortalMedico> =>
  ler(`${P}/extrato${q({ competencia })}`);
export const contaPortalMedico = (competencia: string): Promise<ContaDoMedicoResposta> =>
  ler(`${P}/extrato/conta${q({ competencia })}`);
export const agendaPortalMedico = (de: string | null, ate: string | null): Promise<AgendaPortalMedico> =>
  ler(`${P}/agenda${q({ de, ate })}`);
/** W0-10 (M4): os pacientes com vínculo assistencial e o resumo do prontuário de um deles (403 fora da lista). */
export const pacientesPortalMedico = (): Promise<MeusPacientesPortalMedico> => ler(`${P}/pacientes`);
export const prontuarioPortalMedico = (paciente: number): Promise<ProntuarioPortalMedico> =>
  ler(`${P}/pacientes/${paciente}`);
/** W0-10 (M5): os avisos de resultado crítico dos pacientes do médico e a ciência com a conduta. */
export const criticosPortalMedico = (): Promise<CriticosPortalMedico> => ler(`${P}/criticos`);
export const cienciaCriticoPortal = (aviso: number, conduta: string): Promise<ResultadoPortalMedico> =>
  postarPortal(`${P}/criticos/${aviso}/ciencia`, { conduta });
/** W0-10 (M6): a fila de assinatura remota, o pedido do lote ao provedor e a volta do provedor (state e código). */
export const assinaturasPortalMedico = (): Promise<AssinaturasPortalMedico> => ler(`${P}/assinaturas`);
export const assinarPortalMedico = (e: AssinarPortalMedico): Promise<InicioAssinaturaPortalMedico> =>
  postarPortal(`${P}/assinaturas`, e);
export const retornoAssinaturaPortalMedico = (
  e: RetornoAssinaturaPortalMedico,
): Promise<ResultadoAssinaturaPortalMedico> => postarPortal(`${P}/assinaturas/retorno`, e);
/** Leva o navegador ao provedor do certificado (separado para o teste da tela substituir). */
export function irAoProvedorAssinatura(endereco: string): void {
  window.location.assign(endereco);
}
export const opcoesPortalMedico = (): Promise<OpcoesPortalMedico> => ler(`${P}/opcoes`);
export const procedimentosPortalMedico = (texto: string): Promise<{ codigo: number; nome: string }[]> =>
  ler(`${P}/procedimentos${q({ q: texto })}`);
export const pedirCirurgiaPortal = (p: PedidoCirurgiaPortal): Promise<ResultadoPortalMedico> =>
  postarPortal(`${P}/pedidos`, p);
export const retirarPedidoPortal = (id: number, motivo: string | null): Promise<ResultadoPortalMedico> =>
  postarPortal(`${P}/pedidos/${id}/retirar`, motivo ? { motivo } : {});
/** W0-10: altera o pedido não confirmado (o pedido inteiro, a versão vista e o motivo). */
export const alterarPedidoPortal = (id: number, p: AlterarPedidoPortal): Promise<ResultadoPortalMedico> =>
  postarPortal(`${P}/pedidos/${id}/alteracao`, p);

// ── Lado interno ──
export const contasMedicoExterno = (
  f: { q?: string; situacao?: string; pagina?: number } = {},
): Promise<ContasMedicoExterno> =>
  ler(
    `${I}/contas${q({
      q: f.q?.trim() || null,
      situacao: f.situacao && f.situacao !== 'todas' ? f.situacao : null,
      pagina: f.pagina && f.pagina > 1 ? String(f.pagina) : null,
    })}`,
  );
export const buscarProfissionaisCorpoClinico = (texto: string): Promise<{ id: number; nome: string }[]> =>
  ler(`${I}/profissionais${q({ q: texto })}`);
export const vincularMedicoExterno = (acesso: number, profissional: number): Promise<ResultadoPortalMedico> =>
  postarInterno(`${I}/contas/${acesso}/vinculo`, { profissional });
export const desvincularMedicoExterno = (acesso: number): Promise<ResultadoPortalMedico> =>
  postarInterno(`${I}/contas/${acesso}/desvinculo`, {});
// W0-10: bloqueio, desbloqueio e encerramento da conta (com motivo e a senha de novo) e o histórico dos atos.
export const atoContaMedicoExterno = (
  acesso: number,
  e: AtoContaMedicoExternoEntrada & { senha: string },
): Promise<ResultadoAtoContaMedicoExterno> => postarInterno(`${I}/contas/${acesso}/ato`, e);
export const atosContaMedicoExterno = (acesso: number): Promise<AtoContaMedicoExternoItem[]> =>
  ler(`${I}/contas/${acesso}/atos`);

// W0-10: o médico troca a senha e o e-mail da própria conta (o e-mail só vale depois do link confirmado nele).
export const trocarSenhaMedico = (e: TrocarSenhaMedicoEntrada): Promise<ResultadoPortalMedico> =>
  postarPortal(`${P}/conta/senha`, e);
export const trocaEmailMedicoPendente = (): Promise<{ pendente: TrocaEmailMedicoPedida | null }> =>
  ler(`${P}/conta/email`);
export const pedirTrocaEmailMedico = (e: PedirTrocaEmailMedicoEntrada): Promise<TrocaEmailMedicoPedida> =>
  postarPortal(`${P}/conta/email`, e);
export const cancelarTrocaEmailMedico = (): Promise<ResultadoPortalMedico> =>
  postarPortal(`${P}/conta/email/cancelar`, {});
export const confirmarTrocaEmailMedico = (
  hospital: string,
  token: string,
): Promise<{ emailMascarado: string }> =>
  postarPortal(`${P}/email/confirmacao${q({ h: hospital })}`, { token });
