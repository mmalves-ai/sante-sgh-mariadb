// Porta do atendimento externo sobre o núcleo do legado (M20): leituras READ ONLY pelos repositórios de @sgh/legado;
// gravações pelo EXECUTOR (receitas atendimento.*, com a trilha na mesma transação); as gravações só do novo (etapa do
// PA, observação, impresso, paciente não identificado) em transação SGH_ com a SGH_TRILHA junto. Em dev sobre a cópia
// compartilhada, o executor só de leitura recusa as gravações (como nos outros módulos).
import {
  alocarObservacao,
  apoioAtendimento,
  atendimentoDetalhe,
  atendimentosDoDia,
  atendimentosPaAbertos,
  buscarCid,
  buscarProcedimentosDoConvenio,
  buscarSolicitantes,
  dadosDoImpresso,
  escoresPaDosAtendimentos,
  estornarEscorePa,
  type Executor,
  type FonteCatalogo,
  filaDoLocal,
  gravarEtapaPa,
  gravarImpresso,
  gravarTrilha,
  historicoAtendimentos,
  indicadoresAtendimento,
  type Leitor,
  leitosObservacao,
  liberarObservacao,
  identificarPaciente,
  locaisDeAtendimento,
  marcacaoParaAbertura,
  marcarNaoIdentificado,
  type MetricasExecutor,
  naoIdentificados,
  type NucleoLegado,
  operacao,
  previaCancelamento,
  profissionalDoLogin,
  registrarEscorePa,
  relogioRecepcao,
  sinaisRecentesDosAtendimentos,
} from '@sgh/legado';
import { portaIndisponivel } from '../exames/public-api.js';
import { type ContextoAtendimento, METODOS_PORTA_ATENDIMENTO, type PortaAtendimento } from './porta.js';

export function portaAtendimentoLegado(
  nucleo: NucleoLegado,
  catalogo: FonteCatalogo,
  metricas?: MetricasExecutor,
  executorPronto?: Executor,
): PortaAtendimento {
  const executor = executorPronto ?? nucleo.criarExecutor({ catalogo, ...(metricas ? { metricas } : {}) });
  const ctx = (c: ContextoAtendimento) => ({ rede: c.rede, hospital: c.hospital, traceId: 'atendimento' });
  const ler = <T>(c: ContextoAtendimento, fn: (l: Leitor) => Promise<T>) => nucleo.lerSomente(ctx(c), fn);
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
        const r = await fn({
          registrarEtapa: (x) => gravarEtapaPa(e, { hospital: c.hospital, ...x }),
          alocarObservacao: (x) => alocarObservacao(e, { hospital: c.hospital, ...x }),
          liberarObservacao: (x) => liberarObservacao(e, { hospital: c.hospital, ...x }),
          registrarImpresso: (x) => gravarImpresso(e, { hospital: c.hospital, ...x }),
          marcarNaoIdentificado: (x) => marcarNaoIdentificado(e, { hospital: c.hospital, ...x }),
          identificarPaciente: (x) => identificarPaciente(e, { hospital: c.hospital, ...x }),
          registrarEscorePa: (x) => registrarEscorePa(e, { hospital: c.hospital, ...x }),
          estornarEscorePa: (x) => estornarEscorePa(e, { hospital: c.hospital, ...x }),
        });
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      }),
    relogio: (c) => ler(c, (l) => relogioRecepcao(l)),
    atendimentosDoDia: (c, f) => ler(c, (l) => atendimentosDoDia(l, c.hospital, f)),
    marcacao: (c, id) => ler(c, (l) => marcacaoParaAbertura(l, id)),
    detalhe: (c, reg) => ler(c, (l) => atendimentoDetalhe(l, c.hospital, reg)),
    fila: (c, o) => ler(c, (l) => filaDoLocal(l, c.hospital, o)),
    locais: (c) => ler(c, (l) => locaisDeAtendimento(l)),
    paAbertos: (c, o) => ler(c, (l) => atendimentosPaAbertos(l, c.hospital, o)),
    observacao: (c) => ler(c, (l) => leitosObservacao(l, c.hospital)),
    indicadores: (c, o) => ler(c, (l) => indicadoresAtendimento(l, c.hospital, o)),
    apoio: (c) => ler(c, (l) => apoioAtendimento(l)),
    cid: (c, t) => ler(c, (l) => buscarCid(l, t)),
    solicitantes: (c, t) => ler(c, (l) => buscarSolicitantes(l, t)),
    procedimentos: (c, conv, t) => ler(c, (l) => buscarProcedimentosDoConvenio(l, conv, t)),
    historico: (c, p) => ler(c, (l) => historicoAtendimentos(l, p)),
    previaCancelamento: (c, reg) => ler(c, (l) => previaCancelamento(l, c.hospital, reg)),
    dadosImpresso: (c, reg) => ler(c, (l) => dadosDoImpresso(l, reg)),
    profissional: (c, login) => ler(c, (l) => profissionalDoLogin(l, login)),
    naoIdentificados: (c) => ler(c, (l) => naoIdentificados(l, c.hospital)),
    escoresPa: (c, cabs) => ler(c, (l) => escoresPaDosAtendimentos(l, c.hospital, cabs)),
    sinaisPa: (c, itens) =>
      ler(c, async (l) => {
        // A hora local do banco na convenção do repositório (os campos UTC do Date levam a hora local).
        const local = (t: string) => new Date(`${t.length === 10 ? `${t}T00:00:00` : t.slice(0, 19)}Z`);
        const m = await sinaisRecentesDosAtendimentos(
          l,
          c.hospital,
          itens.map((i) => ({ atendimento: Number(i.cabecalho), desde: local(i.desde) })),
        );
        return new Map([...m].map(([k, v]) => [String(k), v]));
      }),
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaAtendimentoIndisponivel(): PortaAtendimento {
  return portaIndisponivel<PortaAtendimento>(METODOS_PORTA_ATENDIMENTO);
}
