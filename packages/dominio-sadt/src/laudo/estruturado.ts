// Laudo estruturado de métodos gráficos e hemodinâmica (F3.5, 05-SADT linha 17): as grandezas medidas (ecocardiograma,
// cateterismo) com a faixa de referência do paciente (sexo, idade, peso e superfície corporal, com vigência pela data do
// exame), a marca de fora da referência, a grandeza obrigatória e a casa decimal. Regra pura, sem banco.
import { RecusaLaudo } from './redacao.js';

export interface GrandezaDoLaudo {
  readonly id: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly casasDecimais: number | null;
  readonly obrigatoria: boolean;
  readonly calculada: boolean;
  readonly ordem: number;
  readonly unidade: number | null;
}

export interface FaixaDaGrandeza {
  readonly grandeza: number;
  readonly sexo: 'feminino' | 'masculino' | null;
  readonly idadeMinimaDias: number | null;
  readonly idadeMaximaDias: number | null;
  readonly pesoMinimoKg: number | null;
  readonly pesoMaximoKg: number | null;
  readonly superficieMinima: number | null;
  readonly superficieMaxima: number | null;
  readonly minima: number | null;
  readonly maxima: number | null;
  /** A referência vale para o valor dividido pela superfície corporal (índice, como a massa do ventrículo). */
  readonly indexadaSuperficie: boolean;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}

export interface PacienteDoExame {
  readonly sexo: 'feminino' | 'masculino' | null;
  readonly idadeDias: number | null;
  readonly pesoKg: number | null;
  readonly alturaCm: number | null;
  /** Data do exame (AAAA-MM-DD): escolhe a faixa vigente naquele dia. */
  readonly dataExame: string;
}

export interface ValorInformado {
  readonly grandeza: number;
  readonly numero: number | null;
  readonly texto: string | null;
}

export interface ValorAvaliado {
  readonly grandeza: number;
  readonly sequencia: number;
  readonly numero: number | null;
  readonly texto: string | null;
  readonly unidade: number | null;
  readonly calculado: boolean;
  readonly foraReferencia: boolean;
  /** A faixa usada, para a tela mostrar (null quando não há faixa para o paciente). */
  readonly faixa: { minima: number | null; maxima: number | null; indexada: boolean } | null;
}

/** Superfície corporal pela fórmula de Mosteller (m², 3 casas); null sem peso ou altura. */
export function superficieCorporal(pesoKg: number | null, alturaCm: number | null): number | null {
  if (!pesoKg || !alturaCm || pesoKg <= 0 || alturaCm <= 0) return null;
  return Math.round(Math.sqrt((pesoKg * alturaCm) / 3600) * 1000) / 1000;
}

const dentro = (v: number | null, min: number | null, max: number | null) =>
  v === null ? min === null && max === null : (min === null || v >= min) && (max === null || v <= max);

/** A faixa da grandeza que vale para o paciente na data do exame (a mais específica: com sexo antes da geral). */
export function faixaDaGrandezaDoPaciente(
  faixas: readonly FaixaDaGrandeza[],
  grandeza: number,
  p: PacienteDoExame,
): FaixaDaGrandeza | null {
  const sc = superficieCorporal(p.pesoKg, p.alturaCm);
  const cabem = faixas.filter(
    (f) =>
      f.grandeza === grandeza &&
      f.vigenciaInicio <= p.dataExame &&
      (f.vigenciaFim === null || f.vigenciaFim >= p.dataExame) &&
      (f.sexo === null || f.sexo === p.sexo) &&
      dentro(p.idadeDias, f.idadeMinimaDias, f.idadeMaximaDias) &&
      dentro(p.pesoKg, f.pesoMinimoKg, f.pesoMaximoKg) &&
      dentro(sc, f.superficieMinima, f.superficieMaxima),
  );
  const especificidade = (f: FaixaDaGrandeza) =>
    (f.sexo ? 1 : 0) +
    (f.idadeMinimaDias !== null || f.idadeMaximaDias !== null ? 1 : 0) +
    (f.pesoMinimoKg !== null || f.pesoMaximoKg !== null ? 1 : 0) +
    (f.superficieMinima !== null || f.superficieMaxima !== null ? 1 : 0);
  return (
    [...cabem].sort(
      (a, b) => especificidade(b) - especificidade(a) || b.vigenciaInicio.localeCompare(a.vigenciaInicio),
    )[0] ?? null
  );
}

