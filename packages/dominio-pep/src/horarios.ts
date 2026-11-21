// Horário clínico × horário de gravação (regra 10 da ficha do M22; cap-11 §11.1; ref 04): o registro guarda o
// horário clínico (o que o profissional informa) e o de gravação (o relógio do banco). Nunca no futuro; o
// retroativo além da tolerância exige justificativa (o legado tem 106.365 registros retroativos, 14%), e só para
// quem o cadastro do profissional permite lançamento retroativo (preferência do profissional no prontuário; 63 de
// 524 com F). A tolerância é parâmetro (pep.evolucao.toleranciaRetroativoMinutos; padrão 15, pelo perfil).
// Residente com preceptor (coassinatura do preceptor responsável): 663 registros, todos de 2020 e 2021 (perfil
// medido pelo corretor); o novo não oferece (decisão D-PREC-1): o residente registra sem preceptor, como hoje no
// banco desde 2022.

export type RecusaHorario =
  'horario-futuro' | 'justificativa-necessaria' | 'retroativo-nao-permitido' | 'horario-invalido';

export interface ConferenciaHorario {
  readonly clinica: string;
  /** Agora pelo relógio do banco, na hora local do estabelecimento (AAAA-MM-DDTHH:MM[:SS]). */
  readonly agora: string;
  readonly toleranciaMin: number;
  readonly justificativa?: string | null;
  /** Cadastro do profissional permite lançamento retroativo (sem cadastro: permite). */
  readonly permiteRetroativo: boolean;
}

export interface ResultadoHorario {
  readonly ok: boolean;
  readonly recusa: RecusaHorario | null;
  readonly retroativo: boolean;
  /** Minutos entre o horário clínico e a gravação. */
  readonly minutos: number;
}

function minutosDe(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return Number.isFinite(t) ? t / 60_000 : null;
}

export function conferirHorario(c: ConferenciaHorario): ResultadoHorario {
  const a = minutosDe(c.clinica);
  const b = minutosDe(c.agora);
  if (a === null || b === null)
    return { ok: false, recusa: 'horario-invalido', retroativo: false, minutos: 0 };
  const minutos = Math.round(b - a);
  if (minutos < 0) return { ok: false, recusa: 'horario-futuro', retroativo: false, minutos };
  const retroativo = minutos > c.toleranciaMin;
  if (!retroativo) return { ok: true, recusa: null, retroativo, minutos };
  if (!c.permiteRetroativo) return { ok: false, recusa: 'retroativo-nao-permitido', retroativo, minutos };
  if (!c.justificativa || c.justificativa.trim().length < 10)
    return { ok: false, recusa: 'justificativa-necessaria', retroativo, minutos };
  return { ok: true, recusa: null, retroativo, minutos };
}

export const MENSAGENS_HORARIO: Readonly<Record<RecusaHorario, string>> = {
  'horario-futuro': 'O horário do registro não pode estar no futuro.',
  'justificativa-necessaria':
    'Registro com horário anterior ao da gravação além da tolerância: informe a justificativa (pelo menos 10 letras).',
  'retroativo-nao-permitido':
    'O seu cadastro não permite registro com horário anterior ao da gravação além da tolerância.',
  'horario-invalido': 'Horário do registro inválido.',
};
