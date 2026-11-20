// Tecnovigilância e farmacovigilância, etapa 2 do M48 (ficha, seções 4 e 5: qualidade.registrarQueixaTecnica; RDC
// 67/2009 e RDC 551/2021 para produtos para saúde; RDC 406/2020 para medicamentos; cap-05b §5.11):
//   - o tipo cabe na área (reação adversa e inefetividade são de medicamento; evento adverso de produto é de
//     tecnovigilância; queixa técnica e alerta sanitário valem nas duas);
//   - a situação só anda para a frente: aberta → em investigação → notificada à Anvisa → encerrada (pode pular etapas);
//     "notificada" exige o número que o Notivisa devolveu; a encerrada não muda mais;
//   - os expostos (pacientes que receberam o lote) só se calculam com o item e o lote.
import {
  type AreaVigilanciaProduto,
  type SituacaoVigilanciaProduto,
  TIPOS_VIGILANCIA_PRODUTO,
  type TipoVigilanciaProduto,
} from '@sgh/contratos';

export type RecusaVigilanciaProduto =
  'tipo-fora-da-area' | 'versao-desatualizada' | 'situacao-nao-permite' | 'sem-numero-notivisa';

const ORDEM: Readonly<Record<SituacaoVigilanciaProduto, number>> = {
  aberta: 0,
  emInvestigacao: 1,
  notificada: 2,
  encerrada: 3,
};

export function tipoCabeNaArea(tipo: TipoVigilanciaProduto, area: AreaVigilanciaProduto): boolean {
  const t = TIPOS_VIGILANCIA_PRODUTO.find((x) => x.codigo === tipo);
  return t !== undefined && (t.areas as readonly string[]).includes(area);
}

export function conferirAberturaVigilancia(e: {
  readonly area: AreaVigilanciaProduto;
  readonly tipo: TipoVigilanciaProduto;
}): RecusaVigilanciaProduto | null {
  return tipoCabeNaArea(e.tipo, e.area) ? null : 'tipo-fora-da-area';
}

export function conferirAndamentoVigilancia(
  atual: {
    readonly situacao: SituacaoVigilanciaProduto;
    readonly versao: number;
    readonly notivisaNumero: string | null;
  },
  e: {
    readonly versao: number;
    readonly situacao: SituacaoVigilanciaProduto;
    readonly notivisaNumero: string | null;
  },
):
  | { readonly ok: true; readonly encerra: boolean; readonly notivisaNumero: string | null }
  | {
      readonly ok: false;
      readonly motivo: RecusaVigilanciaProduto;
    } {
  if (atual.versao !== e.versao) return { ok: false, motivo: 'versao-desatualizada' };
  if (atual.situacao === 'encerrada' || ORDEM[e.situacao] < ORDEM[atual.situacao])
    return { ok: false, motivo: 'situacao-nao-permite' };
  // O número do Notivisa, uma vez registrado, fica (o informado de novo é ignorado se for o mesmo).
  const numero = atual.notivisaNumero ?? e.notivisaNumero;
  if (atual.notivisaNumero !== null && e.notivisaNumero !== null && e.notivisaNumero !== atual.notivisaNumero)
    return { ok: false, motivo: 'situacao-nao-permite' };
  if (e.situacao === 'notificada' && numero === null) return { ok: false, motivo: 'sem-numero-notivisa' };
  return { ok: true, encerra: e.situacao === 'encerrada', notivisaNumero: numero };
}

/** Os expostos se calculam só com o item do cadastro e o lote. */
export function calculaExpostos(q: { readonly item: number | null; readonly lote: string | null }): boolean {
  return q.item !== null && q.lote !== null && q.lote.trim() !== '';
}

export const MENSAGENS_RECUSA_VIGILANCIA: Readonly<Record<RecusaVigilanciaProduto, string>> = {
  'tipo-fora-da-area':
    'Esse tipo não cabe na área escolhida: reação adversa e inefetividade são de medicamento; evento adverso de produto é de tecnovigilância.',
  'versao-desatualizada': 'Outra pessoa alterou este registro. Recarregue para ver a versão atual.',
  'situacao-nao-permite':
    'A situação só anda para a frente (aberta, em investigação, notificada, encerrada), e o número do Notivisa não muda.',
  'sem-numero-notivisa': 'Para marcar como notificada, informe o número que o Notivisa devolveu.',
};
