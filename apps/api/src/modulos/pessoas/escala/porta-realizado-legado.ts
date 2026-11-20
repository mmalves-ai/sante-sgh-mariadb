// Porta do plantão realizado sobre o núcleo do legado (M52.6): leituras numa transação curta READ ONLY; gravações
// SGH_PES_* numa transação SGH_ (`somenteSgh`) com a SGH_TRILHA junto; o lançamento no repasse pelo executor do M04
// (`repasse.lancarEvento`, origem `plantao`: a receita grava RPLANEVE e liga os realizados na mesma transação). Em dev
// sobre a cópia compartilhada, as gravações SGH_ são recusadas com o motivo (`sghSoLeitura`) e o executor é o de só
// leitura. `portaRealizadoNaTransacao`: a mesma porta sobre UMA transação aberta (integração na cópia, desfeita).
import {
  apuracaoRepasseDaCompetenciaPesSgh,
  desfazerEstornoRealizadoPesSgh,
  estornoLancadoDoRealizadoPesSgh,
  estornarRealizadoPesSgh,
  ligarEstornoRealizadoPesSgh,
  codigosDosRegistrosPesSgh,
  decidirRealizadoPesSgh,
  encerrarTarifaPlantaoPesSgh,
  type Escritor,
  type Executor,
  gravarTrilha,
  incluirRealizadoPesSgh,
  incluirTarifaPlantaoPesSgh,
  type Leitor,
  type NucleoLegado,
  operacao,
  plantaoParaRealizadoPesSgh,
  plantoesParaRealizadoPesSgh,
  plantoesPorIdsParaRealizadoPesSgh,
  realizadoPesSgh,
  realizadosAprovadosPesSgh,
  realizadosDaPessoaPesSgh,
  realizadosDosPlantoesPesSgh,
  realizadosSemValorPesSgh,
  relogioRecepcao,
  somenteSgh,
  tarifasPlantaoPesSgh,
  valorarRealizadoPesSgh,
} from '@sgh/legado';
import { ErroProblema } from '../../../problema.filter.js';
import { portaIndisponivel } from '../../exames/public-api.js';
import {
  type ContextoRealizado,
  type GravadorRealizado,
  METODOS_PORTA_REALIZADO,
  type PortaRealizado,
} from './porta-realizado.js';

type Ler = <T>(c: ContextoRealizado, fn: (l: Leitor) => Promise<T>) => Promise<T>;

function leituras(ler: Ler): Omit<PortaRealizado, 'destino' | 'podeGravar' | 'executar' | 'gravarSgh'> {
  return {
    relogio: (c) =>
      ler(c, async (l) => {
        const r = await relogioRecepcao(l);
        return { hoje: r.hoje, agora: r.agora.slice(0, 16) };
      }),
    plantoes: (c, f) => ler(c, (l) => plantoesParaRealizadoPesSgh(l, c.hospital, f)),
    plantao: (c, id) => ler(c, (l) => plantaoParaRealizadoPesSgh(l, c.hospital, id)),
    plantoesPorIds: (c, ids) =>
      ids.length === 0
        ? Promise.resolve([])
        : ler(c, (l) => plantoesPorIdsParaRealizadoPesSgh(l, c.hospital, ids)),
    realizadosDosPlantoes: (c, ps) =>
      ps.length === 0 ? Promise.resolve([]) : ler(c, (l) => realizadosDosPlantoesPesSgh(l, c.hospital, ps)),
    realizadosAprovados: (c, de, ate) => ler(c, (l) => realizadosAprovadosPesSgh(l, c.hospital, de, ate)),
    realizado: (c, id) => ler(c, (l) => realizadoPesSgh(l, c.hospital, id)),
    tarifas: (c) => ler(c, (l) => tarifasPlantaoPesSgh(l, c.hospital)),
    codigosDosRegistros: (c, rs) =>
      rs.length === 0 ? Promise.resolve(new Map()) : ler(c, (l) => codigosDosRegistrosPesSgh(l, rs)),
    apuracaoRepasse: (c, comp) => ler(c, (l) => apuracaoRepasseDaCompetenciaPesSgh(l, c.hospital, comp)),
  };
}

