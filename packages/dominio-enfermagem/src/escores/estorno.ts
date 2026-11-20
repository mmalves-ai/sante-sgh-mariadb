// W0-03 (programa CRUD completo; matriz, linha "Checagem / administração / sinais vitais / anotação de enfermagem"): o
// escore errado é inativado e relançado; nunca se apaga. No NEWS2, o alerta que o escore estornado disparou é
// reavaliado na hora: fica `mantido` se outro NEWS2 válido (não estornado) das últimas 12 horas tem gatilho, e o
// mantenedor é o mais recente deles; senão, `encerrado`. Escore estornado sem gatilho: `sem-alerta`.

export interface News2ParaAlerta {
  readonly id: number;
  readonly gatilho: string;
  readonly aferidoEm: string;
  readonly estornado: boolean;
}

export interface AlertaReavaliacao {
  readonly alerta: 'sem-alerta' | 'encerrado' | 'mantido';
  readonly escoreMantem: number | null;
}

/** A janela do gatilho aberto da unidade (horas), a mesma da tela da unidade. */
export const JANELA_ALERTA_NEWS2_HORAS = 12;

function menosHoras(agora: string, horas: number): string {
  const d = new Date(`${agora.slice(0, 19)}Z`);
  d.setUTCHours(d.getUTCHours() - horas);
  return d.toISOString().slice(0, 19);
}

export function reavaliarAlertaNews2(
  estornado: { readonly id: number; readonly gatilho: string },
  outros: readonly News2ParaAlerta[],
  agora: string,
): AlertaReavaliacao {
  if (estornado.gatilho === 'nenhum') return { alerta: 'sem-alerta', escoreMantem: null };
  const desde = menosHoras(agora, JANELA_ALERTA_NEWS2_HORAS);
  const vale = outros
    .filter(
      (x) =>
        x.id !== estornado.id && !x.estornado && x.gatilho !== 'nenhum' && x.aferidoEm.slice(0, 19) >= desde,
    )
    .sort((a, b) => b.aferidoEm.localeCompare(a.aferidoEm) || b.id - a.id)[0];
  return vale ? { alerta: 'mantido', escoreMantem: vale.id } : { alerta: 'encerrado', escoreMantem: null };
}
