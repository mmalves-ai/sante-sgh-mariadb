// Cor proposta (ficha do M44, regra 3; cap-05a §5.3; cap-11 §11.1): a de maior prioridade entre os discriminadores
// presentes no fluxograma escolhido, sejam os marcados pela regra a partir dos sinais, sejam os marcados à mão pelo
// enfermeiro. Sem discriminador presente, a proposta é a cor de menor prioridade (azul, "não urgente"), como no
// fim de todo fluxograma. Sobrepor a proposta exige justificativa e gera evento de auditoria.
import type { ConteudoProtocolo, CorRisco, Discriminador, SinaisClassificacao } from '@sgh/contratos';
import { CORES_RISCO } from '@sgh/contratos';
import { discriminadoresDoFluxograma, prioridadeDaCor } from './protocolo.js';
import { regraSatisfeita, type ValoresClassificacao } from './regra.js';

const MENOS_GRAVE: CorRisco = [...CORES_RISCO].sort((a, b) => b.prioridade - a.prioridade)[0]!.codigo;

/** Os valores que as regras leem: os sinais e a idade em anos (da data de nascimento, no servidor). */
export function valoresDaClassificacao(
  sinais: Partial<SinaisClassificacao>,
  idadeAnos: number | null,
): ValoresClassificacao {
  return { ...sinais, idadeAnos };
}

export interface Proposta {
  /** Discriminadores presentes, do mais grave para o menos grave. */
  readonly presentes: readonly Discriminador[];
  /** Os que a regra marcou sozinha (a tela os mostra marcados e travados com a explicação). */
  readonly automaticos: readonly string[];
  readonly cor: CorRisco;
  /** Nenhum discriminador presente (a proposta é a menos grave). */
  readonly semDiscriminador: boolean;
  /** Marcados à mão que não existem no fluxograma (a entrada é recusada com eles). */
  readonly desconhecidos: readonly string[];
}

export function proporCor(
  conteudo: Pick<ConteudoProtocolo, 'discriminadores'>,
  fluxograma: string,
  valores: ValoresClassificacao,
  marcados: readonly string[],
): Proposta {
  const doFluxo = discriminadoresDoFluxograma(conteudo, fluxograma);
  const porCodigo = new Map(doFluxo.map((d) => [d.codigo, d]));
  const automaticos = doFluxo.filter((d) => d.regra !== null && regraSatisfeita(d.regra, valores));
  const manuais = marcados.map((c) => porCodigo.get(c)).filter((d): d is Discriminador => d !== undefined);
  const desconhecidos = marcados.filter((c) => !porCodigo.has(c));
  const presentes = [...new Map([...automaticos, ...manuais].map((d) => [d.codigo, d])).values()].sort(
    (a, b) => prioridadeDaCor(a.cor) - prioridadeDaCor(b.cor) || doFluxo.indexOf(a) - doFluxo.indexOf(b),
  );
  return {
    presentes,
    automaticos: automaticos.map((d) => d.codigo),
    cor: presentes[0]?.cor ?? MENOS_GRAVE,
    semDiscriminador: presentes.length === 0,
    desconhecidos,
  };
}

export type DecisaoCorFinal =
  | {
      readonly ok: true;
      readonly sobreposta: boolean;
      readonly direcao: 'igual' | 'mais-grave' | 'menos-grave';
    }
  | { readonly ok: false; readonly motivo: 'justificativa-obrigatoria' };

/** A cor final aceita? Diferente da proposta só com justificativa (regra 3). */
export function decidirCorFinal(
  proposta: CorRisco,
  final: CorRisco,
  justificativa: string | null | undefined,
): DecisaoCorFinal {
  if (proposta === final) return { ok: true, sobreposta: false, direcao: 'igual' };
  if (!justificativa?.trim()) return { ok: false, motivo: 'justificativa-obrigatoria' };
  return {
    ok: true,
    sobreposta: true,
    direcao: prioridadeDaCor(final) < prioridadeDaCor(proposta) ? 'mais-grave' : 'menos-grave',
  };
}
