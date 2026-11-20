// Entrega ao setor e devolução da dose (ficha do M29, regras 5 e 6): "Entregue" só com o aceite da enfermagem (leitura
// da etiqueta ou confirmação no tablet), com autor e hora; a dose ainda em 7 (Dispensado), nem estornada nem entregue
// pelo outro sistema. A dose não administrada vira sugestão de devolução com o lote; a devolução efetivada estorna a
// saída e o item da conta pelos gatilhos.
import { qtd3, recusa, type RecusaSuprimentos } from './recusa.js';

export type ModoAceite = 'leitura' | 'tablet';

/** Regra 5: o aceite da entrega. */
export function conferirAceiteEntrega(c: {
  /** A última situação do documento em GECTRLENTREGADOCSAIDA (7, 8 ou 9). */
  situacao: number | null;
  modo: ModoAceite;
  /** O conteúdo lido da etiqueta (modo leitura). */
  leitura?: string | null;
  /** O código esperado (o da etiqueta impressa, GS1 ou o ID da dose). */
  etiquetas: readonly string[];
  autor: string;
  /** Quem dispensou: quem recebe é da enfermagem, não a farmácia. */
  dispensador: string | null;
  /** O autor tem a permissão de aceitar (enfermagem). */
  podeAceitar: boolean;
}): RecusaSuprimentos | null {
  if (c.situacao === 9)
    return recusa('dose-estornada', 'A dose foi estornada: não há o que receber.', ['dose']);
  if (c.situacao === 8)
    return recusa('ja-entregue', 'A entrega desta dose já foi registrada (por este ou pelo outro sistema).', [
      'dose',
    ]);
  if (c.situacao !== 7)
    return recusa('nao-dispensada', 'A dose ainda não foi dispensada pela farmácia.', ['dose']);
  if (!c.podeAceitar)
    return recusa('sem-permissao-aceite', 'O aceite da entrega é da enfermagem do setor.', ['autor']);
  if (!c.autor.trim()) return recusa('sem-autor', 'Informe quem recebeu.', ['autor']);
  if (c.dispensador && c.dispensador.trim().toUpperCase() === c.autor.trim().toUpperCase())
    return recusa('aceite-pelo-dispensador', 'Quem dispensou não pode registrar o próprio aceite.', [
      'autor',
    ]);
  if (c.modo === 'leitura') {
    const limpo = (t: string) => t.split('\u001d').join('').replace(/\s/g, '');
    const lido = limpo(c.leitura ?? '');
    const ok = c.etiquetas.some((e) => {
      const esperado = limpo(e);
      return esperado !== '' && (lido === esperado || lido.endsWith(esperado));
    });
    if (!ok)
      return recusa('etiqueta-diferente', 'A etiqueta lida não é desta dose: confira o paciente e a dose.', [
        'leitura',
      ]);
  }
  return null;
}

export interface DoseDispensada {
  /** GEDISPHOR.ID. */
  readonly dose: number;
  readonly horario: number | null;
  readonly item: number;
  readonly quantidade: number;
  /** A saída que levou a dose (GELANSAI). */
  readonly itemSaida: number | null;
  readonly lote: string | null;
  readonly validade: string | null;
}

export interface SugestaoDevolucao extends DoseDispensada {
  readonly motivo: 'nao-administrado' | 'suspenso';
  readonly checadoEm: string | null;
}

/**
 * Regra 6: as doses dispensadas cujo horário foi marcado como não administrado (M25, situação 'N') ou suspenso viram a
 * sugestão de devolução, com o lote da saída; a já devolvida não volta.
 */
export function sugestoesDevolucao(
  doses: readonly DoseDispensada[],
  situacoes: ReadonlyMap<number, { situacao: string; em: string | null }>,
  devolvidas: ReadonlySet<number>,
): SugestaoDevolucao[] {
  const r: SugestaoDevolucao[] = [];
  for (const d of doses) {
    if (devolvidas.has(d.dose) || d.horario === null) continue;
    const s = situacoes.get(d.horario);
    if (!s) continue;
    // Binário (sensível a maiúsculas): N não administrado e X não administrar; S suspenso e C suspenso por correção.
    if (s.situacao === 'N' || s.situacao === 'X')
      r.push({ ...d, motivo: 'nao-administrado', checadoEm: s.em });
    else if (s.situacao === 'S' || s.situacao === 'C') r.push({ ...d, motivo: 'suspenso', checadoEm: s.em });
  }
  return r;
}

/** A devolução de dose: quantidade até a dispensada e o lote da saída. */
export function conferirDevolucaoDose(c: {
  quantidade: number;
  dispensada: number;
  jaDevolvida: number;
  lote: string | null;
  loteInformado: string | null;
}): RecusaSuprimentos | null {
  if (!(c.quantidade > 0))
    return recusa('quantidade-invalida', 'Informe a quantidade a devolver.', ['quantidade']);
  if (qtd3(c.quantidade + c.jaDevolvida) > qtd3(c.dispensada))
    return recusa('quantidade-maior-que-a-saida', 'A devolução passa da quantidade dispensada nesta dose.', [
      'quantidade',
    ]);
  if (c.lote && (c.loteInformado ?? '').trim() !== c.lote.trim())
    return recusa('lote-diferente', `Devolva o mesmo lote da saída (${c.lote}).`, ['lote']);
  return null;
}
