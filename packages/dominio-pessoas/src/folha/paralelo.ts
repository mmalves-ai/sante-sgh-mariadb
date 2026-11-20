// Cálculo em paralelo com a folha atual (M53.3, etapa F2; ficha do M53, regra 8; cap-07 §7.1.5, "Prazo"): nas
// competências fixadas pelo dono, a folha calculada pelo Sante SGH é comparada com a folha que o sistema externo
// devolveu (retorno conferido da interface M53-F0, resumo por vínculo e rubrica-resumo) e o relatório de divergências sai
// por rubrica-resumo, SEM dado pessoal: só IDs de vínculo, contagens e somas em centavos, com as parcelas de cada conta
// (convencoes.md: toda conta agregada com as parcelas impressas). Regra pura: quem lê o banco é o teste dourado
// (`tools/assinatura/dourado/folha.spec.ts`) e, depois, a tela de conferência do paralelo.
//
// Comparação (por empresa e competência, D-PARALELO-535: a mensal somada às rescisões do mês; `juntarCompetenciaParalelo`):
// - por vínculo: proventos, descontos e líquido (o externo devolve as três rubricas-resumo por colaborador);
// - por competência: os encargos que viram guia (INSS = INSS dos colaboradores + INSS da empresa + RAT + outras
//   entidades; FGTS; IRRF), porque o retorno traz o encargo pelo total da guia, não por vínculo;
// - vínculo só num dos lados é divergência própria (entrou numa folha e não na outra);
// - a tolerância é por valor comparado, em centavos (padrão 0: a meta é divergência zero; cada diferença é explicada e
//   aceita pelo departamento pessoal nas evidências).

/** As rubricas-resumo comparadas por vínculo. */
export const RUBRICAS_PARALELO_VINCULO = ['proventos', 'descontos', 'liquido'] as const;
export type RubricaParaleloVinculo = (typeof RUBRICAS_PARALELO_VINCULO)[number];
/** Os encargos comparados pelo total da competência. */
export const ENCARGOS_PARALELO = ['inss', 'fgts', 'irrf'] as const;
export type EncargoParalelo = (typeof ENCARGOS_PARALELO)[number];

/** O vínculo no cálculo do Sante SGH (somas das linhas, em centavos). */
export interface VinculoCalculadoParalelo {
  readonly vinculo: number;
  readonly proventos: number;
  readonly descontos: number;
  /** INSS do colaborador, IRRF e FGTS (linhas do vínculo). */
  readonly inss: number;
  readonly irrf: number;
  readonly fgts: number;
  /** Encargos da empresa do vínculo (INSS da empresa + RAT + outras entidades). */
  readonly encargosEmpresa: number;
}

/** Uma linha do resumo importado do sistema externo (SGH_PES_FOLHA_RESUMO, origem importada). */
export interface LinhaExternaParalelo {
  /** null nas linhas de encargo (guia da competência). */
  readonly vinculo: number | null;
  /** 'proventos' | 'descontos' | 'liquido' por vínculo; o tipo do encargo ('inss', 'fgts', 'irrf', ...) sem vínculo. */
  readonly rubrica: string;
  readonly valor: number;
}

export interface EntradaParalelo {
  readonly empresa: number;
  readonly competencia: string;
  /** O processamento em vigor do Sante SGH (ID) e o lote recebido do sistema externo (ID). */
  readonly processo: number;
  readonly loteExterno: number;
  readonly calculado: readonly VinculoCalculadoParalelo[];
  readonly externo: readonly LinhaExternaParalelo[];
  /** Diferença aceita por valor comparado, em centavos (padrão 0). */
  readonly toleranciaCentavos?: number;
  /** Os processamentos somados na competência (padrão: só `processo`); ver `juntarCompetenciaParalelo`. */
  readonly processos?: readonly number[];
  /** Os processamentos em vigor da competência que ficaram fora da comparação, com o tipo (padrão: nenhum). */
  readonly deixados?: readonly ProcessoDeixadoParalelo[];
}

export interface ComparacaoRubricaParalelo {
  readonly rubrica: RubricaParaleloVinculo | EncargoParalelo;
  readonly sante: number;
  readonly externo: number;
  /** sante − externo. */
  readonly diferenca: number;
  /** A conta impressa: "sante − externo = diferença" com as parcelas. */
  readonly conta: string;
  /** Vínculos com diferença acima da tolerância nesta rubrica (só por vínculo; nos encargos, vazio). */
  readonly vinculosDivergentes: readonly number[];
  readonly confere: boolean;
}

