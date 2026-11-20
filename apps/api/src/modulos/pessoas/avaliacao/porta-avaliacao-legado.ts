// Porta da avaliação de desempenho sobre o núcleo do legado (W0-06, parte 5): leituras numa transação curta READ ONLY
// no banco do estabelecimento da sessão; gravações SGH_PES_* numa transação SGH_ (`somenteSgh`: nenhuma tabela do outro
// sistema) com a SGH_TRILHA junto. Em dev sobre a cópia compartilhada, as gravações são recusadas com o motivo
// (`sghSoLeitura`): a prova da gravação é a integração, sob a trava da cópia e desfeita. `portaAvaliacaoNaTransacao`:
// a mesma porta sobre UMA transação aberta (integração na cópia, desfeita). Nenhuma operação do executor.
import {
  alterarCicloPesSgh,
  alterarCompetenciaPesSgh,
  alterarPdiPesSgh,
  avaliacaoPesSgh,
  avaliacoesPesSgh,
  cargoDoVinculoPesSgh,
  cicloPesSgh,
  cienciaAvaliacaoPesSgh,
  competenciaPesSgh,
  competenciasDoCargoPesSgh,
  contarDependenciasPesSgh,
  corrigirAvaliacaoPesSgh,
  correcoesPesSgh,
  desligarCompetenciaCargoPesSgh,
  type Escritor,
  excluirAvaliacaoRascunhoPesSgh,
  excluirCicloPesSgh,
  excluirCompetenciaPesSgh,
  finalizarAvaliacaoPesSgh,
  gravarTrilha,
  incluirAvaliacaoPesSgh,
  incluirCicloPesSgh,
  incluirCompetenciaPesSgh,
  incluirPdiPesSgh,
  lancarNotasAvaliacaoPesSgh,
  type Leitor,
  ligarCompetenciaCargoPesSgh,
  listarCiclosPesSgh,
  listarCompetenciasPesSgh,
  notasAvaliacaoPesSgh,
  type NucleoLegado,
  pdiDoColaboradorPesSgh,
  pdiPesSgh,
  registrarCorrecaoPesSgh,
  relogioRecepcao,
  situacaoCicloPesSgh,
  situacaoCompetenciaPesSgh,
  situacaoPdiPesSgh,
  somenteSgh,
  vinculosEmExperienciaPesSgh,
} from '@sgh/legado';
import { ErroProblema } from '../../../problema.filter.js';
import { portaIndisponivel } from '../../exames/public-api.js';
import {
  type ContextoAvaliacao,
  type GravadorAvaliacao,
  METODOS_PORTA_AVALIACAO,
  type PortaAvaliacao,
} from './porta-avaliacao.js';

type Ler = <T>(c: ContextoAvaliacao, fn: (l: Leitor) => Promise<T>) => Promise<T>;

function leituras(ler: Ler): Omit<PortaAvaliacao, 'destino' | 'podeGravar' | 'executar' | 'gravarSgh'> {
  return {
    hoje: (c) => ler(c, async (l) => (await relogioRecepcao(l)).hoje),
    competencias: (c) => ler(c, (l) => listarCompetenciasPesSgh(l, c.hospital)),
    competencia: (c, id) => ler(c, (l) => competenciaPesSgh(l, c.hospital, id)),
    competenciasDoCargo: (c, cargo) => ler(c, (l) => competenciasDoCargoPesSgh(l, c.hospital, cargo)),
    ciclos: (c) => ler(c, (l) => listarCiclosPesSgh(l, c.hospital)),
    ciclo: (c, id) => ler(c, (l) => cicloPesSgh(l, c.hospital, id)),
    avaliacoes: (c, f) => ler(c, (l) => avaliacoesPesSgh(l, c.hospital, f)),
    avaliacao: (c, id) => ler(c, (l) => avaliacaoPesSgh(l, c.hospital, id)),
    notas: (c, id) => ler(c, (l) => notasAvaliacaoPesSgh(l, c.hospital, id)),
    cargoDoVinculo: (c, v) => ler(c, (l) => cargoDoVinculoPesSgh(l, c.hospital, v)),
    vinculosEmExperiencia: (c, d) => ler(c, (l) => vinculosEmExperienciaPesSgh(l, c.hospital, d)),
    pdiDoColaborador: (c, v) => ler(c, (l) => pdiDoColaboradorPesSgh(l, c.hospital, v)),
    pdi: (c, id) => ler(c, (l) => pdiPesSgh(l, c.hospital, id)),
    dependencias: (c, alvo, id) => ler(c, (l) => contarDependenciasPesSgh(l, alvo, c.hospital, id)),
    correcoes: (c, t, ids) =>
      ids.length === 0 ? Promise.resolve([]) : ler(c, (l) => correcoesPesSgh(l, c.hospital, t, ids)),
  };
}

