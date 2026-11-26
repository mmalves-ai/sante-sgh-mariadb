// Plano de cuidado e estratificação de risco do paciente na linha de cuidado do hospital (03-PEP L142). Regras puras.
// Decisão de produto (classe C, 26/11): o produto tem o plano de cuidado com a estratificação de risco, como pedem as
// linhas de cuidado da acreditação (ONA e JCI: plano individual com metas, responsável e reavaliação); núcleo familiar
// e programas populacionais de atenção primária ficam fora até um cliente pedir.
//
// O plano nasce em rascunho, recebe o risco e os itens (problema, objetivo, intervenção, educação, monitoramento) e só é
// ativado com o risco estratificado e ao menos um objetivo. O risco pode ser reestratificado enquanto o plano vale;
// subir para alto ou muito alto pede aviso à equipe. O plano ativo é fechado quando nenhum item segue em aberto; o
// cancelamento pede motivo. A decisão de não criar o plano também é registrada, com a justificativa. Nada é apagado:
// o item que não será feito é cancelado ou marcado como não realizado, sempre com a justificativa do desvio.
import type { FalhaRegra } from './farmacovigilancia.js';

export const NIVEIS_RISCO_PLANO = ['baixo', 'moderado', 'alto', 'muito_alto'] as const;
export type NivelRiscoPlano = (typeof NIVEIS_RISCO_PLANO)[number];
export const SITUACOES_PLANO = ['rascunho', 'ativo', 'fechado', 'cancelado', 'nao_criado'] as const;
export type SituacaoPlano = (typeof SITUACOES_PLANO)[number];
export const ACOES_PLANO = ['ativar', 'estratificar', 'fechar', 'cancelar'] as const;
export type AcaoPlano = (typeof ACOES_PLANO)[number];

export const TIPOS_ITEM_PLANO = ['problema', 'objetivo', 'intervencao', 'educacao', 'monitoramento'] as const;
export type TipoItemPlano = (typeof TIPOS_ITEM_PLANO)[number];
export const SITUACOES_ITEM_PLANO = [
  'pendente',
  'em_andamento',
  'concluida',
  'cancelada',
  'nao_realizada',
] as const;
export type SituacaoItemPlano = (typeof SITUACOES_ITEM_PLANO)[number];
export const PASSOS_ITEM_PLANO = ['iniciar', 'concluir', 'cancelar', 'nao_realizar'] as const;
export type PassoItemPlano = (typeof PASSOS_ITEM_PLANO)[number];

export const DESCRICAO_ITEM_MAXIMA = 500;
export const METAS_MAXIMO = 4000;
export const MOTIVO_MINIMO_PLANO = 5;
export const JUSTIFICATIVA_NAO_CRIACAO_MINIMA = 10;
export const JUSTIFICATIVA_MAXIMA_PLANO = 500;

const falha = (codigo: string, mensagem: string): FalhaRegra => ({ codigo, mensagem });
const ordemRisco = (r: NivelRiscoPlano): number => NIVEIS_RISCO_PLANO.indexOf(r);
const ehRisco = (r: string | null | undefined): r is NivelRiscoPlano =>
  r !== null && r !== undefined && (NIVEIS_RISCO_PLANO as readonly string[]).includes(r);
/** Dia civil AAAA-MM-DD comparável como texto. */
const diaValido = (d: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));

/** Quais tipos podem ficar sob cada tipo (objetivo de um problema; intervenção, educação e monitoramento de um objetivo
 * ou de um problema). Problema é sempre raiz. */
const SUPERIORES: Record<TipoItemPlano, readonly TipoItemPlano[]> = {
  problema: [],
  objetivo: ['problema'],
  intervencao: ['objetivo', 'problema'],
  educacao: ['objetivo', 'problema'],
  monitoramento: ['objetivo', 'problema'],
};

export interface NovoPlano {
  readonly inicio: string;
  readonly fimPrevisto: string | null;
  readonly risco: string | null;
  readonly metas: string | null;
  /** Profissional que responde pelo plano (quem cria); nulo quando a conta não é de profissional. */
  readonly responsavel: number | null;
}