export interface RelatorioParalelo {
  readonly empresa: number;
  readonly competencia: string;
  readonly processo: number;
  readonly loteExterno: number;
  /** Os processamentos do Sante SGH somados por vínculo nesta competência (a mensal e as rescisões). */
  readonly processos: readonly number[];
  /** Os processamentos em vigor fora da comparação (férias e 13º: a folha externa da competência não os traz). */
  readonly deixados: readonly ProcessoDeixadoParalelo[];
  readonly toleranciaCentavos: number;
  readonly vinculos: {
    readonly sante: number;
    readonly externo: number;
    readonly emAmbos: number;
    /** Só no cálculo do Sante SGH / só na folha externa (IDs). */
    readonly soNoSante: readonly number[];
    readonly soNoExterno: readonly number[];
  };
  readonly rubricas: readonly ComparacaoRubricaParalelo[];
  /** Divergência zero (dentro da tolerância) em todas as rubricas e nenhum vínculo só num lado. */
  readonly confere: boolean;
}

/**
 * Os tipos de processamento que a folha externa traz na competência (D-PARALELO-535): a folha mensal e as rescisões do
 * mês. O colaborador desligado fica fora da mensal (D-DESLIG-533) e sai só na rescisão, enquanto a folha externa da
 * competência traz o saldo e as verbas dele; por isso o paralelo soma, por vínculo, a mensal com as rescisões em vigor da
 * competência. Férias e 13º (`ferias`, `decimo1`, `decimo2`) são folhas à parte e ficam fora, listados no relatório.
 */
export const TIPOS_PARALELO_COMPETENCIA = ['mensal', 'rescisao'] as const;

/** Um processamento em vigor do Sante SGH, com o resumo por vínculo (vazio nos tipos fora da comparação). */
export interface ProcessoCalculadoParalelo {
  readonly id: number;
  readonly tipo: string;
  readonly empresa: number;
  readonly competencia: string;
  readonly vinculos: readonly VinculoCalculadoParalelo[];
}
export interface ProcessoDeixadoParalelo {
  readonly id: number;
  readonly tipo: string;
}
/** O lado do Sante SGH de uma competência, pronto para `compararParalelo`. */
export interface CompetenciaParalelo {
  readonly empresa: number;
  readonly competencia: string;
  /** O processamento de referência do relatório: o mensal; sem mensal, o de menor ID. */
  readonly processo: number;
  readonly processos: readonly number[];
  readonly deixados: readonly ProcessoDeixadoParalelo[];
  /** Por vínculo, a soma da mensal com as rescisões da competência. */
  readonly calculado: readonly VinculoCalculadoParalelo[];
}

/**
 * Junta os processamentos em vigor por empresa e competência (regra 8 por competência, não por processamento): soma por
 * vínculo os tipos de `tipos` (padrão `TIPOS_PARALELO_COMPETENCIA`) e lista os demais como deixados. Competência só com
 * processamentos deixados não entra (não há o que comparar com a folha externa da competência).
 */
export function juntarCompetenciaParalelo(
  processos: readonly ProcessoCalculadoParalelo[],
  tipos: readonly string[] = TIPOS_PARALELO_COMPETENCIA,
): CompetenciaParalelo[] {
  const grupos = new Map<string, ProcessoCalculadoParalelo[]>();
  for (const p of processos) {
    const k = `${p.empresa}|${p.competencia}`;
    grupos.set(k, [...(grupos.get(k) ?? []), p]);
  }
  const out: CompetenciaParalelo[] = [];
  for (const ps of grupos.values()) {
    const ordem = [...ps].sort((a, b) => a.id - b.id);
    const dentro = ordem.filter((p) => tipos.includes(p.tipo));
    if (dentro.length === 0) continue;
    const soma = new Map<number, VinculoCalculadoParalelo>();
    for (const p of dentro)
      for (const v of p.vinculos) {
        const x = soma.get(v.vinculo);
        soma.set(
          v.vinculo,
          x
            ? {
                vinculo: v.vinculo,
                proventos: x.proventos + v.proventos,
                descontos: x.descontos + v.descontos,
                inss: x.inss + v.inss,
                irrf: x.irrf + v.irrf,
                fgts: x.fgts + v.fgts,
                encargosEmpresa: x.encargosEmpresa + v.encargosEmpresa,
              }
            : { ...v },
        );
      }
    const primeiro = dentro[0]!;
    out.push({
      empresa: primeiro.empresa,
      competencia: primeiro.competencia,
      processo: (dentro.find((p) => p.tipo === 'mensal') ?? primeiro).id,
      processos: dentro.map((p) => p.id),
      deixados: ordem.filter((p) => !tipos.includes(p.tipo)).map((p) => ({ id: p.id, tipo: p.tipo })),
      calculado: [...soma.values()].sort((a, b) => a.vinculo - b.vinculo),
    });
  }
  return out.sort((a, b) => a.competencia.localeCompare(b.competencia) || a.empresa - b.empresa);
}

