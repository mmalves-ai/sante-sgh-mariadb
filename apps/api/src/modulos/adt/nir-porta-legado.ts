// Porta do NIR sobre o núcleo do legado (M44, etapa 2): leituras READ ONLY pelos repositórios de @sgh/legado; as
// gravações só do novo (solicitação, transição, reserva, alta prevista, barreiras, limites, de-para) numa transação
// SGH_ com a SGH_TRILHA junto. A admissão e a transferência vindas do NIR não passam por aqui: vão pelo executor (M21),
// com a solicitação concluída na mesma transação. Em dev sobre a cópia compartilhada, as gravações SGH_ são recusadas
// (`sghSoLeitura`), como nos outros módulos.
import {
  alterarBarreiraSgh,
  alterarReservaSgh,
  corrigirSolicitacaoSgh,
  excluirReservaSgh,
  excluirSolicitacaoSgh,
  removerLimitePermanenciaSgh,
  retirarDpaSgh,
  configuracaoRegulacao,
  registrarRegulacaoSgh,
  regulacoesDasSolicitacoes,
  aprovarDeparaSituacaoSgh,
  barreiraNir,
  barreirasDasInternacoes,
  cirurgiasComSolicitacaoNir,
  cirurgiasQuePedemUti,
  confirmarReservaSgh,
  deparaAprovadoNir,
  dpasDasInternacoes,
  encerrarReservaSgh,
  eventosDasSolicitacoesNir,
  type Executor,
  type FonteCatalogo,
  gravarLimitePermanenciaSgh,
  gravarTrilha,
  histogramasPermanencia,
  internacaoParaNir,
  internadosDoQuadro,
  type Leitor,
  limitesPermanencia,
  type MetricasExecutor,
  type NucleoLegado,
  operacao,
  registrarBarreiraSgh,
  registrarDpaSgh,
  registrarReservaSgh,
  relogioRecepcao,
  reservasEncerradasNir,
  reservasVigentesNir,
  resolverBarreiraSgh,
  situacoesRegulacaoLeito,
  solicitacaoNir,
  solicitacoesAbertasNir,
  solicitacoesConcluidasNir,
  solicitarLeitoSgh,
  somenteSgh,
  transicionarSolicitacaoSgh,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import { portaIndisponivel } from '../exames/public-api.js';
import { type ContextoNir, METODOS_PORTA_NIR, type PortaNir } from './nir-porta.js';

export function portaNirLegado(
  nucleo: NucleoLegado,
  catalogo: FonteCatalogo,
  metricas?: MetricasExecutor,
  executorPronto?: Executor,
  opcoes: { sghSoLeitura?: boolean } = {},
): PortaNir {
  const executor = executorPronto ?? nucleo.criarExecutor({ catalogo, ...(metricas ? { metricas } : {}) });
  const ctx = (c: ContextoNir) => ({ rede: c.rede, hospital: c.hospital, traceId: 'nir' });
  const ler = <T>(c: ContextoNir, fn: (l: Leitor) => Promise<T>) => nucleo.lerSomente(ctx(c), fn);
  return {
    destino: 'legado',
    podeGravar: (c, op, usuarioLegado) =>
      executor.liberacao(operacao(op), { rede: c.rede, hospital: c.hospital, usuarioLegado }),
    async executar(c, op, entrada, octx) {
      const r = await executor.executar(operacao(op), c.hospital, entrada, octx);
      return { resultado: r.resultado, repetida: r.repetida, trilha: r.trilha };
    },
    gravarSgh: (c, trilha, fn) => {
      if (opcoes.sghSoLeitura)
        return Promise.reject(
          new ErroProblema(
            'recurso-desligado',
            403,
            'Gravação desligada neste ambiente',
            'Neste ambiente de desenvolvimento o banco é só de leitura: o NIR não grava.',
            { codigo: 'somente-leitura' },
          ),
        );
      return nucleo.gravarSgh(ctx(c), async (e0) => {
        const e = somenteSgh(e0);
        const h = c.hospital;
        const r = await fn({
          solicitar: (x) => solicitarLeitoSgh(e, { hospital: h, ...x }),
          transicionar: (x) => transicionarSolicitacaoSgh(e, { hospital: h, ...x }),
          reservar: (x) => registrarReservaSgh(e, { hospital: h, ...x }),
          confirmarReserva: (x) => confirmarReservaSgh(e, { hospital: h, ...x }),
          encerrarReserva: (x) => encerrarReservaSgh(e, { hospital: h, ...x }),
          registrarDpa: (x) => registrarDpaSgh(e, { hospital: h, ...x }),
          registrarBarreira: (x) => registrarBarreiraSgh(e, { hospital: h, ...x }),
          resolverBarreira: (x) => resolverBarreiraSgh(e, { hospital: h, ...x }),
          gravarLimite: (x) => gravarLimitePermanenciaSgh(e, { hospital: h, ...x }),
          aprovarDepara: (x) => aprovarDeparaSituacaoSgh(e, { hospital: h, ...x }),
          registrarEvento: async (linha) => {
            await gravarTrilha(e, linha);
          },
          registrarRegulacao: (x) => registrarRegulacaoSgh(e, { hospital: h, ...x }),
          corrigirSolicitacao: (x) => corrigirSolicitacaoSgh(e, { hospital: h, ...x }),
          excluirSolicitacao: (x) => excluirSolicitacaoSgh(e, { hospital: h, ...x }),
          alterarReserva: (x) => alterarReservaSgh(e, { hospital: h, ...x }),
          excluirReserva: (x) => excluirReservaSgh(e, { hospital: h, ...x }),
          retirarDpa: (x) => retirarDpaSgh(e, { hospital: h, ...x }),
          alterarBarreira: (x) => alterarBarreiraSgh(e, { hospital: h, ...x }),
          removerLimite: (x) => removerLimitePermanenciaSgh(e, { hospital: h, ...x }),
        });
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      });
    },
    relogio: (c) => ler(c, (l) => relogioRecepcao(l)),
    abertas: (c) => ler(c, (l) => solicitacoesAbertasNir(l, c.hospital)),
    solicitacao: (c, id) => ler(c, (l) => solicitacaoNir(l, c.hospital, id)),
    eventos: (c, ids) => ler(c, (l) => eventosDasSolicitacoesNir(l, c.hospital, ids)),
    concluidas: (c, desde) => ler(c, (l) => solicitacoesConcluidasNir(l, c.hospital, desde)),
    reservasVigentes: (c) => ler(c, (l) => reservasVigentesNir(l, c.hospital)),
    reservasEncerradas: (c) => ler(c, (l) => reservasEncerradasNir(l, c.hospital)),
    cirurgiasUti: (c) => ler(c, (l) => cirurgiasQuePedemUti(l, c.hospital)),
    cirurgiasComSolicitacao: (c, ids) => ler(c, (l) => cirurgiasComSolicitacaoNir(l, c.hospital, ids)),
    internados: (c) => ler(c, (l) => internadosDoQuadro(l)),
    internacao: (c, reg) => ler(c, (l) => internacaoParaNir(l, reg)),
    dpas: (c, regs) => ler(c, (l) => dpasDasInternacoes(l, c.hospital, regs)),
    barreiras: (c, regs) => ler(c, (l) => barreirasDasInternacoes(l, c.hospital, regs)),
    barreira: (c, id) => ler(c, (l) => barreiraNir(l, c.hospital, id)),
    limites: (c) => ler(c, (l) => limitesPermanencia(l, c.hospital)),
    depara: (c) => ler(c, (l) => deparaAprovadoNir(l, c.hospital)),
    situacoes: (c) => ler(c, (l) => situacoesRegulacaoLeito(l)),
    histogramas: (c, o) => ler(c, (l) => histogramasPermanencia(l, o)),
    regulacoes: (c, ids) => ler(c, (l) => regulacoesDasSolicitacoes(l, c.hospital, ids)),
    configuracaoRegulacao: (c) => ler(c, (l) => configuracaoRegulacao(l)),
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaNirIndisponivel(): PortaNir {
  return portaIndisponivel<PortaNir>(METODOS_PORTA_NIR);
}
