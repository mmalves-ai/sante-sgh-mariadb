// Comuns das telas da escala (M52.2): a competência do mês seguinte, os rótulos do plantão na grade, o fim do plantão a
// partir do dia, da hora e da duração, e a semana na forma do Brasil. Sem regra de negócio: o servidor confere tudo.
import { TIPOS_PLANTAO, type TipoPlantao } from '@sgh/contratos';

const p2 = (x: number) => String(x).padStart(2, '0');

/** A competência (AAAA-MM) do mês seguinte ao dia `hoje` (AAAA-MM-DD). */
export function proximaCompetencia(hoje: string): string {
  const a = Number(hoje.slice(0, 4));
  const m = Number(hoje.slice(5, 7));
  return m === 12 ? `${a + 1}-01` : `${a}-${p2(m + 1)}`;
}

/** O fim do plantão (AAAA-MM-DDTHH:MM) a partir do início e da duração em minutos (relógio local, sem fuso). */
export function fimDoPlantao(dia: string, hora: string, duracaoMin: number): string {
  const [h, mi] = hora.split(':').map(Number) as [number, number];
  const base = Date.UTC(
    Number(dia.slice(0, 4)),
    Number(dia.slice(5, 7)) - 1,
    Number(dia.slice(8, 10)),
    h,
    mi,
  );
  return new Date(base + duracaoMin * 60_000).toISOString().slice(0, 16);
}

/** Rótulo curto do plantão na célula da grade: "07h–19h" e a letra do tipo (S sobreaviso, D diarista). */
export function rotuloCelula(p: { tipo: TipoPlantao; inicio: string; fim: string }): string {
  const h = (i: string) => `${i.slice(11, 13)}h${i.slice(14, 16) === '00' ? '' : i.slice(14, 16)}`;
  const letra = p.tipo === 'sobreaviso' ? ' S' : p.tipo === 'diarista' ? ' D' : '';
  return `${h(p.inicio)}–${h(p.fim)}${letra}`;
}

/** Descrição completa do plantão para o leitor de tela e o diálogo. */
export function descricaoPlantao(p: { tipo: TipoPlantao; inicio: string; fim: string }): string {
  const d = (i: string) => `${i.slice(8, 10)}/${i.slice(5, 7)} ${i.slice(11, 16)}`;
  return `${TIPOS_PLANTAO[p.tipo]} de ${d(p.inicio)} a ${d(p.fim)}`;
}

/** O dia da semana abreviado (seg, ter…) de uma data. */
export function diaDaSemana(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`).getUTCDay();
  return ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][d]!;
}

/** Minutos em "12 h" ou "12 h 30 min". */
export function horasTexto(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Inteiro de um campo de texto (vazio ou inválido: null). */
export function inteiroDe(texto: string): number | null {
  const t = texto.trim();
  if (!/^\d+$/.test(t)) return null;
  return Number(t);
}
