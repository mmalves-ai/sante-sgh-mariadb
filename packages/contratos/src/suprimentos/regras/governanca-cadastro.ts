// C2-082 (05-SUP linha 2): governança do cadastro de itens do estoque. Regras puras:
// - a solicitação de item novo (inclusão), de alteração ou de inativação, com justificativa, analisada pela comissão de
//   padronização: quem aprova ou reprova nunca é quem pediu (segregação), a reprovação exige o motivo e o item novo só
//   nasce da aprovação; a inclusão de um item cuja descrição já existe no cadastro é recusada na hora (peça a
//   unificação ou use o item que já existe); a inativação aprovada segue a regra do cadastro (conferirInativacaoItem);
// - a unificação de itens duplicados num item que permanece: absorvidos distintos e do mesmo tipo, fator de conversão
//   positivo, aprovação por outra pessoa; na execução o saldo vai para o item que permanece (convertido pelo fator, com
//   o mesmo valor), as referências do cadastro passam a apontar para ele e o absorvido fica inativo (nunca apagado);
//   saldo reservado ou consignado impede a execução;
// - a substituição (de-para) entre itens: genérico, terapêutico, apresentação ou marca, com fator e vigência.
import { type RecusaSuprimentos, recusa } from './recusa.js';

export const TIPOS_SOLICITACAO_CADASTRO = ['inclusao', 'alteracao', 'inativacao'] as const;
export type TipoSolicitacaoCadastro = (typeof TIPOS_SOLICITACAO_CADASTRO)[number];
export const SITUACOES_SOLICITACAO_CADASTRO = [
  'rascunho',
  'enviada',
  'em_analise',
  'aprovada',
  'reprovada',
  'concluida',
  'cancelada',
] as const;
export type SituacaoSolicitacaoCadastro = (typeof SITUACOES_SOLICITACAO_CADASTRO)[number];
export const ACOES_SOLICITACAO_CADASTRO = [
  'enviar',
  'analisar',
  'aprovar',
  'reprovar',
  'concluir',
  'cancelar',
] as const;
export type AcaoSolicitacaoCadastro = (typeof ACOES_SOLICITACAO_CADASTRO)[number];

export const SITUACOES_UNIFICACAO = [
  'rascunho',
  'aguardando_aprovacao',
  'aprovada',
  'em_execucao',
  'concluida',
  'cancelada',
  'erro',
] as const;
export type SituacaoUnificacao = (typeof SITUACOES_UNIFICACAO)[number];
export const ACOES_UNIFICACAO = ['aprovar', 'executar', 'cancelar'] as const;
export type AcaoUnificacao = (typeof ACOES_UNIFICACAO)[number];

export const TIPOS_SUBSTITUICAO = ['generico', 'terapeutico', 'apresentacao', 'marca'] as const;
export type TipoSubstituicao = (typeof TIPOS_SUBSTITUICAO)[number];

/** Mínimo de caracteres da justificativa da solicitação, do parecer, do motivo da reprovação e do cancelamento. */
export const MINIMO_JUSTIFICATIVA_CADASTRO = 20;
export const MINIMO_MOTIVO_CADASTRO = 10;
/** Quantos itens uma unificação absorve de uma vez. */
export const MAXIMO_ABSORVIDOS_UNIFICACAO = 20;

const texto = (v: string | null | undefined): string => (v ?? '').trim();

