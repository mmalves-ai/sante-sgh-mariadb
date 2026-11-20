// Conferência dos lotes trocados com a folha externa (M53-F0; ficha do M53, regra 6; cap-07 §7.1.5, "Integração com
// escala e ponto: por interface"): contagem e soma conferíveis nos dois sentidos. O lote exportado declara os totais;
// o retorno ecoa o que recebeu e declara os seus. Qualquer divergência barra o lançamento dos títulos.
//
// A conferência devolve só códigos, campos, números e o vínculo (nunca CPF ou nome): a lista vai para a tela, para a
// trilha e para SGH_PES_FOLHA_INTERFACE.DIVERGENCIAS sem expor dado pessoal.
import type {
  DivergenciaLoteFolha,
  EncargoRetorno,
  LoteExportacaoFolha,
  LoteRetornoFolha,
  TipoEncargoFolha,
  TotaisExportacao,
  TotaisRetorno,
} from '@sgh/contratos';

/** Códigos de divergência (a tela traduz pelo i18n; `pessoas.folha.divergencia.<codigo>`). */
export const CODIGOS_DIVERGENCIA_LOTE = [
  'total-exportado',
  'eco-diferente',
  'competencia-diferente',
  'empresa-diferente',
  'lote-diferente',
  'total-retorno',
  'liquido-colaborador',
  'vinculo-nao-exportado',
  'vinculo-repetido',
  'vinculo-sem-colaborador',
] as const;
export type CodigoDivergenciaLote = (typeof CODIGOS_DIVERGENCIA_LOTE)[number];

type Divergencia = DivergenciaLoteFolha & { readonly codigo: CodigoDivergenciaLote };

const div = (
  codigo: CodigoDivergenciaLote,
  campo: string,
  declarado: number,
  calculado: number,
  vinculo: number | null = null,
): Divergencia => ({ codigo, campo, declarado, calculado, vinculo });

const soma = <T>(xs: readonly T[], f: (x: T) => number): number => xs.reduce((s, x) => s + f(x), 0);

/** Totais calculados de um lote exportado (o que ele de fato contém). */
export function totalizarExportacao(
  lote: Pick<LoteExportacaoFolha, 'colaboradores' | 'afastamentos' | 'eventosPonto' | 'plantoes'>,
): TotaisExportacao {
  return {
    colaboradores: lote.colaboradores.length,
    afastamentos: lote.afastamentos.length,
    eventosPonto: lote.eventosPonto.length,
    minutosPonto: soma(lote.eventosPonto, (e) => e.minutos),
    plantoes: lote.plantoes.length,
    minutosPlantao: soma(lote.plantoes, (p) => p.minutos),
  };
}

const CAMPOS_EXPORTACAO: readonly (keyof TotaisExportacao)[] = [
  'colaboradores',
  'afastamentos',
  'eventosPonto',
  'minutosPonto',
  'plantoes',
  'minutosPlantao',
];

function compararTotais(
  codigo: CodigoDivergenciaLote,
  declarado: TotaisExportacao,
  calculado: TotaisExportacao,
): Divergencia[] {
  return CAMPOS_EXPORTACAO.filter((c) => declarado[c] !== calculado[c]).map((c) =>
    div(codigo, c, declarado[c], calculado[c]),
  );
}

/**
 * Confere o lote exportado antes de baixar: os totais declarados batem com o conteúdo; todo afastamento, evento e
 * plantão é de um colaborador do lote; nenhum colaborador aparece duas vezes.
 */
export function conferirExportacao(lote: LoteExportacaoFolha): Divergencia[] {
  const out = compararTotais('total-exportado', lote.totais, totalizarExportacao(lote));
  const vinculos = new Set<number>();
  for (const c of lote.colaboradores) {
    if (vinculos.has(c.vinculo)) out.push(div('vinculo-repetido', 'colaboradores', 1, 2, c.vinculo));
    vinculos.add(c.vinculo);
  }
  const orfaos = new Set<number>();
  for (const x of [...lote.afastamentos, ...lote.eventosPonto, ...lote.horasPonto, ...lote.plantoes])
    if (!vinculos.has(x.vinculo)) orfaos.add(x.vinculo);
  for (const v of [...orfaos].sort((a, b) => a - b))
    out.push(div('vinculo-sem-colaborador', 'colaboradores', 0, 1, v));
  return out;
}

