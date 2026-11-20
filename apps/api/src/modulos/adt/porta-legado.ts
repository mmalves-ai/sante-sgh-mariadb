// Porta da internação, dos leitos, da higienização e do SAME sobre o núcleo do legado (M21): leituras READ ONLY pelos
// repositórios de @sgh/legado; gravações pelo EXECUTOR (receitas internacao.*, hotelaria.*, same.*, com a trilha na
// mesma transação); as gravações só do novo em transação SGH_ com a SGH_TRILHA junto. Em dev sobre a cópia
// compartilhada, o executor só de leitura recusa as gravações (como nos outros módulos).
import {
  abrirEstadoLeito,
  alterarEstadoLeitoSgh,
  limparAtributosLeitoSgh,
  altaMedicaAberta,
  altasMedicasDecididas,
  apoioInternacao,
  buscarCidInternacao,
  buscarMedicos,
  cancelarAltaMedica,
  contaDoCodigo,
  dadosImpressoInternacao,
  devolucoesAtrasadas,
  encerrarEstadoLeito,
  estadosDoMapa,
  etapasDaSolicitacao,
  limpezasLiberadasNoPeriodo,
  fichasDaInternacao,
  type Executor,
  type FonteCatalogo,
  gravarAtributoLeito,
  gravarEtapaLimpeza,
  gravarSameExt,
  gravarTrilha,
  historicoOcupacao,
  internacaoDetalhe,
  internacoesDaLista,
  type Leitor,
  lerLeiturasPainel,
  leitoDaSolicitacaoLimpeza,
  localizacaoDaConta,
  type MetricasExecutor,
  type NucleoLegado,
  operacao,
  pacienteParaLeito,
  preInternacaoDoPaciente,
  preInternacoes,
  profissionalDoLogin,
  profissionalLimpezaDoLogin,
  registrarAltaMedica,
  registrarConflitoLeito,
  registrarConflitoReservaSgh,
  relatorioIncoerencias,
  relogioRecepcao,
  solicitacoesDaFila,
} from '@sgh/legado';
import { portaIndisponivel } from '../exames/public-api.js';
import { type ContextoAdt, METODOS_PORTA_ADT, type PortaAdt } from './porta.js';

