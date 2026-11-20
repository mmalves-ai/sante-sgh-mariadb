// Títulos e fatos contábeis da folha (M53-F8; ficha do M53, seções 5 e 8, regras 6, 10 e 11): o plano de títulos de
// um período fechado (folha calculada) ou de um retorno conferido (folha externa), com as parcelas impressas, o
// vencimento de cada encargo pelo de-para, o número do documento, as pendências que barram o lançamento e os fatos
// contábeis por centro de custo (o custo de pessoal do M54). Regras puras: os processamentos, o retorno, o de-para e as
// rotinas vêm de quem chama; o lançamento confere de novo dentro da transação.
//
// D-DESTINO-539 (POL-5): um título por destino e vencimento. O líquido sai por tipo de processamento (folha mensal,
// férias, rescisão, 13º) e vence na data de pagamento dele; os recibos de férias e as rescisões do mês com a mesma data
// somam num título só. Os encargos são do período inteiro: INSS dos segurados (o retido), INSS patronal com RAT e
// terceiros (a mesma guia, separado porque a rotina 17 contabiliza e a 16 não), FGTS e IRRF, cada um no vencimento do
// de-para (dia do mês, no mês do período ou no seguinte; o dia que o mês não tem vira o último dia dele).
// D-DOCUMENTO-539 (POL-5): o documento do título é AAAAMM·10000 + rotina·100 + dia do vencimento (o 13º usa o mês 13):
// determinístico, cabe no INTEGER do título e não colide entre destinos do mesmo credor.
// D-FATO-539 (POL-5): os fatos são por centro de custo e rotina: proventos (rotina do processamento) e encargos da
// empresa (FGTS na 15; INSS patronal, RAT e terceiros na 17). `contabiliza` vem do cadastro de rotinas: o M54 decide o
// lançamento contábil; o custo de pessoal soma todos.
import {
  type ApuracaoFolha,
  type AvisoTituloFolha,
  cenarioDoDestino,
  type CustoPessoalCentro,
  DESTINOS_TITULO_FOLHA,
  type DestinoIntegracaoFolha,
  type DestinoTituloFolha,
  type FatoContabilFolha,
  type ParcelaContaFolha,
  type PendenciaTituloFolha,
  ROTINA_DO_DESTINO,
  type TipoEncargoFolha,
  type TipoProcessoFolha,
  type TituloFolhaPlanejado,
  type TotaisCalculoFolha,
} from '@sgh/contratos';

/** Rótulo de cada destino na conta impressa e na tela. */
export const ROTULO_DESTINO_FOLHA: Readonly<Record<DestinoTituloFolha, string>> = {
  'liquido-mensal': 'líquido da folha mensal',
  'liquido-ferias': 'líquido das férias',
  'liquido-rescisao': 'líquido das rescisões',
  'liquido-decimo': 'líquido do 13º salário',
  inss: 'INSS dos segurados',
  'inss-patronal': 'INSS patronal, RAT e terceiros',
  fgts: 'FGTS',
  irrf: 'IRRF',
  sindical: 'contribuição sindical',
};

/** O destino do líquido de cada tipo de processamento. */
export const DESTINO_DO_LIQUIDO: Readonly<Record<TipoProcessoFolha, DestinoTituloFolha>> = {
  mensal: 'liquido-mensal',
  ferias: 'liquido-ferias',
  rescisao: 'liquido-rescisao',
  decimo1: 'liquido-decimo',
  decimo2: 'liquido-decimo',
};

/** O destino de cada encargo do retorno da folha externa ("outro" não tem rotina: pendência). */
export const DESTINO_DO_ENCARGO: Readonly<Record<TipoEncargoFolha, DestinoTituloFolha | null>> = {
  inss: 'inss',
  fgts: 'fgts',
  irrf: 'irrf',
  sindical: 'sindical',
  outro: null,
};

/**
 * Classificação gerencial sugerida por destino, tirada do perfil do contas a pagar (como a folha que roda fora é
 * lançada hoje): salário 210.1.1, férias 210.1.15, 13º 210.1.14, rescisão 210.5.8, contribuição sindical 210.4.1 e os
 * encargos em 296.4.2 ("outro imposto e taxa", 103 títulos de 5 credores em 2025 e 2026). O credor é escolha do DP.
 */
