// Manutenção corretiva (04-HOT linha 135): cadastro da oficina, orçamento da OS com aprovação por alçada e remessa do
// equipamento para conserto externo, com o retorno. Regras puras; a porta relê a OS, a oficina e o orçamento dentro da
// transação e só grava o que o plano daqui aprovou.
// Padrão de mercado: RDC 509/2021 (gerenciamento de tecnologias em saúde) e NBR 15943 (programa de gerenciamento):
// o gestor de manutenção aprova o orçamento dentro de uma alçada por valor; quem registrou o orçamento não o aprova
// (segregação de funções); a reprovação leva justificativa. A saída do equipamento leva termo (estado, acessórios) e a
// nota de remessa para conserto (CFOP 5.915 dentro do estado, 6.915 fora); o retorno fecha a remessa e devolve a OS ao
// atendimento. Nada se apaga: orçamento novo substitui o pendente, e a remessa retornada fica no histórico.
import type { SituacaoOs } from '@sgh/contratos';
import type { Recusa } from './os.js';

const recusa = <C extends string>(c: C, mensagem: string): Recusa<C> => ({ ok: false, recusa: c, mensagem });

/** Justificativa mínima da reprovação do orçamento e da devolução sem conserto. */
export const JUSTIFICATIVA_MINIMA_ORCAMENTO = 10;

// ── Oficina ────────────────────────────────────────────────────────────────────────────────────────────────────
export const FUNCOES_OFICINA = ['tecnico', 'supervisor', 'aprovador', 'recepcao'] as const;
export type FuncaoOficina = (typeof FUNCOES_OFICINA)[number];

export interface OficinaParaConferir {
  readonly codigo: string;
  readonly nome: string;
  readonly terceirizada: boolean;
  readonly fornecedor: number | null;
  readonly notificaPorEmail: boolean;
  readonly email: string | null;
}

export type RecusaOficina =
  | 'codigo-invalido'
  | 'nome-obrigatorio'
  | 'terceirizada-sem-fornecedor'
  | 'email-obrigatorio'
  | 'email-invalido';

export type CampoOficina = 'codigo' | 'nome' | 'fornecedor' | 'email';

