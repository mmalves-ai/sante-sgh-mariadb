// Porta do cálculo mensal da folha sobre o núcleo do legado (M53.3): leituras numa transação curta READ ONLY no banco do
// estabelecimento da sessão; gravações SGH_PES_* numa transação SGH_ (`somenteSgh`: nenhuma tabela do outro sistema)
// com a SGH_TRILHA junto. Em dev sobre a cópia compartilhada, as gravações são recusadas com o motivo (`sghSoLeitura`):
// a prova da gravação é a integração, sob a trava da cópia e desfeita. `portaCalculoFolhaNaTransacao`: a mesma porta
// sobre UMA transação aberta (integração na cópia, desfeita). Nenhuma operação do executor.
import {
  cancelarObrigacaoPesSgh,
  codigosCatalogosObrigacoes,
  conteudoObrigacaoPesSgh,
  incluirObrigacaoPesSgh,
  incluirParametrosObrigacoesPesSgh,
  obrigacaoComTravaPesSgh,
  obrigacaoPesSgh,
  obrigacoesEmVigorComTravaPesSgh,
  obrigacoesPesSgh,
  parametrosObrigacoesPesSgh,
  registrarEntregaObrigacaoPesSgh,
  substituirObrigacaoPesSgh,
  fechamentoEmVigorComTravaPesSgh,
  fechamentoFolhaPesSgh,
  fechamentosFolhaPesSgh,
  incluirFechamentoFolhaPesSgh,
  itensRubricaDoProcessoPesSgh,
  processosCalculadosComTravaPesSgh,
  reabrirFechamentoFolhaPesSgh,
  adiantamentosDecimoPesSgh,
  desligadosPesSgh,
  fgtsDepositadoPesSgh,
  incluirRescisaoPesSgh,
  processosDoVinculoPesSgh,
  rescisaoPorIdPesSgh,
  rescisoesDoVinculoComTravaPesSgh,
  rescisoesPesSgh,
  situacaoRescisaoPesSgh,
  tiposRescisaoFolhaPesSgh,
  dependentesDaFolhaPesSgh,
  feriasDoVinculoComTravaPesSgh,
  feriasNaCompetenciaPesSgh,
  feriasPesSgh,
  feriasPorIdPesSgh,
  historicoFolhaPesSgh,
  incluirFeriasPesSgh,
  situacaoFeriasPesSgh,
  type Escritor,
  gravarTrilha,
  incluirLinhasCalculoPesSgh,
  incluirParametrosFolhaPesSgh,
  incluirProcessoFolhaPesSgh,
  incluirSalarioPesSgh,
  type Leitor,
  linhasDoVinculoPesSgh,
  type NucleoLegado,
  parametrosFolhaPesSgh,
  processoEmVigorComTravaPesSgh,
  processoFolhaPesSgh,
  processosFolhaPesSgh,
  resumoVinculosProcessoPesSgh,
  salariosPesSgh,
  situacaoProcessoFolhaPesSgh,
  somenteSgh,
  vinculosDoCalculoPesSgh,
} from '@sgh/legado';
import { ErroProblema } from '../../../problema.filter.js';
import { portaIndisponivel } from '../../exames/public-api.js';
import {
  type ContextoCalculoFolha,
  type GravadorCalculoFolha,
  METODOS_PORTA_CALCULO_FOLHA,
  type PortaCalculoFolha,
} from './porta-calculo.js';

type Ler = <T>(c: ContextoCalculoFolha, fn: (l: Leitor) => Promise<T>) => Promise<T>;

