// Ajustes do ponto, regra 11 do M52 (cap-07 §7.1.3, "Regras"): a marcação original NUNCA é alterada; o ajuste é um
// registro novo com motivo e aprovador. Três tipos: incluir a marcação que faltou, desconsiderar uma marcação original
// (ela continua gravada e aparece riscada no espelho) e justificar ou abonar o atraso, a saída antecipada ou a falta pelo
// tipo de movimento do ramo. Quem pediu não aprova o próprio ajuste (D-AJUSTE-524); o período fechado não recebe ajuste.
import type { SituacaoAjuste, TipoAjuste } from '@sgh/contratos';
import { diasEntre } from '../datas.js';
import { minutoLocal } from '../escala/tempo.js';
import { type RecusaSesmt as RecusaPonto, recusaSesmt as recusa } from '../sesmt/recusa.js';

export type { RecusaPonto };

export interface MarcacaoOriginal {
  readonly id: number;
  /** Instante local (`AAAA-MM-DDTHH:MM`). */
  readonly instante: string;
}

export interface AjusteLido {
  readonly id: number;
  readonly tipo: TipoAjuste;
  readonly dia: string;
  readonly marcacao: number | null;
  readonly instante: string | null;
  readonly movimento: number | null;
  readonly minutos: number | null;
  readonly situacao: SituacaoAjuste;
  readonly pedidoPor: string;
}

export interface AjusteProposto {
  readonly tipo: TipoAjuste;
  readonly dia: string;
  readonly marcacao: number | null;
  readonly instante: string | null;
  readonly movimento: number | null;
  readonly minutos: number | null;
}

export interface ContextoAjuste {
  readonly hoje: string;
  readonly admissao: string;
  readonly desligamento: string | null;
  readonly periodoFechado: boolean;
  /** As marcações originais da pessoa perto do dia (o dia e o seguinte). */
  readonly originais: readonly MarcacaoOriginal[];
  /** Os ajustes do vínculo (pendentes e decididos) do período. */
  readonly ajustes: readonly AjusteLido[];
  /** Códigos do tipo de movimento de ponto do ramo aceitos. */
  readonly movimentos: readonly number[];
}

/** A inclusão vale para o dia e para a saída do plantão noturno na manhã seguinte (até 12 h). */
const LIMITE_MANHA_SEGUINTE_MIN = 12 * 60;

export function conferirAjuste(a: AjusteProposto, c: ContextoAjuste): RecusaPonto | null {
  if (c.periodoFechado)
    return recusa('periodo-fechado', 'O período deste dia está fechado: o ajuste não entra.', 'dia');
  if (diasEntre(c.hoje, a.dia) > 0)
    return recusa('dia-futuro', 'O ajuste é de um dia que já passou ou de hoje.', 'dia');
  if (diasEntre(c.admissao, a.dia) < 0)
    return recusa('antes-da-admissao', 'O dia é anterior à admissão do colaborador.', 'dia');
  if (c.desligamento && diasEntre(c.desligamento, a.dia) > 0)
    return recusa('depois-do-desligamento', 'O dia é posterior ao desligamento do colaborador.', 'dia');
  // W0-06: o desistido pelo solicitante também não conta (pode ser lançado de novo, certo).
  const vivos = c.ajustes.filter((x) => x.situacao !== 'recusado' && x.situacao !== 'desistido');
  if (a.tipo === 'inclusao') {
    if (!a.instante) return recusa('instante', 'Informe o horário da marcação que faltou.', 'instante');
    const desde = minutoLocal(`${a.dia}T00:00`);
    const m = minutoLocal(a.instante);
    if (m < desde || m >= desde + 1440 + LIMITE_MANHA_SEGUINTE_MIN)
      return recusa(
        'instante-fora-do-dia',
        'O horário precisa ser do dia ou da manhã seguinte (saída do plantão noturno).',
        'instante',
      );
    if (
      c.originais.some((o) => o.instante === a.instante) ||
      vivos.some((x) => x.tipo === 'inclusao' && x.instante === a.instante)
    )
      return recusa('marcacao-existente', 'Já existe marcação neste horário.', 'instante');
    return null;
  }
  if (a.tipo === 'desconsiderar') {
    if (a.marcacao === null || !c.originais.some((o) => o.id === a.marcacao))
      return recusa('marcacao-inexistente', 'Escolha a marcação do colaborador a desconsiderar.', 'marcacao');
    if (vivos.some((x) => x.tipo === 'desconsiderar' && x.marcacao === a.marcacao))
      return recusa(
        'ja-desconsiderada',
        'Esta marcação já tem um pedido para ser desconsiderada.',
        'marcacao',
      );
    return null;
  }
  if (a.movimento === null || !c.movimentos.includes(a.movimento))
    return recusa('movimento', 'Escolha o tipo da justificativa.', 'movimento');
  if (a.minutos !== null && (a.minutos < 1 || a.minutos > 1440))
    return recusa('minutos', 'Os minutos abonados vão de 1 a 1.440 (vazio = o dia inteiro).', 'minutos');
  if (vivos.some((x) => x.tipo === 'justificativa' && x.dia === a.dia && x.minutos === null))
    return recusa('dia-ja-justificado', 'O dia inteiro já está justificado.', 'dia');
  return null;
}

