// Porta do repasse sobre o núcleo do legado (M33): leituras READ ONLY pelos repositórios de @sgh/legado; gravações pelo
// EXECUTOR (receitas repasse.*, com a trilha na mesma transação); as só do novo em transação SGH_ com a SGH_TRILHA
// junto. Em dev sobre a cópia compartilhada, o executor só de leitura recusa as gravações (como nos outros módulos).
// `portaRepasseNaTransacao`: a mesma porta sobre UMA transação aberta (integração na cópia, desfeita).
import {
  adiantamentosDosPrestadores,
  apuracaoDoPeriodo,
  apuracaoPorId,
  basesIndicadoresRepasse,
  buscarPrestadoresRepasse,
  decidirVersaoRegraSgh,
  type Escritor,
  estadoDoPeriodo,
  estornosDosLancamentos,
  type Executor,
  type FonteCatalogo,
  gravarApuracaoSgh,
  gravarTrilha,
  hojeFinanceiro,
  itensJaIntegrados,
  lancamentosDoPeriodo,
  lancamentosDosPrestadores,
  lancamentosJaEmRpa,
  type Leitor,
  marcarVersaoSimuladaSgh,
  memoriasDaApuracao,
  type MetricasExecutor,
  type NucleoLegado,
  operacao,
  opcoesRepasse,
  prestadoresDoUsuario,
  producaoDoPeriodo,
  proporVersaoRegraSgh,
  regrasCandidatas,
  regrasUsadas,
  registroDoPrestador,
  rpaDetalhe,
  rpasDoPeriodo,
  rpasDosPrestadores,
  todasRegrasCandidatas,
  transicionarApuracaoSgh,
  versaoRegra,
  versoesRegra,
} from '@sgh/legado';
import { portaIndisponivel } from '../exames/public-api.js';
import {
  type ContextoRepasse,
  type GravadorSghRepasse,
  METODOS_PORTA_REPASSE,
  type PortaRepasse,
} from './porta.js';

function gravador(e: Escritor, hospital: string): GravadorSghRepasse {
  return {
    proporVersao: (d) => proporVersaoRegraSgh(e, { hospital, ...d }),
    marcarSimulada: (d) => marcarVersaoSimuladaSgh(e, { hospital, ...d }),
    decidirVersao: (d) => decidirVersaoRegraSgh(e, { hospital, ...d }),
    gravarApuracao: (d) => gravarApuracaoSgh(e, { hospital, ...d }),
    transicionarApuracao: (d) => transicionarApuracaoSgh(e, { hospital, ...d }),
  };
}

type Ler = <T>(c: ContextoRepasse, fn: (l: Leitor) => Promise<T>) => Promise<T>;

function leituras(ler: Ler): Omit<PortaRepasse, 'destino' | 'podeGravar' | 'executar' | 'gravarSgh'> {
  return {
    hoje: (c) => ler(c, (l) => hojeFinanceiro(l)),
    opcoes: (c) => ler(c, (l) => opcoesRepasse(l)),
    regras: (c, f) => ler(c, (l) => regrasCandidatas(l, f)),
    todasRegras: (c, f) => ler(c, (l) => todasRegrasCandidatas(l, f)),
    regrasUsadas: (c, ids) => ler(c, (l) => regrasUsadas(l, ids)),
    versoes: (c) => ler(c, (l) => versoesRegra(l, c.hospital)),
    versao: (c, id) => ler(c, (l) => versaoRegra(l, c.hospital, id)),
    producao: (c, competencia, depoisDe) => ler(c, (l) => producaoDoPeriodo(l, { competencia, depoisDe })),
    jaIntegrados: (c, itens) => ler(c, (l) => itensJaIntegrados(l, itens)),
    estadoPeriodo: (c, empresa, competencia) => ler(c, (l) => estadoDoPeriodo(l, empresa, competencia)),
    apuracaoDoPeriodo: (c, empresa, competencia) =>
      ler(c, (l) => apuracaoDoPeriodo(l, c.hospital, empresa, competencia)),
    apuracao: (c, id) => ler(c, (l) => apuracaoPorId(l, c.hospital, id)),
    memorias: (c, id, prestador) => ler(c, (l) => memoriasDaApuracao(l, c.hospital, id, prestador)),
    lancamentos: (c, f) => ler(c, (l) => lancamentosDoPeriodo(l, f)),
    estornos: (c, ids) => ler(c, (l) => estornosDosLancamentos(l, c.hospital, ids)),
    rpas: (c, f) => ler(c, (l) => rpasDoPeriodo(l, f)),
    rpaDetalhe: (c, id) => ler(c, (l) => rpaDetalhe(l, c.hospital, id)),
    buscarPrestadores: (c, termo) => ler(c, (l) => buscarPrestadoresRepasse(l, termo)),
    jaEmRpa: (c, ids) => ler(c, (l) => lancamentosJaEmRpa(l, ids)),
    prestadoresDoUsuario: (c, login) => ler(c, (l) => prestadoresDoUsuario(l, login)),
    registroDoPrestador: (c, p) => ler(c, (l) => registroDoPrestador(l, p)),
    lancamentosDosPrestadores: (c, ps, desde, ate) =>
      ler(c, (l) => lancamentosDosPrestadores(l, ps, desde, ate ?? null)),
    rpasDosPrestadores: (c, ps, desde, ate) => ler(c, (l) => rpasDosPrestadores(l, ps, desde, ate ?? null)),
    adiantamentos: (c, ps) => ler(c, (l) => adiantamentosDosPrestadores(l, ps)),
    basesIndicadores: (c, de, ate) => ler(c, (l) => basesIndicadoresRepasse(l, de, ate)),
  };
}

export function portaRepasseLegado(
  nucleo: NucleoLegado,
  catalogo: FonteCatalogo,
  metricas?: MetricasExecutor,
  executorPronto?: Executor,
): PortaRepasse {
  const executor = executorPronto ?? nucleo.criarExecutor({ catalogo, ...(metricas ? { metricas } : {}) });
  const ctx = (c: ContextoRepasse) => ({ rede: c.rede, hospital: c.hospital, traceId: 'repasse' });
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
        const r = await fn(gravador(e, c.hospital));
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      }),
    ...leituras((c, fn) => nucleo.lerSomente(ctx(c), fn)),
  };
}

export function portaRepasseNaTransacao(e: Escritor, executor: Executor): PortaRepasse {
  return {
    destino: 'legado',
    podeGravar: (c, op, usuarioLegado) =>
      executor.liberacao(operacao(op), { rede: c.rede, hospital: c.hospital, usuarioLegado }),
    async executar(c, op, entrada, octx) {
      const r = await executor.executar(operacao(op), c.hospital, entrada, octx, { escritor: e });
      return { resultado: r.resultado, repetida: r.repetida, trilha: r.trilha };
    },
    async gravarSgh(c, trilha, fn) {
      const r = await fn(gravador(e, c.hospital));
      await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
      return r;
    },
    ...leituras((_c, fn) => fn(e)),
  };
}

export function portaRepasseIndisponivel(): PortaRepasse {
  return portaIndisponivel<PortaRepasse>(METODOS_PORTA_REPASSE);
}
