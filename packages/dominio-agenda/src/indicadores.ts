// Indicadores da agenda (ficha do M17, regras 8 e 9; leitura "Indicadores"; sante-api:
// src/services/gestao-agenda.js, com a MESMA semântica para os números baterem no mesmo período):
//   - ocupação = marcados / horários ofertados (vaga = PACIENTE vazio; LIVRE='S' não serve);
//   - cancelamento = cancelados / (marcados + cancelados) (o cancelamento remove a marcação);
//   - absenteísmo = (marcados − compareceu) / marcados, comparecimento por ATENDIDO='S';
//   - agrupar falta pela especialidade do NOME da agenda, nunca por REPACAGD.ESPEC (só se preenche na chegada);
//   - risco de falta pela antecedência (DT_AGE → DATA): mesmo dia 7,9%; 1-7 d 37,2%; 8-30 d 40,2%; 31+ d 55,3%.
import { partesDoNome } from './nome-agenda.js';
import { diasEntre } from './tempo.js';

/** Percentual com uma casa (gestao-comum.js: pct). */
export function pct(parte: number, total: number): number {
  return total ? Math.round((parte / total) * 1000) / 10 : 0;
}

export type FaixaAntecedencia = 'mesmo-dia' | 'ate-7' | 'de-8-a-30' | 'mais-de-30' | 'nao-informada';

/** Faixa da antecedência entre a marcação (DT_AGE) e a consulta (DATA). A sentinela 1899 é "não informada". */
export function faixaAntecedencia(dataMarcacao: string | null, dataConsulta: string): FaixaAntecedencia {
  if (!dataMarcacao || dataMarcacao <= '1900-01-01') return 'nao-informada';
  const d = diasEntre(dataMarcacao, dataConsulta);
  if (d <= 0) return 'mesmo-dia';
  if (d <= 7) return 'ate-7';
  if (d <= 30) return 'de-8-a-30';
  return 'mais-de-30';
}

/** Taxa de falta histórica por faixa (ref 01 §2.1, medida na cópia). */
export const RISCO_FALTA: Readonly<Record<FaixaAntecedencia, number | null>> = {
  'mesmo-dia': 7.9,
  'ate-7': 37.2,
  'de-8-a-30': 40.2,
  'mais-de-30': 55.3,
  'nao-informada': null,
};

export type NivelRisco = 'baixo' | 'medio' | 'alto' | 'desconhecido';

export function riscoDeFalta(f: FaixaAntecedencia): { percentual: number | null; nivel: NivelRisco } {
  const p = RISCO_FALTA[f];
  if (p === null) return { percentual: null, nivel: 'desconhecido' };
  return { percentual: p, nivel: p < 20 ? 'baixo' : p < 50 ? 'medio' : 'alto' };
}

export interface LinhaOcupacao {
  readonly agenda: string;
  readonly horarios: number;
  readonly ocupados: number;
}

export interface Ocupacao {
  readonly horarios: number;
  readonly ocupados: number;
  readonly livres: number;
  readonly ocupacao: number;
  readonly linhas: readonly {
    chave: string;
    horarios: number;
    ocupados: number;
    livres: number;
    ocupacao: number;
  }[];
}

/** Ocupação agrupada por agenda ou pela especialidade do nome (gestao-agenda.js: ocupacao). */
export function ocupacao(
  linhas: readonly LinhaOcupacao[],
  agrupadoPor: 'agenda' | 'especialidade',
): Ocupacao {
  const m = new Map<string, { h: number; o: number }>();
  for (const l of linhas) {
    const k = agrupadoPor === 'especialidade' ? partesDoNome(l.agenda).procedimento : l.agenda;
    const a = m.get(k) ?? { h: 0, o: 0 };
    a.h += l.horarios;
    a.o += l.ocupados;
    m.set(k, a);
  }
  const horarios = linhas.reduce((s, l) => s + l.horarios, 0);
  const ocupados = linhas.reduce((s, l) => s + l.ocupados, 0);
  return {
    horarios,
    ocupados,
    livres: horarios - ocupados,
    ocupacao: pct(ocupados, horarios),
    linhas: [...m.entries()]
      .map(([chave, v]) => ({
        chave,
        horarios: v.h,
        ocupados: v.o,
        livres: v.h - v.o,
        ocupacao: pct(v.o, v.h),
      }))
      .sort((a, b) => b.horarios - a.horarios || a.chave.localeCompare(b.chave)),
  };
}

export interface LinhaFalta {
  readonly chave: string;
  readonly marcados: number;
  readonly compareceu: number;
}

export interface Absenteismo {
  readonly marcados: number;
  readonly compareceu: number;
  readonly faltou: number;
  readonly absenteismo: number;
  readonly linhas: readonly {
    chave: string;
    marcados: number;
    compareceu: number;
    faltou: number;
    absenteismo: number;
  }[];
}

/** Absenteísmo por chave já agrupada (agenda, especialidade do nome, faixa de antecedência). */
export function absenteismo(linhas: readonly LinhaFalta[], porEspecialidade = false): Absenteismo {
  const m = new Map<string, { mk: number; c: number }>();
  for (const l of linhas) {
    const k = porEspecialidade ? partesDoNome(l.chave).procedimento : l.chave;
    const a = m.get(k) ?? { mk: 0, c: 0 };
    a.mk += l.marcados;
    a.c += l.compareceu;
    m.set(k, a);
  }
  const marcados = linhas.reduce((s, l) => s + l.marcados, 0);
  const compareceu = linhas.reduce((s, l) => s + l.compareceu, 0);
  return {
    marcados,
    compareceu,
    faltou: marcados - compareceu,
    absenteismo: pct(marcados - compareceu, marcados),
    linhas: [...m.entries()]
      .map(([chave, v]) => ({
        chave,
        marcados: v.mk,
        compareceu: v.c,
        faltou: v.mk - v.c,
        absenteismo: pct(v.mk - v.c, v.mk),
      }))
      .sort((a, b) => b.marcados - a.marcados || a.chave.localeCompare(b.chave)),
  };
}

export interface ContagensFunil {
  readonly horarios: number;
  readonly livres: number;
  readonly marcados: number;
  readonly compareceu: number;
  readonly cancelados: number;
  readonly encaixes: number;
}

export interface Funil {
  readonly horariosOfertados: number;
  readonly nuncaPreenchidos: number;
  readonly marcados: number;
  readonly cancelados: number;
  readonly compareceu: number;
  readonly faltou: number;
  readonly encaixes: number;
  readonly ocupacao: number;
  readonly taxaCancelamento: number;
  readonly absenteismo: number;
  readonly conversaoEmAtendimento: number;
}

/** Funil ofertado → marcado → (cancelado | compareceu | faltou) (gestao-agenda.js: funil). */
export function funil(c: ContagensFunil): Funil {
  return {
    horariosOfertados: c.horarios,
    nuncaPreenchidos: c.livres,
    marcados: c.marcados,
    cancelados: c.cancelados,
    compareceu: c.compareceu,
    faltou: c.marcados - c.compareceu,
    encaixes: c.encaixes,
    ocupacao: pct(c.marcados, c.horarios),
    taxaCancelamento: pct(c.cancelados, c.marcados + c.cancelados),
    absenteismo: pct(c.marcados - c.compareceu, c.marcados),
    conversaoEmAtendimento: pct(c.compareceu, c.horarios),
  };
}
