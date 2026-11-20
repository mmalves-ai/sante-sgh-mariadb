// Sobreposição na sala (ficha do M18, regra 5; cap-05a §5.5; cap-10 §10.5; ref 01 §3.13). O banco aceita duas
// cirurgias que se cruzam na mesma sala (a chave única é só SALA + DATA_HORA): em 2026 a cópia tem 65 cirurgias
// sobrepostas. O novo recusa a sobreposição (exceção de urgência só com supervisor, registrada à parte) e mostra com
// alerta as que o outro sistema já gravou. A ocupação de um agendamento vai do início ao fim da duração MAIS o
// intervalo de preparo (o do agendamento, CCAGENDA.INTERVALO, e o mínimo do parâmetro do estabelecimento).
import { dataImpossivel, minutosAbsolutos } from './tempo.js';

export interface OcupacaoSala {
  readonly id: number;
  readonly sala: number;
  /** "AAAA-MM-DD HH:MM". */
  readonly inicio: string;
  readonly duracaoMin: number;
  /** CCAGENDA.INTERVALO em minutos (0 em 100% hoje). */
  readonly intervaloMin: number;
}

export interface Janela {
  readonly de: number;
  readonly ate: number;
}

/** Janela ocupada em minutos absolutos: [início, início + duração + preparo). */
export function janelaOcupada(o: OcupacaoSala, preparoMinimoMin = 0): Janela {
  const de = minutosAbsolutos(o.inicio);
  const preparo = Math.max(o.intervaloMin, preparoMinimoMin, 0);
  return { de, ate: de + Math.max(o.duracaoMin, 1) + preparo };
}

export function cruzam(a: Janela, b: Janela): boolean {
  return a.de < b.ate && b.de < a.ate;
}

export interface Conflito {
  readonly com: number;
  readonly inicio: string;
  readonly duracaoMin: number;
}

/**
 * Agendamentos da mesma sala que cruzam com o novo (o próprio, na remarcação, fica de fora pelo ID). Linha com data
 * impossível não conta (é mostrada com alerta).
 */
export function conflitosNaSala(
  novo: OcupacaoSala,
  existentes: readonly OcupacaoSala[],
  preparoMinimoMin = 0,
): Conflito[] {
  const j = janelaOcupada(novo, preparoMinimoMin);
  return existentes
    .filter((e) => e.sala === novo.sala && e.id !== novo.id && !dataImpossivel(e.inicio))
    .filter((e) => cruzam(j, janelaOcupada(e, preparoMinimoMin)))
    .map((e) => ({ com: e.id, inicio: e.inicio, duracaoMin: e.duracaoMin }));
}

export interface SobreposicaoExistente {
  readonly sala: number;
  readonly a: number;
  readonly b: number;
}

/** Pares que já se sobrepõem no mapa lido (gravados pelo outro sistema): o alerta da tela. */
export function sobreposicoesNoMapa(
  ocupacoes: readonly OcupacaoSala[],
  preparoMinimoMin = 0,
): SobreposicaoExistente[] {
  const validos = ocupacoes
    .filter((o) => !dataImpossivel(o.inicio))
    .map((o) => ({ o, j: janelaOcupada(o, preparoMinimoMin) }))
    .sort((x, y) => x.o.sala - y.o.sala || x.j.de - y.j.de);
  const pares: SobreposicaoExistente[] = [];
  for (let i = 0; i < validos.length; i++) {
    const x = validos[i]!;
    for (let k = i + 1; k < validos.length; k++) {
      const y = validos[k]!;
      if (y.o.sala !== x.o.sala) break;
      if (y.j.de >= x.j.ate) break;
      pares.push({ sala: x.o.sala, a: x.o.id, b: y.o.id });
    }
  }
  return pares;
}

/** IDs envolvidos em alguma sobreposição (para marcar no mapa). */
export function idsSobrepostos(pares: readonly SobreposicaoExistente[]): Set<number> {
  return new Set(pares.flatMap((p) => [p.a, p.b]));
}

/** Próximo início livre na sala a partir de `desde`, no passo dado, até o fim do dia (null se não há). */
export function proximoInicioLivre(
  sala: number,
  desde: string,
  duracaoMin: number,
  existentes: readonly OcupacaoSala[],
  passoMin = 15,
  preparoMinimoMin = 0,
): string | null {
  const dia = desde.slice(0, 10);
  let t = minutosAbsolutos(desde);
  const fimDoDia = minutosAbsolutos(`${dia} 23:59`);
  for (; t + duracaoMin <= fimDoDia + 1; t += passoMin) {
    const inicio = new Date(t * 60_000).toISOString().slice(0, 16).replace('T', ' ');
    const c = conflitosNaSala(
      { id: -1, sala, inicio, duracaoMin, intervaloMin: 0 },
      existentes,
      preparoMinimoMin,
    );
    if (c.length === 0) return inicio;
  }
  return null;
}
