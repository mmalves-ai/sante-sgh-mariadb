// Fluxo do material esterilizado entre a CME e os setores (F7, 04-CME linha 117; RDC 15/2012, arts. 52 a 57):
// solicitação (receber na CME, cancelar), entrega ao setor, recolhimento (material usado ou que volta sem uso) e a
// conferência do movimento pelo setor; permissões de cada colaborador da CME por setor e por tipo de movimento.
// Regras puras: a porta lê o banco, chama estas funções e grava o desfecho.
import type { ProblemaCme } from './cme.js';

export const TIPOS_MOVIMENTO_MATERIAL = [
  'entrega',
  'recolhimento',
  'devolucao',
  'transferencia',
  'emprestimo',
  'terceirizacao',
] as const;
export type TipoMovimentoMaterial = (typeof TIPOS_MOVIMENTO_MATERIAL)[number];

/** O que o colaborador pode fazer na CME para um setor (cadastro de permissões por setor). */
export interface PermissaoSetorCme {
  readonly setor: number;
  readonly expurgo: boolean;
  readonly lavagem: boolean;
  readonly desinfeccao: boolean;
  readonly preparo: boolean;
  readonly esterilizacao: boolean;
  readonly entradaArsenal: boolean;
  readonly saidaArsenal: boolean;
  readonly devolucaoArsenal: boolean;
  readonly transferenciaArsenal: boolean;
  readonly terceirizacao: boolean;
}

/** Qual permissão do setor cobre cada tipo de movimento. */
export const PERMISSAO_DO_MOVIMENTO: Readonly<Record<TipoMovimentoMaterial, keyof PermissaoSetorCme>> = {
  entrega: 'saidaArsenal',
  recolhimento: 'expurgo',
  devolucao: 'devolucaoArsenal',
  transferencia: 'transferenciaArsenal',
  emprestimo: 'transferenciaArsenal',
  terceirizacao: 'terceirizacao',
};

/**
 * Confere se o colaborador pode fazer o movimento com o setor. Sem nenhuma permissão por setor cadastrada para ele,
 * vale só o perfil (a CME que não restringe por setor); com o cadastro, só os setores e os tipos marcados.
 */
export function conferirPermissaoDoSetor(
  permissoes: readonly PermissaoSetorCme[],
  setor: number,
  tipo: TipoMovimentoMaterial,
): ProblemaCme[] {
  if (permissoes.length === 0) return [];
  const p = permissoes.find((x) => x.setor === setor);
  if (!p)
    return [
      { campo: 'setor', mensagem: 'Você não tem permissão na CME para movimentar material deste setor.' },
    ];
  if (!p[PERMISSAO_DO_MOVIMENTO[tipo]])
    return [
      { campo: 'tipo', mensagem: `Você não tem permissão na CME para o movimento de ${tipo} neste setor.` },
    ];
  return [];
}

/**
 * Quem grava as permissões da CME por setor não pode ser o próprio colaborador: sem essa segregação, quem a CME
 * restringiu a um setor se daria qualquer outro e a restrição não valeria nada.
 */
export function conferirGravacaoDaPermissao(executor: number, colaborador: number): ProblemaCme[] {
  if (executor === colaborador)
    return [
      {
        campo: 'usuario',
        mensagem: 'Você não pode alterar as próprias permissões na CME; peça a outro responsável.',
      },
    ];
  return [];
}

/** A CME recebe a solicitação (passa a "recebida_cme"): só a aberta. */
export function conferirRecebimentoDaSolicitacao(situacao: string): ProblemaCme[] {
  if (situacao !== 'aberta')
    return [{ campo: 'solicitacao', mensagem: 'Só a solicitação aberta pode ser recebida pela CME.' }];
  return [];
}

/**
 * Cancelamento da solicitação: só antes de a CME começar a atender (aberta ou recebida, nenhum item em processamento,
 * pronto ou entregue) e com o motivo escrito.
 */
