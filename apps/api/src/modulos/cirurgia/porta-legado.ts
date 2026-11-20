// Porta do centro cirúrgico sobre o núcleo do legado (M18): leituras READ ONLY pelos repositórios de @sgh/legado;
// gravações pelo EXECUTOR (receitas cirurgia.*, com a trilha na mesma transação); as gravações só do novo
// (solicitação, andamento, pendências, revisão da ligação) em transação SGH_ com a SGH_TRILHA junto. Fora de dev/ci,
// sem o núcleo, a porta indisponível responde 503.
import {
  agendamentosDoPeriodo,
  agendamentosDosRegs,
  buscarProcedimentos,
  buscarProfissionais,
  cancelamentosCirurgia,
  agendamentosDoCirurgiao,
  estadosDoPeriodo,
  estadosDoPortal,
  alterarPedidoPortal,
  versoesDosPedidos,
  estadosDosAgendamentos,
  type Escritor,
  type Executor,
  type FonteCatalogo,
  gravarLigacaoCirurgia,
  gravarPendencia,
  gravarTrilha,
  historicoDoAgendamento,
  historicoDoPeriodo,
  incluirEstado,
  type Leitor,
  lerAgendamento,
  lerEstadoCirurgia,
  lerPacientesPorIds,
  lerRealizada,
  ligacoesCirurgia,
  type MetricasExecutor,
  mudarEstado,
  nomesProcedimentos,
  nomesProfissionais,
  type NucleoLegado,
  opcoesCirurgia,
  operacao,
  pacientePorProntuario,
  pendenciasDoEstado,
  procedimentosAdicionais,
  profissionaisDoBloco,
  profissionaisPorRegistro,
  realizadasDoPeriodo,
  registrosExt,
  relogioDaAgenda,
  retirarPedidoPortal,
  salasCirurgicas,
  usuariosDaSala,
} from '@sgh/legado';
import { type ContextoPortaM18, portaIndisponivel } from '../exames/public-api.js';
import { METODOS_PORTA_CIRURGIA, type PortaCirurgia } from './porta.js';

type LerCirurgia = <T>(c: ContextoPortaM18, fn: (l: Leitor) => Promise<T>) => Promise<T>;
type GravarCirurgia = <T>(c: ContextoPortaM18, fn: (e: Escritor) => Promise<T>) => Promise<T>;