export const SUGESTAO_CLASSIFICACAO_FOLHA: Readonly<
  Record<DestinoTituloFolha, { grupo: number; subgrupo: number; item: number }>
> = {
  'liquido-mensal': { grupo: 210, subgrupo: 1, item: 1 },
  'liquido-ferias': { grupo: 210, subgrupo: 1, item: 15 },
  'liquido-rescisao': { grupo: 210, subgrupo: 5, item: 8 },
  'liquido-decimo': { grupo: 210, subgrupo: 1, item: 14 },
  inss: { grupo: 296, subgrupo: 4, item: 2 },
  'inss-patronal': { grupo: 296, subgrupo: 4, item: 2 },
  fgts: { grupo: 296, subgrupo: 4, item: 2 },
  irrf: { grupo: 296, subgrupo: 4, item: 2 },
  sindical: { grupo: 210, subgrupo: 4, item: 1 },
};

/** Uma parcela da origem antes do de-para: o valor e, no líquido e no retorno externo, o vencimento já dado. */
export interface ParcelaOrigemFolha {
  readonly destino: DestinoTituloFolha;
  readonly valor: number;
  readonly vencimento: string | null;
}

/** O processamento fixado no fechamento, com os totais dele. */
export interface ProcessoParaTitulos {
  readonly id: number;
  readonly tipo: TipoProcessoFolha;
  readonly pagamento: string | null;
  readonly totais: TotaisCalculoFolha;
}

/** A rotina do cadastro, só o que a regra usa. */
export interface RotinaParaTitulos {
  readonly id: number;
  readonly financeiro: boolean;
  readonly contabilidade: boolean;
}

const soma = <T>(xs: readonly T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);
const ordem = (d: DestinoTituloFolha) => DESTINOS_TITULO_FOLHA.indexOf(d);

export const reaisFolha = (c: number): string =>
  `R$ ${Math.floor(c / 100).toLocaleString('pt-BR')},${String(c % 100).padStart(2, '0')}`;

/** Encargos da empresa no processamento: INSS patronal, RAT e terceiros (a mesma guia). */
export const patronalDoProcesso = (t: TotaisCalculoFolha) => t.inssPatronal + t.rat + t.terceiros;

/** Líquido + encargos de um período fechado: o que a soma dos títulos tem de igualar. */
export function esperadoDoFechamento(ps: readonly ProcessoParaTitulos[]): {
  liquido: number;
  encargos: number;
} {
  const liquido = soma(ps, (p) => p.totais.liquido);
  const encargos = soma(
    ps,
    (p) => p.totais.inss + p.totais.irrf + p.totais.fgts + patronalDoProcesso(p.totais),
  );
  return { liquido, encargos };
}

/** As parcelas de um período fechado: o líquido por tipo e data de pagamento; os encargos somados no período. */
export function parcelasDoFechamento(ps: readonly ProcessoParaTitulos[]): ParcelaOrigemFolha[] {
  const liquidos = new Map<string, ParcelaOrigemFolha>();
  for (const p of ps) {
    if (p.totais.liquido <= 0) continue;
    const destino = DESTINO_DO_LIQUIDO[p.tipo];
    const k = `${destino}|${p.pagamento ?? ''}`;
    const atual = liquidos.get(k);
    liquidos.set(k, { destino, vencimento: p.pagamento, valor: (atual?.valor ?? 0) + p.totais.liquido });
  }
  const encargos: ParcelaOrigemFolha[] = [
    { destino: 'inss', valor: soma(ps, (p) => p.totais.inss), vencimento: null },
    { destino: 'inss-patronal', valor: soma(ps, (p) => patronalDoProcesso(p.totais)), vencimento: null },
    { destino: 'fgts', valor: soma(ps, (p) => p.totais.fgts), vencimento: null },
    { destino: 'irrf', valor: soma(ps, (p) => p.totais.irrf), vencimento: null },
  ];
  return [...liquidos.values(), ...encargos.filter((e) => e.valor > 0)];
}

/** O retorno conferido da folha externa, como o resumo gravado o mostra. */
export interface RetornoParaTitulos {
  readonly liquido: number;
  readonly vencimentoLiquido: string | null;
  readonly encargos: readonly {
    readonly tipo: TipoEncargoFolha;
    readonly valor: number;
    readonly vencimento: string | null;
  }[];
}

