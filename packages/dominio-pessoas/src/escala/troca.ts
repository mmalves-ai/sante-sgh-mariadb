// Troca de plantão entre colegas (M52.3; ficha do M52, seção 8, regra 8, segunda parte: "troca = pedido → aceite do
// colega → aprovação do coordenador"). Recurso só da escala publicada (em rascunho, a coordenação muda a grade direto).
// O pedido prende os plantões (um plantão só entra em uma troca aberta por vez); cada passo tem quem pode dar e de que
// estado sai. Na aprovação, a API confere de novo cada plantão com o novo colaborador (conselho no dia, interjornada,
// limite do contrato e sobreposição, regras 3 e 5 a 7) pela montagem da F2, e os plantões mudam de colaborador com o
// motivo na trilha da escala.
import type { EstadoEscala, EstadoTroca, TipoTroca } from '@sgh/contratos';
import { OK, recusar, type Conferencia } from './plantao.js';
import { minutoLocal } from './tempo.js';

export interface PlantaoDaTroca {
  readonly id: number;
  readonly escala: number;
  readonly vinculo: number;
  readonly pessoa: number;
  readonly situacao: string;
  readonly inicio: string;
  readonly versao: number;
}

export interface PedidoDeTroca {
  readonly tipo: TipoTroca;
  /** O plantão de quem pede, relido. */
  readonly plantao: PlantaoDaTroca;
  readonly estadoEscala: EstadoEscala;
  readonly versaoInformada: number;
  /** O colega (vínculo ativo no estabelecimento). */
  readonly colega: { readonly vinculo: number; readonly pessoa: number; readonly ativo: boolean };
  /** Na troca, o plantão do colega que volta para quem pede, relido. */
  readonly plantaoColega: PlantaoDaTroca | null;
  readonly estadoEscalaColega: EstadoEscala | null;
  readonly versaoColegaInformada: number | null;
  /** Os plantões que já estão em troca aberta (pedida ou aceita). */
  readonly emTrocaAberta: ReadonlySet<number>;
  /** Agora, em hora local (`AAAA-MM-DDTHH:MM`). */
  readonly agora: string;
}

const futuro = (p: PlantaoDaTroca, agora: string) => minutoLocal(p.inicio) > minutoLocal(agora);

export function conferirPedidoDeTroca(x: PedidoDeTroca): Conferencia {
  const p = x.plantao;
  if (x.estadoEscala !== 'publicada')
    return recusar(
      'escala-em-rascunho',
      'A escala ainda está em rascunho: a coordenação muda o plantão direto na grade.',
    );
  if (p.situacao !== 'previsto') return recusar('plantao-cancelado', 'O plantão está cancelado.');
  if (p.versao !== x.versaoInformada)
    return recusar('desatualizado', 'O plantão mudou depois que você abriu. Abra de novo.');
  if (!futuro(p, x.agora))
    return recusar('plantao-comecou', 'O plantão já começou: a troca é só de plantão que ainda não começou.');
  if (!x.colega.ativo)
    return recusar('colega-inativo', 'O colega não tem vínculo ativo neste estabelecimento.');
  if (x.colega.pessoa === p.pessoa)
    return recusar('mesma-pessoa', 'Escolha um colega: a troca é entre duas pessoas diferentes.');
  if (x.emTrocaAberta.has(p.id))
    return recusar('plantao-em-troca', 'Este plantão já está em outro pedido de troca em andamento.');
  if (x.tipo === 'cessao') {
    if (x.plantaoColega) return recusar('cessao-com-plantao', 'Na cessão, o colega não devolve plantão.');
    return OK;
  }
  const b = x.plantaoColega;
  if (!b) return recusar('troca-sem-plantao', 'Na troca, escolha o plantão do colega.');
  if (b.id === p.id) return recusar('mesmo-plantao', 'Escolha um plantão diferente do seu.');
  if (b.vinculo !== x.colega.vinculo)
    return recusar('plantao-de-outro', 'O plantão escolhido não é do colega.');
  if (x.estadoEscalaColega !== 'publicada')
    return recusar('escala-em-rascunho', 'A escala do plantão do colega ainda está em rascunho.');
  if (b.situacao !== 'previsto') return recusar('plantao-cancelado', 'O plantão do colega está cancelado.');
  if (b.versao !== x.versaoColegaInformada)
    return recusar('desatualizado', 'O plantão do colega mudou depois que você abriu. Abra de novo.');
  if (!futuro(b, x.agora)) return recusar('plantao-comecou', 'O plantão do colega já começou.');
  if (x.emTrocaAberta.has(b.id))
    return recusar('plantao-em-troca', 'O plantão do colega já está em outro pedido de troca em andamento.');
  return OK;
}

