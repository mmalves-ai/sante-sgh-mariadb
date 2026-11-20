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