function gravador(e: Escritor, c: ContextoAvaliacao): GravadorAvaliacao {
  const h = { hospital: c.hospital };
  return {
    incluirCompetencia: (x) => incluirCompetenciaPesSgh(e, { ...h, ...x }),
    alterarCompetencia: (x) => alterarCompetenciaPesSgh(e, { ...h, ...x }),
    situacaoCompetencia: (x) => situacaoCompetenciaPesSgh(e, { ...h, ...x }),
    excluirCompetencia: (x) => excluirCompetenciaPesSgh(e, { ...h, ...x }),
    ligarCompetenciaCargo: (x) => ligarCompetenciaCargoPesSgh(e, { ...h, ...x }),
    desligarCompetenciaCargo: (x) => desligarCompetenciaCargoPesSgh(e, { ...h, ...x }),
    incluirCiclo: (x) => incluirCicloPesSgh(e, { ...h, ...x }),
    alterarCiclo: (x) => alterarCicloPesSgh(e, { ...h, ...x }),
    situacaoCiclo: (x) => situacaoCicloPesSgh(e, { ...h, ...x }),
    excluirCiclo: (x) => excluirCicloPesSgh(e, { ...h, ...x }),
    incluirAvaliacao: (x) => incluirAvaliacaoPesSgh(e, { ...h, ...x }),
    lancarNotas: (x) => lancarNotasAvaliacaoPesSgh(e, { ...h, ...x }),
    finalizarAvaliacao: (x) => finalizarAvaliacaoPesSgh(e, { ...h, ...x }),
    ciencia: (x) => cienciaAvaliacaoPesSgh(e, { ...h, ...x }),
    corrigirAvaliacao: (x) => corrigirAvaliacaoPesSgh(e, { ...h, ...x }),
    excluirAvaliacao: (x) => excluirAvaliacaoRascunhoPesSgh(e, { ...h, ...x }),
    incluirPdi: (x) => incluirPdiPesSgh(e, { ...h, ...x }),
    alterarPdi: (x) => alterarPdiPesSgh(e, { ...h, ...x }),
    situacaoPdi: (x) => situacaoPdiPesSgh(e, { ...h, ...x }),
    registrarCorrecao: (x) => registrarCorrecaoPesSgh(e, { ...h, ...x }),
  };
}

const recusaSoLeitura = () =>
  Promise.reject(
    new ErroProblema(
      'recurso-desligado',
      403,
      'Gravação desligada neste ambiente',
      'Neste ambiente de desenvolvimento o banco é só de leitura: a avaliação de desempenho não grava.',
      { codigo: 'somente-leitura' },
    ),
  );

const semExecutor = () =>
  Promise.reject(
    new ErroProblema(
      'recusa-de-negocio',
      409,
      'Operação recusada',
      'A avaliação de desempenho não usa o executor.',
    ),
  );

export function portaAvaliacaoLegado(
  nucleo: Pick<NucleoLegado, 'lerSomente'> & Partial<Pick<NucleoLegado, 'gravarSgh'>>,
  opcoes: { sghSoLeitura?: boolean } = {},
): PortaAvaliacao {
  const ctx = (c: ContextoAvaliacao) => ({ rede: c.rede, hospital: c.hospital, traceId: 'avaliacao' });
  return {
    destino: 'legado',
    podeGravar: async () => ({ pode: true, codigo: null, motivo: null }),
    executar: semExecutor,
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

/** A mesma porta sobre UMA transação aberta (integração na cópia, sempre desfeita). */
export function portaAvaliacaoNaTransacao(e: Escritor): PortaAvaliacao {
  return {
    destino: 'legado',
    podeGravar: async () => ({ pode: true, codigo: null, motivo: null }),
    executar: semExecutor,
    async gravarSgh(c, trilha, fn) {
      const s = somenteSgh(e);
      const r = await fn(gravador(s, c));
      await gravarTrilha(s, typeof trilha === 'function' ? trilha(r) : trilha);
      return r;
    },
    ...leituras((_c, fn) => fn(e)),
  };
}

export function portaAvaliacaoIndisponivel(): PortaAvaliacao {
  return portaIndisponivel<PortaAvaliacao>(METODOS_PORTA_AVALIACAO);
}
