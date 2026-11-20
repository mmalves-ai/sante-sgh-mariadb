// Regras de tela das especialidades sob demanda e do lactário (M45, etapa 6): só apresentação (o servidor calcula a
// classificação, as doses, as linhas do partograma e a validade). O gráfico do partograma é desenhado a partir das horas
// desde o início da fase ativa e da dilatação, na escala de 0 a 12 horas e de 0 a 10 cm.

export const leitoTexto = (l: { bloco: string; acomodacao: string; leito: string }) =>
  `${l.bloco} ${l.acomodacao} ${l.leito}`.trim();

/** "AAAA-MM-DDTHH:MM" → "DD/MM HH:MM". */
export function instanteCurto(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]} ${m[4]}:${m[5]}` : '';
}

/** "AAAA-MM-DD" → "DD/MM/AAAA". */
export function dataLonga(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** Número com vírgula e as casas pedidas. */
export const numero = (x: number | null | undefined, casas = 1) =>
  x === null || x === undefined ? '' : x.toFixed(casas).replace('.', ',');

/** O instante civil "agora" do navegador ("AAAA-MM-DDTHH:MM"), para o padrão dos campos. */
export function agoraCivil(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Os horários digitados ("09:00, 12:00 15:00") em lista, sem vazios. */
export function horariosDoTexto(t: string): string[] {
  return t
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => (/^\d:\d{2}$/.test(x) ? `0${x}` : x));
}

/** Os dias do ciclo digitados ("1, 8, 15") em números. */
export function diasDoTexto(t: string): number[] {
  return t
    .split(/[\s,;]+/)
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isInteger(x) && x > 0);
}

export const LARGURA_PARTOGRAMA = 480;
export const ALTURA_PARTOGRAMA = 240;
const HORAS_EIXO = 12;

/** As coordenadas do gráfico: x pelas horas (0 a 12), y pela dilatação (10 cm em cima). */
export function pontoNoGrafico(horas: number, dilatacaoCm: number): { x: number; y: number } {
  const h = Math.max(0, Math.min(HORAS_EIXO, horas));
  const d = Math.max(0, Math.min(10, dilatacaoCm));
  return {
    x: Math.round((h / HORAS_EIXO) * LARGURA_PARTOGRAMA),
    y: Math.round(ALTURA_PARTOGRAMA - (d / 10) * ALTURA_PARTOGRAMA),
  };
}

/** Horas entre dois instantes civis (para o eixo do partograma). */
export function horasEntre(de: string, ate: string): number {
  return (Date.parse(`${ate}:00Z`) - Date.parse(`${de}:00Z`)) / 3_600_000;
}