/** As parcelas do retorno: o líquido e cada encargo com o vencimento que a folha externa deu ("outro" fica de fora). */
export function parcelasDoRetorno(r: RetornoParaTitulos): {
  parcelas: ParcelaOrigemFolha[];
  semDestino: number;
} {
  const parcelas: ParcelaOrigemFolha[] = [];
  if (r.liquido > 0)
    parcelas.push({ destino: 'liquido-mensal', valor: r.liquido, vencimento: r.vencimentoLiquido });
  const porChave = new Map<string, ParcelaOrigemFolha>();
  let semDestino = 0;
  for (const e of r.encargos) {
    const destino = DESTINO_DO_ENCARGO[e.tipo];
    if (!destino) {
      semDestino += e.valor;
      continue;
    }
    if (e.valor <= 0) continue;
    const k = `${destino}|${e.vencimento ?? ''}`;
    const atual = porChave.get(k);
    porChave.set(k, { destino, vencimento: e.vencimento, valor: (atual?.valor ?? 0) + e.valor });
  }
  return { parcelas: [...parcelas, ...porChave.values()], semDestino };
}

const ultimoDia = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();

/** O mês-base do período (o anual, dezembro) em [ano, mês]. */
const mesBase = (apuracao: ApuracaoFolha, periodo: string): [number, number] =>
  apuracao === 'anual'
    ? [Number(periodo.slice(0, 4)), 12]
    : [Number(periodo.slice(0, 4)), Number(periodo.slice(5, 7))];

