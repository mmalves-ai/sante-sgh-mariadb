// Comuns das solicitações do autoatendimento (W0-06, parte 6d): o formulário único da tela (um campo por dado de
// qualquer tipo) vira a entrada do MESMO Zod do servidor; o motivo do diálogo é a observação do pedido. A hora do
// SanteHora chega em HHMM e vira HH:MM no instante da marcação que faltou.
import {
  esquemaDecidirSolicitacao,
  esquemaIncluirSolicitacao,
  type DecidirSolicitacaoEntrada,
  type IncluirSolicitacaoEntrada,
  type SolicitacaoPessoaResposta,
  type TipoAjuste,
  type TipoSolicitacaoPessoaContrato,
} from '@sgh/contratos';

export interface FormSolicitacao {
  tipo: TipoSolicitacaoPessoaContrato;
  inicio: string | null;
  fim: string | null;
  diasGozo: string;
  diasAbono: string;
  adiantaDecimo: boolean;
  movimento: number | null;
  dia: string | null;
  ajuste: TipoAjuste;
  marcacao: number | null;
  /** HHMM (SanteHora). */
  hora: string | null;
  valorNovo: string;
  emitidoEm: string | null;
  diasAtestado: string;
  cid: string;
  emitente: string;
  registroConselho: string;
}

export const formSolicitacaoVazio = (tipo: TipoSolicitacaoPessoaContrato = 'ferias'): FormSolicitacao => ({
  tipo,
  inicio: null,
  fim: null,
  diasGozo: '30',
  diasAbono: '0',
  adiantaDecimo: false,
  movimento: null,
  dia: null,
  ajuste: 'inclusao',
  marcacao: null,
  hora: null,
  valorNovo: '',
  emitidoEm: null,
  diasAtestado: '1',
  cid: '',
  emitente: '',
  registroConselho: '',
});

/** HHMM ou HH:MM → HH:MM; null se não for hora válida. */
export function horaHhMm(h: string | null): string | null {
  const m = /^([01]\d|2[0-3]):?([0-5]\d)$/.exec((h ?? '').trim());
  return m ? `${m[1]}:${m[2]}` : null;
}

const inteiro = (s: string): number => (/^\d{1,3}$/.test(s.trim()) ? Number(s.trim()) : Number.NaN);

/** O corpo do pedido conforme o tipo (antes do Zod): só os campos daquele tipo. */
export function corpoDoPedido(f: FormSolicitacao, motivo: string, vinculo: number | null): unknown {
  const observacao = motivo.trim();
  switch (f.tipo) {
    case 'ferias':
      return {
        tipo: 'ferias',
        vinculo,
        inicio: f.inicio ?? '',
        diasGozo: inteiro(f.diasGozo),
        diasAbono: inteiro(f.diasAbono || '0'),
        adiantaDecimo: f.adiantaDecimo,
        observacao,
      };
    case 'abono':
      return {
        tipo: 'abono',
        vinculo,
        inicio: f.inicio ?? '',
        fim: f.fim ?? f.inicio ?? '',
        movimento: f.movimento,
        observacao,
      };
    case 'ajuste_ponto': {
      const hora = horaHhMm(f.hora);
      return {
        tipo: 'ajuste_ponto',
        vinculo,
        dia: f.dia ?? '',
        ajuste: f.ajuste,
        marcacao: f.ajuste === 'desconsiderar' ? f.marcacao : null,
        instante: f.ajuste === 'inclusao' && f.dia && hora ? `${f.dia}T${hora}` : null,
        movimento: f.ajuste === 'justificativa' ? f.movimento : null,
        observacao,
      };
    }
    case 'alteracao_cadastral':
      return { tipo: 'alteracao_cadastral', vinculo, campo: 'nome', valorNovo: f.valorNovo, observacao };
    case 'atestado':
      return {
        tipo: 'atestado',
        vinculo,
        inicio: f.inicio ?? '',
        fim: f.fim ?? f.inicio ?? '',
        movimento: f.movimento,
        atestado: {
          emitidoEm: f.emitidoEm ?? '',
          dias: inteiro(f.diasAtestado),
          cid: f.cid.trim() || null,
          emitente: f.emitente,
          registroConselho: f.registroConselho,
        },
        observacao,
      };
  }
}

