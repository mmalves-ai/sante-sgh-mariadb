// Formatação das telas do prontuário (M15): data e hora AAAA-MM-DDTHH:MM em DD/MM/AAAA HH:MM, idade a partir do
// nascimento (o relógio do navegador só para a idade exibida) e as classes de recuo do texto formatado.
export function dataHoraBr(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ''}`;
}

export function idade(nascimento: string | null, hoje = new Date()): number | null {
  const m = nascimento ? /^(\d{4})-(\d{2})-(\d{2})/.exec(nascimento) : null;
  if (!m) return null;
  const [a, ms, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let anos = hoje.getFullYear() - a;
  if (hoje.getMonth() + 1 < ms || (hoje.getMonth() + 1 === ms && hoje.getDate() < d)) anos--;
  return anos >= 0 && anos < 150 ? anos : null;
}