export function portaAdtLegado(
  nucleo: NucleoLegado,
  catalogo: FonteCatalogo,
  metricas?: MetricasExecutor,
  executorPronto?: Executor,
): PortaAdt {
  const executor = executorPronto ?? nucleo.criarExecutor({ catalogo, ...(metricas ? { metricas } : {}) });
  const ctx = (c: ContextoAdt) => ({ rede: c.rede, hospital: c.hospital, traceId: 'internacao' });
  const ler = <T>(c: ContextoAdt, fn: (l: Leitor) => Promise<T>) => nucleo.lerSomente(ctx(c), fn);
  return {
    destino: 'legado',
    podeGravar: (c, op, usuarioLegado) =>
      executor.liberacao(operacao(op), { rede: c.rede, hospital: c.hospital, usuarioLegado }),
    async executar(c, op, entrada, octx) {
      const r = await executor.executar(operacao(op), c.hospital, entrada, octx);
      return { resultado: r.resultado, repetida: r.repetida, trilha: r.trilha };
    },
    gravarSgh: (c, trilha, fn) =>
      nucleo.gravarSgh(ctx(c), async (e) => {
        const h = c.hospital;
        // O registro do conflito que não alterou linha (já registrado por outra tela): nada vai à trilha.
        let semEfeito = false;
        const r = await fn({
          registrarAltaMedica: (x) => registrarAltaMedica(e, { hospital: h, ...x }),
          cancelarAltaMedica: (x) => cancelarAltaMedica(e, { hospital: h, ...x }),
          abrirEstadoLeito: (x) => abrirEstadoLeito(e, { hospital: h, ...x }),
          encerrarEstadoLeito: (x) => encerrarEstadoLeito(e, { hospital: h, ...x }),
          registrarConflito: async (x) => {
            const n = await registrarConflitoLeito(e, { hospital: h, ...x });
            semEfeito = n === 0;
            return n;
          },
          registrarConflitoReserva: async (x) => {
            const n = await registrarConflitoReservaSgh(e, { hospital: h, ...x });
            semEfeito = n === 0;
            return n;
          },
          gravarAtributo: (x) => gravarAtributoLeito(e, { hospital: h, ...x }),
          alterarEstadoLeito: (x) => alterarEstadoLeitoSgh(e, { hospital: h, ...x }),
          limparAtributos: (x) => limparAtributosLeitoSgh(e, { hospital: h, ...x }),
          gravarEtapaLimpeza: (x) => gravarEtapaLimpeza(e, { hospital: h, ...x }),
          gravarSameExt: (x) => gravarSameExt(e, { hospital: h, ...x }),
        });
        if (!semEfeito) await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      }),
    relogio: (c) => ler(c, (l) => relogioRecepcao(l)),
    internacoes: (c, o) => ler(c, (l) => internacoesDaLista(l, o)),
    detalhe: (c, reg, intensivas) => ler(c, (l) => internacaoDetalhe(l, reg, intensivas)),
    altaMedica: (c, reg) => ler(c, (l) => altaMedicaAberta(l, c.hospital, reg)),
    altasMedicas: (c, regs) => ler(c, (l) => altasMedicasDecididas(l, c.hospital, regs)),
    preInternacoes: (c, o) => ler(c, (l) => preInternacoes(l, o)),
    preDoPaciente: (c, p) => ler(c, (l) => preInternacaoDoPaciente(l, p)),
    leiturasPainel: (c) => ler(c, (l) => lerLeiturasPainel(l)),
    estadosDoMapa: (c, o) => ler(c, (l) => estadosDoMapa(l, c.hospital, o)),
    historico: (c, o) => ler(c, (l) => historicoOcupacao(l, o)),
    solicitacoes: (c, o) => ler(c, (l) => solicitacoesDaFila(l, c.hospital, o)),
    etapas: (c, s) => ler(c, (l) => etapasDaSolicitacao(l, c.hospital, s)),
    limpezasLiberadas: (c, de, ate) => ler(c, (l) => limpezasLiberadasNoPeriodo(l, c.hospital, de, ate)),
    leitoDaSolicitacao: (c, s) => ler(c, (l) => leitoDaSolicitacaoLimpeza(l, s)),
    contaDoCodigo: (c, codigo) => ler(c, (l) => contaDoCodigo(l, codigo)),
    localizacao: (c, conta, o) => ler(c, (l) => localizacaoDaConta(l, c.hospital, conta, o)),
    devolucoesAtrasadas: (c, o) => ler(c, (l) => devolucoesAtrasadas(l, c.hospital, o)),
    apoio: (c) => ler(c, (l) => apoioInternacao(l)),
    medicos: (c, t) => ler(c, (l) => buscarMedicos(l, t)),
    cid: (c, t) => ler(c, (l) => buscarCidInternacao(l, t)),
    incoerencias: (c) => ler(c, (l) => relatorioIncoerencias(l)),
    impresso: (c, reg) => ler(c, (l) => dadosImpressoInternacao(l, reg)),
    pacienteParaLeito: (c, q) => ler(c, (l) => pacienteParaLeito(l, q)),
    fichas: (c, reg) => ler(c, (l) => fichasDaInternacao(l, reg)),
    profissional: (c, login) => ler(c, (l) => profissionalDoLogin(l, login)),
    profissionalLimpeza: (c, login) => ler(c, (l) => profissionalLimpezaDoLogin(l, login)),
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaAdtIndisponivel(): PortaAdt {
  return portaIndisponivel<PortaAdt>(METODOS_PORTA_ADT);
}