function leituras(ler: Ler): Omit<PortaCalculoFolha, 'destino' | 'podeGravar' | 'executar' | 'gravarSgh'> {
  return {
    vinculos: (c, i, f) => ler(c, (l) => vinculosDoCalculoPesSgh(l, c.hospital, i, f)),
    dependentes: (c, vs, d) =>
      vs.length === 0
        ? Promise.resolve(new Map())
        : ler(c, (l) => dependentesDaFolhaPesSgh(l, c.hospital, vs, d)),
    salarios: (c, vs) =>
      vs.length === 0 ? Promise.resolve([]) : ler(c, (l) => salariosPesSgh(l, c.hospital, vs)),
    parametros: (c, e) => ler(c, (l) => parametrosFolhaPesSgh(l, c.hospital, e)),
    processos: (c, f) => ler(c, (l) => processosFolhaPesSgh(l, c.hospital, f)),
    processo: (c, id) => ler(c, (l) => processoFolhaPesSgh(l, c.hospital, id)),
    resumoVinculos: (c, p) => ler(c, (l) => resumoVinculosProcessoPesSgh(l, c.hospital, p)),
    linhasDoVinculo: (c, p, v) => ler(c, (l) => linhasDoVinculoPesSgh(l, c.hospital, p, v)),
    ferias: (c, f) => ler(c, (l) => feriasPesSgh(l, c.hospital, f)),
    feriasPorId: (c, id) => ler(c, (l) => feriasPorIdPesSgh(l, c.hospital, id)),
    historico: (c, vs, de, ate) =>
      vs.length === 0 ? Promise.resolve([]) : ler(c, (l) => historicoFolhaPesSgh(l, c.hospital, vs, de, ate)),
    adiantamentosDecimo: (c, empresa, ano, origens) =>
      ler(c, (l) => adiantamentosDecimoPesSgh(l, c.hospital, empresa, ano, origens)),
    feriasNaCompetencia: (c, i, f) => ler(c, (l) => feriasNaCompetenciaPesSgh(l, c.hospital, i, f)),
    rescisoes: (c, f) => ler(c, (l) => rescisoesPesSgh(l, c.hospital, f)),
    rescisaoPorId: (c, id) => ler(c, (l) => rescisaoPorIdPesSgh(l, c.hospital, id)),
    desligados: (c, de, ate) => ler(c, (l) => desligadosPesSgh(l, c.hospital, de, ate)),
    processosDoVinculo: (c, v, t, de, ate) =>
      ler(c, (l) => processosDoVinculoPesSgh(l, c.hospital, v, t, de, ate)),
    fgtsDepositado: (c, v) => ler(c, (l) => fgtsDepositadoPesSgh(l, c.hospital, v)),
    tiposRescisao: (c) => ler(c, (l) => tiposRescisaoFolhaPesSgh(l)),
    fechamentos: (c, f) => ler(c, (l) => fechamentosFolhaPesSgh(l, c.hospital, f)),
    fechamento: (c, id) => ler(c, (l) => fechamentoFolhaPesSgh(l, c.hospital, id)),
    itensRubricaDoProcesso: (c, p) => ler(c, (l) => itensRubricaDoProcessoPesSgh(l, c.hospital, p)),
    parametrosObrigacoes: (c, e) => ler(c, (l) => parametrosObrigacoesPesSgh(l, c.hospital, e)),
    obrigacoes: (c, f) => ler(c, (l) => obrigacoesPesSgh(l, c.hospital, f)),
    obrigacao: (c, id) => ler(c, (l) => obrigacaoPesSgh(l, c.hospital, id)),
    conteudoObrigacao: (c, id) => ler(c, (l) => conteudoObrigacaoPesSgh(l, c.hospital, id)),
    catalogosObrigacoes: (c) => ler(c, (l) => codigosCatalogosObrigacoes(l)),
  };
}