const fmt = (c: number) => (c / 100).toFixed(2);
const conta = (a: number, b: number) => `${fmt(a)} − ${fmt(b)} = ${fmt(a - b)}`;

/** Compara a folha calculada com a folha externa da mesma empresa e competência (regra 8). */
export function compararParalelo(e: EntradaParalelo): RelatorioParalelo {
  const tol = Math.max(0, Math.trunc(e.toleranciaCentavos ?? 0));
  const sante = new Map(e.calculado.map((v) => [v.vinculo, v]));
  const externo = new Map<number, Record<RubricaParaleloVinculo, number>>();
  const guias = new Map<string, number>();
  for (const l of e.externo) {
    if (l.vinculo === null) {
      guias.set(l.rubrica, (guias.get(l.rubrica) ?? 0) + l.valor);
      continue;
    }
    if (!(RUBRICAS_PARALELO_VINCULO as readonly string[]).includes(l.rubrica)) continue;
    const x = externo.get(l.vinculo) ?? { proventos: 0, descontos: 0, liquido: 0 };
    x[l.rubrica as RubricaParaleloVinculo] += l.valor;
    externo.set(l.vinculo, x);
  }
  const ids = (m: Map<number, unknown>) => [...m.keys()].sort((a, b) => a - b);
  const soNoSante = ids(sante).filter((v) => !externo.has(v));
  const soNoExterno = ids(externo).filter((v) => !sante.has(v));
  const ambos = ids(sante).filter((v) => externo.has(v));

  const valorSante = (v: VinculoCalculadoParalelo, r: RubricaParaleloVinculo) =>
    r === 'proventos' ? v.proventos : r === 'descontos' ? v.descontos : v.proventos - v.descontos;

  const rubricas: ComparacaoRubricaParalelo[] = RUBRICAS_PARALELO_VINCULO.map((r) => {
    const s = e.calculado.reduce((t, v) => t + valorSante(v, r), 0);
    const x = [...externo.values()].reduce((t, v) => t + v[r], 0);
    const divergentes = ambos.filter(
      (id) => Math.abs(valorSante(sante.get(id)!, r) - externo.get(id)![r]) > tol,
    );
    return {
      rubrica: r,
      sante: s,
      externo: x,
      diferenca: s - x,
      conta: conta(s, x),
      vinculosDivergentes: divergentes,
      confere: divergentes.length === 0 && Math.abs(s - x) <= tol,
    };
  });
  const somaSante = (f: (v: VinculoCalculadoParalelo) => number) => e.calculado.reduce((t, v) => t + f(v), 0);
  const santeEncargo: Record<EncargoParalelo, number> = {
    inss: somaSante((v) => v.inss + v.encargosEmpresa),
    fgts: somaSante((v) => v.fgts),
    irrf: somaSante((v) => v.irrf),
  };
  for (const r of ENCARGOS_PARALELO) {
    const s = santeEncargo[r];
    const x = guias.get(r) ?? 0;
    rubricas.push({
      rubrica: r,
      sante: s,
      externo: x,
      diferenca: s - x,
      conta: conta(s, x),
      vinculosDivergentes: [],
      confere: Math.abs(s - x) <= tol,
    });
  }
  return {
    empresa: e.empresa,
    competencia: e.competencia,
    processo: e.processo,
    loteExterno: e.loteExterno,
    processos: e.processos ?? [e.processo],
    deixados: e.deixados ?? [],
    toleranciaCentavos: tol,
    vinculos: {
      sante: sante.size,
      externo: externo.size,
      emAmbos: ambos.length,
      soNoSante,
      soNoExterno,
    },
    rubricas,
    confere: soNoSante.length === 0 && soNoExterno.length === 0 && rubricas.every((r) => r.confere),
  };
}

// ── Relatório do paralelo em Markdown (ficha do M53, §11: docs/marcos/M53/evidencias.md › Paralelo) ─────────────────

/** O que o teste dourado junta numa execução (o mesmo conteúdo do paralelo.json). */
export interface ExecucaoParalelo {
  readonly geradoEm: string;
  readonly estabelecimento: string;
  readonly competenciasFixadas: readonly string[];
  readonly processosEmVigor: number;
  readonly observacao: string | null;
  readonly relatorios: readonly RelatorioParalelo[];
}

