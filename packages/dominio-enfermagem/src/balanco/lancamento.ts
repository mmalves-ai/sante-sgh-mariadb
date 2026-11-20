// Conferência do lançamento e do estorno do balanço (M45, etapa 3; regras 6 e 15): o ganho leva o grupo, a perda leva
// o tipo de eliminação ativo (com a intensidade quando o tipo pede, e só então); o volume estimado só nos tipos que
// aceitam; valor nunca visto nos domínios é recusado; a hora real não é do futuro nem de uma janela já fechada em 24
// horas. Nada se apaga: o estorno anula o lançamento com o motivo, uma vez só, enquanto a janela está aberta.
import type {
  DominiosBalanco,
  LancamentoBalancoEntrada,
  LancamentoBalancoLido,
  SentidoBalanco,
} from '@sgh/contratos';
import { janelaDoInstante } from './janela.js';

export type RecusaBalanco = { readonly ok: false; readonly codigo: string; readonly mensagem: string };

export interface LancamentoConferido {
  readonly sentido: SentidoBalanco;
  readonly grupo: number | null;
  readonly via: string | null;
  readonly tipoEliminacao: number | null;
  readonly intensidade: number | null;
  readonly aspecto: string | null;
  readonly estimado: boolean;
  readonly volumeMl: number;
  readonly horaReal: string;
  readonly descricao: string | null;
  readonly origemOffline: boolean;
}

const recusa = (codigo: string, mensagem: string): RecusaBalanco => ({ ok: false, codigo, mensagem });

/** A janela de 24 horas da hora já tem o fechamento de 24 horas? (`fechadas`: os inícios das janelas fechadas.) */
export function janelaFechada(hora: string, horaCorte: string, fechadas: ReadonlySet<string>): boolean {
  return fechadas.has(janelaDoInstante(hora, horaCorte).inicio);
}

export function conferirLancamento(
  e: LancamentoBalancoEntrada,
  d: DominiosBalanco,
  ctx: {
    readonly agora: string;
    readonly horaCorte: string;
    readonly fechadas: ReadonlySet<string>;
    /** O começo da internação: lançamento de antes dela é recusado. */
    readonly desde?: string | null;
  },
): ({ readonly ok: true } & LancamentoConferido) | RecusaBalanco {
  const hora = (e.horaReal ?? ctx.agora).slice(0, 16);
  if (hora > ctx.agora.slice(0, 16))
    return recusa('hora-futura', 'A hora do lançamento é depois de agora: confira a hora.');
  if (ctx.desde && hora < ctx.desde.slice(0, 16))
    return recusa('hora-antes-da-internacao', 'A hora do lançamento é de antes da internação.');
  if (janelaFechada(hora, ctx.horaCorte, ctx.fechadas))
    return recusa(
      'janela-fechada',
      'O balanço de 24 horas desta hora já foi fechado: o lançamento não entra mais nele.',
    );
  let via: string | null = null;
  if (e.sentido === 'ganho') {
    if (e.grupo === null) return recusa('grupo-exigido', 'Escolha o grupo do ganho.');
    if (!d.grupos.some((g) => g.codigo === e.grupo))
      return recusa('valor-nunca-visto', 'O grupo do ganho não existe no cadastro.');
    if (e.tipoEliminacao !== null || e.intensidade !== null || e.estimado)
      return recusa(
        'sentido-misturado',
        'O ganho não tem tipo de eliminação, intensidade nem volume estimado.',
      );
    if (e.via !== null) {
      if (!d.vias.some((v) => v.codigo === e.via))
        return recusa('valor-nunca-visto', 'A via não existe no cadastro de vias.');
      via = e.via;
    }
  } else {
    if (e.tipoEliminacao === null) return recusa('tipo-exigido', 'Escolha o tipo da perda.');
    const t = d.tiposEliminacao.find((x) => x.codigo === e.tipoEliminacao);
    if (!t) return recusa('valor-nunca-visto', 'O tipo de eliminação não existe no cadastro.');
    if (!t.ativo) return recusa('tipo-inativo', `O tipo de eliminação ${t.nome} está inativo no cadastro.`);
    if (e.grupo !== null || e.via !== null)
      return recusa('sentido-misturado', 'A perda não tem grupo nem via de ganho.');
    if (t.pedeIntensidade && e.intensidade === null)
      return recusa('intensidade-exigida', `${t.nome}: informe a intensidade (1+ a 4+).`);
    if (!t.pedeIntensidade && e.intensidade !== null)
      return recusa('intensidade-nao-cabe', `${t.nome} não leva intensidade.`);
    if (e.intensidade !== null && !d.intensidades.some((i) => i.codigo === e.intensidade))
      return recusa('valor-nunca-visto', 'A intensidade não existe no cadastro.');
    if (e.estimado && !t.aceitaEstimado)
      return recusa('estimado-nao-cabe', `${t.nome}: o volume tem de ser medido.`);
  }
  return {
    ok: true,
    sentido: e.sentido,
    grupo: e.sentido === 'ganho' ? e.grupo : null,
    via,
    tipoEliminacao: e.sentido === 'perda' ? e.tipoEliminacao : null,
    intensidade: e.sentido === 'perda' ? e.intensidade : null,
    aspecto: e.aspecto,
    estimado: e.estimado,
    volumeMl: Math.round(e.volumeMl * 10) / 10,
    horaReal: hora,
    descricao: e.descricao,
    origemOffline: e.origemOffline,
  };
}

/** Os lançamentos que contam: nem o estorno nem o estornado. */
export function lancamentosVigentes<T extends Pick<LancamentoBalancoLido, 'origem' | 'estornadoPor'>>(
  ls: readonly T[],
): T[] {
  return ls.filter((l) => l.origem !== 'estorno' && l.estornadoPor === null);
}

export function conferirEstorno(
  l: LancamentoBalancoLido | null,
  ctx: { readonly horaCorte: string; readonly fechadas: ReadonlySet<string> },
): { readonly ok: true } | RecusaBalanco {
  if (!l) return recusa('nao-encontrado', 'O lançamento não foi encontrado.');
  if (l.origem === 'estorno') return recusa('estorno-de-estorno', 'Um estorno não se estorna.');
  if (l.estornadoPor !== null) return recusa('ja-estornado', 'O lançamento já foi estornado.');
  if (janelaFechada(l.horaReal, ctx.horaCorte, ctx.fechadas))
    return recusa(
      'janela-fechada',
      'O balanço de 24 horas deste lançamento já foi fechado: o lançamento não se estorna mais.',
    );
  return { ok: true };
}
