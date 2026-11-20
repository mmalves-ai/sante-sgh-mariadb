// Porta do catálogo de relatórios sobre o núcleo do legado (M34): as consultas do catálogo e as leituras em transação
// READ ONLY (a escrita é recusada pelo banco; o teto e o tempo, pelo driver: regra 3), cada estabelecimento no seu
// banco (o leitor é o do estabelecimento do contexto); as gravações só em SGH_ (o escritor `somenteSgh`) com a
// SGH_TRILHA na mesma transação. `portaRelatorioNaTransacao`: a mesma porta sobre UMA transação aberta (os testes de
// integração na cópia, sempre desfeita).
import {
  acessoDeOrigem,
  agendamentosVencidos,
  alterarAgendamentoRelatorio,
  alterarPedidoRelatorio,
  cancelarPedidoRelatorio,
  contarDependenciasRelatorio,
  excluirAgendamentoRelatorio,
  excluirPedidoRelatorio,
  lerEventosRelatorio,
  lerPedidoRelatorio,
  registrarEventoRelatorio,
  criarAgendamentoRelatorio,
  criarPedidoRelatorio,
  decidirTriagem,
  type Escritor,
  executarRelatorioCatalogo,
  gravarPropostasTriagem,
  gravarTrilha,
  historicoEnvioOrigem,
  inventarioRelatoriosOrigem,
  type Leitor,
  lerAgendamentoRelatorio,
  lerAgendamentosRelatorio,
  lerExecucoesRelatorio,
  lerPedidosRelatorio,
  lerTriagem,
  lerUmaTriagem,
  type NucleoLegado,
  registrarExecucaoRelatorio,
  registrarResultadoEnvio,
  relogioRecepcao,
  responderPedidoRelatorio,
  resumoTriagem,
} from '@sgh/legado';
import { portaIndisponivel } from '../exames/public-api.js';
import {
  type ContextoRelatorio,
  type GravadorSghRelatorio,
  METODOS_PORTA_RELATORIO,
  type PortaRelatorio,
} from './porta.js';

function gravador(e: Escritor, hospital: string): GravadorSghRelatorio {
  return {
    gravarPropostas: (p) => gravarPropostasTriagem(e, hospital, p),
    decidirTriagem: (id, d, u) => decidirTriagem(e, hospital, id, d, u),
    criarAgendamento: (a, u, p) => criarAgendamentoRelatorio(e, hospital, a, u, p),
    alterarAgendamento: (id, a, u, p) => alterarAgendamentoRelatorio(e, hospital, id, a, u, p),
    registrarResultadoEnvio: (id, r) => registrarResultadoEnvio(e, hospital, id, r),
    registrarExecucao: (x) => registrarExecucaoRelatorio(e, hospital, x),
    criarPedido: (p, u) => criarPedidoRelatorio(e, hospital, p, u),
    responderPedido: (id, r, u) => responderPedidoRelatorio(e, hospital, id, r, u),
    lerPedidoTravado: (id) => lerPedidoRelatorio(e, hospital, id, { travar: true }),
    lerAgendamentoTravado: (id) => lerAgendamentoRelatorio(e, hospital, id, { travar: true }),
    alterarPedido: (id, p, u) => alterarPedidoRelatorio(e, hospital, id, p, u),
    cancelarPedido: (id, m, u) => cancelarPedidoRelatorio(e, hospital, id, m, u),
    excluirPedido: (id) => excluirPedidoRelatorio(e, hospital, id),
    excluirAgendamento: (id) => excluirAgendamentoRelatorio(e, hospital, id),
    registrarEvento: (ev, u) => registrarEventoRelatorio(e, hospital, ev, u),
  };
}

type Ler = <T>(c: ContextoRelatorio, fn: (l: Leitor) => Promise<T>) => Promise<T>;

function leituras(ler: Ler): Omit<PortaRelatorio, 'destino' | 'gravarSgh'> {
  return {
    relogio: (c) =>
      ler(c, async (l) => {
        const r = await relogioRecepcao(l);
        // O relógio de parede do banco nos campos UTC (como as datas lidas do legado).
        return { agora: new Date(`${r.agora}Z`), hoje: r.hoje };
      }),
    executar: (c, codigo, valores, o) => ler(c, (l) => executarRelatorioCatalogo(l, codigo, valores, o)),
    acessoDeOrigem: (c, codigo, usuario) =>
      ler(c, (l) => acessoDeOrigem(l, c.hospital, codigo, usuario, null)),
    inventario: (c) => ler(c, (l) => inventarioRelatoriosOrigem(l)),
    triagem: (c, f) => ler(c, (l) => lerTriagem(l, c.hospital, f)),
    umaTriagem: (c, id) => ler(c, (l) => lerUmaTriagem(l, c.hospital, id)),
    resumoTriagem: (c) => ler(c, (l) => resumoTriagem(l, c.hospital)),
    agendamentos: (c) => ler(c, (l) => lerAgendamentosRelatorio(l, c.hospital)),
    agendamento: (c, id) => ler(c, (l) => lerAgendamentoRelatorio(l, c.hospital, id)),
    vencidos: (c, lote) => ler(c, (l) => agendamentosVencidos(l, c.hospital, lote)),
    historicoOrigem: (c) => ler(c, (l) => historicoEnvioOrigem(l)),
    execucoes: (c, f) => ler(c, (l) => lerExecucoesRelatorio(l, c.hospital, f)),
    pedidos: (c, f) => ler(c, (l) => lerPedidosRelatorio(l, c.hospital, f)),
    pedido: (c, id) => ler(c, (l) => lerPedidoRelatorio(l, c.hospital, id)),
    eventos: (c, alvo, id) => ler(c, (l) => lerEventosRelatorio(l, c.hospital, alvo, id)),
    dependencias: (c, alvo, id) => ler(c, (l) => contarDependenciasRelatorio(l, c.hospital, alvo, id)),
  };
}

export function portaRelatorioLegado(nucleo: NucleoLegado): PortaRelatorio {
  const ctx = (c: ContextoRelatorio) => ({ rede: c.rede, hospital: c.hospital, traceId: 'relatorio' });
  return {
    destino: 'legado',
    gravarSgh: (c, trilha, fn) =>
      nucleo.gravarSgh(ctx(c), async (e) => {
        const r = await fn(gravador(e, c.hospital));
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      }),
    ...leituras((c, fn) => nucleo.lerSomente(ctx(c), fn)),
  };
}

/** A porta sobre uma transação aberta (testes de integração na cópia, desfeita no fim). */
export function portaRelatorioNaTransacao(e: Escritor): PortaRelatorio {
  return {
    destino: 'legado',
    async gravarSgh(c, trilha, fn) {
      const r = await fn(gravador(e, c.hospital));
      await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
      return r;
    },
    ...leituras((_c, fn) => fn(e)),
  };
}

export function portaRelatorioIndisponivel(): PortaRelatorio {
  return portaIndisponivel<PortaRelatorio>(METODOS_PORTA_RELATORIO);
}
