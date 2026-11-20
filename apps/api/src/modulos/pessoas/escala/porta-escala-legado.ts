// Porta da escala sobre o núcleo do legado (M52.2): cada leitura numa transação curta READ ONLY no banco do
// estabelecimento da sessão; as gravações SGH_PES_* numa transação SGH_ (`somenteSgh`: nenhuma tabela do outro sistema)
// com a SGH_TRILHA e a SGH_OUTBOX na mesma transação. A consulta à Rede (regra 7) lê o HMAC do CPF no banco local e,
// em cada OUTRO estabelecimento configurado, só os intervalos dos plantões da mesma pessoa; nenhuma transação cruza os
// bancos, e o estabelecimento que não responder conta como "sem resposta" (o plantão entra com o alerta; D-REDE-52).
// HS-1: hoje só o pc está configurado, então a Rede não tem outro estabelecimento a consultar. Em dev sobre a cópia
// compartilhada, as gravações são recusadas com o motivo (`sghSoLeitura`), como nos outros módulos.
// `portaEscalaNasTransacoes`: a mesma porta sobre transações abertas, uma por banco (integração, desfeita).
import {
  anularVigenciaRegimePesSgh,
  cancelarEscalaPesSgh,
  contarDependenciasEscalaPesSgh,
  excluirEscalaRascunhoPesSgh,
  historicoVigenciasPesSgh,
  vigenciaPorIdPesSgh,
  acionamentoPesSgh,
  acionamentosDosPlantoesPesSgh,
  alterarCoberturaPesSgh,
  cancelarAcionamentoPesSgh,
  cancelarTrocaPesSgh,
  classificacoesDaUnidade,
  decidirTrocaPesSgh,
  incluirAcionamentoPesSgh,
  incluirDimensionamentoPesSgh,
  incluirTrocaPesSgh,
  listarDimensionamentosPesSgh,
  listarTrocasPesSgh,
  plantoesEmTrocaAbertaPesSgh,
  plantoesNoInstantePesSgh,
  registrarChegadaPesSgh,
  responderTrocaPesSgh,
  transferirPlantaoPesSgh,
  trocaPesSgh,
  unidadesDeInternacao,
  alterarPlantaoPesSgh,
  alterarRegimePesSgh,
  atribuirRegimePesSgh,
  cancelarPlantaoPesSgh,
  cpfHmacDoVinculoPesSgh,
  type Escritor,
  escalaPesSgh,
  eventosDaEscalaPesSgh,
  gravarOutbox,
  gravarTrilha,
  incluirEscalaPesSgh,
  incluirEventoEscalaPesSgh,
  incluirPlantaoPesSgh,
  incluirRegimePesSgh,
  type Leitor,
  listarEscalasPesSgh,
  listarRegimesPesSgh,
  type NucleoLegado,
  plantaoPesSgh,
  plantoesDaEscalaPesSgh,
  plantoesDaPessoaPesSgh,
  plantoesNaRedePorCpfPesSgh,
  publicarEscalaPesSgh,
  regimePesSgh,
  somenteSgh,
  temposParciais,
  tiposJornada,
  tiposTrabalhoFolga,
  tocarEscalaPesSgh,
  travarPessoaPesSgh,
  vigenciasRegimePesSgh,
  eventosPeriodoDoVinculoPesSgh,
} from '@sgh/legado';
import { ErroProblema } from '../../../problema.filter.js';
import { portaIndisponivel } from '../../exames/public-api.js';
import {
  type ContextoEscala,
  type GravadorEscala,
  type JanelaPlantoes,
  METODOS_PORTA_ESCALA,
  type PlantoesDaRede,
  type PortaEscala,
  soLiberados,
} from './porta-escala.js';

type Ler = <T>(c: ContextoEscala, fn: (l: Leitor) => Promise<T>) => Promise<T>;
type LerEm = <T>(c: ContextoEscala, hospital: string, fn: (l: Leitor) => Promise<T>) => Promise<T>;