/** Totais calculados de um retorno (proventos, descontos, líquido e encargos, em centavos). */
export function totalizarRetorno(
  retorno: Pick<LoteRetornoFolha, 'colaboradores' | 'encargos'>,
): TotaisRetorno {
  let proventos = 0;
  let descontos = 0;
  for (const c of retorno.colaboradores)
    for (const r of c.rubricas) {
      if (r.natureza === 'provento') proventos += r.valor;
      else if (r.natureza === 'desconto') descontos += r.valor;
    }
  return {
    colaboradores: retorno.colaboradores.length,
    proventos,
    descontos,
    liquido: soma(retorno.colaboradores, (c) => c.liquido),
    encargos: soma(retorno.encargos, (e) => e.valor),
  };
}

const CAMPOS_RETORNO: readonly (keyof TotaisRetorno)[] = [
  'colaboradores',
  'proventos',
  'descontos',
  'liquido',
  'encargos',
];

/**
 * O que a conferência do retorno precisa do lote exportado, sem dado pessoal: o lote, a empresa, a competência, os
 * totais que o conteúdo tem e os vínculos exportados. É o que SGH_PES_FOLHA_INTERFACE guarda do lote (o arquivo, com o
 * CPF, não é guardado).
 */
export interface ExportadoConferivel {
  readonly lote: number;
  readonly empresa: number;
  readonly competencia: string;
  readonly totais: TotaisExportacao;
  readonly vinculos: readonly number[];
}

export function exportadoConferivel(lote: LoteExportacaoFolha): ExportadoConferivel {
  return {
    lote: lote.lote,
    empresa: lote.empresa,
    competencia: lote.competencia,
    totais: totalizarExportacao(lote),
    vinculos: lote.colaboradores.map((c) => c.vinculo),
  };
}

/**
 * Confere o retorno contra o lote exportado a que ele responde (regra 6, nos dois sentidos):
 * 1. mesmo lote, empresa e competência;
 * 2. o eco do sistema de folha (o que ele recebeu) é igual aos totais que o Sante SGH exportou;
 * 3. os totais declarados no retorno batem com o conteúdo;
 * 4. em cada colaborador, líquido = proventos − descontos (as rubricas informativas não entram);
 * 5. só volta vínculo que foi exportado, e cada um uma vez só.
 */
export function conferirRetorno(
  retorno: LoteRetornoFolha,
  exportadoOuResumo: LoteExportacaoFolha | ExportadoConferivel,
): Divergencia[] {
  const exportado =
    'colaboradores' in exportadoOuResumo ? exportadoConferivel(exportadoOuResumo) : exportadoOuResumo;
  const out: Divergencia[] = [];
  if (retorno.loteExportado !== exportado.lote)
    out.push(div('lote-diferente', 'loteExportado', retorno.loteExportado, exportado.lote));
  if (retorno.empresa !== exportado.empresa)
    out.push(div('empresa-diferente', 'empresa', retorno.empresa, exportado.empresa));
  if (retorno.competencia !== exportado.competencia)
    out.push(
      div(
        'competencia-diferente',
        'competencia',
        Number(retorno.competencia.replace('-', '')),
        Number(exportado.competencia.replace('-', '')),
      ),
    );
  out.push(...compararTotais('eco-diferente', retorno.recebido, exportado.totais));
  const calculado = totalizarRetorno(retorno);
  for (const c of CAMPOS_RETORNO)
    if (retorno.totais[c] !== calculado[c])
      out.push(div('total-retorno', c, retorno.totais[c], calculado[c]));
  const exportados = new Set(exportado.vinculos);
  const vistos = new Set<number>();
  for (const c of retorno.colaboradores) {
    if (!exportados.has(c.vinculo)) out.push(div('vinculo-nao-exportado', 'colaboradores', 0, 1, c.vinculo));
    if (vistos.has(c.vinculo)) out.push(div('vinculo-repetido', 'colaboradores', 1, 2, c.vinculo));
    vistos.add(c.vinculo);
    const proventos = soma(
      c.rubricas.filter((r) => r.natureza === 'provento'),
      (r) => r.valor,
    );
    const descontos = soma(
      c.rubricas.filter((r) => r.natureza === 'desconto'),
      (r) => r.valor,
    );
    if (c.liquido !== proventos - descontos)
      out.push(div('liquido-colaborador', 'liquido', c.liquido, proventos - descontos, c.vinculo));
  }
  return out;
}