function gravador(e: Escritor, c: ContextoCalculoFolha): GravadorCalculoFolha {
  const h = c.hospital;
  return {
    salarios: (vs) => (vs.length === 0 ? Promise.resolve([]) : salariosPesSgh(e, h, vs)),
    incluirSalario: (x) => incluirSalarioPesSgh(e, { hospital: h, ...x }),
    parametros: (empresa) => parametrosFolhaPesSgh(e, h, empresa),
    incluirParametros: (x) => incluirParametrosFolhaPesSgh(e, { hospital: h, ...x }),
    emVigorComTrava: (empresa, competencia, tipo, intervalo) =>
      processoEmVigorComTravaPesSgh(e, h, empresa, competencia, tipo ?? 'mensal', intervalo ?? null),
    incluirProcesso: (x) => incluirProcessoFolhaPesSgh(e, { hospital: h, ...x }),
    incluirLinhas: (processo, linhas) => incluirLinhasCalculoPesSgh(e, { hospital: h, processo, linhas }),
    situacaoProcesso: (x) => situacaoProcessoFolhaPesSgh(e, { hospital: h, ...x }),
    processo: (id) => processoFolhaPesSgh(e, h, id),
    resumoVinculos: (p) => resumoVinculosProcessoPesSgh(e, h, p),
    feriasDoVinculoComTrava: (v) => feriasDoVinculoComTravaPesSgh(e, h, v),
    incluirFerias: (x) => incluirFeriasPesSgh(e, { hospital: h, ...x }),
    situacaoFerias: (x) => situacaoFeriasPesSgh(e, { hospital: h, ...x }),
    rescisoesDoVinculoComTrava: (v) => rescisoesDoVinculoComTravaPesSgh(e, h, v),
    incluirRescisao: (x) => incluirRescisaoPesSgh(e, { hospital: h, ...x }),
    situacaoRescisao: (x) => situacaoRescisaoPesSgh(e, { hospital: h, ...x }),
    fechamentoEmVigorComTrava: (empresa, apuracao, periodo) =>
      fechamentoEmVigorComTravaPesSgh(e, h, empresa, apuracao, periodo),
    processosCalculadosComTrava: (empresa, de, ate) =>
      processosCalculadosComTravaPesSgh(e, h, empresa, de, ate),
    incluirFechamento: (x) => incluirFechamentoFolhaPesSgh(e, { hospital: h, ...x }),
    reabrirFechamento: (x) => reabrirFechamentoFolhaPesSgh(e, { hospital: h, ...x }),
    incluirParametrosObrigacoes: (x) => incluirParametrosObrigacoesPesSgh(e, { hospital: h, ...x }),
    obrigacoesEmVigorComTrava: (empresa, tipo, periodo) =>
      obrigacoesEmVigorComTravaPesSgh(e, h, empresa, tipo, periodo),
    obrigacaoComTrava: (id) => obrigacaoComTravaPesSgh(e, h, id),
    incluirObrigacao: (x) => incluirObrigacaoPesSgh(e, { hospital: h, ...x }),
    substituirObrigacao: (x) => substituirObrigacaoPesSgh(e, { hospital: h, ...x }),
    registrarEntregaObrigacao: (x) => registrarEntregaObrigacaoPesSgh(e, { hospital: h, ...x }),
    cancelarObrigacao: (x) => cancelarObrigacaoPesSgh(e, { hospital: h, ...x }),
  };
}

const recusaSoLeitura = () =>
  Promise.reject(
    new ErroProblema(
      'recurso-desligado',
      403,
      'Gravação desligada neste ambiente',
      'Neste ambiente de desenvolvimento o banco é só de leitura: o cálculo da folha não grava.',
      { codigo: 'somente-leitura' },
    ),
  );

const semExecutor = () =>
  Promise.reject(
    new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', 'O cálculo da folha não usa o executor.'),
  );

export function portaCalculoFolhaLegado(
  nucleo: Pick<NucleoLegado, 'lerSomente'> & Partial<Pick<NucleoLegado, 'gravarSgh'>>,
  opcoes: { sghSoLeitura?: boolean } = {},
): PortaCalculoFolha {
  const ctx = (c: ContextoCalculoFolha) => ({ rede: c.rede, hospital: c.hospital, traceId: 'folha-calculo' });
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
export function portaCalculoFolhaNaTransacao(e: Escritor): PortaCalculoFolha {
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

export function portaCalculoFolhaIndisponivel(): PortaCalculoFolha {
  return portaIndisponivel<PortaCalculoFolha>(METODOS_PORTA_CALCULO_FOLHA);
}

/** O gravador sobre um escritor já `somenteSgh` (W0-06: a aprovação da solicitação grava o efeito na mesma transação). */
export { gravador as gravadorCalculoFolhaSgh };