function gravador(e: Escritor, c: ContextoEscala): GravadorEscala {
  const h = c.hospital;
  return {
    escala: (id) => escalaPesSgh(e, h, id),
    plantao: (id) => plantaoPesSgh(e, h, id),
    plantoesDaEscala: (id) => plantoesDaEscalaPesSgh(e, h, id),
    plantoesDaPessoa: (p, j) => plantoesDaPessoaPesSgh(e, h, p, j),
    travarPessoa: (p) => travarPessoaPesSgh(e, h, p),
    regime: (id) => regimePesSgh(e, h, id),
    incluirRegime: (r) => incluirRegimePesSgh(e, { hospital: h, ...r }),
    alterarRegime: (r) => alterarRegimePesSgh(e, { hospital: h, ...r }),
    atribuirRegime: (a) => atribuirRegimePesSgh(e, { hospital: h, ...a }),
    incluirEscala: (s) => incluirEscalaPesSgh(e, { hospital: h, ...s }),
    alterarCobertura: (x) => alterarCoberturaPesSgh(e, { hospital: h, ...x }),
    tocarEscala: (t) => tocarEscalaPesSgh(e, { hospital: h, ...t }),
    publicarEscala: (p) => publicarEscalaPesSgh(e, { hospital: h, ...p }),
    incluirPlantao: (p) => incluirPlantaoPesSgh(e, { hospital: h, ...p }),
    alterarPlantao: (m) => alterarPlantaoPesSgh(e, { hospital: h, ...m }),
    cancelarPlantao: (x) => cancelarPlantaoPesSgh(e, { hospital: h, ...x }),
    evento: (ev) => incluirEventoEscalaPesSgh(e, { hospital: h, ...ev }),
    outbox: (ev) => gravarOutbox(e, { rede: c.rede, hospital: h, ...ev }),
    troca: (id) => trocaPesSgh(e, h, id),
    plantoesEmTrocaAberta: (ids) => plantoesEmTrocaAbertaPesSgh(e, h, ids),
    incluirTroca: (t) => incluirTrocaPesSgh(e, { hospital: h, ...t }),
    responderTroca: (r) => responderTrocaPesSgh(e, { hospital: h, ...r }),
    decidirTroca: (d) => decidirTrocaPesSgh(e, { hospital: h, ...d }),
    cancelarTroca: (x) => cancelarTrocaPesSgh(e, { hospital: h, ...x }),
    transferirPlantao: (t) => transferirPlantaoPesSgh(e, { hospital: h, ...t }),
    acionamento: (id) => acionamentoPesSgh(e, h, id),
    acionamentosDosPlantoes: (ids) => acionamentosDosPlantoesPesSgh(e, h, ids),
    incluirAcionamento: (a) => incluirAcionamentoPesSgh(e, { hospital: h, ...a }),
    registrarChegada: (x) => registrarChegadaPesSgh(e, { hospital: h, ...x }),
    cancelarAcionamento: (x) => cancelarAcionamentoPesSgh(e, { hospital: h, ...x }),
    incluirDimensionamento: (d) => incluirDimensionamentoPesSgh(e, { hospital: h, ...d }),
    dependenciasEscala: (id) => contarDependenciasEscalaPesSgh(e, h, id),
    excluirEscalaRascunho: (x) => excluirEscalaRascunhoPesSgh(e, { hospital: h, ...x }),
    cancelarEscala: (x) => cancelarEscalaPesSgh(e, { hospital: h, ...x }),
    historicoVigencias: (v) => historicoVigenciasPesSgh(e, h, v),
    anularVigencia: (a) => anularVigenciaRegimePesSgh(e, { hospital: h, ...a }),
    eventosPeriodo: (v) => eventosPeriodoDoVinculoPesSgh(e, h, v),
  };
}

function leituras(
  ler: Ler,
  lerEm: LerEm,
  outros: (c: ContextoEscala) => readonly string[],
): Omit<PortaEscala, 'destino' | 'podeGravar' | 'executar' | 'gravarSgh'> {
  return {
    tiposJornada: (c) => ler(c, (l) => tiposJornada(l)),
    temposParciais: (c) => ler(c, (l) => temposParciais(l)),
    tiposTrabalhoFolga: (c) => ler(c, (l) => tiposTrabalhoFolga(l)),
    regimes: (c) => ler(c, (l) => listarRegimesPesSgh(l, c.hospital)),
    regime: (c, id) => ler(c, (l) => regimePesSgh(l, c.hospital, id)),
    vigencias: (c, v) =>
      v.length === 0 ? Promise.resolve([]) : ler(c, (l) => vigenciasRegimePesSgh(l, c.hospital, v)),
    escalas: (c, f) => ler(c, (l) => listarEscalasPesSgh(l, c.hospital, f)),
    escala: (c, id) => ler(c, (l) => escalaPesSgh(l, c.hospital, id)),
    plantoesDaEscala: (c, id) => ler(c, (l) => plantoesDaEscalaPesSgh(l, c.hospital, id)),
    plantoesDaPessoa: (c, p, j) => ler(c, (l) => plantoesDaPessoaPesSgh(l, c.hospital, p, j)),
    eventos: (c, id) => ler(c, (l) => eventosDaEscalaPesSgh(l, c.hospital, id)),
    plantao: (c, id) => ler(c, (l) => plantaoPesSgh(l, c.hospital, id)),
    trocas: (c, f) => ler(c, (l) => listarTrocasPesSgh(l, c.hospital, f)),
    troca: (c, id) => ler(c, (l) => trocaPesSgh(l, c.hospital, id)),
    plantoesEmTrocaAberta: (c, ids) => ler(c, (l) => plantoesEmTrocaAbertaPesSgh(l, c.hospital, ids)),
    plantoesNoInstante: (c, i, desde, f) =>
      ler(c, (l) => plantoesNoInstantePesSgh(l, c.hospital, i, desde, f)),
    acionamentos: (c, ids) => ler(c, (l) => acionamentosDosPlantoesPesSgh(l, c.hospital, ids)),
    acionamento: (c, id) => ler(c, (l) => acionamentoPesSgh(l, c.hospital, id)),
    dimensionamentos: (c, f) => ler(c, (l) => listarDimensionamentosPesSgh(l, c.hospital, f)),
    unidadesInternacao: (c) => ler(c, (l) => unidadesDeInternacao(l)),
    dependenciasEscala: (c, id) => ler(c, (l) => contarDependenciasEscalaPesSgh(l, c.hospital, id)),
    historicoVigencias: (c, v) => ler(c, (l) => historicoVigenciasPesSgh(l, c.hospital, v)),
    vigencia: (c, id) => ler(c, (l) => vigenciaPorIdPesSgh(l, c.hospital, id)),
    classificacoesDoTurno: (c, u, d, t) =>
      ler(c, async (l) =>
        (await classificacoesDaUnidade(l, c.hospital, u, d, t)).map((x) => ({
          paciente: x.paciente,
          instrumento: x.instrumento,
          categoria: x.categoria,
          total: x.total,
        })),
      ),
    async plantoesNaRede(c, vinculo, j: JanelaPlantoes, liberado): Promise<PlantoesDaRede> {
      const lista = await soLiberados(outros(c), liberado);
      if (lista.length === 0) return { intervalos: [], semResposta: 0 };
      const hmac = await ler(c, (l) => cpfHmacDoVinculoPesSgh(l, c.hospital, vinculo));
      if (!hmac) return { intervalos: [], semResposta: lista.length };
      const r = await Promise.all(
        lista.map((h) =>
          lerEm(c, h, (l) => plantoesNaRedePorCpfPesSgh(l, h, hmac, j)).then(
            (x) => ({ ok: true as const, x }),
            () => ({ ok: false as const, x: [] }),
          ),
        ),
      );
      return { intervalos: r.flatMap((y) => y.x), semResposta: r.filter((y) => !y.ok).length };
    },
  };
}

