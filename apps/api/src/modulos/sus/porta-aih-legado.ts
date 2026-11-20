// Porta do faturamento SUS, etapa 4 (AIH), sobre o núcleo do legado: as leituras READ ONLY (o adaptador faz os lotes) e as
// gravações só SGH_ do escritor `somenteSgh`, na mesma transação da competência e da trilha.
import {
  aihPorNumero,
  aihsDasInternacoes,
  aihsParaApresentar,
  aplicarRetornoNaAih,
  autorizarAih,
  cancelarAih,
  cidsExistentes,
  cnesCadastrados,
  compatibilidadesSigtap,
  type Escritor,
  fecharAih,
  gravarArquivoSisaih,
  inserirAih,
  inserirFaixaAih,
  inserirRetornoSus,
  internacaoParaAih,
  internacoesParaAih,
  internacoesSusDaCompetencia,
  itensAih,
  itensContaAih,
  type Leitor,
  leitosUtiHabilitados,
  lerAih,
  lerFaixaAih,
  lerRetornoSusSgh,
  linhaBpaDaCompetencia,
  listarFaixasAih,
  lotesSaidaDoAtendimento,
  maiorNumeroDaFaixa,
  mudarFaixaAih,
  negarAih,
  numeroAihEmUso,
  paginaAihs,
  paginaRetornosSus,
  procedimentosSigtap,
  reabrirAih,
  registrosSigtap,
  sigtapPorCodigos,
  solicitanteDaAih,
  trajetoriaDasInternacoes,
  tratarRetornoSus,
  ultimoRetornoDaAih,
  valoresSigtap,
} from '@sgh/legado';
import type { DadosAihLidos, GravacaoSusAih, LeituraSusAih } from './porta-aih.js';

/** As leituras da montagem das AIHs (todas as internações pedidas; os lotes ficam no adaptador). */
export async function dadosAihDoLegado(
  l: Leitor,
  registros: readonly number[],
  codigos: readonly string[],
  sigtapExtra: readonly number[],
  conveniosSus: readonly number[],
): Promise<DadosAihLidos> {
  const internacoes = await internacoesParaAih(l, registros, conveniosSus);
  // Os itens de todas as contas SUS da internação (as parciais) e da conta gravada na AIH.
  const contas = [
    ...new Set(internacoes.flatMap((x) => [...x.contasSus, ...(x.conta === null ? [] : [x.conta])])),
  ];
  const itens = await itensContaAih(l, contas);
  const passagens = await trajetoriaDasInternacoes(
    l,
    internacoes.map((x) => x.registro),
  );
  const porCodigo = await sigtapPorCodigos(l, codigos);
  const ids = [
    ...new Set([
      ...itens.map((i) => i.sigtap).filter((x): x is number => x !== null),
      ...porCodigo.map((x) => x.id),
      ...sigtapExtra,
    ]),
  ];
  const { procedimentos, historico } = await procedimentosSigtap(l, ids);
  return {
    internacoes,
    itens,
    passagens,
    procedimentos,
    historico,
    registros: await registrosSigtap(l, ids),
    compatibilidades: await compatibilidadesSigtap(l, ids),
    porCodigo,
    cids: await cidsExistentes(
      l,
      internacoes.flatMap((x) => [x.cidPrincipal ?? '', x.cidSecundario ?? '']).filter(Boolean),
    ),
    leitosUti: await leitosUtiHabilitados(l),
    cnesCadastrados: await cnesCadastrados(l),
  };
}

export function leituraAih(l: Leitor): LeituraSusAih {
  return {
    internacaoAih: (r, sus) => internacaoParaAih(l, r, sus),
    internacoesSus: (intervalo, sus) => internacoesSusDaCompetencia(l, intervalo, sus),
    dadosAih: (registros, codigos, extra, sus) => dadosAihDoLegado(l, registros, codigos, extra, sus),
    leitosUti: () => leitosUtiHabilitados(l),
    lotesSaida: (r) => lotesSaidaDoAtendimento(l, r),
    valoresSigtap: (ids) => valoresSigtap(l, ids),
    solicitanteAih: (cpf) => solicitanteDaAih(l, cpf),
    faixasAih: () => listarFaixasAih(l),
    faixaAih: (id, travar) => lerFaixaAih(l, id, travar ?? false),
    maiorNumeroDaFaixa: (id) => maiorNumeroDaFaixa(l, id),
    numeroAihEmUso: (n) => numeroAihEmUso(l, n),
    aih: (id, travar) => lerAih(l, id, travar ?? false),
    aihPorNumero: (n) => aihPorNumero(l, n),
    aihsDasInternacoes: (r) => aihsDasInternacoes(l, r),
    aihsParaApresentar: (c) => aihsParaApresentar(l, c),
    paginaAihs: (f) => paginaAihs(l, f),
    itensAih: (id, f) => itensAih(l, id, f),
    linhaBpaDaCompetencia: (c, p) => linhaBpaDaCompetencia(l, c, p),
    paginaRetornos: (f) => paginaRetornosSus(l, f),
    retornoSus: (id, travar) => lerRetornoSusSgh(l, id, travar ?? false),
    ultimoRetornoDaAih: (id) => ultimoRetornoDaAih(l, id),
  };
}

export function gravacaoAih(e: Escritor): GravacaoSusAih {
  return {
    inserirFaixaAih: (p) => inserirFaixaAih(e, p),
    mudarFaixaAih: (p) => mudarFaixaAih(e, p),
    inserirAih: (p) => inserirAih(e, p),
    autorizarAih: (a, p) => autorizarAih(e, a, p),
    negarAih: (a, j, por) => negarAih(e, a, j, por),
    reabrirAih: (a, j, por) => reabrirAih(e, a, j, por),
    cancelarAih: (a, j, por) => cancelarAih(e, a, j, por),
    fecharAih: (a, p) => fecharAih(e, a, p),
    gravarArquivoSisaih: (a, aihs) => gravarArquivoSisaih(e, a, aihs),
    inserirRetornoSus: (r) => inserirRetornoSus(e, r),
    aplicarRetornoNaAih: (id, s, por) => aplicarRetornoNaAih(e, id, s, por),
    tratarRetornoSus: (r, p) => tratarRetornoSus(e, r, p),
  };
}