/** A descrição normalizada para comparar itens: sem acento, maiúscula, espaços e pontuação simples unificados. */
export function normalizarDescricaoItem(d: string): string {
  return d
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[.,;:()\-_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface SolicitacaoCadastroParaConferir {
  readonly tipo: TipoSolicitacaoCadastro;
  /** O item a alterar ou inativar (nulo na inclusão). */
  readonly item: number | null;
  readonly descricao: string;
  readonly justificativa: string;
}

/** A solicitação de cadastro bem formada (antes de gravar). */
export function conferirSolicitacaoCadastro(s: SolicitacaoCadastroParaConferir): RecusaSuprimentos[] {
  const out: RecusaSuprimentos[] = [];
  if (!TIPOS_SOLICITACAO_CADASTRO.includes(s.tipo))
    out.push(recusa('tipo-invalido', 'Escolha o tipo: inclusão, alteração ou inativação.', ['tipo']));
  else if (s.tipo === 'inclusao' && s.item !== null)
    out.push(
      recusa('item-na-inclusao', 'A inclusão pede um item novo: não escolha item existente.', ['item']),
    );
  else if (s.tipo !== 'inclusao' && s.item === null)
    out.push(recusa('sem-item', 'Escolha o item a alterar ou inativar.', ['item']));
  const d = texto(s.descricao);
  if (d.length < 3 || d.length > 150)
    out.push(
      recusa('descricao-invalida', 'A descrição proposta tem de ter de 3 a 150 caracteres.', ['descricao']),
    );
  const j = texto(s.justificativa);
  if (j.length < MINIMO_JUSTIFICATIVA_CADASTRO || j.length > 2000)
    out.push(
      recusa(
        'justificativa-curta',
        `Justifique o pedido com pelo menos ${MINIMO_JUSTIFICATIVA_CADASTRO} caracteres.`,
        ['justificativa'],
      ),
    );
  return out;
}

/**
 * A inclusão cuja descrição já existe no cadastro (mesma descrição normalizada de um item ativo) é recusada: o
 * hospital usa o item que já existe ou pede a unificação. Devolve a recusa ou nulo.
 */
export function conferirDuplicidadeInclusao(
  descricao: string,
  existentes: readonly { readonly id: number; readonly nome: string }[],
): RecusaSuprimentos | null {
  const alvo = normalizarDescricaoItem(descricao);
  const igual = existentes.find((e) => normalizarDescricaoItem(e.nome) === alvo);
  return igual
    ? recusa(
        'item-ja-existe',
        `Já existe o item "${igual.nome}" com esta descrição: use-o ou peça a unificação.`,
        ['descricao'],
      )
    : null;
}

export interface TransicaoSolicitacaoCadastro {
  readonly situacao: SituacaoSolicitacaoCadastro;
  readonly acao: AcaoSolicitacaoCadastro;
  readonly solicitante: number;
  readonly usuario: number;
  readonly parecer?: string | null;
  readonly motivo?: string | null;
}

const ORIGENS_SOLICITACAO: Record<AcaoSolicitacaoCadastro, readonly SituacaoSolicitacaoCadastro[]> = {
  enviar: ['rascunho'],
  analisar: ['enviada'],
  aprovar: ['enviada', 'em_analise'],
  reprovar: ['enviada', 'em_analise'],
  concluir: ['aprovada'],
  cancelar: ['rascunho', 'enviada', 'em_analise'],
};
const DESTINOS_SOLICITACAO: Record<AcaoSolicitacaoCadastro, SituacaoSolicitacaoCadastro> = {
  enviar: 'enviada',
  analisar: 'em_analise',
  aprovar: 'aprovada',
  reprovar: 'reprovada',
  concluir: 'concluida',
  cancelar: 'cancelada',
};

/** A situação seguinte da solicitação pela ação, ou a recusa (situação errada, segregação, parecer ou motivo). */
export function proximaSituacaoSolicitacao(
  t: TransicaoSolicitacaoCadastro,
): { readonly situacao: SituacaoSolicitacaoCadastro } | RecusaSuprimentos {
  if (!ORIGENS_SOLICITACAO[t.acao]?.includes(t.situacao))
    return recusa(
      'situacao-invalida',
      `A solicitação ${t.situacao.replace('_', ' ')} não aceita "${t.acao}".`,
    );
  if ((t.acao === 'aprovar' || t.acao === 'reprovar' || t.acao === 'analisar') && t.usuario === t.solicitante)
    return recusa(
      'segregacao',
      'Quem pediu não analisa o próprio pedido: a comissão de padronização decide.',
    );
  if (t.acao === 'aprovar' && texto(t.parecer).length < MINIMO_MOTIVO_CADASTRO)
    return recusa(
      'sem-parecer',
      `Registre o parecer da comissão (mínimo de ${MINIMO_MOTIVO_CADASTRO} caracteres).`,
      ['parecer'],
    );
  if ((t.acao === 'reprovar' || t.acao === 'cancelar') && texto(t.motivo).length < MINIMO_MOTIVO_CADASTRO)
    return recusa('sem-motivo', `Informe o motivo (mínimo de ${MINIMO_MOTIVO_CADASTRO} caracteres).`, [
      'motivo',
    ]);
  if (t.acao === 'cancelar' && t.usuario !== t.solicitante)
    return recusa('cancelar-so-solicitante', 'Só quem pediu cancela a solicitação; a comissão reprova.');
  return { situacao: DESTINOS_SOLICITACAO[t.acao] };
}

export interface AbsorvidoParaConferir {
  readonly item: number;
  readonly fator: number;
}
export interface UnificacaoParaConferir {
  readonly permanece: number;
  readonly absorvidos: readonly AbsorvidoParaConferir[];
  readonly motivo: string;
}

const fatorValido = (f: number): boolean =>
  Number.isFinite(f) && f > 0 && f <= 1_000_000 && Math.abs(Math.round(f * 1e8) - f * 1e8) < 1e-6;

/** A unificação bem formada: absorvidos distintos, diferentes do que permanece, fator positivo, motivo. */
export function conferirUnificacao(u: UnificacaoParaConferir): RecusaSuprimentos[] {
  const out: RecusaSuprimentos[] = [];
  if (!u.absorvidos.length || u.absorvidos.length > MAXIMO_ABSORVIDOS_UNIFICACAO)
    out.push(
      recusa(
        'sem-absorvidos',
        `Escolha de 1 a ${MAXIMO_ABSORVIDOS_UNIFICACAO} itens duplicados a absorver.`,
        ['absorvidos'],
      ),
    );
  const vistos = new Set<number>();
  for (const a of u.absorvidos) {
    if (a.item === u.permanece)
      out.push(
        recusa('absorve-a-si', 'O item que permanece não pode ser absorvido por ele mesmo.', ['absorvidos']),
      );
    else if (vistos.has(a.item))
      out.push(recusa('absorvido-repetido', 'O mesmo item foi escolhido duas vezes.', ['absorvidos']));
    vistos.add(a.item);
    if (!fatorValido(a.fator))
      out.push(
        recusa('fator-invalido', 'O fator de conversão tem de ser maior que zero (até 8 casas).', [
          'absorvidos',
        ]),
      );
  }
  if (texto(u.motivo).length < MINIMO_MOTIVO_CADASTRO || texto(u.motivo).length > 500)
    out.push(
      recusa(
        'sem-motivo',
        `Informe o motivo da unificação (de ${MINIMO_MOTIVO_CADASTRO} a 500 caracteres).`,
        ['motivo'],
      ),
    );
  return out;
}

export interface ItemDaUnificacao {
  readonly id: number;
  readonly nome: string;
  readonly tipo: string;
  readonly ativo: boolean;
}

/** Os itens envolvidos existem, estão ativos e são do mesmo tipo (medicamento com medicamento, material com material). */
export function conferirItensDaUnificacao(
  permanece: ItemDaUnificacao,
  absorvidos: readonly ItemDaUnificacao[],
): RecusaSuprimentos | null {
  if (!permanece.ativo)
    return recusa('permanece-inativo', `O item que permanece (${permanece.nome}) está inativo.`, [
      'permanece',
    ]);
  for (const a of absorvidos) {
    if (!a.ativo) return recusa('absorvido-inativo', `O item ${a.nome} já está inativo.`, ['absorvidos']);
    if (a.tipo !== permanece.tipo)
      return recusa(
        'tipos-diferentes',
        `O item ${a.nome} é de outro tipo (${a.tipo}): só se unificam itens do mesmo tipo.`,
        ['absorvidos'],
      );
  }
  return null;
}

export interface TransicaoUnificacao {
  readonly situacao: SituacaoUnificacao;
  readonly acao: AcaoUnificacao;
  readonly solicitante: number;
  readonly usuario: number;
  readonly motivo?: string | null;
}

/** A situação seguinte da unificação, ou a recusa (situação, segregação na aprovação, motivo do cancelamento). */
export function proximaSituacaoUnificacao(
  t: TransicaoUnificacao,
): { readonly situacao: SituacaoUnificacao } | RecusaSuprimentos {
  const origens: Record<AcaoUnificacao, readonly SituacaoUnificacao[]> = {
    aprovar: ['aguardando_aprovacao'],
    executar: ['aprovada'],
    cancelar: ['rascunho', 'aguardando_aprovacao', 'aprovada'],
  };
  if (!origens[t.acao]?.includes(t.situacao))
    return recusa(
      'situacao-invalida',
      `A unificação ${t.situacao.replace('_', ' ')} não aceita "${t.acao}".`,
    );
  if (t.acao === 'aprovar' && t.usuario === t.solicitante)
    return recusa('segregacao', 'Quem pediu a unificação não a aprova: outra pessoa da comissão aprova.');
  if (t.acao === 'cancelar' && texto(t.motivo).length < MINIMO_MOTIVO_CADASTRO)
    return recusa(
      'sem-motivo',
      `Informe o motivo do cancelamento (mínimo de ${MINIMO_MOTIVO_CADASTRO} caracteres).`,
      ['motivo'],
    );
  return { situacao: t.acao === 'aprovar' ? 'aprovada' : t.acao === 'executar' ? 'concluida' : 'cancelada' };
}

/** A quantidade do absorvido convertida para a unidade do que permanece (4 casas). */
export function quantidadeConvertida(quantidade: number, fator: number): number {
  return Math.round(quantidade * fator * 10_000) / 10_000;
}

/** O fator de uma referência (fornecedor, preço) do absorvido reescrito para o que permanece (8 casas). */
export function fatorReferenciaConvertido(fatorReferencia: number, fatorUnificacao: number): number {
  return Math.round(fatorReferencia * fatorUnificacao * 1e8) / 1e8;
}

export interface SaldoDoAbsorvido {
  readonly local: string;
  readonly quantidade: number;
  readonly reservada: number;
  readonly consignada: number;
  /** Soma dos lotes do saldo no local. */
  readonly emLotes: number;
}

/**
 * O saldo do absorvido pode ser transferido: nada reservado para separação nem consignado (é do fornecedor), e, se o
 * item que permanece controla lote, todo o saldo está em lotes.
 */
export function conferirSaldoTransferivel(
  s: SaldoDoAbsorvido,
  permaneceControlaLote: boolean,
): RecusaSuprimentos | null {
  if (s.reservada > 0)
    return recusa(
      'saldo-reservado',
      `Há ${s.reservada} reservado para separação em ${s.local}: conclua antes.`,
    );
  if (s.consignada > 0)
    return recusa(
      'saldo-consignado',
      `Há ${s.consignada} consignado em ${s.local}: devolva ou fature antes.`,
    );
  if (permaneceControlaLote && Math.round((s.quantidade - s.emLotes) * 10_000) > 0)
    return recusa(
      'saldo-sem-lote',
      `O item que permanece controla lote e ${s.local} tem saldo sem lote: acerte o inventário antes.`,
    );
  return null;
}

export interface SubstituicaoParaConferir {
  readonly item: number;
  readonly substituto: number;
  readonly tipo: TipoSubstituicao;
  readonly fator: number;
  readonly vigenciaInicio: string | null;
  readonly vigenciaFim: string | null;
}

/** A substituição (de-para) bem formada: itens distintos, tipo conhecido, fator positivo, vigência em ordem. */
export function conferirSubstituicao(s: SubstituicaoParaConferir): RecusaSuprimentos[] {
  const out: RecusaSuprimentos[] = [];
  if (s.item === s.substituto)
    out.push(recusa('substitui-a-si', 'O substituto tem de ser outro item.', ['substituto']));
  if (!TIPOS_SUBSTITUICAO.includes(s.tipo))
    out.push(
      recusa('tipo-invalido', 'Escolha o tipo: genérico, terapêutico, apresentação ou marca.', ['tipo']),
    );
  if (!(s.fator > 0) || s.fator > 1_000_000)
    out.push(recusa('fator-invalido', 'O fator de conversão tem de ser maior que zero.', ['fator']));
  if (s.vigenciaInicio && s.vigenciaFim && s.vigenciaFim < s.vigenciaInicio)
    out.push(recusa('vigencia-invertida', 'O fim da vigência vem antes do início.', ['vigenciaFim']));
  return out;
}