export const MARCA_INICIO_PARALELO =
  '<!-- paralelo:inicio (gerado pelo teste dourado da folha; a última coluna é do DP) -->';
export const MARCA_FIM_PARALELO = '<!-- paralelo:fim -->';
const SEM_ACEITE = 'pendente';

const celula = (x: string) => x.replace(/\|/g, '/').replace(/\s+/g, ' ').trim();

/** As explicações e aceites do DP já escritos na seção (chave: competência|empresa|rubrica), para não se perderem. */
function aceitesDaSecao(md: string): Map<string, string> {
  const r = new Map<string, string>();
  const i = md.indexOf(MARCA_INICIO_PARALELO);
  const f = md.indexOf(MARCA_FIM_PARALELO);
  if (i < 0 || f < i) return r;
  for (const l of md.slice(i, f).split('\n')) {
    const c = l.split('|').map((x) => x.trim());
    // | competência | empresa | rubrica | Sante | externo | diferença | confere | aceite |
    if (c.length < 10 || !/^\d{4}-\d{2}$/.test(c[1] ?? '')) continue;
    const aceite = c[8] ?? '';
    if (aceite && aceite !== SEM_ACEITE) r.set(`${c[1]}|${c[2]}|${c[3]}`, aceite);
  }
  return r;
}

/**
 * Atualiza (ou cria) a seção "Paralelo" do evidencias.md do M53: uma tabela por competência e rubrica-resumo, com as
 * parcelas da conta e a coluna de explicação e aceite do DP, que é preservada entre execuções. Só IDs e somas.
 */
export function atualizarSecaoParalelo(mdAnterior: string | null, x: ExecucaoParalelo): string {
  const aceites = aceitesDaSecao(mdAnterior ?? '');
  const linhas: string[] = [
    MARCA_INICIO_PARALELO,
    '',
    `Gerado em ${x.geradoEm} no estabelecimento ${x.estabelecimento}. Competências fixadas: ${
      x.competenciasFixadas.length ? x.competenciasFixadas.join(', ') : 'nenhuma (cabe ao dono fixar)'
    }. Processamentos em vigor: ${x.processosEmVigor}. Comparadas: ${x.relatorios.length}; conferem: ${
      x.relatorios.filter((r) => r.confere).length
    }. Detalhe por vínculo (só IDs): paralelo.json.`,
    '',
  ];
  if (x.relatorios.length === 0) linhas.push(x.observacao ?? 'Nenhuma competência comparada.', '');
  else {
    linhas.push(
      '| Competência | Empresa | Rubrica | Sante SGH | Folha externa | Conta (Sante − externa = diferença) | Confere | Explicação e aceite do DP |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
    );
    const ordem = [...x.relatorios].sort(
      (a, b) => a.competencia.localeCompare(b.competencia) || a.empresa - b.empresa,
    );
    for (const r of ordem)
      for (const c of r.rubricas) {
        const chave = `${r.competencia}|${r.empresa}|${c.rubrica}`;
        linhas.push(
          `| ${r.competencia} | ${r.empresa} | ${c.rubrica} | ${fmt(c.sante)} | ${fmt(c.externo)} | ${celula(c.conta)} | ${
            c.confere ? 'sim' : 'não'
          } | ${celula(aceites.get(chave) ?? (c.confere ? '-' : SEM_ACEITE))} |`,
        );
      }
    linhas.push('');
  }
  linhas.push(MARCA_FIM_PARALELO);
  const secao = linhas.join('\n');
  const md = mdAnterior ?? '';
  const i = md.indexOf(MARCA_INICIO_PARALELO);
  const f = md.indexOf(MARCA_FIM_PARALELO);
  if (i >= 0 && f > i) return `${md.slice(0, i)}${secao}${md.slice(f + MARCA_FIM_PARALELO.length)}`;
  const cabeca = md.trim()
    ? `${md.trimEnd()}\n\n`
    : '# M53 — Evidências do marco (folha de pagamento)\n\nVer também as evidências de cada etapa em `docs/marcos/M53.<n>/evidencias.md`.\n\n';
  return `${cabeca}## Paralelo (ficha do M53, §11)\n\nCompetência a competência, divergência zero por rubrica-resumo ou cada diferença explicada e aceita pelo departamento pessoal na última coluna (o teste dourado preserva o que o DP escrever ali).\n\n${secao}\n`;
}
