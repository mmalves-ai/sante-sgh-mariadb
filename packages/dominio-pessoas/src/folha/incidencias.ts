// Conferência das incidências da rubrica (M53, etapa F1; ficha, seção 4 "Rubricas e incidências vigentes"): a letra
// da rubrica (incide INSS, IRRF, FGTS, contribuição sindical) contra o código de incidência do eSocial do vínculo da
// rubrica (tabelas de incidência por rubrica). É informativa: não barra a gravação (o cadastro genérico grava cada um),
// mas a tela mostra a divergência e o cálculo (F2) usa a letra da rubrica. Os grupos de código vêm do leiaute oficial
// (tabela 3 do eSocial, "códigos de incidência"), como faixas de prefixo; nenhuma alíquota aqui.
import type {
  ConferenciaRubrica,
  IncidenciaRubricaFolha,
  RubricaFolha,
  TributoIncidenciaEsocial,
} from '@sgh/contratos';

/** O código do eSocial diz que a rubrica é base de cálculo do tributo? (null: código fora dos grupos conhecidos). */
export function codigoEsocialEhBase(tributo: TributoIncidenciaEsocial, codigo: string): boolean | null {
  const c = codigo.trim();
  if (!/^\d{2,4}$/.test(c)) return null;
  const n = Number(c);
  switch (tributo) {
    // INSS: 00 e 01 não é base; 11 a 26 base (mensal, 13º, exclusiva, maternidade); 31 a 35 contribuição descontada
    // (a rubrica de desconto, não base); 51 outros (salário-família); 91 a 94 suspensão judicial (base com exigibilidade
    // suspensa).
    case 'inss':
      if (n <= 1) return false;
      if (n >= 11 && n <= 26) return true;
      if ((n >= 31 && n <= 35) || n === 51) return false;
      if (n >= 91 && n <= 94) return true;
      return null;
    // IRRF: 00, 01 e 09 não é base (09 = outras verbas não consideradas); 11 a 15 base; 31 a 35 retenção; 41 a 48
    // dedução; 51 a 55 pensão; 61 e 62 indenizatória; 63 a 79 isentos; 7x a 9x isenção, demandas e suspensão.
    case 'irrf':
      if (n <= 1 || n === 9) return false;
      if (n >= 11 && n <= 15) return true;
      if (n >= 31) return false;
      return null;
    // FGTS: 00 não é base; 11 base mensal, 12 base 13º, 21 base de aviso prévio indenizado; 91 a 93 suspensão.
    case 'fgts':
      if (n === 0) return false;
      if (n === 11 || n === 12 || n === 21) return true;
      if (n >= 91 && n <= 93) return true;
      return null;
    // Contribuição sindical: 00 não é base; 11 base; 31 a 34 desconto ou contribuição (não base).
    case 'sindical':
      if (n === 0) return false;
      if (n === 11) return true;
      if (n >= 31 && n <= 34) return false;
      return null;
  }
}

/** A letra da rubrica que corresponde a cada tributo do eSocial. */
export const INCIDENCIA_DO_TRIBUTO: Readonly<Record<TributoIncidenciaEsocial, IncidenciaRubricaFolha>> = {
  inss: 'inss',
  irrf: 'irrf',
  fgts: 'fgts',
  sindical: 'contribuicaoSindical',
};

const TRIBUTOS: readonly TributoIncidenciaEsocial[] = ['inss', 'irrf', 'fgts', 'sindical'];

/**
 * Conferência de uma rubrica: para cada tributo, a letra contra o código do eSocial; rubrica ativa sem natureza do
 * eSocial; vigência invertida. Rubrica de base de cálculo e informativa não pedem código do eSocial (não são enviadas
 * como rubrica de pagamento); as demais, quando incidem, pedem.
 */
export function conferirIncidenciasRubrica(r: RubricaFolha): ConferenciaRubrica[] {
  const out: ConferenciaRubrica[] = [];
  const enviada = r.tipo === 'provento' || r.tipo === 'desconto' || r.tipo === null;
  for (const t of TRIBUTOS) {
    const incide = r.incidencias[INCIDENCIA_DO_TRIBUTO[t]] === true;
    const codigo = r.esocial[t] ?? null;
    if (codigo === null) {
      if (incide && enviada && t !== 'sindical')
        out.push({ rubrica: r.id, codigo: 'sem-codigo-esocial', tributo: t });
      continue;
    }
    const base = codigoEsocialEhBase(t, codigo);
    if (base === null) continue;
    // A rubrica de desconto do próprio tributo (contribuição descontada, retenção) não é base e não "incide".
    if (incide && !base && !(r.tipo === 'desconto'))
      out.push({ rubrica: r.id, codigo: 'incide-sem-base-esocial', tributo: t });
    if (!incide && base) out.push({ rubrica: r.id, codigo: 'base-esocial-sem-incidencia', tributo: t });
  }
  if (r.ativa && enviada && r.natureza === null)
    out.push({ rubrica: r.id, codigo: 'sem-natureza-esocial', tributo: null });
  if (r.vigencia.inicio && r.vigencia.fim && r.vigencia.fim < r.vigencia.inicio)
    out.push({ rubrica: r.id, codigo: 'vigencia-invertida', tributo: null });
  return out;
}