function montarPorta(executor: Executor, ler: LerCirurgia, gravar: GravarCirurgia): PortaCirurgia {
  return {
    destino: 'legado',
    podeGravar: (c, op, usuarioLegado) =>
      executor.liberacao(operacao(op), { rede: c.rede, hospital: c.hospital, usuarioLegado }),
    async executar(c, op, entrada, octx) {
      const r = await executor.executar(operacao(op), c.hospital, entrada, octx);
      return { resultado: r.resultado, repetida: r.repetida, trilha: r.trilha };
    },
    gravarSgh: (c, trilha, fn) =>
      gravar(c, async (e) => {
        const h = c.hospital;
        const r = await fn({
          solicitar: (x) =>
            incluirEstado(e, {
              hospital: h,
              idCcagenda: null,
              sala: x.sala,
              data: x.data,
              hora: x.hora,
              duracaoMin: x.duracaoMin,
              intervaloMin: 0,
              reg: x.reg,
              pront: x.pront,
              idPaciente: x.idPaciente,
              procedimento: x.procedimento,
              convenio: x.convenio,
              cirurgiao: x.cirurgiao,
              carater: x.carater,
              anestesia: x.anestesia,
              estado: 'solicitado',
              observacao: x.observacao,
              usuario: x.usuario,
              portal: x.portal ?? null,
            }),
          retirarPedidoPortal: (x) => retirarPedidoPortal(e, { hospital: h, ...x }),
          alterarPedidoPortal: (x) => alterarPedidoPortal(e, { hospital: h, ...x }),
          mudarEstado: (x) => mudarEstado(e, { hospital: h, ...x }),
          gravarPendencia: (x) => gravarPendencia(e, { hospital: h, ...x }),
          gravarLigacao: (x) =>
            gravarLigacaoCirurgia(e, { hospital: h, ...x, preinternacao: null, origem: 'revisao' }),
        });
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      }),
    relogio: (c) => ler(c, (l) => relogioDaAgenda(l)),
    salas: (c, login) => ler(c, (l) => salasCirurgicas(l, login)),
    usuariosDaSala: (c, sala) => ler(c, (l) => usuariosDaSala(l, sala)),
    agendamentos: (c, de, ate, salas) => ler(c, (l) => agendamentosDoPeriodo(l, de, ate, salas)),
    agendamento: (c, id) => ler(c, (l) => lerAgendamento(l, id)),
    adicionais: (c, sala, inicio) => ler(c, (l) => procedimentosAdicionais(l, sala, inicio)),
    historico: (c, sala, inicio) => ler(c, (l) => historicoDoAgendamento(l, sala, inicio)),
    historicoDoPeriodo: (c, de, ate) => ler(c, (l) => historicoDoPeriodo(l, de, ate)),
    cancelados: (c, de, ate) => ler(c, (l) => cancelamentosCirurgia(l, de, ate)),
    realizadas: (c, f) => ler(c, (l) => realizadasDoPeriodo(l, f)),
    realizada: (c, id) => ler(c, (l) => lerRealizada(l, id)),
    agendamentosDosRegs: (c, regs) => ler(c, (l) => agendamentosDosRegs(l, regs)),
    profissionaisDoBloco: (c) => ler(c, (l) => profissionaisDoBloco(l)),
    buscarProfissionais: (c, q) => ler(c, (l) => buscarProfissionais(l, q)),
    nomesProfissionais: (c, ids) => ler(c, (l) => nomesProfissionais(l, ids)),
    profissionaisPorRegistro: (c, ids) => ler(c, (l) => profissionaisPorRegistro(l, ids)),
    nomesProcedimentos: (c, cods) => ler(c, (l) => nomesProcedimentos(l, cods)),
    buscarProcedimentos: (c, q) => ler(c, (l) => buscarProcedimentos(l, q)),
    opcoes: (c) => ler(c, (l) => opcoesCirurgia(l)),
    pacientePorProntuario: (c, pront) => ler(c, (l) => pacientePorProntuario(l, pront)),
    pacientes: async (c, ids) =>
      ids.length === 0
        ? []
        : (await ler(c, (l) => lerPacientesPorIds(l, ids))).map((p) => ({
            id: p.id,
            nome: p.nome,
            prontuario: p.prontuario,
          })),
    estadosDoPeriodo: (c, de, ate) => ler(c, (l) => estadosDoPeriodo(l, c.hospital, de, ate)),
    estadosDosAgendamentos: (c, ids) => ler(c, (l) => estadosDosAgendamentos(l, c.hospital, ids)),
    estado: (c, id) => ler(c, (l) => lerEstadoCirurgia(l, c.hospital, id)),
    estadosDoPortal: (c, acesso, desde) => ler(c, (l) => estadosDoPortal(l, c.hospital, acesso, desde)),
    versoesDosPedidos: (c, ids) => ler(c, (l) => versoesDosPedidos(l, c.hospital, ids)),
    agendamentosDoCirurgiao: (c, ids, de, ate) => ler(c, (l) => agendamentosDoCirurgiao(l, ids, de, ate)),
    pendencias: (c, id) => ler(c, (l) => pendenciasDoEstado(l, c.hospital, id)),
    ligacoes: (c, ids) => ler(c, (l) => ligacoesCirurgia(l, c.hospital, ids)),
    registrosExt: (c, ids) => ler(c, (l) => registrosExt(l, c.hospital, ids)),
  };
}

export function portaCirurgiaLegado(
  nucleo: NucleoLegado,
  catalogo: FonteCatalogo,
  metricas?: MetricasExecutor,
  executorPronto?: Executor,
): PortaCirurgia {
  const executor = executorPronto ?? nucleo.criarExecutor({ catalogo, ...(metricas ? { metricas } : {}) });
  const ctx = (c: ContextoPortaM18) => ({ rede: c.rede, hospital: c.hospital, traceId: 'cirurgia' });
  return montarPorta(
    executor,
    (c, fn) => nucleo.lerSomente(ctx(c), fn),
    (c, fn) => nucleo.gravarSgh(ctx(c), fn),
  );
}

/** A mesma porta sobre UMA transação aberta (integração na cópia, desfeita; M50 etapa 3). */
export function portaCirurgiaNaTransacao(e: Escritor, executor: Executor): PortaCirurgia {
  return montarPorta(
    executor,
    (_c, fn) => fn(e),
    (_c, fn) => fn(e),
  );
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaCirurgiaIndisponivel(): PortaCirurgia {
  return portaIndisponivel<PortaCirurgia>(METODOS_PORTA_CIRURGIA);
}
