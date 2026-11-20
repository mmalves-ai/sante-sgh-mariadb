// 13º salário (M53-F3; ficha do M53, seções 1 e 8, regras 7 e 8; Leis 4.090/1962 e 4.749/1965): a 1ª parcela (o
// adiantamento, de fevereiro a 30 de novembro) e a parcela final (até 20 de dezembro), por empresa e ano, com a memória
// por rubrica. Regra pura: quem chama lê os vínculos, os salários, os afastamentos, o histórico das folhas mensais
// calculadas (para as médias), os adiantamentos já pagos no ano, a tabela legal, os parâmetros e as rubricas.
//
// Decisões (POL-5, dono confirma; registradas nas evidências do M53.4):
// - D-PRIM13-534: a 1ª parcela é metade da remuneração fixa (salário em vigor no pagamento + adicionais) × avos do ano ÷
//   12, com os avos do ano inteiro (os meses futuros contam enquanto o vínculo segue ativo e sem afastamento aberto),
//   sem médias (elas entram na parcela final) e sem INSS nem IRRF; só o FGTS, pela rubrica.
// - D-FINAL13-534: a parcela final é a remuneração fixa de dezembro × avos ÷ 12 + as médias (D-MEDIA-534, até novembro)
//   − os adiantamentos do ano (1ª parcela ou com as férias); INSS sobre o 13º inteiro em separado, IRRF exclusivo
//   (D-IRRF13-534), FGTS sobre o 13º inteiro menos o já depositado no adiantamento, encargos sobre a base do INSS.
// - D-DESLIG13-534: vínculo desligado até o fim do ano (ou até o pagamento, na 1ª parcela) fica fora: o 13º proporcional
//   sai na rescisão (M53-F4), descontado o adiantamento; quem já recebeu o adiantamento com as férias fica fora da 1ª.
// - D-SEMAJUSTE-534: as médias de dezembro não entram (sem o ajuste de janeiro nesta etapa).
import type {
  AvisoDecimo,
  DiasAfastamentoFolha,
  PapelCalculoFolha,
  ParametrosFolha,
  PendenciaCalculo,
  RubricaFolha,
  TabelaLegalFolha,
} from '@sgh/contratos';
import { diaUtc } from '../datas.js';
import {
  type AfastamentoParaCalculo,
  type Bruta,
  multiplicarDividir,
  reais,
  type ResultadoCalculoFolhaPuro,
  rubricaServeAoPapel,
  type SalarioParaCalculo,
  totalizarCalculo,
  type VinculoCalculado,
  type VinculoParaCalculo,
} from './calculo.js';
import { remuneracaoFixa } from './ferias.js';
import { avosDoAno, competenciasSemCalculo, type HistoricoFolha, mediaDasVariaveis } from './medias.js';
import { fecharRecibo, papeisSemRubrica, rubricasDosParametros } from './recibo.js';
import { conferirTabelaLegal, vigenteNaCompetencia, vigenteNaData } from './vigencia.js';

export interface EntradaCalculoDecimo {
  readonly empresa: number;
  readonly ano: number;
  readonly parcela: 1 | 2;
  readonly pagamento: string;
  readonly hoje: string;
  readonly vinculos: readonly VinculoParaCalculo[];
  readonly salarios: readonly SalarioParaCalculo[];
  readonly afastamentos: readonly AfastamentoParaCalculo[];
  readonly diasAfastamento: readonly DiasAfastamentoFolha[];
  /** O histórico das folhas mensais calculadas do ano, por vínculo (médias da parcela final). */
  readonly historico: ReadonlyMap<number, readonly HistoricoFolha[]>;
  /** O que cada vínculo já recebeu de adiantamento do 13º no ano (1ª parcela ou com as férias). */
  readonly adiantamentos: ReadonlyMap<number, number>;
  readonly tabelasLegais: readonly TabelaLegalFolha[];
  readonly parametros: readonly ParametrosFolha[];
  readonly rubricas: readonly RubricaFolha[];
}

export interface ResultadoCalculoDecimoPuro extends ResultadoCalculoFolhaPuro {
  readonly competencia: string;
  readonly avisos: readonly { readonly codigo: AvisoDecimo; readonly competencias: readonly string[] }[];
}

