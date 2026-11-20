// Porta do faturamento SUS sobre o núcleo do legado (M51, etapas 1 a 3): leitura READ ONLY e gravação numa transação SGH_
// (escritor `somenteSgh` do `gravarSgh`), com a SGH_TRILHA na mesma transação. `portaSusNasTransacoes`: a mesma porta
// sobre uma transação já aberta (integração e assinatura na cópia, sempre desfeitas).
import {
  apacsDaCompetenciaSgh,
  atendimentoParaLaudoApac,
  buscarSolicitantesApac,
  dominiosApac,
  gravarArquivoApac,
  incluirApacSgh,
  lerApacSgh,
  mudarApacSgh,
  nomesSigtapPorId,
  paginaApacsSgh,
  paginaLinhasApac,
  solicitantesApacPorChave,
  abrirCompetenciaSus,
  buscarMedicosSolicitantesSus,
  compatibilidadesSigtap,
  type ContaBpaLida,
  contasBpaDaCompetencia,
  gravarArquivoBpa,
  itensBpaDasContas,
  paginaLinhasBpa,
  parametrosSusLegado,
  agruparPorAtendimento,
  buscarProcedimentosHospitalSus,
  buscarSigtapSus,
  cidsExistentes,
  cnesCadastrados,
  type ContaCihaLida,
  contasCihaDaCompetencia,
  desativarEquivalenciaSus,
  type Escritor,
  fecharCompetenciaSus,
  gravarArquivoCiha,
  gravarCriticasSus,
  gravarTrilha,
  itensSigtapDasContas,
  justificarCriticaSus,
  type Leitor,
  lerArquivoSus,
  lerCompetenciaSus,
  lerCompetenciasSus,
  lerCriticaSus,
  listarArquivosSus,
  listarCriticasSus,
  listarEquivalenciasSus,
  type NucleoLegado,
  paginaEquivalenciasSus,
  procedimentosHospitalPorIds,
  procedimentosSigtap,
  proximoArquivoSus,
  reabrirCompetenciaSus,
  registrarEquivalenciaSus,
  registrosSigtap,
  sigtapPorCodigo,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import { gravacaoAih, leituraAih } from './porta-aih-legado.js';
import type {
  AtendimentoBpaLido,
  ContextoSus,
  DadosBpaLidos,
  DadosCihaLidos,
  GravacaoSus,
  LeituraSus,
  PortaSus,
} from './porta.js';

/** As leituras da montagem da CIHA (as duas modalidades, todas as páginas; os lotes ficam no adaptador). */
export async function dadosCihaDoLegado(
  l: Leitor,
  intervalo: { readonly inicio: string; readonly fim: string },
  conveniosSus: readonly number[],
  sigtapExtra: readonly number[],
): Promise<DadosCihaLidos> {
  const contas: ContaCihaLida[] = [];
  for (const modalidade of ['internacao', 'ambulatorial'] as const) {
    let depois = 0;
    for (;;) {
      const p = await contasCihaDaCompetencia(l, modalidade, intervalo, conveniosSus, depois);
      contas.push(...p.contas);
      if (p.proxima === null) break;
      depois = p.proxima;
    }
  }
  const itens = await itensSigtapDasContas(
    l,
    contas.map((c) => c.conta),
  );
  const atendimentos = agruparPorAtendimento(contas, itens);
  const ids = [
    ...new Set([...itens.map((i) => i.sigtap).filter((x): x is number => x !== null), ...sigtapExtra]),
  ];
  const { procedimentos, historico } = await procedimentosSigtap(l, ids);
  const registros = await registrosSigtap(l, ids);
  const cids = await cidsExistentes(
    l,
    contas.flatMap((c) => [c.cidPrincipal ?? '', c.cidSecundario ?? '']).filter(Boolean),
  );
  return {
    atendimentos,
    procedimentos,
    historico,
    registros,
    cids,
    cnesCadastrados: await cnesCadastrados(l),
  };
}

/** As leituras da montagem do BPA (todas as páginas; os lotes ficam no adaptador). */
export async function dadosBpaDoLegado(
  l: Leitor,
  intervalo: { readonly inicio: string; readonly fim: string },
  conveniosSus: readonly number[],
  sigtapExtra: readonly number[],
): Promise<DadosBpaLidos> {
  const contas: ContaBpaLida[] = [];
  let depois = 0;
  for (;;) {
    const p = await contasBpaDaCompetencia(l, intervalo, conveniosSus, depois);
    contas.push(...p.contas);
    if (p.proxima === null) break;
    depois = p.proxima;
  }
  const itens = await itensBpaDasContas(
    l,
    contas.map((c) => c.conta),
  );
  // As contas parciais da mesma ficha (mesmo REG) viram um atendimento; os itens somam.
  const porConta = new Map<number, typeof itens>();
  for (const it of itens) porConta.set(it.conta, [...(porConta.get(it.conta) ?? []), it]);
  const grupos = new Map<number, AtendimentoBpaLido>();
  for (const c of contas) {
    const g = grupos.get(c.registro);
    if (g)
      grupos.set(c.registro, {
        ...g,
        contas: [...g.contas, c.conta],
        itens: [...g.itens, ...(porConta.get(c.conta) ?? [])],
      });
    else grupos.set(c.registro, { conta: c, contas: [c.conta], itens: porConta.get(c.conta) ?? [] });
  }
  const ids = [
    ...new Set([...itens.map((i) => i.sigtap).filter((x): x is number => x !== null), ...sigtapExtra]),
  ];
  const { procedimentos, historico } = await procedimentosSigtap(l, ids);
  return {
    atendimentos: [...grupos.values()],
    procedimentos,
    historico,
    registros: await registrosSigtap(l, ids),
    compatibilidades: await compatibilidadesSigtap(l, ids),
    cids: await cidsExistentes(l, contas.map((c) => c.cidPrincipal ?? '').filter(Boolean)),
    cnesCadastrados: await cnesCadastrados(l),
  };
}

function leitura(l: Leitor): LeituraSus {
  return {
    ...leituraAih(l),
    competencias: (i) => lerCompetenciasSus(l, i),
    competencia: (i, c, travar) => lerCompetenciaSus(l, i, c, travar ?? false),
    criticas: (c, f) => listarCriticasSus(l, c, f),
    critica: (id) => lerCriticaSus(l, id),
    arquivos: (i, c) => listarArquivosSus(l, i, c),
    arquivo: (id) => lerArquivoSus(l, id),
    equivalencias: () => listarEquivalenciasSus(l),
    paginaEquivalencias: (f) => paginaEquivalenciasSus(l, f),
    sigtapPorCodigo: (codigo) => sigtapPorCodigo(l, codigo),
    buscarSigtap: (termo, competencia) => buscarSigtapSus(l, termo, competencia),
    buscarProcedimentosHospital: (termo) => buscarProcedimentosHospitalSus(l, termo),
    procedimentosHospital: (ids) => procedimentosHospitalPorIds(l, ids),
    dadosCiha: (intervalo, sus, extra) => dadosCihaDoLegado(l, intervalo, sus, extra),
    dadosBpa: (intervalo, sus, extra) => dadosBpaDoLegado(l, intervalo, sus, extra),
    linhasBpa: (f) => paginaLinhasBpa(l, f),
    buscarSolicitantes: (termo) => buscarMedicosSolicitantesSus(l, termo),
    parametrosLegado: () => parametrosSusLegado(l),
    apac: (id) => lerApacSgh(l, id),
    paginaApacs: (f) => paginaApacsSgh(l, f),
    apacsDaCompetencia: (c) => apacsDaCompetenciaSgh(l, c),
    atendimentoLaudoApac: (r, sus) => atendimentoParaLaudoApac(l, r, sus),
    dominiosApac: () => dominiosApac(l),
    buscarSolicitantesApac: (t) => buscarSolicitantesApac(l, t),
    solicitantesApacPorChave: (c) => solicitantesApacPorChave(l, c),
    nomesSigtap: (ids) => nomesSigtapPorId(l, ids),
    linhasApac: (f) => paginaLinhasApac(l, f),
  };
}

function gravacao(e: Escritor): GravacaoSus {
  return {
    ...leitura(e),
    ...gravacaoAih(e),
    abrir: (p) => abrirCompetenciaSus(e, p),
    fechar: (c, por) => fecharCompetenciaSus(e, c, por),
    reabrir: (c, por, j) => reabrirCompetenciaSus(e, c, por, j),
    gravarCriticas: (c, criticas, contagens) => gravarCriticasSus(e, c, criticas, contagens),
    justificar: (c, j, por) => justificarCriticaSus(e, c, j, por),
    proximoArquivo: () => proximoArquivoSus(e),
    gravarArquivo: (a, r) => gravarArquivoCiha(e, a, r),
    gravarArquivoBpa: (a, linhas) => gravarArquivoBpa(e, a, linhas),
    incluirApac: (a) => incluirApacSgh(e, a),
    mudarApac: (p) => mudarApacSgh(e, p),
    gravarArquivoApac: (a, linhas) => gravarArquivoApac(e, a, linhas),
    registrarEquivalencia: (p) => registrarEquivalenciaSus(e, p),
    desativarEquivalencia: (p) => desativarEquivalenciaSus(e, p),
    trilha: async (linha) => {
      await gravarTrilha(e, { ...linha, hospital: e.hospital });
    },
  };
}

export function portaSusLegado(nucleo: NucleoLegado): PortaSus {
  const ctx = (c: ContextoSus) => ({ rede: c.rede, hospital: c.hospital, traceId: 'faturamento-sus' });
  return {
    destino: 'legado',
    ler: (c, fn) => nucleo.lerSomente(ctx(c), (l) => fn(leitura(l))),
    gravar: (c, fn) => nucleo.gravarSgh(ctx(c), (e) => fn(gravacao(e))),
  };
}

/** Sobre transações já abertas, uma por banco (quem abriu desfaz). */
export function portaSusNasTransacoes(transacoes: ReadonlyMap<string, Escritor>): PortaSus {
  const de = (c: ContextoSus): Escritor => {
    const e = transacoes.get(c.hospital);
    if (!e) throw new ErroProblema('indisponivel', 503, 'Banco do estabelecimento indisponível');
    return e;
  };
  return {
    destino: 'legado',
    ler: async (c, fn) => fn(leitura(de(c))),
    gravar: async (c, fn) => fn(gravacao(de(c))),
  };
}

export function portaSusIndisponivel(): PortaSus {
  const recusa = (): Promise<never> =>
    Promise.reject(
      new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'Os bancos dos estabelecimentos não estão configurados: nada foi lido nem gravado.',
      ),
    );
  return { destino: 'indisponivel', ler: recusa, gravar: recusa };
}