/** Quem age: a pessoa da sessão é quem pediu, o colega, ou nenhum dos dois (coordenação). */
export type PapelNaTroca = 'quemPediu' | 'colega' | 'outro';

export type PassoDaTroca = 'responder' | 'decidir' | 'cancelar';

export interface SituacaoDoPasso {
  readonly estado: EstadoTroca;
  readonly papel: PapelNaTroca;
  /** A pessoa da sessão pode registrar em nome de quem não tem acesso (`pessoas.escala.montar`). */
  readonly emNomeDe: boolean;
  /** A pessoa da sessão pode aprovar trocas (`pessoas.troca.aprovar`). */
  readonly aprova: boolean;
  /** O colega tem acesso ao sistema (então só ele responde). */
  readonly colegaTemAcesso: boolean;
  /** A pessoa da sessão registrou o pedido ou o aceite desta troca (em nome de alguém): então não a aprova. */
  readonly registrouAlgumPasso?: boolean;
}

/**
 * O passo é permitido? Responder: só da troca pedida, pelo próprio colega ou, quando ele não tem acesso, pela
 * coordenação (que diz como ele confirmou). Decidir: só da troca aceita, por quem aprova, não é parte e não registrou o
 * pedido nem o aceite (quatro olhos: pedido, aceite e aprovação nunca pela mesma pessoa). Cancelar: da
 * troca pedida ou aceita, por quem pediu ou pela coordenação.
 */
export function conferirPassoDaTroca(passo: PassoDaTroca, s: SituacaoDoPasso): Conferencia {
  switch (passo) {
    case 'responder':
      if (s.estado !== 'pedida')
        return recusar('troca-respondida', 'A troca não está aguardando a resposta do colega.');
      if (s.papel === 'colega') return OK;
      if (s.papel === 'quemPediu')
        return recusar('responder-o-proprio', 'Quem pede a troca não responde por ela: o colega responde.');
      if (!s.emNomeDe) return recusar('so-o-colega', 'Só o colega responde ao pedido de troca.');
      if (s.colegaTemAcesso)
        return recusar('colega-com-acesso', 'O colega tem acesso ao sistema: a resposta é dele.');
      return OK;
    case 'decidir':
      if (s.estado !== 'aceita')
        return recusar('troca-nao-aceita', 'A coordenação decide só a troca já aceita pelo colega.');
      if (!s.aprova) return recusar('sem-permissao', 'Você não aprova trocas de plantão.');
      if (s.papel !== 'outro')
        return recusar(
          'aprovar-a-propria',
          'Quem é parte da troca não a aprova: outra pessoa da coordenação decide.',
        );
      if (s.registrouAlgumPasso)
        return recusar(
          'aprovar-o-que-registrou',
          'Quem registrou o pedido ou o aceite desta troca não a aprova: outra pessoa da coordenação decide.',
        );
      return OK;
    case 'cancelar':
      if (s.estado !== 'pedida' && s.estado !== 'aceita')
        return recusar('troca-encerrada', 'A troca já foi decidida ou encerrada.');
      if (s.papel === 'quemPediu' || s.emNomeDe) return OK;
      return recusar('so-quem-pediu', 'Só quem pediu (ou a coordenação) cancela a troca.');
  }
}

/** O estado seguinte de cada passo. */
export function estadoDepois(passo: PassoDaTroca, sim: boolean): EstadoTroca {
  if (passo === 'responder') return sim ? 'aceita' : 'recusada';
  if (passo === 'decidir') return sim ? 'aprovada' : 'reprovada';
  return 'cancelada';
}

/**
 * Na aprovação, cada plantão é conferido de novo: ainda previsto, com a mesma versão do pedido e sem ter começado. A
 * conferência das regras com o novo colaborador é a da montagem (a API chama).
 */
export function conferirPlantaoNaAprovacao(
  p: PlantaoDaTroca | null,
  versaoDoPedido: number,
  vinculoDoPedido: number,
  agora: string,
): Conferencia {
  if (!p || p.situacao !== 'previsto' || p.versao !== versaoDoPedido || p.vinculo !== vinculoDoPedido)
    return recusar(
      'troca-desatualizada',
      'Um dos plantões mudou depois do pedido (cancelado, alterado ou já trocado): reprove esta troca e peça de novo.',
    );
  if (!futuro(p, agora))
    return recusar('plantao-comecou', 'Um dos plantões já começou: a troca não pode mais ser aprovada.');
  return OK;
}