function gravador(e: Escritor, c: ContextoRealizado): GravadorRealizado {
  const h = c.hospital;
  return {
    plantao: (id) => plantaoParaRealizadoPesSgh(e, h, id),
    realizadosDoPlantao: (p) => realizadosDosPlantoesPesSgh(e, h, [p]),
    realizadosDaPessoa: (p, de, ate) => realizadosDaPessoaPesSgh(e, h, p, de, ate),
    realizado: (id) => realizadoPesSgh(e, h, id),
    tarifas: () => tarifasPlantaoPesSgh(e, h),
    incluirRealizado: (r) => incluirRealizadoPesSgh(e, { hospital: h, ...r }),
    decidirRealizado: (d) => decidirRealizadoPesSgh(e, { hospital: h, ...d }),
    incluirTarifa: (t) => incluirTarifaPlantaoPesSgh(e, { hospital: h, ...t }),
    encerrarTarifa: (t) => encerrarTarifaPlantaoPesSgh(e, { hospital: h, ...t }),
    realizadosSemValor: (de, ate) => realizadosSemValorPesSgh(e, h, de, ate),
    plantoesPorIds: (ids) =>
      ids.length === 0 ? Promise.resolve([]) : plantoesPorIdsParaRealizadoPesSgh(e, h, ids),
    valorarRealizado: (v) => valorarRealizadoPesSgh(e, { hospital: h, ...v }),
    apuracaoRepasse: (comp) => apuracaoRepasseDaCompetenciaPesSgh(e, h, comp),
    estornarRealizado: (x) => estornarRealizadoPesSgh(e, { hospital: h, ...x }),
    ligarEstorno: (x) => ligarEstornoRealizadoPesSgh(e, { hospital: h, ...x }),
    desfazerEstorno: (id) => desfazerEstornoRealizadoPesSgh(e, { hospital: h, id }),
    estornoLancado: (x) => estornoLancadoDoRealizadoPesSgh(e, { hospital: h, ...x }),
  };
}

const recusaSoLeitura = () =>
  Promise.reject(
    new ErroProblema(
      'recurso-desligado',
      403,
      'Gravação desligada neste ambiente',
      'Neste ambiente de desenvolvimento o banco é só de leitura: o plantão realizado não grava.',
      { codigo: 'somente-leitura' },
    ),
  );

export function portaRealizadoLegado(
  nucleo: Pick<NucleoLegado, 'lerSomente'> & Partial<Pick<NucleoLegado, 'gravarSgh'>>,
  executor: Executor,
  opcoes: { sghSoLeitura?: boolean } = {},
): PortaRealizado {
  const ctx = (c: ContextoRealizado) => ({ rede: c.rede, hospital: c.hospital, traceId: 'realizado' });
  return {
    destino: 'legado',
    podeGravar: (c, op, usuarioLegado) =>
      executor.liberacao(operacao(op), { rede: c.rede, hospital: c.hospital, usuarioLegado }),
    async executar(c, op, entrada, octx) {
      const r = await executor.executar(operacao(op), c.hospital, entrada, octx);
      return { resultado: r.resultado, repetida: r.repetida, trilha: r.trilha };
    },
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
    ...leituras((c, fn) => nucleo.lerSomente(ctx(c), fn)),
  };
}

/** A mesma porta sobre UMA transação aberta (integração na cópia, sempre desfeita), com o executor nela. */
export function portaRealizadoNaTransacao(e: Escritor, executor: Executor): PortaRealizado {
  return {
    destino: 'legado',
    podeGravar: (c, op, usuarioLegado) =>
      executor.liberacao(operacao(op), { rede: c.rede, hospital: c.hospital, usuarioLegado }),
    async executar(c, op, entrada, octx) {
      const r = await executor.executar(operacao(op), c.hospital, entrada, octx, { escritor: e });
      return { resultado: r.resultado, repetida: r.repetida, trilha: r.trilha };
    },
    async gravarSgh(c, trilha, fn) {
      const s = somenteSgh(e);
      const r = await fn(gravador(s, c));
      await gravarTrilha(s, typeof trilha === 'function' ? trilha(r) : trilha);
      return r;
    },
    ...leituras((_c, fn) => fn(e)),
  };
}

export function portaRealizadoIndisponivel(): PortaRealizado {
  return portaIndisponivel<PortaRealizado>(METODOS_PORTA_REALIZADO);
}