export function validarNovoPlano(p: NovoPlano): FalhaRegra[] {
  const f: FalhaRegra[] = [];
  if (p.responsavel === null)
    f.push(falha('sem-profissional', 'O plano de cuidado precisa de um profissional responsável.'));
  if (!diaValido(p.inicio)) f.push(falha('inicio-invalido', 'Informe o dia de início do plano.'));
  if (p.fimPrevisto !== null && !diaValido(p.fimPrevisto))
    f.push(falha('fim-invalido', 'O fim previsto não é uma data válida.'));
  else if (p.fimPrevisto !== null && diaValido(p.inicio) && p.fimPrevisto < p.inicio)
    f.push(falha('fim-antes-do-inicio', 'O fim previsto não pode ser antes do início.'));
  if (p.risco !== null && !ehRisco(p.risco)) f.push(falha('risco-invalido', 'Nível de risco desconhecido.'));
  if ((p.metas ?? '').length > METAS_MAXIMO)
    f.push(falha('metas-longas', `As metas passam de ${METAS_MAXIMO} caracteres.`));
  return f;
}

/** A decisão de não criar o plano para o paciente da linha de cuidado, com a justificativa. */
export function validarNaoCriacao(justificativa: string, responsavel: number | null): FalhaRegra[] {
  const f: FalhaRegra[] = [];
  if (responsavel === null)
    f.push(falha('sem-profissional', 'A decisão precisa de um profissional responsável.'));
  const j = justificativa.trim();
  if (j.length < JUSTIFICATIVA_NAO_CRIACAO_MINIMA)
    f.push(
      falha(
        'justificativa-curta',
        `Justifique por que o plano não será criado (ao menos ${JUSTIFICATIVA_NAO_CRIACAO_MINIMA} caracteres).`,
      ),
    );
  if (j.length > JUSTIFICATIVA_MAXIMA_PLANO)
    f.push(falha('justificativa-longa', 'A justificativa é longa demais.'));
  return f;
}

export interface PassoPlanoEntrada {
  readonly acao: AcaoPlano;
  readonly situacao: string;
  readonly risco: string | null;
  /** Na estratificação: o novo nível. */
  readonly riscoNovo?: string | null;
  readonly motivo?: string | null;
  /** Objetivos do plano que não foram cancelados nem marcados como não realizados. */
  readonly objetivos: number;
  /** Itens do plano ainda pendentes ou em andamento. */
  readonly itensEmAberto: number;
}

export interface PassoPlanoSaida {
  readonly falhas: FalhaRegra[];
  readonly situacaoNova: SituacaoPlano | null;
  readonly riscoNovo: NivelRiscoPlano | null;
  /** O risco subiu para alto ou muito alto: a equipe precisa ser avisada. */
  readonly avisar: boolean;
}

export function passoPlano(e: PassoPlanoEntrada): PassoPlanoSaida {
  const f: FalhaRegra[] = [];
  const sit = e.situacao;
  const vigente = sit === 'rascunho' || sit === 'ativo';
  let situacaoNova: SituacaoPlano;
  let riscoNovo: NivelRiscoPlano | null = ehRisco(e.risco) ? e.risco : null;
  let avisar = false;
  if (e.acao === 'ativar') {
    if (sit !== 'rascunho') f.push(falha('plano-nao-rascunho', 'Só o plano em rascunho é ativado.'));
    if (!ehRisco(e.risco))
      f.push(falha('plano-sem-risco', 'Estratifique o risco do paciente antes de ativar o plano.'));
    if (e.objetivos < 1)
      f.push(falha('plano-sem-objetivo', 'O plano precisa de ao menos um objetivo para ser ativado.'));
    situacaoNova = 'ativo';
  } else if (e.acao === 'estratificar') {
    if (!vigente)
      f.push(falha('plano-encerrado', 'O risco só é estratificado no plano em rascunho ou ativo.'));
    if (!ehRisco(e.riscoNovo ?? null)) f.push(falha('risco-invalido', 'Escolha o nível de risco.'));
    else if (e.riscoNovo === e.risco)
      f.push(falha('risco-igual', 'O risco escolhido é o mesmo já registrado.'));
    else {
      riscoNovo = e.riscoNovo as NivelRiscoPlano;
      const antes = ehRisco(e.risco) ? ordemRisco(e.risco) : -1;
      avisar = ordemRisco(riscoNovo) > antes && ordemRisco(riscoNovo) >= ordemRisco('alto');
    }
    situacaoNova = sit as SituacaoPlano;
  } else if (e.acao === 'fechar') {
    if (sit !== 'ativo') f.push(falha('plano-nao-ativo', 'Só o plano ativo é fechado.'));
    if (e.itensEmAberto > 0)
      f.push(
        falha(
          'itens-em-aberto',
          `Ainda há ${e.itensEmAberto} item(ns) pendente(s) ou em andamento: conclua, cancele ou marque como não realizado.`,
        ),
      );
    situacaoNova = 'fechado';
  } else {
    if (!vigente) f.push(falha('plano-encerrado', 'Só o plano em rascunho ou ativo é cancelado.'));
    if ((e.motivo ?? '').trim().length < MOTIVO_MINIMO_PLANO)
      f.push(falha('motivo-obrigatorio', 'Informe o motivo do cancelamento.'));
    situacaoNova = 'cancelado';
  }
  return { falhas: f, situacaoNova: f.length ? null : situacaoNova, riscoNovo, avisar: !f.length && avisar };
}