export function conferirCancelamentoDaSolicitacao(
  situacao: string,
  itens: readonly { readonly situacao: string }[],
  motivo: string,
): ProblemaCme[] {
  const p: ProblemaCme[] = [];
  if (situacao !== 'aberta' && situacao !== 'recebida_cme')
    p.push({
      campo: 'solicitacao',
      mensagem: 'A solicitação já está em atendimento ou encerrada; não pode ser cancelada.',
    });
  else if (itens.some((i) => i.situacao !== 'pendente' && i.situacao !== 'cancelado'))
    p.push({
      campo: 'solicitacao',
      mensagem: 'A CME já começou a atender a solicitação; não pode ser cancelada.',
    });
  if (motivo.trim().length < 5) p.push({ campo: 'motivo', mensagem: 'Escreva o motivo do cancelamento.' });
  return p;
}

/**
 * A situação da solicitação depois de um movimento, pelos itens. A recebida pela CME continua recebida enquanto nenhum
 * item andou (a regra dos itens daria "aberta").
 */
export function situacaoDaSolicitacaoNoFluxo(
  atual: string,
  itens: readonly { readonly situacao: string; readonly atendida?: number }[],
): string {
  const vivos = itens.filter((i) => i.situacao !== 'cancelado');
  if (vivos.length === 0) return 'cancelada';
  const entregues = vivos.filter((i) => i.situacao === 'entregue').length;
  if (entregues === vivos.length) return 'entregue';
  if (entregues > 0 || vivos.some((i) => (i.atendida ?? 0) > 0)) return 'parcial';
  if (vivos.some((i) => i.situacao === 'em_processamento' || i.situacao === 'pronto'))
    return 'em_processamento';
  return atual === 'recebida_cme' ? 'recebida_cme' : 'aberta';
}

export interface ItemParaEntrega {
  readonly id: number;
  readonly caixa: number | null;
  readonly situacao: string;
  readonly quantidade: number;
  readonly atendida: number;
  /** O pacote preparado para o item (tem a preferência; qualquer pacote estéril da mesma caixa também o atende). */
  readonly pacote: number | null;
}

export interface PacoteParaEntrega {
  readonly id: number;
  readonly caixa: number | null;
}

export interface AlocacaoDaEntrega {
  readonly pacote: number;
  readonly item: number;
  /** A quantidade atendida do item depois desta entrega. */
  readonly atendida: number;
  /** O item fica "entregue" quando atende a quantidade pedida; antes disso mantém a situação (só a quantidade anda). */
  readonly entregue: boolean;
}

/**
 * Aloca cada pacote estéril a um item da solicitação: primeiro o item preparado para aquele pacote, depois o primeiro
 * item da mesma caixa que ainda falta atender. Pacote sem item na solicitação, ou além da quantidade pedida, recusa a
 * entrega inteira.
 */
export function alocarPacotesNaSolicitacao(
  itens: readonly ItemParaEntrega[],
  pacotes: readonly PacoteParaEntrega[],
): { alocacoes: AlocacaoDaEntrega[]; problemas: ProblemaCme[] } {
  const falta = new Map(itens.map((i) => [i.id, i.quantidade - i.atendida]));
  const feito = new Map(itens.map((i) => [i.id, i.atendida]));
  const aberto = (i: ItemParaEntrega) =>
    i.situacao !== 'entregue' && i.situacao !== 'cancelado' && (falta.get(i.id) ?? 0) > 0;
  const alocacoes: AlocacaoDaEntrega[] = [];
  const problemas: ProblemaCme[] = [];
  const vistos = new Set<number>();
  for (const p of pacotes) {
    if (vistos.has(p.id)) {
      problemas.push({ campo: 'pacotes', mensagem: `O pacote ${p.id} está repetido na entrega.` });
      continue;
    }
    vistos.add(p.id);
    const item =
      itens.find((i) => i.pacote === p.id && aberto(i)) ??
      itens.find((i) => i.caixa !== null && i.caixa === p.caixa && aberto(i));
    if (!item) {
      problemas.push({
        campo: 'pacotes',
        mensagem: `O pacote ${p.id} não atende nenhum item que falta nesta solicitação.`,
      });
      continue;
    }
    const atendida = (feito.get(item.id) ?? 0) + 1;
    feito.set(item.id, atendida);
    falta.set(item.id, (falta.get(item.id) ?? 0) - 1);
    alocacoes.push({
      pacote: p.id,
      item: item.id,
      atendida,
      entregue: atendida >= item.quantidade,
    });
  }
  return { alocacoes, problemas };
}