/** Vencimento do encargo pelo de-para: o dia no mês do período (ou no seguinte); o dia que falta vira o último. */
export function vencimentoDoEncargo(
  apuracao: ApuracaoFolha,
  periodo: string,
  dia: number,
  mesesDepois: number,
): string {
  const [a0, m0] = mesBase(apuracao, periodo);
  const total = a0 * 12 + (m0 - 1) + mesesDepois;
  const ano = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  const d = Math.min(dia, ultimoDia(ano, mes));
  return `${ano}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** D-DOCUMENTO-539: AAAAMM·10000 + rotina·100 + dia do vencimento (o anual usa o mês 13). */
export function documentoDoTituloFolha(
  apuracao: ApuracaoFolha,
  periodo: string,
  rotina: number,
  vencimento: string,
): number {
  const ano = Number(periodo.slice(0, 4));
  const mes = apuracao === 'anual' ? 13 : Number(periodo.slice(5, 7));
  return (ano * 100 + mes) * 10_000 + rotina * 100 + Number(vencimento.slice(8, 10));
}

/** O histórico do título (vai ao REFERENTE, até 60 caracteres, sem dado pessoal). */
export function referenteDoTituloFolha(
  destino: DestinoTituloFolha,
  apuracao: ApuracaoFolha,
  periodo: string,
): string {
  const p = apuracao === 'anual' ? periodo : `${periodo.slice(5, 7)}/${periodo.slice(0, 4)}`;
  const r = ROTULO_DESTINO_FOLHA[destino];
  return `Folha ${p}: ${r}`.slice(0, 60);
}

export interface EntradaPlanoTitulos {
  readonly apuracao: ApuracaoFolha;
  readonly periodo: string;
  readonly parcelas: readonly ParcelaOrigemFolha[];
  /** O de-para vigente da empresa na data de emissão (os destinos que faltam ficam pendentes). */
  readonly dePara: readonly DestinoIntegracaoFolha[];
  readonly rotinas: readonly RotinaParaTitulos[];
  /** Vencimentos ajustados pela pessoa na prévia (chave do título → data). */
  readonly vencimentos?: ReadonlyMap<string, string>;
  /** Data de emissão dos títulos (o vencimento não pode ser antes dela). */
  readonly emissao: string;
}

export interface PlanoTitulosFolhaCalculado {
  readonly titulos: TituloFolhaPlanejado[];
  readonly pendencias: PendenciaTituloFolha[];
  readonly parcelas: ParcelaContaFolha[];
  readonly total: number;
  readonly conta: string;
}

/** A conta impressa com as parcelas ("líquido da folha mensal R$ x + FGTS R$ y = R$ total"). */
export function contaDosTitulos(ts: readonly { destino: DestinoTituloFolha; valor: number }[]): {
  parcelas: ParcelaContaFolha[];
  total: number;
  conta: string;
} {
  const parcelas = ts.map((t) => ({ rotulo: ROTULO_DESTINO_FOLHA[t.destino], valor: t.valor }));
  const total = soma(parcelas, (p) => p.valor);
  const conta =
    parcelas.length === 0
      ? `nenhum título = ${reaisFolha(0)}`
      : `${parcelas.map((p) => `${p.rotulo} ${reaisFolha(p.valor)}`).join(' + ')} = ${reaisFolha(total)}`;
  return { parcelas, total, conta };
}

/** Monta o plano: um título por destino e vencimento, com o de-para, o documento e as pendências. */
export function montarPlanoTitulos(x: EntradaPlanoTitulos): PlanoTitulosFolhaCalculado {
  const dePara = new Map(x.dePara.map((d) => [d.destino, d]));
  const rotinas = new Map(x.rotinas.map((r) => [r.id, r]));
  const pendencias: PendenciaTituloFolha[] = [];
  const pendente = (codigo: PendenciaTituloFolha['codigo'], destino: DestinoTituloFolha | null) => {
    if (!pendencias.some((p) => p.codigo === codigo && p.destino === destino))
      pendencias.push({ codigo, destino });
  };
  const porChave = new Map<string, TituloFolhaPlanejado>();
  for (const p of x.parcelas) {
    if (p.valor <= 0) continue;
    const d = dePara.get(p.destino) ?? null;
    const rotina = ROTINA_DO_DESTINO[p.destino];
    if (!d) pendente('sem-de-para', p.destino);
    if (!rotinas.get(rotina)?.financeiro) pendente('rotina-sem-financeiro', p.destino);
    const sugerido =
      p.vencimento ??
      (d ? vencimentoDoEncargo(x.apuracao, x.periodo, d.diaVencimento, d.mesesDepois) : null) ??
      vencimentoDoEncargo(x.apuracao, x.periodo, 20, 1);
    const chave = `${p.destino}:${sugerido}`;
    const vencimento = x.vencimentos?.get(chave) ?? sugerido;
    if (vencimento < x.emissao) pendente('vencimento-antes-da-emissao', p.destino);
    const atual = porChave.get(chave);
    porChave.set(chave, {
      chave,
      destino: p.destino,
      rotina,
      cenario: cenarioDoDestino(p.destino),
      credor: d?.credor ?? null,
      classificacao: d ? { ...d.classificacao } : null,
      documento: documentoDoTituloFolha(x.apuracao, x.periodo, rotina, vencimento),
      valor: (atual?.valor ?? 0) + p.valor,
      vencimento,
      referente: referenteDoTituloFolha(p.destino, x.apuracao, x.periodo),
    });
  }
  const titulos = [...porChave.values()].sort(
    (a, b) => ordem(a.destino) - ordem(b.destino) || a.vencimento.localeCompare(b.vencimento),
  );
  if (titulos.length === 0) pendente('sem-titulos', null);
  const { parcelas, total, conta } = contaDosTitulos(titulos);
  return { titulos, pendencias, parcelas, total, conta };
}

/** Regra 6 e prova da seção 5: a soma dos títulos igual ao líquido mais os encargos da origem. */
export function conferirSomaTitulos(
  titulos: readonly { valor: number }[],
  esperado: number,
): PendenciaTituloFolha | null {
  return soma(titulos, (t) => t.valor) === esperado ? null : { codigo: 'soma-divergente', destino: null };
}

/** Texto canônico do plano (o SHA-256 dele é o resumo que a prévia mostra e o lançamento confere). */
export function textoResumoPlano(
  origem: string,
  id: number,
  titulos: readonly TituloFolhaPlanejado[],
  fatos: readonly FatoContabilFolha[],
): string {
  const ts = titulos.map(
    (t) =>
      `${t.chave}|${t.rotina}|${t.credor ?? ''}|${t.classificacao ? `${t.classificacao.grupo}.${t.classificacao.subgrupo}.${t.classificacao.item}` : ''}|${t.documento}|${t.valor}`,
  );
  const fs = fatos.map(
    (f) => `${f.rotina}|${f.centroCusto}|${f.natureza}|${f.contabiliza ? 1 : 0}|${f.valor}`,
  );
  return [`${origem}:${id}`, ...ts, '--', ...fs].join('\n');
}

/** O resumo de um vínculo no processamento (a soma do banco), como a regra dos fatos usa. */
export interface VinculoParaFatos {
  readonly centroCusto: number;
  readonly proventos: number;
  readonly porPapel: Readonly<Partial<Record<string, number>>>;
}

/** D-FATO-539: os fatos de um período por centro de custo e rotina (proventos e encargos da empresa). */
export function fatosDaFolha(
  processos: readonly { readonly tipo: TipoProcessoFolha; readonly vinculos: readonly VinculoParaFatos[] }[],
  rotinas: readonly RotinaParaTitulos[],
): FatoContabilFolha[] {
  const contab = new Map(rotinas.map((r) => [r.id, r.contabilidade]));
  const acc = new Map<string, FatoContabilFolha>();
  const somar = (
    rotina: number,
    centroCusto: number,
    natureza: FatoContabilFolha['natureza'],
    valor: number,
  ) => {
    if (valor <= 0) return;
    const k = `${rotina}|${centroCusto}|${natureza}`;
    const a = acc.get(k);
    acc.set(k, {
      rotina,
      centroCusto,
      natureza,
      contabiliza: contab.get(rotina) ?? false,
      valor: (a?.valor ?? 0) + valor,
    });
  };
  for (const p of processos) {
    const rotinaProventos = ROTINA_DO_DESTINO[DESTINO_DO_LIQUIDO[p.tipo]];
    for (const v of p.vinculos) {
      const papel = (k: string) => v.porPapel[k] ?? 0;
      somar(rotinaProventos, v.centroCusto, 'provento', v.proventos);
      somar(ROTINA_DO_DESTINO.fgts, v.centroCusto, 'encargo', papel('fgts'));
      somar(
        ROTINA_DO_DESTINO['inss-patronal'],
        v.centroCusto,
        'encargo',
        papel('inssPatronal') + papel('rat') + papel('terceiros'),
      );
    }
  }
  return [...acc.values()].sort(
    (a, b) => a.centroCusto - b.centroCusto || a.rotina - b.rotina || a.natureza.localeCompare(b.natureza),
  );
}

/** Os fatos do retorno da folha externa: o custo por centro de custo da lotação de cada colaborador (só proventos). */
export function fatosDoRetorno(
  linhas: readonly { readonly centroCusto: number | null; readonly proventos: number }[],
  rotinas: readonly RotinaParaTitulos[],
): FatoContabilFolha[] {
  const rotina = ROTINA_DO_DESTINO['liquido-mensal'];
  const contabiliza = rotinas.find((r) => r.id === rotina)?.contabilidade ?? false;
  const acc = new Map<number, number>();
  for (const l of linhas)
    if (l.proventos > 0) acc.set(l.centroCusto ?? 0, (acc.get(l.centroCusto ?? 0) ?? 0) + l.proventos);
  return [...acc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([centroCusto, valor]) => ({
      rotina,
      centroCusto,
      natureza: 'provento' as const,
      contabiliza,
      valor,
    }));
}

/** Regra 11: custo de pessoal por centro de custo (proventos + encargos da empresa), somado dos fatos. */
export function custoPessoalPorCentro(fatos: readonly FatoContabilFolha[]): CustoPessoalCentro[] {
  const acc = new Map<number, { proventos: number; encargos: number }>();
  for (const f of fatos) {
    const a = acc.get(f.centroCusto) ?? { proventos: 0, encargos: 0 };
    if (f.natureza === 'provento') a.proventos += f.valor;
    else a.encargos += f.valor;
    acc.set(f.centroCusto, a);
  }
  return [...acc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([centroCusto, a]) => ({ centroCusto, ...a, total: a.proventos + a.encargos }));
}

/** Avisos: títulos do mesmo credor e classificação no mês, lançados por outro caminho (não barram; o DP confere). */
export function avisosDeLancamentoManual(
  contagens: readonly { readonly destino: DestinoTituloFolha; readonly titulos: number }[],
): AvisoTituloFolha[] {
  return contagens
    .filter((c) => c.titulos > 0)
    .map((c) => ({ codigo: 'possivel-lancamento-manual' as const, destino: c.destino, titulos: c.titulos }));
}