/** A competência do processamento: a do pagamento na 1ª parcela; dezembro na final. */
export function competenciaDoDecimo(ano: number, parcela: 1 | 2, pagamento: string): string {
  return parcela === 1 ? pagamento.slice(0, 7) : `${ano}-12`;
}

/** O vínculo entra na parcela do 13º (D-TIPO-533, D-DESLIG13-534)? */
export function entraNoDecimo(
  v: VinculoParaCalculo,
  ano: number,
  parcela: 1 | 2,
  pagamento: string,
): boolean {
  if (v.tipo !== 'clt') return false;
  const ref = parcela === 1 ? pagamento : `${ano}-12-31`;
  if (diaUtc(v.admissao) > diaUtc(ref)) return false;
  return v.desligamento === null || diaUtc(v.desligamento) > diaUtc(ref);
}

/** Calcula a parcela do 13º da empresa no ano. */
export function calcularDecimoTerceiro(e: EntradaCalculoDecimo): ResultadoCalculoDecimoPuro {
  const competencia = competenciaDoDecimo(e.ano, e.parcela, e.pagamento);
  const pend = new Map<string, PendenciaCalculo>();
  const add = (
    codigo: PendenciaCalculo['codigo'],
    vinculo: number | null,
    papel: PapelCalculoFolha | null = null,
  ) => {
    const k = `${codigo}:${papel ?? ''}`;
    const p = pend.get(k) ?? { codigo, vinculos: [], papel };
    if (vinculo !== null && !p.vinculos.includes(vinculo)) (p.vinculos as number[]).push(vinculo);
    pend.set(k, p);
  };
  const avisos: { codigo: AvisoDecimo; competencias: string[] }[] = [];
  const liberaEm = e.parcela === 1 ? `${e.ano}-01-01` : `${e.ano}-12-01`;
  if (diaUtc(e.hoje) < diaUtc(liberaEm)) add('competencia-futura', null);
  const p = e.pagamento;
  if (
    (e.parcela === 1 && (p < `${e.ano}-02-01` || p > `${e.ano}-11-30`)) ||
    (e.parcela === 2 && p > `${e.ano}-12-20`)
  )
    avisos.push({ codigo: 'pagamento-fora-do-prazo', competencias: [] });
  const tabela = vigenteNaCompetencia(e.tabelasLegais, competencia);
  if (!tabela) add('sem-tabela-legal', null);
  else if (conferirTabelaLegal(tabela).length > 0) add('tabela-legal-divergente', null);
  const parametros = vigenteNaCompetencia(
    e.parametros.filter((x) => x.empresa === e.empresa),
    competencia,
  );
  if (!parametros) add('sem-parametros', null);
  const dias = vigenteNaCompetencia(e.diasAfastamento, competencia)?.dias ?? 0;

  const candidatos = e.vinculos.filter((v) => entraNoDecimo(v, e.ano, e.parcela, e.pagamento));
  let foraDaFolha = e.vinculos.length - candidatos.length;
  const naFolha: VinculoParaCalculo[] = [];
  for (const v of candidatos) {
    if (e.parcela === 1 && (e.adiantamentos.get(v.id) ?? 0) > 0) foraDaFolha++;
    else naFolha.push(v);
  }
  if (naFolha.length === 0) add('sem-colaboradores', null);
  const rub = parametros
    ? rubricasDosParametros(parametros, e.rubricas, e.empresa, competencia, rubricaServeAoPapel)
    : null;
  const ref = e.parcela === 1 ? e.pagamento : `${e.ano}-12-31`;
  const semCalculo = new Set<string>();
  const colaboradores: VinculoCalculado[] = [];
  for (const v of [...naFolha].sort((a, b) => a.id - b.id)) {
    const salario = vigenteNaData(
      e.salarios.filter((s) => s.vinculo === v.id),
      ref,
    );
    if (!salario) {
      add('sem-salario', v.id);
      continue;
    }
    if (!tabela || !parametros || !rub) continue;
    const afast = e.afastamentos.filter((a) => a.vinculo === v.id && a.situacao === 'ativo');
    const { avos } = avosDoAno(v, afast, e.ano, dias);
    if (avos === 0) {
      foraDaFolha++;
      continue;
    }
    const fixa = remuneracaoFixa(salario, tabela, parametros);
    const brutas: Bruta[] = [];
    let recibo;
    if (e.parcela === 1) {
      brutas.push({
        papel: 'decimoPrimeira',
        quantidade: avos,
        unidade: 'valor',
        valor: multiplicarDividir([fixa.valor, avos], [24]),
        memoria: `(${fixa.memoria}) = ${reais(fixa.valor)} × ${avos}/12 avos ÷ 2`,
      });
      recibo = fecharRecibo(
        v,
        avos,
        brutas,
        { tabela, parametros, rubricas: rub.mapa, dependentesIrrf: salario.dependentesIrrf },
        {
          papelInss: null,
          papelIrrf: null,
          irrf: 'exclusiva',
          foraDoInssIrrf: new Set<PapelCalculoFolha>(['decimoPrimeira']),
          fgtsJaDepositado: 0,
          encargos: false,
        },
      );
    } else {
      const ateNov = avosDoAno(v, afast, e.ano, dias, 11);
      const hist = e.historico.get(v.id) ?? [];
      for (const c of competenciasSemCalculo(hist, ateNov.meses)) semCalculo.add(c);
      const divisor = parametros.divisorHoras ?? v.cargaSemanal * 5;
      const media = mediaDasVariaveis(
        hist,
        new Set(ateNov.meses),
        ateNov.avos,
        salario.salario,
        divisor,
        parametros,
        [avos, 12],
      );
      brutas.push({
        papel: 'decimoTerceiro',
        quantidade: avos,
        unidade: 'valor',
        valor: multiplicarDividir([fixa.valor, avos], [12]),
        memoria: `(${fixa.memoria}) = ${reais(fixa.valor)} × ${avos}/12 avos`,
      });
      brutas.push({
        papel: 'decimoMedias',
        quantidade: ateNov.avos,
        unidade: 'valor',
        valor: media.valor,
        memoria: `médias até novembro: ${media.memoria}`,
      });
      const adiantado = e.adiantamentos.get(v.id) ?? 0;
      brutas.push({
        papel: 'decimoDesconto',
        quantidade: 0,
        unidade: 'valor',
        valor: adiantado,
        memoria: `adiantamento do 13º pago no ano ${reais(adiantado)}`,
      });
      recibo = fecharRecibo(
        v,
        avos,
        brutas,
        { tabela, parametros, rubricas: rub.mapa, dependentesIrrf: salario.dependentesIrrf },
        {
          papelInss: 'inssDecimo',
          papelIrrf: 'irrfDecimo',
          irrf: 'exclusiva',
          foraDoInssIrrf: new Set<PapelCalculoFolha>(),
          foraDasBases: new Set<PapelCalculoFolha>(['decimoDesconto']),
          fgtsJaDepositado: adiantado,
          encargos: true,
        },
      );
    }
    let falta = false;
    for (const papel of papeisSemRubrica(recibo.linhas, rub.mapa)) {
      add(rub.invalidas.has(papel) ? 'rubrica-invalida' : 'papel-sem-rubrica', v.id, papel);
      falta = true;
    }
    if (recibo.resumo.descontos > recibo.resumo.proventos) {
      add('liquido-negativo', v.id);
      falta = true;
    }
    if (!falta) colaboradores.push({ resumo: recibo.resumo, linhas: recibo.linhas });
  }
  if (semCalculo.size > 0)
    avisos.push({ codigo: 'competencias-sem-calculo', competencias: [...semCalculo].sort() });
  const pendencias = [...pend.values()]
    .map((x) => ({ ...x, vinculos: [...x.vinculos].sort((a, b) => a - b) }))
    .sort((a, b) => (a.codigo + (a.papel ?? '')).localeCompare(b.codigo + (b.papel ?? '')));
  return {
    competencia,
    pendencias,
    avisos,
    colaboradores,
    totais: totalizarCalculo(colaboradores),
    foraDaFolha,
    tabelaLegal: tabela?.inicio ?? null,
    parametros: parametros?.inicio ?? null,
  };
}
