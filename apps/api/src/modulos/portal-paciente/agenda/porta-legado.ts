// Porta da etapa 2 do portal sobre o núcleo do legado (M50): leituras READ ONLY das tabelas SGH_ dos scripts 0503 a
// 0506; gravações numa transação SGH_ com a SGH_TRILHA junto (nenhuma tabela do legado). `portaAgendaOnlineNaTransacao`:
// a mesma porta sobre UMA transação aberta (integração na cópia, desfeita).
import {
  cancelarPreCheckin,
  configAgendaOnline,
  configsAgendaOnline,
  confirmarPagamentoPortal,
  decidirPreCheckin,
  enviarPreCheckin,
  type Escritor,
  filaPreCheckin,
  gravarConfigAgendaOnline,
  gravarTrilha,
  iniciarPagamentoPortal,
  type Leitor,
  liberarConferenciaPreCheckin,
  type NucleoLegado,
  pagamentoPortalPorId,
  pagamentoPortalPorTransacao,
  pagamentosPortalDoPaciente,
  pagamentosTesourariaPortal,
  pagamentoTesourariaPortal,
  registrarConciliacaoPortal,
  pesquisasPortalDoPaciente,
  preCheckinDaMarcacao,
  preCheckinPorId,
  preCheckinsDoPaciente,
  reservarConferenciaPreCheckin,
  responderPesquisaPortal,
} from '@sgh/legado';
import { portaIndisponivel } from '../../exames/public-api.js';
import {
  type ContextoAgendaOnline,
  type GravadorAgendaOnline,
  METODOS_PORTA_AGENDA_ONLINE,
  type PortaAgendaOnline,
  type TrilhaAgendaOnline,
} from './porta.js';

function gravador(e: Escritor, c: ContextoAgendaOnline): GravadorAgendaOnline {
  const h = c.hospital;
  return {
    gravarConfig: (x) => gravarConfigAgendaOnline(e, { ...x, hospital: h }),
    enviarPreCheckin: (p) => enviarPreCheckin(e, { ...p, hospital: h }),
    decidirPreCheckin: (id, versao, d) => decidirPreCheckin(e, h, id, versao, d),
    reservarConferencia: (id, versao, por) => reservarConferenciaPreCheckin(e, h, id, versao, por),
    liberarConferencia: (id, versao) => liberarConferenciaPreCheckin(e, h, id, versao),
    cancelarPreCheckin: (tipo, marcacao) => cancelarPreCheckin(e, h, tipo, marcacao),
    iniciarPagamento: (p) => iniciarPagamentoPortal(e, { ...p, hospital: h }),
    confirmarPagamento: (x) => confirmarPagamentoPortal(e, { ...x, hospital: h }),
    responderPesquisa: (r) => responderPesquisaPortal(e, { ...r, hospital: h }),
    registrarConciliacao: (n) => registrarConciliacaoPortal(e, { ...n, hospital: h }),
  };
}

async function naTransacao<T>(
  e: Escritor,
  c: ContextoAgendaOnline,
  trilha: TrilhaAgendaOnline<T>,
  fn: (g: GravadorAgendaOnline) => Promise<T>,
) {
  const r = await fn(gravador(e, c));
  const linha = typeof trilha === 'function' ? trilha(r) : trilha;
  if (linha) await gravarTrilha(e, linha);
  return r;
}

type Ler = <T>(c: ContextoAgendaOnline, fn: (l: Leitor) => Promise<T>) => Promise<T>;

function leituras(ler: Ler): Omit<PortaAgendaOnline, 'destino' | 'gravar'> {
  return {
    configs: (c) => ler(c, (l) => configsAgendaOnline(l, c.hospital)),
    config: (c, tipo, agenda) => ler(c, (l) => configAgendaOnline(l, c.hospital, tipo, agenda)),
    preCheckinDaMarcacao: (c, tipo, m) => ler(c, (l) => preCheckinDaMarcacao(l, c.hospital, tipo, m)),
    preCheckinPorId: (c, id) => ler(c, (l) => preCheckinPorId(l, c.hospital, id)),
    preCheckinsDoPaciente: (c, p) => ler(c, (l) => preCheckinsDoPaciente(l, c.hospital, p)),
    filaPreCheckin: (c, f) => ler(c, (l) => filaPreCheckin(l, c.hospital, f)),
    pagamentoPorTransacao: (c, t) => ler(c, (l) => pagamentoPortalPorTransacao(l, c.hospital, t)),
    pagamentoPorId: (c, id) => ler(c, (l) => pagamentoPortalPorId(l, c.hospital, id)),
    pagamentosDoPaciente: (c, p) => ler(c, (l) => pagamentosPortalDoPaciente(l, c.hospital, p)),
    pesquisasDoPaciente: (c, p) => ler(c, (l) => pesquisasPortalDoPaciente(l, c.hospital, p)),
    tesouraria: (c, de, ate) =>
      ler(c, (l) => pagamentosTesourariaPortal(l, { hospital: c.hospital, de, ate })),
    pagamentoTesouraria: (c, id) => ler(c, (l) => pagamentoTesourariaPortal(l, c.hospital, id)),
  };
}

export function portaAgendaOnlineLegado(nucleo: NucleoLegado): PortaAgendaOnline {
  const ctx = (c: ContextoAgendaOnline) => ({ rede: c.rede, hospital: c.hospital, traceId: 'portal-agenda' });
  return {
    destino: 'legado',
    gravar: (c, fn, trilha) => nucleo.gravarSgh(ctx(c), (e) => naTransacao(e, c, trilha, fn)),
    ...leituras((c, fn) => nucleo.lerSomente(ctx(c), fn)),
  };
}

export function portaAgendaOnlineNaTransacao(e: Escritor): PortaAgendaOnline {
  return {
    destino: 'legado',
    gravar: (c, fn, trilha) => naTransacao(e, c, trilha, fn),
    ...leituras((_c, fn) => fn(e)),
  };
}

export function portaAgendaOnlineIndisponivel(): PortaAgendaOnline {
  return portaIndisponivel<PortaAgendaOnline>(METODOS_PORTA_AGENDA_ONLINE);
}