/**
 * Avalia as medidas do laudo: confere a grandeza (do exame), arredonda pela casa decimal, marca fora da referência pela
 * faixa do paciente e numera na ordem do catálogo. `exigirObrigatorias` vale na assinatura (o rascunho pode ficar
 * incompleto). Recusa grandeza de outro exame, valor sem número nem texto e grandeza repetida.
 */
export function avaliarValores(
  grandezas: readonly GrandezaDoLaudo[],
  valores: readonly ValorInformado[],
  faixas: readonly FaixaDaGrandeza[],
  p: PacienteDoExame,
  exigirObrigatorias = false,
): ValorAvaliado[] {
  const porId = new Map(grandezas.map((g) => [g.id, g]));
  const vistos = new Set<number>();
  for (const v of valores) {
    if (!porId.has(v.grandeza))
      throw new RecusaLaudo('grandeza-de-outro-exame', `A grandeza ${v.grandeza} não é deste exame.`);
    if (vistos.has(v.grandeza))
      throw new RecusaLaudo(
        'grandeza-repetida',
        `A grandeza ${porId.get(v.grandeza)!.descricao} veio duas vezes.`,
      );
    vistos.add(v.grandeza);
    if (v.numero === null && !(v.texto ?? '').trim())
      throw new RecusaLaudo('grandeza-sem-valor', `Informe o valor de ${porId.get(v.grandeza)!.descricao}.`);
    if (v.numero !== null && !Number.isFinite(v.numero))
      throw new RecusaLaudo(
        'grandeza-valor-invalido',
        `O valor de ${porId.get(v.grandeza)!.descricao} não é número.`,
      );
  }
  if (exigirObrigatorias) {
    const faltam = grandezas.filter((g) => g.obrigatoria && !vistos.has(g.id)).map((g) => g.descricao);
    if (faltam.length)
      throw new RecusaLaudo('grandeza-obrigatoria', `Faltam as medidas obrigatórias: ${faltam.join(', ')}.`);
  }
  const sc = superficieCorporal(p.pesoKg, p.alturaCm);
  const ordenados = [...valores].sort((a, b) => {
    const ga = porId.get(a.grandeza)!;
    const gb = porId.get(b.grandeza)!;
    return ga.ordem - gb.ordem || ga.id - gb.id;
  });
  return ordenados.map((v, i) => {
    const g = porId.get(v.grandeza)!;
    const numero =
      v.numero === null
        ? null
        : g.casasDecimais === null
          ? v.numero
          : Math.round(v.numero * 10 ** g.casasDecimais) / 10 ** g.casasDecimais;
    const f = faixaDaGrandezaDoPaciente(faixas, g.id, p);
    let fora = false;
    if (f && numero !== null) {
      const base = f.indexadaSuperficie ? (sc ? numero / sc : null) : numero;
      fora =
        base !== null && ((f.minima !== null && base < f.minima) || (f.maxima !== null && base > f.maxima));
    }
    return {
      grandeza: g.id,
      sequencia: i + 1,
      numero,
      texto: (v.texto ?? '').trim() || null,
      unidade: g.unidade,
      calculado: g.calculada,
      foraReferencia: fora,
      faixa: f ? { minima: f.minima, maxima: f.maxima, indexada: f.indexadaSuperficie } : null,
    };
  });
}

/** O resumo das medidas para o texto do laudo (o modelo usa `{{codigo}}` de cada grandeza). */
export function valoresParaModelo(
  grandezas: readonly GrandezaDoLaudo[],
  avaliados: readonly ValorAvaliado[],
): Record<string, string> {
  const r: Record<string, string> = {};
  for (const v of avaliados) {
    const g = grandezas.find((x) => x.id === v.grandeza);
    if (!g) continue;
    r[g.codigo] =
      v.numero !== null
        ? g.casasDecimais === null
          ? String(v.numero)
          : v.numero.toFixed(g.casasDecimais).replace('.', ',')
        : (v.texto ?? '');
  }
  return r;
}