/** A decisão do ajuste (aprovar ou recusar): só o pendente, por outra pessoa, com o período aberto. */
export function conferirDecisao(
  a: Pick<AjusteLido, 'situacao' | 'pedidoPor'>,
  decisor: string,
  periodoFechado: boolean,
): RecusaPonto | null {
  if (a.situacao !== 'pendente') return recusa('ja-decidido', 'Este ajuste já foi decidido.');
  if (a.pedidoPor.trim().toUpperCase() === decisor.trim().toUpperCase())
    return recusa('aprovador-e-solicitante', 'Quem pediu o ajuste não o aprova: peça a outra pessoa.');
  if (periodoFechado) return recusa('periodo-fechado', 'O período deste dia está fechado.');
  return null;
}

export interface MarcacaoEfetiva {
  /** ID da marcação original, ou null na incluída por ajuste. */
  readonly id: number | null;
  readonly instante: string;
  readonly fonte: 'O' | 'I';
  /** O ajuste que incluiu ou desconsiderou. */
  readonly ajuste: number | null;
  /** Desconsiderada por ajuste aprovado: aparece riscada e não conta. */
  readonly desconsiderada: boolean;
}

/** As marcações do espelho: as originais (as desconsideradas marcadas) e as incluídas por ajuste APROVADO, em ordem. */
export function marcacoesEfetivas(
  originais: readonly MarcacaoOriginal[],
  ajustes: readonly AjusteLido[],
): MarcacaoEfetiva[] {
  const aprovados = ajustes.filter((a) => a.situacao === 'aprovado');
  const desc = new Map<number, number>();
  for (const a of aprovados)
    if (a.tipo === 'desconsiderar' && a.marcacao !== null) desc.set(a.marcacao, a.id);
  const r: MarcacaoEfetiva[] = [
    ...originais.map((o) => ({
      id: o.id,
      instante: o.instante,
      fonte: 'O' as const,
      ajuste: desc.get(o.id) ?? null,
      desconsiderada: desc.has(o.id),
    })),
    ...aprovados
      .filter((a) => a.tipo === 'inclusao' && a.instante)
      .map((a) => ({
        id: null,
        instante: a.instante!,
        fonte: 'I' as const,
        ajuste: a.id,
        desconsiderada: false,
      })),
  ];
  return r.sort((a, b) => minutoLocal(a.instante) - minutoLocal(b.instante) || (a.fonte < b.fonte ? -1 : 1));
}

export interface JustificativaAprovada {
  readonly dia: string;
  readonly movimento: number;
  /** null = o dia inteiro. */
  readonly minutos: number | null;
}

export function justificativasAprovadas(ajustes: readonly AjusteLido[]): JustificativaAprovada[] {
  return ajustes
    .filter((a) => a.situacao === 'aprovado' && a.tipo === 'justificativa' && a.movimento !== null)
    .map((a) => ({ dia: a.dia, movimento: a.movimento!, minutos: a.minutos }));
}
