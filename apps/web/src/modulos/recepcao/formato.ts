// Formatação das telas da recepção (M19). Os instantes vêm do relógio do banco como "AAAA-MM-DDTHH:MM:SS" (hora local
// do estabelecimento, sem fuso): a tela mostra o texto como veio, sem converter pelo fuso do navegador.

/** "AAAA-MM-DDTHH:MM:SS" → "HH:MM" ("—" sem hora). */
export function horaDe(instante: string | null | undefined): string {
  const m = /T?(\d{2}):(\d{2})/.exec(instante?.slice(10) ?? '') ?? /^(\d{2}):(\d{2})/.exec(instante ?? '');
  return m ? `${m[1]}:${m[2]}` : '—';
}

/** "AAAA-MM-DD…" → "dd/mm/aaaa" ("—" sem data). */
export function dataDe(instante: string | null | undefined): string {
  if (!instante || !/^\d{4}-\d{2}-\d{2}/.test(instante)) return '—';
  return `${instante.slice(8, 10)}/${instante.slice(5, 7)}/${instante.slice(0, 4)}`;
}

/** "dd/mm/aaaa HH:MM". */
export function dataHoraDe(instante: string | null | undefined): string {
  const d = dataDe(instante);
  return d === '—' ? d : `${d} ${horaDe(instante)}`;
}

/** Minutos com uma casa decimal, ou o texto de "sem medida". */
export function minutosOu(v: number | null | undefined, semMedida: string): string {
  return v === null || v === undefined
    ? semMedida
    : `${String(Math.round(v * 10) / 10).replace('.', ',')} min`;
}

/** "AAAA-MM-DD" do dia de hoje somado de `dias` (relógio do navegador, só para preencher o filtro). */
export function diaRelativo(hoje: string, dias: number): string {
  const d = new Date(`${hoje.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * M44 (etapa 3): a hora digitada (HHMM do campo de hora) no dia do relógio do banco (AAAA-MM-DDTHH:MM). Hora depois da
 * do relógio é do dia anterior (o registro feito logo depois da meia-noite de algo feito antes dela).
 */
export function horaHhmmParaLocal(agora: string, hhmm: string): string {
  const h = `${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}`;
  const dia = agora.slice(0, 10);
  if (h <= agora.slice(11, 16)) return `${dia}T${h}`;
  const ontem = new Date(Date.parse(`${dia}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return `${ontem}T${h}`;
}