/** Confere a oficina antes de gravar; devolve a primeira recusa com o campo, ou null. */
export function conferirOficina(
  o: OficinaParaConferir,
): (Recusa<RecusaOficina> & { readonly campo: CampoOficina }) | null {
  const r = (c: RecusaOficina, campo: CampoOficina, m: string) => ({ ...recusa(c, m), campo });
  if (!/^[A-Z0-9_.-]{2,30}$/.test(o.codigo.trim().toUpperCase()))
    return r(
      'codigo-invalido',
      'codigo',
      'O código tem de 2 a 30 letras, números, ponto, hífen ou sublinhado.',
    );
  if (o.nome.trim().length < 3) return r('nome-obrigatorio', 'nome', 'Informe o nome da oficina.');
  if (o.terceirizada && o.fornecedor === null)
    return r(
      'terceirizada-sem-fornecedor',
      'fornecedor',
      'A oficina terceirizada exige a empresa fornecedora.',
    );
  const email = o.email?.trim() ?? '';
  if (o.notificaPorEmail && !email)
    return r('email-obrigatorio', 'email', 'Para avisar por e-mail, informe o e-mail da oficina.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return r('email-invalido', 'email', 'E-mail da oficina inválido.');
  return null;
}

export interface MembroOficina {
  readonly usuario: number;
  readonly funcao: FuncaoOficina;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly ativo: boolean;
  /** Valor máximo que o aprovador aprova; null = sem limite. Só vale para a função aprovador. */
  readonly alcada: number | null;
}

export type RecusaMembro = 'vigencia-invertida' | 'alcada-invalida' | 'alcada-so-do-aprovador';

export function conferirMembro(m: MembroOficina): Recusa<RecusaMembro> | null {
  if (m.vigenciaFim !== null && m.vigenciaFim < m.vigenciaInicio)
    return recusa('vigencia-invertida', 'O fim da vigência é anterior ao início.');
  if (m.alcada !== null && m.funcao !== 'aprovador')
    return recusa('alcada-so-do-aprovador', 'Só o aprovador tem alçada de valor.');
  if (m.alcada !== null && !(m.alcada > 0))
    return recusa('alcada-invalida', 'A alçada tem de ser maior que zero.');
  return null;
}

const vigente = (m: MembroOficina, dia: string) =>
  m.ativo && m.vigenciaInicio <= dia && (m.vigenciaFim === null || m.vigenciaFim >= dia);

// ── Orçamento ──────────────────────────────────────────────────────────────────────────────────────────────────
export type SituacaoOrcamento = 'pendente' | 'aprovado' | 'reprovado' | 'substituido';

export interface PedidoOrcamento {
  readonly situacaoOs: SituacaoOs;
  readonly valor: number;
  readonly descricao: string;
  readonly validade: string | null;
  readonly hoje: string;
  /** Já há orçamento aprovado nesta OS. */
  readonly haAprovado: boolean;
}

export type RecusaOrcamento =
  'os-fechada' | 'valor-invalido' | 'descricao-obrigatoria' | 'validade-vencida' | 'ja-aprovado';

/** O orçamento novo na OS (o pendente anterior, se houver, passa a substituído). */
export function planejarOrcamento(p: PedidoOrcamento): { readonly ok: true } | Recusa<RecusaOrcamento> {
  if (!['aberta', 'emAtendimento', 'aguardandoPeca', 'aguardandoTerceiro'].includes(p.situacaoOs))
    return recusa('os-fechada', 'A ordem de serviço já foi concluída ou cancelada.');
  if (p.haAprovado)
    return recusa(
      'ja-aprovado',
      'A ordem de serviço já tem orçamento aprovado; abra outra OS para serviço novo.',
    );
  if (!(p.valor > 0) || Math.round(p.valor * 100) !== p.valor * 100)
    return recusa('valor-invalido', 'O valor tem de ser maior que zero, com até duas casas decimais.');
  if (p.descricao.trim().length < 5) return recusa('descricao-obrigatoria', 'Descreva o serviço orçado.');
  if (p.validade !== null && p.validade < p.hoje)
    return recusa('validade-vencida', 'A validade do orçamento já passou.');
  return { ok: true };
}

export interface PedidoDecisao {
  readonly decisao: 'aprovado' | 'reprovado';
  readonly orcamento: {
    readonly situacao: SituacaoOrcamento;
    readonly valor: number;
    readonly registradoPor: number;
    readonly validade: string | null;
  };
  readonly quem: number;
  /** O administrador da plataforma pode tudo (ADR 0002): decide sem alçada. */
  readonly administrador: boolean;
  /** Os papéis de quem decide na oficina da OS. */
  readonly membros: readonly MembroOficina[];
  readonly justificativa: string | null;
  readonly hoje: string;
}

export type RecusaDecisao =
  | 'orcamento-decidido'
  | 'orcamento-vencido'
  | 'mesmo-autor'
  | 'sem-alcada'
  | 'acima-da-alcada'
  | 'justificativa-curta';

/** Aprovação ou reprovação do orçamento pendente pelo aprovador da oficina, dentro da alçada. */
export function planejarDecisao(p: PedidoDecisao): { readonly ok: true } | Recusa<RecusaDecisao> {
  if (p.orcamento.situacao !== 'pendente')
    return recusa('orcamento-decidido', 'Este orçamento já foi decidido ou substituído.');
  const just = p.justificativa?.trim() ?? '';
  if (p.decisao === 'reprovado' && just.length < JUSTIFICATIVA_MINIMA_ORCAMENTO)
    return recusa(
      'justificativa-curta',
      `Justifique a reprovação (no mínimo ${JUSTIFICATIVA_MINIMA_ORCAMENTO} caracteres).`,
    );
  if (p.decisao === 'aprovado' && p.orcamento.validade !== null && p.orcamento.validade < p.hoje)
    return recusa('orcamento-vencido', 'O orçamento venceu; peça um novo ao fornecedor.');
  if (p.administrador) return { ok: true };
  if (p.quem === p.orcamento.registradoPor)
    return recusa('mesmo-autor', 'Quem registrou o orçamento não pode decidi-lo.');
  const aprovadores = p.membros.filter(
    (m) => m.usuario === p.quem && m.funcao === 'aprovador' && vigente(m, p.hoje),
  );
  if (aprovadores.length === 0)
    return recusa('sem-alcada', 'Só o aprovador vigente da oficina decide o orçamento.');
  if (
    p.decisao === 'aprovado' &&
    !aprovadores.some((m) => m.alcada === null || m.alcada >= p.orcamento.valor)
  )
    return recusa(
      'acima-da-alcada',
      'O valor passa da sua alçada; encaminhe a um aprovador com alçada maior.',
    );
  return { ok: true };
}

// ── Remessa para conserto externo ──────────────────────────────────────────────────────────────────────────────
export type CfopRemessa = '5915' | '6915';
export type ResultadoRetorno = 'consertado' | 'sem_conserto';

/** Saída sem custo, sem orçamento: o equipamento volta ao fabricante ou ao contratado. */
export const MOTIVOS_SEM_ORCAMENTO = ['garantia', 'contrato', 'comodato'] as const;
export type MotivoSemOrcamento = (typeof MOTIVOS_SEM_ORCAMENTO)[number];

export interface PedidoRemessa {
  readonly situacaoOs: SituacaoOs;
  readonly temEquipamento: boolean;
  readonly remessaAberta: boolean;
  /** Situação do último orçamento da OS (null: sem orçamento). */
  readonly orcamento: SituacaoOrcamento | null;
  readonly enviadoEm: string;
  readonly previsaoRetorno: string | null;
  readonly termo: string;
  /** Saída sem orçamento aprovado (garantia, contrato, comodato), com justificativa; null quando há orçamento. */
  readonly semOrcamento: { readonly motivo: MotivoSemOrcamento; readonly justificativa: string } | null;
}

export type RecusaRemessa =
  | 'situacao-nao-permite'
  | 'sem-equipamento'
  | 'remessa-aberta'
  | 'orcamento-pendente'
  | 'orcamento-reprovado'
  | 'sem-orcamento'
  | 'sem-orcamento-indevido'
  | 'justificativa-sem-orcamento'
  | 'previsao-invertida'
  | 'termo-obrigatorio';

/** A saída do equipamento para o fornecedor: a OS passa a aguardando terceiro. */
export function planejarRemessa(
  p: PedidoRemessa,
): { readonly ok: true; readonly para: SituacaoOs } | Recusa<RecusaRemessa> {
  if (!['emAtendimento', 'aguardandoPeca'].includes(p.situacaoOs))
    return recusa('situacao-nao-permite', 'Assuma a ordem de serviço antes de enviar o equipamento.');
  if (!p.temEquipamento) return recusa('sem-equipamento', 'A remessa é de equipamento; esta OS é de local.');
  if (p.remessaAberta) return recusa('remessa-aberta', 'O equipamento já está fora, aguardando retorno.');
  if (p.orcamento === 'pendente')
    return recusa('orcamento-pendente', 'O orçamento ainda aguarda a aprovação.');
  if (p.orcamento === 'aprovado' && p.semOrcamento !== null)
    return recusa('sem-orcamento-indevido', 'A OS já tem orçamento aprovado; a saída segue por ele.');
  if (p.orcamento !== 'aprovado') {
    // RDC 509/2021: o conserto externo pago sai só com o orçamento aprovado dentro da alçada; a saída sem custo
    // (garantia, contrato, comodato) fica registrada com o motivo e a justificativa.
    if (p.semOrcamento === null)
      return p.orcamento === 'reprovado'
        ? recusa('orcamento-reprovado', 'O orçamento foi reprovado; registre outro antes de enviar.')
        : recusa(
            'sem-orcamento',
            'Registre e aprove o orçamento antes de enviar, ou informe a saída sem custo (garantia, contrato ou comodato).',
          );
    if (p.semOrcamento.justificativa.trim().length < JUSTIFICATIVA_MINIMA_ORCAMENTO)
      return recusa(
        'justificativa-sem-orcamento',
        `Justifique a saída sem orçamento (no mínimo ${JUSTIFICATIVA_MINIMA_ORCAMENTO} caracteres).`,
      );
  }
  if (p.previsaoRetorno !== null && p.previsaoRetorno < p.enviadoEm.slice(0, 10))
    return recusa('previsao-invertida', 'A previsão de retorno é anterior à saída.');
  if (p.termo.trim().length < 5)
    return recusa('termo-obrigatorio', 'Descreva no termo de saída o estado e os acessórios do equipamento.');
  return { ok: true, para: 'aguardandoTerceiro' };
}

export interface PedidoRetorno {
  readonly situacaoRemessa: 'enviado' | 'retornado';
  readonly enviadoEm: string;
  readonly retornadoEm: string;
  readonly agora: string;
  readonly resultado: ResultadoRetorno;
  readonly observacao: string | null;
}

export type RecusaRetorno =
  'remessa-retornada' | 'retorno-antes-da-saida' | 'retorno-futuro' | 'justificativa-curta';

/** O retorno do fornecedor: fecha a remessa e devolve a OS ao atendimento (o técnico conclui depois do teste). */
export function planejarRetorno(
  p: PedidoRetorno,
): { readonly ok: true; readonly para: SituacaoOs } | Recusa<RecusaRetorno> {
  if (p.situacaoRemessa !== 'enviado') return recusa('remessa-retornada', 'Esta remessa já retornou.');
  if (p.retornadoEm < p.enviadoEm) return recusa('retorno-antes-da-saida', 'O retorno é anterior à saída.');
  if (p.retornadoEm > p.agora) return recusa('retorno-futuro', 'O retorno não pode ser no futuro.');
  if (p.resultado === 'sem_conserto' && (p.observacao?.trim().length ?? 0) < JUSTIFICATIVA_MINIMA_ORCAMENTO)
    return recusa(
      'justificativa-curta',
      `Explique por que voltou sem conserto (no mínimo ${JUSTIFICATIVA_MINIMA_ORCAMENTO} caracteres).`,
    );
  return { ok: true, para: 'emAtendimento' };
}