/** Conferência de todas (a ordem é a das rubricas). */
export function conferirRubricas(rs: readonly RubricaFolha[]): ConferenciaRubrica[] {
  return rs.flatMap(conferirIncidenciasRubrica);
}

/** Códigos do eSocial da rubrica por tributo (null: sem incidência cadastrada na vigência). */
export interface CodigosIncidenciaRubrica {
  readonly inss: string | null;
  readonly irrf: string | null;
  readonly fgts: string | null;
  readonly sindical: string | null;
  readonly pis: string | null;
}

/** As marcas de tributo que o cálculo usa, tiradas só do código do eSocial (e do uso da rubrica nas férias). */
export interface MarcasTributoRubrica {
  readonly inss: boolean;
  readonly irrf: boolean;
  readonly fgts: boolean;
  readonly inss13: boolean;
  readonly irrf13: boolean;
  readonly fgts13: boolean;
  readonly inssFerias: boolean;
  readonly irrfFerias: boolean;
  readonly pis: boolean;
  readonly contribuicaoSindical: boolean;
}

/** INSS: as bases do 13º (12 normal, 14 exclusiva do empregador, 16 exclusiva do segurado, 22 e 24 maternidade e
 * auxílio, 26 pago pela previdência, 92 e 94 com exigibilidade suspensa). */
const INSS_DECIMO = new Set([12, 14, 16, 22, 24, 26, 92, 94]);

const numero = (c: string | null): number | null =>
  c !== null && /^\d{2,4}$/.test(c.trim()) ? Number(c.trim()) : null;

/** PIS/PASEP (tabela 3 do eSocial): 00 não é base; 11 mensal e 12 13º; 91 e 92 suspensão (base suspensa). */
function pisEhBase(codigo: string | null): boolean {
  const n = numero(codigo);
  return n === 11 || n === 12 || n === 91 || n === 92;
}

/**
 * As marcas de incidência da rubrica a partir dos códigos do eSocial (regra única: codigoEsocialEhBase decide se é
 * base; o grupo do código decide se a base é a mensal, a do 13º ou a das férias):
 * - INSS: base mensal = base e fora do grupo do 13º; base do 13º = grupo do 13º. As férias entram na base mensal do
 *   INSS (o leiaute não tem código próprio): inssFerias = base mensal e a rubrica usada nas férias.
 * - IRRF: 11 mensal, 12 13º, 13 férias (cada um com a sua tributação); 14 (PLR) e 15 (rendimentos acumulados) têm
 *   tributação exclusiva e não entram em nenhuma das três; 09 e 31 em diante não são base.
 * - FGTS: 11 e 21 (aviso indenizado) mensal; 12 13º; 91 a 93 suspensão, na base mensal.
 * Código fora dos grupos conhecidos: nenhuma marca (a conferência da rubrica mostra a divergência).
 */
export function marcasTributoRubrica(
  codigos: CodigosIncidenciaRubrica,
  usos: { readonly ferias: boolean },
): MarcasTributoRubrica {
  const ni = numero(codigos.inss);
  const inssBase = codigos.inss !== null && codigoEsocialEhBase('inss', codigos.inss) === true;
  const inss = inssBase && ni !== null && !INSS_DECIMO.has(ni);
  const irrfBase = codigos.irrf !== null && codigoEsocialEhBase('irrf', codigos.irrf) === true;
  const nr = numero(codigos.irrf);
  const fgtsBase = codigos.fgts !== null && codigoEsocialEhBase('fgts', codigos.fgts) === true;
  const nf = numero(codigos.fgts);
  return {
    inss,
    inss13: inssBase && ni !== null && INSS_DECIMO.has(ni),
    inssFerias: inss && usos.ferias,
    irrf: irrfBase && nr === 11,
    irrf13: irrfBase && nr === 12,
    irrfFerias: irrfBase && nr === 13,
    fgts: fgtsBase && nf !== 12,
    fgts13: fgtsBase && nf === 12,
    pis: pisEhBase(codigos.pis),
    contribuicaoSindical:
      codigos.sindical !== null && codigoEsocialEhBase('sindical', codigos.sindical) === true,
  };
}