export interface PacoteParaRecolher {
  readonly id: number;
  readonly situacao: string;
  readonly validade: string | null;
  /** O setor da última entrega do pacote (null: sem entrega registrada). */
  readonly setorEntregue: number | null;
}

export type DestinoDoRecolhido = 'arsenal' | 'expurgo';

export interface DesfechoDoRecolhimento {
  readonly pacote: number;
  readonly destino: DestinoDoRecolhido;
  /** A nova situação do pacote: "esteril" (volta ao arsenal), "descartado" (embalagem desfeita) ou a mesma. */
  readonly situacao: string;
}

/**
 * Recolhimento do setor para a CME. Só o pacote entregue a este setor (distribuído ou usado). O usado e o devolvido sem
 * integridade ou fora da validade vão ao expurgo (a caixa volta a reprocessar e o pacote não volta ao arsenal); o
 * devolvido sem uso, íntegro e dentro da validade volta ao arsenal como estéril.
 */
export function desfechoDoRecolhimento(
  setor: number,
  pacotes: readonly PacoteParaRecolher[],
  pedidos: readonly { readonly pacote: number; readonly integro: boolean }[],
  hoje: string,
): { desfechos: DesfechoDoRecolhimento[]; problemas: ProblemaCme[] } {
  const desfechos: DesfechoDoRecolhimento[] = [];
  const problemas: ProblemaCme[] = [];
  const vistos = new Set<number>();
  for (const pedido of pedidos) {
    if (vistos.has(pedido.pacote)) {
      problemas.push({
        campo: 'pacotes',
        mensagem: `O pacote ${pedido.pacote} está repetido no recolhimento.`,
      });
      continue;
    }
    vistos.add(pedido.pacote);
    const p = pacotes.find((x) => x.id === pedido.pacote);
    if (!p) {
      problemas.push({
        campo: 'pacotes',
        mensagem: `O pacote ${pedido.pacote} não existe neste estabelecimento.`,
      });
      continue;
    }
    if (p.situacao !== 'distribuido' && p.situacao !== 'usado') {
      problemas.push({
        campo: 'pacotes',
        mensagem: `O pacote ${p.id} não está fora da CME para ser recolhido.`,
      });
      continue;
    }
    if (p.setorEntregue !== null && p.setorEntregue !== setor) {
      problemas.push({ campo: 'pacotes', mensagem: `O pacote ${p.id} foi entregue a outro setor.` });
      continue;
    }
    const dentroDaValidade = !!p.validade && p.validade >= hoje.slice(0, 10);
    if (p.situacao === 'distribuido' && pedido.integro && dentroDaValidade)
      desfechos.push({ pacote: p.id, destino: 'arsenal', situacao: 'esteril' });
    else
      desfechos.push({
        pacote: p.id,
        destino: 'expurgo',
        situacao: p.situacao === 'usado' ? 'usado' : 'descartado',
      });
  }
  if (pedidos.length === 0) problemas.push({ campo: 'pacotes', mensagem: 'Escolha os pacotes recolhidos.' });
  return { desfechos, problemas };
}

/** O setor confere o movimento (recebeu ou entregou o que está nele): só o movimento aberto. */
export function conferirConferenciaDoMovimento(situacao: string): ProblemaCme[] {
  if (situacao !== 'aberto')
    return [{ campo: 'movimento', mensagem: 'O movimento já foi conferido ou cancelado.' }];
  return [];
}
