// Porta da farmácia sobre o núcleo do legado (M29): leituras READ ONLY pelos repositórios de @sgh/legado; gravações
// pelo EXECUTOR (receitas suprimentos.*, com a trilha na mesma transação); as só do novo em transação SGH_ com a
// SGH_TRILHA junto. Em dev sobre a cópia compartilhada, o executor só de leitura recusa as gravações (como nos outros
// módulos). `portaFarmaciaNaTransacao`: a mesma porta sobre UMA transação aberta (os testes de integração na cópia).
import {
  aceitesDasEntregas,
  avaliacoesSgh,
  conferenciasControlado,
  conferirControladoSgh,
  decidirAvaliacaoSgh,
  dispensacoesAmbulatoriais,
  dispensarAmbulatorialSgh,
  dosesDaSaida,
  dosesDoAtendimento,
  entregasPorSituacao,
  janelaEntregas,
  locaisEstoque,
  lotesDoLocal,
  type Escritor,
  escriturarSngpcSgh,
  type Executor,
  fecharLivroSgh,
  filaDaUnidade,
  type FonteCatalogo,
  gravarTrilha,
  intervencaoPorId,
  intervencoesDoPrescritor,
  intervencoesDosItens,
  itensControlados,
  itensDaFarmacia,
  itensPrescritosDosHorarios,
  type Leitor,
  leitosDosRegistros,
  livroFechado,
  type MetricasExecutor,
  movimentosControlados,
  type NucleoLegado,
  operacao,
  parametrosIntegracaoFarmacia,
  registrarIntervencaoSgh,
  registrarTriagemSgh,
  relogioFarmacia,
  responderIntervencaoSgh,
  situacoesDosHorariosFarmacia,
  substituicoesDosHorarios,
  totaisIntervencoes,
  unidadesFarmacia,
} from '@sgh/legado';
import { portaIndisponivel } from '../exames/public-api.js';
import {
  type ContextoFarmacia,
  type GravadorSghFarmacia,
  METODOS_PORTA_FARMACIA,
  type PortaFarmacia,
} from './porta.js';

function gravador(e: Escritor, hospital: string): GravadorSghFarmacia {
  return {
    triar: (t) => registrarTriagemSgh(e, { hospital, ...t }),
    decidir: (d) => decidirAvaliacaoSgh(e, { hospital, ...d }),
    intervir: (i) => registrarIntervencaoSgh(e, { hospital, ...i }),
    responder: (r) => responderIntervencaoSgh(e, { hospital, ...r }),
    conferirControlado: (c) => conferirControladoSgh(e, { hospital, ...c }),
    fecharLivro: (f) => fecharLivroSgh(e, { hospital, ...f }),
    dispensarAmbulatorial: (d) => dispensarAmbulatorialSgh(e, { hospital, ...d }),
    escriturarSngpc: (s) => escriturarSngpcSgh(e, { hospital, ...s }),
  };
}

type Ler = <T>(c: ContextoFarmacia, fn: (l: Leitor) => Promise<T>) => Promise<T>;

function leituras(ler: Ler): Omit<PortaFarmacia, 'destino' | 'podeGravar' | 'executar' | 'gravarSgh'> {
  return {
    relogio: (c) => ler(c, (l) => relogioFarmacia(l)),
    unidades: (c) => ler(c, (l) => unidadesFarmacia(l)),
    filaDaUnidade: (c, o) => ler(c, (l) => filaDaUnidade(l, { ...o, hospital: c.hospital })),
    itens: (c, codigos) => ler(c, (l) => itensDaFarmacia(l, codigos)),
    avaliacoes: (c, itens) => ler(c, (l) => avaliacoesSgh(l, c.hospital, itens)),
    itensPrescritos: (c, lancamentos) => ler(c, (l) => itensPrescritosDosHorarios(l, lancamentos)),
    dosesDoAtendimento: (c, reg, desde) => ler(c, (l) => dosesDoAtendimento(l, reg, desde)),
    situacoes: (c, horarios) => ler(c, (l) => situacoesDosHorariosFarmacia(l, horarios)),
    entregas: (c, o) => ler(c, (l) => entregasPorSituacao(l, o)),
    dosesDaSaida: (c, saida) => ler(c, (l) => dosesDaSaida(l, saida)),
    leitos: (c, regs) => ler(c, (l) => leitosDosRegistros(l, regs)),
    aceites: (c, controles) => ler(c, (l) => aceitesDasEntregas(l, c.hospital, controles)),
    intervencoesDosItens: (c, itens) => ler(c, (l) => intervencoesDosItens(l, c.hospital, itens)),
    intervencoesDoPrescritor: (c, login) => ler(c, (l) => intervencoesDoPrescritor(l, c.hospital, login)),
    intervencao: (c, id) => ler(c, (l) => intervencaoPorId(l, c.hospital, id)),
    totaisIntervencoes: (c, desde) => ler(c, (l) => totaisIntervencoes(l, c.hospital, desde)),
    substituicoes: (c, horarios) => ler(c, (l) => substituicoesDosHorarios(l, horarios)),
    controlados: (c) => ler(c, (l) => itensControlados(l)),
    movimentos: (c, o) => ler(c, (l) => movimentosControlados(l, o)),
    conferencias: (c, desde) => ler(c, (l) => conferenciasControlado(l, c.hospital, desde)),
    livroFechado: (c, livro, inicio) => ler(c, (l) => livroFechado(l, c.hospital, livro, inicio)),
    parametrosIntegracao: (c) => ler(c, (l) => parametrosIntegracaoFarmacia(l)),
    ambulatoriais: (c, desde) => ler(c, (l) => dispensacoesAmbulatoriais(l, c.hospital, desde)),
    locais: (c) => ler(c, (l) => locaisEstoque(l)),
    lotes: (c, item, local) =>
      ler(c, async (l) =>
        (await lotesDoLocal(l, item, local, '1899-12-30', 0)).map((x) => ({
          id: x.id,
          lote: x.lote,
          validade: x.validade,
          quantidade: x.quantidade,
        })),
      ),
    janelaEntregas: (c) => ler(c, (l) => janelaEntregas(l)),
  };
}

export function portaFarmaciaLegado(
  nucleo: NucleoLegado,
  catalogo: FonteCatalogo,
  metricas?: MetricasExecutor,
  executorPronto?: Executor,
): PortaFarmacia {
  const executor = executorPronto ?? nucleo.criarExecutor({ catalogo, ...(metricas ? { metricas } : {}) });
  const ctx = (c: ContextoFarmacia) => ({ rede: c.rede, hospital: c.hospital, traceId: 'farmacia' });
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

/** A porta sobre uma transação aberta (testes de integração na cópia, desfeita no fim). */
export function portaFarmaciaNaTransacao(e: Escritor, executor: Executor): PortaFarmacia {
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

export function portaFarmaciaIndisponivel(): PortaFarmacia {
  return portaIndisponivel<PortaFarmacia>(METODOS_PORTA_FARMACIA);
}
