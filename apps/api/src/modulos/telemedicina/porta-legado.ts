// Porta da telemedicina sobre o núcleo do legado (M50, etapa 4): leituras READ ONLY de SGH_ATD_TELECONSULTA (0954) e do
// histórico clínico (RECADATE, só leitura); gravações numa transação SGH_ com a SGH_TRILHA junto (nenhuma tabela do
// legado). `portaTelemedicinaNaTransacao`: a mesma porta sobre UMA transação aberta (integração na cópia, desfeita).
import {
  abrirSalaTeleconsulta,
  abrirSalaTeleinterconsulta,
  agendarTeleconsulta,
  cancelarTeleconsultaDaMarcacao,
  cancelarTeleinterconsulta,
  encerrarTeleconsulta,
  entrarSalaEspera,
  type Escritor,
  gravarTrilha,
  historicoClinicoTeleconsulta,
  type Leitor,
  moverTeleconsulta,
  type NucleoLegado,
  regsDeTeleconsulta,
  registrarEntradaPaciente,
  responderTeleinterconsulta,
  solicitarTeleinterconsulta,
  teleconsultaDaMarcacao,
  teleconsultaDoCabecalho,
  teleconsultaPorId,
  teleconsultasDoDia,
  teleconsultasDoPaciente,
  teleinterconsultas,
  vincularAtendimentoTeleconsulta,
} from '@sgh/legado';
import { portaIndisponivel } from '../exames/public-api.js';
import {
  type ContextoTelemedicina,
  type GravadorTelemedicina,
  METODOS_PORTA_TELEMEDICINA,
  type PortaTelemedicina,
  type TrilhaTelemedicina,
} from './porta.js';

function gravador(e: Escritor, c: ContextoTelemedicina): GravadorTelemedicina {
  const h = c.hospital;
  return {
    agendar: (t) => agendarTeleconsulta(e, { ...t, hospital: h }),
    entrarSalaEspera: (id, versao, d) => entrarSalaEspera(e, h, id, versao, d),
    registrarEntradaPaciente: (id) => registrarEntradaPaciente(e, h, id),
    abrirSala: (id, versao, d) => abrirSalaTeleconsulta(e, h, id, versao, d),
    vincularAtendimento: (d) => vincularAtendimentoTeleconsulta(e, { ...d, hospital: h }),
    encerrar: (id, versao, d) => encerrarTeleconsulta(e, h, id, versao, d),
    cancelarDaMarcacao: (m, por) => cancelarTeleconsultaDaMarcacao(e, h, m, por),
    mover: (d) => moverTeleconsulta(e, h, d),
    solicitarInterconsulta: (t) => solicitarTeleinterconsulta(e, { ...t, hospital: h }),
    abrirSalaInterconsulta: (id, versao, d) => abrirSalaTeleinterconsulta(e, h, id, versao, d),
    responderInterconsulta: (id, versao, d) => responderTeleinterconsulta(e, h, id, versao, d),
    cancelarInterconsulta: (id, versao, d) => cancelarTeleinterconsulta(e, h, id, versao, d),
  };
}

async function naTransacao<T>(
  e: Escritor,
  c: ContextoTelemedicina,
  trilha: TrilhaTelemedicina<T>,
  fn: (g: GravadorTelemedicina) => Promise<T>,
) {
  const r = await fn(gravador(e, c));
  const linha = typeof trilha === 'function' ? trilha(r) : trilha;
  if (linha) await gravarTrilha(e, linha);
  return r;
}

type Ler = <T>(c: ContextoTelemedicina, fn: (l: Leitor) => Promise<T>) => Promise<T>;

function leituras(ler: Ler): Omit<PortaTelemedicina, 'destino' | 'gravar'> {
  return {
    porId: (c, id) => ler(c, (l) => teleconsultaPorId(l, c.hospital, id)),
    daMarcacao: (c, m) => ler(c, (l) => teleconsultaDaMarcacao(l, c.hospital, m)),
    doPaciente: (c, p) => ler(c, (l) => teleconsultasDoPaciente(l, c.hospital, p)),
    doDia: (c, f) => ler(c, (l) => teleconsultasDoDia(l, c.hospital, f)),
    doCabecalho: (c, cab) => ler(c, (l) => teleconsultaDoCabecalho(l, c.hospital, cab)),
    regsDeTeleconsulta: (c, regs) => ler(c, (l) => regsDeTeleconsulta(l, c.hospital, regs)),
    interconsultas: (c, f) => ler(c, (l) => teleinterconsultas(l, c.hospital, f)),
    historicoClinico: (c, p) => ler(c, (l) => historicoClinicoTeleconsulta(l, p)),
  };
}

export function portaTelemedicinaLegado(nucleo: NucleoLegado): PortaTelemedicina {
  const ctx = (c: ContextoTelemedicina) => ({ rede: c.rede, hospital: c.hospital, traceId: 'telemedicina' });
  return {
    destino: 'legado',
    gravar: (c, trilha, fn) => nucleo.gravarSgh(ctx(c), (e) => naTransacao(e, c, trilha, fn)),
    ...leituras((c, fn) => nucleo.lerSomente(ctx(c), fn)),
  };
}

export function portaTelemedicinaNaTransacao(e: Escritor): PortaTelemedicina {
  return {
    destino: 'legado',
    gravar: (c, trilha, fn) => naTransacao(e, c, trilha, fn),
    ...leituras((_c, fn) => fn(e)),
  };
}

export function portaTelemedicinaIndisponivel(): PortaTelemedicina {
  return portaIndisponivel<PortaTelemedicina>(METODOS_PORTA_TELEMEDICINA);
}