export interface NovoItemPlano {
  readonly tipo: string;
  readonly descricao: string;
  readonly situacaoPlano: string;
  /** Tipo do item superior (nulo quando o item é raiz); undefined quando o superior não existe no plano. */
  readonly tipoSuperior: string | null | undefined;
  readonly prazo: string | null;
  readonly inicioPlano: string;
}

export function validarNovoItem(i: NovoItemPlano): FalhaRegra[] {
  const f: FalhaRegra[] = [];
  if (i.situacaoPlano !== 'rascunho' && i.situacaoPlano !== 'ativo')
    f.push(falha('plano-encerrado', 'Só o plano em rascunho ou ativo recebe itens.'));
  const tipo = (TIPOS_ITEM_PLANO as readonly string[]).includes(i.tipo) ? (i.tipo as TipoItemPlano) : null;
  if (!tipo) f.push(falha('tipo-invalido', 'Tipo de item desconhecido.'));
  const d = i.descricao.trim();
  if (d.length < 3) f.push(falha('descricao-curta', 'Descreva o item.'));
  if (d.length > DESCRICAO_ITEM_MAXIMA)
    f.push(falha('descricao-longa', `A descrição passa de ${DESCRICAO_ITEM_MAXIMA} caracteres.`));
  if (i.tipoSuperior === undefined)
    f.push(falha('superior-inexistente', 'O item superior não existe neste plano.'));
  else if (tipo && i.tipoSuperior !== null && !SUPERIORES[tipo].includes(i.tipoSuperior as TipoItemPlano))
    f.push(
      falha(
        'hierarquia-invalida',
        tipo === 'problema'
          ? 'O problema não fica sob outro item.'
          : `Um item do tipo ${tipo} não fica sob um item do tipo ${i.tipoSuperior}.`,
      ),
    );
  if (i.prazo !== null && !diaValido(i.prazo))
    f.push(falha('prazo-invalido', 'O prazo não é uma data válida.'));
  else if (i.prazo !== null && i.prazo < i.inicioPlano)
    f.push(falha('prazo-antes-do-inicio', 'O prazo não pode ser antes do início do plano.'));
  return f;
}

export interface PassoItemEntrada {
  readonly passo: PassoItemPlano;
  readonly situacao: string;
  readonly situacaoPlano: string;
  readonly justificativa?: string | null;
}

export function passoItem(e: PassoItemEntrada): {
  falhas: FalhaRegra[];
  situacaoNova: SituacaoItemPlano | null;
} {
  const f: FalhaRegra[] = [];
  const aberto = e.situacao === 'pendente' || e.situacao === 'em_andamento';
  if (e.situacaoPlano !== 'ativo') f.push(falha('plano-nao-ativo', 'Os itens só andam com o plano ativo.'));
  let nova: SituacaoItemPlano;
  if (e.passo === 'iniciar') {
    if (e.situacao !== 'pendente') f.push(falha('item-nao-pendente', 'Só o item pendente é iniciado.'));
    nova = 'em_andamento';
  } else {
    if (!aberto) f.push(falha('item-encerrado', 'O item já foi encerrado.'));
    nova = e.passo === 'concluir' ? 'concluida' : e.passo === 'cancelar' ? 'cancelada' : 'nao_realizada';
    if (nova !== 'concluida' && (e.justificativa ?? '').trim().length < MOTIVO_MINIMO_PLANO)
      f.push(falha('justificativa-obrigatoria', 'Justifique o desvio do plano.'));
  }
  return { falhas: f, situacaoNova: f.length ? null : nova };
}

/** O item conta como objetivo do plano para a ativação (não cancelado nem não realizado). */
export const objetivoValido = (tipo: string, situacao: string): boolean =>
  tipo === 'objetivo' && situacao !== 'cancelada' && situacao !== 'nao_realizada';
export const itemEmAberto = (situacao: string): boolean =>
  situacao === 'pendente' || situacao === 'em_andamento';