export type MontagemPedido =
  | { readonly ok: true; readonly entrada: IncluirSolicitacaoEntrada }
  | { readonly ok: false; readonly campo: string; readonly mensagem: string };

/** O pedido pronto para gravar ou a primeira pendência (o campo e a frase do Zod, a mesma do servidor). */
export function montarPedido(f: FormSolicitacao, motivo: string, vinculo: number | null): MontagemPedido {
  const r = esquemaIncluirSolicitacao.safeParse(corpoDoPedido(f, motivo, vinculo));
  if (r.success) return { ok: true, entrada: r.data };
  const i = r.error.issues[0];
  const campo = (i?.path ?? []).filter((p) => typeof p === 'string').join('.');
  const mensagem = i?.code === 'invalid_type' ? 'Preencha este campo.' : (i?.message ?? 'Pedido incompleto.');
  return { ok: false, campo, mensagem };
}

/** O período do pedido em uma linha (as datas já formatadas por `data`). */
export function periodoDoPedido(s: SolicitacaoPessoaResposta, data: (d: string) => string): string {
  if (!s.inicio) return '';
  if (s.tipo === 'ferias') return `${data(s.inicio)} · ${s.diasGozo ?? 0} dias`;
  if (!s.fim || s.fim === s.inicio) return data(s.inicio);
  return `${data(s.inicio)} a ${data(s.fim)}`;
}

// ── A decisão do gestor (parte 6d-2) ──────────────────────────────────────────────────────────────────────────

/** O que o gestor confirma além do motivo: o movimento do ponto (abono e atestado) e, nas férias, empresa e aquisitivo. */
export interface FormDecisao {
  movimento: number | null;
  justificativa: number | null;
  empresa: number | null;
  aquisitivoInicio: string | null;
}

export const formDecisaoVazio = (s: SolicitacaoPessoaResposta): FormDecisao => ({
  movimento: s.movimento,
  justificativa: s.justificativa,
  empresa: null,
  aquisitivoInicio: null,
});

/** Abono e atestado viram justificativa no ponto: a aprovação exige o movimento (o do pedido ou o do gestor). */
export const pedeMovimento = (s: SolicitacaoPessoaResposta): boolean =>
  s.tipo === 'abono' || s.tipo === 'atestado';

export type MontagemDecisao =
  | { readonly ok: true; readonly entrada: Omit<DecidirSolicitacaoEntrada, 'solicitacao'> }
  | { readonly ok: false; readonly campo: string; readonly mensagem: string };

/** A decisão pronta para gravar (o MESMO Zod do servidor) ou a primeira pendência. Só os campos do tipo vão. */
export function montarDecisao(
  s: SolicitacaoPessoaResposta,
  decisao: 'aprovar' | 'recusar',
  motivo: string,
  f: FormDecisao,
): MontagemDecisao {
  const aprovar = decisao === 'aprovar';
  if (aprovar && pedeMovimento(s) && f.movimento === null)
    return { ok: false, campo: 'movimento', mensagem: 'Escolha o tipo de movimento do ponto.' };
  const r = esquemaDecidirSolicitacao.safeParse({
    solicitacao: s.id,
    versao: s.versao,
    decisao,
    motivo: motivo.trim(),
    movimento: aprovar && pedeMovimento(s) ? f.movimento : null,
    justificativa: aprovar && pedeMovimento(s) ? f.justificativa : null,
    empresa: aprovar && s.tipo === 'ferias' ? f.empresa : null,
    aquisitivoInicio: aprovar && s.tipo === 'ferias' ? f.aquisitivoInicio : null,
  });
  if (!r.success) {
    const i = r.error.issues[0];
    const campo = (i?.path ?? []).filter((p) => typeof p === 'string').join('.');
    return { ok: false, campo, mensagem: i?.message ?? 'Decisão incompleta.' };
  }
  const d = r.data;
  return {
    ok: true,
    entrada: {
      versao: d.versao,
      decisao: d.decisao,
      motivo: d.motivo,
      movimento: d.movimento,
      justificativa: d.justificativa,
      empresa: d.empresa,
      aquisitivoInicio: d.aquisitivoInicio,
    },
  };
}