const recusaSoLeitura = () =>
  Promise.reject(
    new ErroProblema(
      'recurso-desligado',
      403,
      'Gravação desligada neste ambiente',
      'Neste ambiente de desenvolvimento o banco é só de leitura: a escala de plantão não grava.',
      { codigo: 'somente-leitura' },
    ),
  );

/** A escala não grava no outro sistema: nenhuma operação do executor. */
const semExecutor = {
  podeGravar: async () => ({
    pode: false,
    codigo: 'operacao-desconhecida',
    motivo: 'A escala não grava no outro sistema.',
  }),
  executar: () =>
    Promise.reject(
      new ErroProblema('entrada-invalida', 422, 'Operação fora da escala', 'A escala só grava em SGH_.'),
    ),
};

export function portaEscalaLegado(
  nucleo: Pick<NucleoLegado, 'lerSomente' | 'estabelecimentos'> & Partial<Pick<NucleoLegado, 'gravarSgh'>>,
  opcoes: { sghSoLeitura?: boolean; liberados?: ReadonlySet<string> | null } = {},
): PortaEscala {
  const ctx = (c: ContextoEscala, hospital = c.hospital) => ({
    rede: c.rede,
    hospital,
    traceId: 'pessoas-escala',
  });
  // HS-1 (como o MPI do M57): com `liberados`, a Rede da escala só vê esses bancos; o resto não é nem consultado.
  const codigos = nucleo.estabelecimentos
    .map((e) => e.codigo)
    .filter((x) => !opcoes.liberados || opcoes.liberados.has(x));
  return {
    destino: 'legado',
    ...semExecutor,
    gravarSgh: (c, trilha, fn) => {
      const gravar = nucleo.gravarSgh?.bind(nucleo);
      if (opcoes.sghSoLeitura || !gravar) return recusaSoLeitura();
      return gravar(ctx(c), async (e0) => {
        const e = somenteSgh(e0);
        const r = await fn(gravador(e, c));
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      });
    },
    ...leituras(
      (c, fn) => nucleo.lerSomente(ctx(c), fn),
      (c, h, fn) => nucleo.lerSomente(ctx(c, h), fn),
      (c) => codigos.filter((x) => x !== c.hospital),
    ),
  };
}

/** A mesma porta sobre transações abertas, uma por banco (integração na cópia, sempre desfeita). */
export function portaEscalaNasTransacoes(transacoes: ReadonlyMap<string, Escritor>): PortaEscala {
  const de = (h: string): Escritor => {
    const e = transacoes.get(h);
    if (!e) throw new ErroProblema('indisponivel', 503, 'Banco do estabelecimento indisponível');
    return e;
  };
  return {
    destino: 'legado',
    ...semExecutor,
    async gravarSgh(c, trilha, fn) {
      const s = somenteSgh(de(c.hospital));
      const r = await fn(gravador(s, c));
      await gravarTrilha(s, typeof trilha === 'function' ? trilha(r) : trilha);
      return r;
    },
    ...leituras(
      (c, fn) => fn(de(c.hospital)),
      (_c, h, fn) => fn(de(h)),
      (c) => [...transacoes.keys()].filter((x) => x !== c.hospital),
    ),
  };
}

export function portaEscalaIndisponivel(): PortaEscala {
  return portaIndisponivel<PortaEscala>(METODOS_PORTA_ESCALA);
}