/** Regra 6: com qualquer divergência, os títulos não são lançados. */
export function podeLancarTitulos(divergencias: readonly DivergenciaLoteFolha[]): boolean {
  return divergencias.length === 0;
}

/** Parcela de um título a lançar (cenários `origem-folha` e `origem-encargo` do M32). */
export interface ParcelaTituloFolha {
  readonly origem: 'folha' | 'encargo';
  readonly tipo: 'liquido' | TipoEncargoFolha;
  readonly valor: number;
  readonly vencimento: string;
}

/** Os títulos que o retorno pede, com as parcelas impressas, e a soma que a prova pós-escrita relê (seção 5). */
export interface PlanoTitulosFolha {
  readonly parcelas: readonly ParcelaTituloFolha[];
  readonly total: number;
  /** "líquido R$ x + INSS R$ y + … = R$ total", em centavos; vai ao relatório da importação. */
  readonly conta: string;
}

const ORDEM_ENCARGO: readonly TipoEncargoFolha[] = ['inss', 'fgts', 'irrf', 'sindical', 'outro'];

const reais = (c: number): string =>
  `R$ ${Math.floor(c / 100).toLocaleString('pt-BR')},${String(c % 100).padStart(2, '0')}`;

/**
 * Monta o plano de títulos de um retorno conferido: um título para a folha líquida e um por tipo de encargo (os
 * encargos do mesmo tipo e vencimento somam num título só). Parcela de valor zero não vira título.
 */
export function planoDeTitulos(retorno: LoteRetornoFolha): PlanoTitulosFolha {
  const parcelas: ParcelaTituloFolha[] = [];
  const liquido = soma(retorno.colaboradores, (c) => c.liquido);
  if (liquido > 0)
    parcelas.push({
      origem: 'folha',
      tipo: 'liquido',
      valor: liquido,
      vencimento: retorno.vencimentoLiquido,
    });
  const porChave = new Map<string, EncargoRetorno[]>();
  for (const e of retorno.encargos) {
    const k = `${e.tipo}|${e.vencimento}`;
    porChave.set(k, [...(porChave.get(k) ?? []), e]);
  }
  const chaves = [...porChave.keys()].sort((a, b) => {
    const [ta, va] = a.split('|') as [TipoEncargoFolha, string];
    const [tb, vb] = b.split('|') as [TipoEncargoFolha, string];
    return ORDEM_ENCARGO.indexOf(ta) - ORDEM_ENCARGO.indexOf(tb) || va.localeCompare(vb);
  });
  for (const k of chaves) {
    const grupo = porChave.get(k)!;
    const valor = soma(grupo, (e) => e.valor);
    if (valor > 0)
      parcelas.push({ origem: 'encargo', tipo: grupo[0]!.tipo, valor, vencimento: grupo[0]!.vencimento });
  }
  const total = soma(parcelas, (p) => p.valor);
  const rotulo = (p: ParcelaTituloFolha) => (p.tipo === 'liquido' ? 'líquido' : p.tipo.toUpperCase());
  const conta =
    parcelas.length === 0
      ? `nenhum título = ${reais(0)}`
      : `${parcelas.map((p) => `${rotulo(p)} ${reais(p.valor)}`).join(' + ')} = ${reais(total)}`;
  return { parcelas, total, conta };
}
