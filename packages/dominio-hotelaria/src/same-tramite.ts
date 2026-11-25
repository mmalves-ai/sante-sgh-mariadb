// SAME: protocolo de envio em lote entre setores e empréstimo de prontuário (F3.9, 04-HOT L127 e L128). Regras puras:
// sem banco, sem HTTP. A porta (apps/api, adt/same-tramite-propria) lê o estado, chama estas regras e grava.
//   - Protocolo: um lote com itens (volume, atendimento, conta ou documento avulso) de um setor para outro. É emitido e
//     enviado num passo só; quem recebe confere item a item (recebe ou recusa com motivo). A situação do lote sai dos
//     itens: todos recebidos = recebido; todos recusados = recusado; parte conferida = recebido parcial.
//   - Solicitação: o pedido de volumes de um paciente ao arquivo, com o motivo (finalidade e prazo de devolução do
//     cadastro). O arquivo atende entregando os volumes por empréstimo; a solicitação fica atendida (ou parcial).
//   - Empréstimo: o volume sai do arquivo para o setor com o prazo de devolução (o do motivo, ou o padrão); volta pela
//     devolução; o atraso conta da data do prazo; a cobrança soma os avisos. Nada se apaga: cancelar exige motivo.

export const TIPOS_ITEM_PROTOCOLO = ['volume_prontuario', 'atendimento', 'conta', 'documento'] as const;
export type TipoItemProtocolo = (typeof TIPOS_ITEM_PROTOCOLO)[number];

export type SituacaoProtocolo =
  'aberto' | 'enviado' | 'recebido_parcial' | 'recebido' | 'recusado' | 'cancelado';

export interface ProblemaTramite {
  readonly campo: string;
  readonly mensagem: string;
}

export interface ItemProtocoloPedido {
  readonly tipo: TipoItemProtocolo;
  /** O id do alvo (volume, atendimento ou conta); nulo no documento avulso. */
  readonly alvo: number | null;
  readonly descricao: string | null;
}

/** O conteúdo do lote pelos tipos dos itens (prontuário, conta, documento ou misto). */
export function conteudoDoProtocolo(itens: readonly Pick<ItemProtocoloPedido, 'tipo'>[]): string {
  const tipos = new Set(
    itens.map((i) => (i.tipo === 'volume_prontuario' || i.tipo === 'atendimento' ? 'prontuario' : i.tipo)),
  );
  return tipos.size === 1 ? [...tipos][0]! : 'misto';
}

/** A montagem do lote: setores diferentes, ao menos um item, nenhum item repetido, alvo ou descrição conforme o tipo. */
export function conferirProtocolo(p: {
  readonly remetente: number;
  readonly destinatario: number;
  readonly itens: readonly ItemProtocoloPedido[];
}): ProblemaTramite[] {
  const r: ProblemaTramite[] = [];
  if (p.remetente === p.destinatario)
    r.push({ campo: 'destinatario', mensagem: 'O setor de destino tem de ser outro que não o remetente.' });
  if (p.itens.length === 0) r.push({ campo: 'itens', mensagem: 'O protocolo precisa de ao menos um item.' });
  if (p.itens.length > 500) r.push({ campo: 'itens', mensagem: 'Um protocolo leva no máximo 500 itens.' });
  const vistos = new Set<string>();
  p.itens.forEach((i, n) => {
    if (i.tipo === 'documento') {
      if (!i.descricao?.trim())
        r.push({ campo: `itens.${n}.descricao`, mensagem: 'O documento avulso precisa da descrição.' });
    } else if (i.alvo === null)
      r.push({ campo: `itens.${n}.alvo`, mensagem: 'Informe o volume, o atendimento ou a conta do item.' });
    const chave = i.tipo === 'documento' ? `d:${i.descricao?.trim().toLowerCase()}` : `${i.tipo}:${i.alvo}`;
    if (vistos.has(chave)) r.push({ campo: `itens.${n}`, mensagem: 'O item já está no protocolo.' });
    vistos.add(chave);
  });
  return r;
}

export interface ItemConferido {
  readonly recebido: boolean;
  readonly recusado: boolean;
}

/** A situação do lote pela conferência dos itens. */
export function situacaoPelosItens(itens: readonly ItemConferido[]): SituacaoProtocolo {
  const conferidos = itens.filter((i) => i.recebido || i.recusado).length;
  if (itens.length === 0 || conferidos === 0) return 'enviado';
  if (conferidos < itens.length) return 'recebido_parcial';
  return itens.every((i) => i.recusado) ? 'recusado' : 'recebido';
}

export interface ConferenciaItem {
  readonly item: number;
  readonly aceito: boolean;
  readonly motivo: string | null;
}

/** O recebimento item a item: só lote enviado ou parcial; item do lote, ainda não conferido; recusa com motivo. */
export function conferirRecebimento(
  situacao: SituacaoProtocolo,
  itens: readonly (ItemConferido & { readonly id: number })[],
  conferencia: readonly ConferenciaItem[],
): ProblemaTramite[] {
  const r: ProblemaTramite[] = [];
  if (situacao !== 'enviado' && situacao !== 'recebido_parcial')
    return [
      { campo: 'protocolo', mensagem: 'Só se recebe o protocolo enviado e ainda não conferido por inteiro.' },
    ];
  if (conferencia.length === 0) r.push({ campo: 'itens', mensagem: 'Marque ao menos um item.' });
  const vistos = new Set<number>();
  conferencia.forEach((c, n) => {
    const i = itens.find((x) => x.id === c.item);
    if (!i) r.push({ campo: `itens.${n}.item`, mensagem: 'O item não é deste protocolo.' });
    else if (i.recebido || i.recusado)
      r.push({ campo: `itens.${n}.item`, mensagem: 'O item já foi conferido.' });
    if (vistos.has(c.item))
      r.push({ campo: `itens.${n}.item`, mensagem: 'O item está repetido na conferência.' });
    vistos.add(c.item);
    if (!c.aceito && !c.motivo?.trim())
      r.push({ campo: `itens.${n}.motivo`, mensagem: 'A recusa do item exige o motivo.' });
  });
  return r;
}

/** O cancelamento do lote: só antes de qualquer conferência, e com motivo. */
export function conferirCancelamentoProtocolo(
  situacao: SituacaoProtocolo,
  motivo: string | null,
): ProblemaTramite[] {
  const r: ProblemaTramite[] = [];
  if (situacao !== 'aberto' && situacao !== 'enviado')
    r.push({
      campo: 'protocolo',
      mensagem: 'O protocolo já foi conferido (ou cancelado): não se cancela mais.',
    });
  if (!motivo?.trim()) r.push({ campo: 'motivo', mensagem: 'O cancelamento exige o motivo.' });
  return r;
}

// ---------------------------------------------------------------------------------------------------------- empréstimo

export type SituacaoVolumeEmprestimo =
  'aberto' | 'encerrado' | 'arquivado' | 'emprestado' | 'extraviado' | 'eliminado';

/** O volume pode sair por empréstimo? Tem de estar no local de guarda e não eliminado, extraviado ou já emprestado. */
export function conferirEmprestimo(v: {
  readonly situacao: SituacaoVolumeEmprestimo;
  readonly noLocal: boolean;
  readonly emprestimoAberto: boolean;
  /** O volume está num protocolo enviado e ainda não conferido. */
  readonly emTransito?: boolean;
}): ProblemaTramite[] {
  if (v.situacao === 'eliminado') return [{ campo: 'volume', mensagem: 'O volume foi eliminado.' }];
  if (v.situacao === 'extraviado') return [{ campo: 'volume', mensagem: 'O volume está extraviado.' }];
  if (v.situacao === 'emprestado' || v.emprestimoAberto)
    return [{ campo: 'volume', mensagem: 'O volume já está emprestado: registre a devolução antes.' }];
  if (v.emTransito)
    return [{ campo: 'volume', mensagem: 'O volume está em trânsito num protocolo ainda não recebido.' }];
  if (!v.noLocal)
    return [{ campo: 'volume', mensagem: 'O volume não está no arquivo (fora do local de guarda).' }];
  return [];
}

/** O prazo de devolução: o informado, ou o do motivo, ou o padrão do arquivo, contado da saída (fim do dia não: o instante). */
export function prazoDoEmprestimo(
  emprestadoEm: Date,
  dias: { readonly informado: number | null; readonly doMotivo: number | null; readonly padrao: number },
): Date {
  const d = dias.informado ?? dias.doMotivo ?? dias.padrao;
  const n = Math.max(1, Math.min(365, Math.trunc(d)));
  return new Date(emprestadoEm.getTime() + n * 86_400_000);
}

/** Dias de atraso da devolução (0 no prazo ou já devolvido). */
export function diasDeAtraso(prazo: Date, devolvidoEm: Date | null, agora: Date): number {
  if (devolvidoEm !== null) return 0;
  const ms = agora.getTime() - prazo.getTime();
  return ms > 0 ? Math.ceil(ms / 86_400_000) : 0;
}

export type SituacaoSolicitacao =
  'pendente' | 'em_atendimento' | 'atendida' | 'atendida_parcial' | 'cancelada';

/** A situação da solicitação depois do atendimento: todos os volumes pedidos entregues = atendida; parte = parcial. */
export function situacaoDaSolicitacao(pedidos: number, entregues: number): SituacaoSolicitacao {
  if (entregues <= 0) return 'pendente';
  return entregues >= pedidos ? 'atendida' : 'atendida_parcial';
}

/** A solicitação ainda pode ser atendida ou cancelada? */
export function conferirSolicitacaoAberta(situacao: SituacaoSolicitacao): ProblemaTramite[] {
  return situacao === 'pendente' || situacao === 'em_atendimento'
    ? []
    : [{ campo: 'solicitacao', mensagem: 'A solicitação já foi atendida ou cancelada.' }];
}

// ------------------------------------------------------------------------- custódia única (trilha da guarda, F3.9-4)
// A posse do volume tem uma fonte só: o movimento da guarda (movimento_prontuario). O empréstimo e o protocolo gravam o
// movimento; o empréstimo é o documento do pedido (motivo, prazo, cobrança) preso ao movimento de saída.

/** Onde o volume está: no arquivo (local) ou com um setor (o destino do último movimento). */
export interface PosseVolume {
  readonly situacao: SituacaoVolumeEmprestimo;
  readonly noLocal: boolean;
  readonly localArquivo: number | null;
  readonly setorAtual: number | null;
  /** Há saída da guarda sem retorno (empréstimo pelo trâmite ou pela guarda). */
  readonly saidaAberta: boolean;
  /** O volume está num protocolo enviado e ainda não conferido. */
  readonly emTransito: boolean;
}

/** O lado do trâmite: o setor funcional e o arquivo a que o setor de trâmite responde. */
export interface PontaTramite {
  readonly setor: number | null;
  readonly local: number | null;
}

/** O volume pode ir no lote? Tem de estar com o remetente, fora de empréstimo e de outro lote em trânsito; e o
 * destinatário tem de ter setor ou arquivo para registrar a nova posse. */
export function conferirVolumeNoProtocolo(
  v: PosseVolume,
  remetente: PontaTramite,
  destinatario: PontaTramite,
): string[] {
  if (v.situacao === 'eliminado') return ['O volume foi eliminado.'];
  if (v.situacao === 'extraviado') return ['O volume está extraviado.'];
  if (v.situacao === 'emprestado' || v.saidaAberta)
    return ['O volume está emprestado: registre a devolução antes de enviá-lo.'];
  if (v.emTransito) return ['O volume já está em outro protocolo ainda não recebido.'];
  const r: string[] = [];
  const comRemetente = v.noLocal
    ? remetente.local !== null && remetente.local === v.localArquivo
    : v.setorAtual !== null && remetente.setor === v.setorAtual;
  if (!comRemetente) r.push('O volume não está com o setor remetente.');
  if (destinatario.setor === null && destinatario.local === null)
    r.push('O setor de destino não tem setor nem arquivo vinculado para receber o volume.');
  return r;
}

/** A nova posse do volume recebido no protocolo: no arquivo do destinatário, ou com o setor dele. A situação fica. */
export function posseAoReceber(
  v: Pick<PosseVolume, 'situacao' | 'localArquivo'>,
  destinatario: PontaTramite,
): {
  readonly situacao: SituacaoVolumeEmprestimo;
  readonly noLocal: boolean;
  readonly localArquivo: number | null;
} {
  return destinatario.local !== null
    ? { situacao: v.situacao, noLocal: true, localArquivo: destinatario.local }
    : { situacao: v.situacao, noLocal: false, localArquivo: v.localArquivo };
}

/** A situação do volume na volta do empréstimo: a de antes da saída (aberto, encerrado ou arquivado); sem registro
 * dela (empréstimo antigo ou pela guarda), arquivado. */
export function situacaoAposDevolucao(anterior: string | null): SituacaoVolumeEmprestimo {
  return anterior === 'aberto' || anterior === 'encerrado' || anterior === 'arquivado'
    ? anterior
    : 'arquivado';
}

export type SituacaoItemSolicitacao = 'pendente' | 'atendido' | 'nao_localizado' | 'emprestado' | 'cancelado';

/** A situação da solicitação pelos itens: com pendente e algum já tratado, em atendimento; sem pendente, atendida (tudo
 * entregue), atendida em parte (algum não localizado) ou cancelada (nada a entregar). */
export function situacaoDaSolicitacaoPelosItens(
  itens: readonly SituacaoItemSolicitacao[],
): SituacaoSolicitacao {
  const validos = itens.filter((i) => i !== 'cancelado');
  const pendentes = validos.filter((i) => i === 'pendente').length;
  const entregues = validos.filter((i) => i === 'emprestado' || i === 'atendido').length;
  if (validos.length === 0) return 'cancelada';
  if (pendentes > 0) return pendentes === validos.length ? 'pendente' : 'em_atendimento';
  if (entregues === validos.length) return 'atendida';
  return entregues > 0 ? 'atendida_parcial' : 'cancelada';
}

/** O cancelamento da solicitação: só aberta e com motivo (os itens pendentes ficam cancelados; nada se apaga). */
export function conferirCancelamentoSolicitacao(
  situacao: SituacaoSolicitacao,
  motivo: string | null,
): ProblemaTramite[] {
  const r = conferirSolicitacaoAberta(situacao);
  if (!motivo?.trim()) r.push({ campo: 'motivo', mensagem: 'O cancelamento exige o motivo.' });
  return r;
}

/** O item não localizado: só item pendente de solicitação aberta, com a observação de onde se procurou. */
export function conferirNaoLocalizado(
  situacao: SituacaoSolicitacao,
  item: SituacaoItemSolicitacao,
  motivo: string | null,
): ProblemaTramite[] {
  const r = conferirSolicitacaoAberta(situacao);
  if (item !== 'pendente')
    r.push({ campo: 'item', mensagem: 'Só o item pendente pode ficar não localizado.' });
  if (!motivo?.trim()) r.push({ campo: 'motivo', mensagem: 'Diga onde o volume foi procurado.' });
  return r;
}

// ------------------------------------------------------------------- autorização da solicitação pelo motivo (L128)
// O motivo que exige autorização (pesquisa, processo judicial) deixa a solicitação aguardando a decisão do responsável
// do arquivo; o volume só sai depois de autorizada. Quem decide fica gravado com o instante e a justificativa
// (obrigatória na negativa), e quem pediu não autoriza o próprio pedido (CFM 1.638/2002; LGPD, art. 11).

export type SituacaoAutorizacao = 'aguardando' | 'autorizada' | 'negada';
export type DecisaoAutorizacao = 'autorizar' | 'negar';

/** A autorização com que a solicitação nasce: aguardando, se o motivo exige; nula, se não. */
export function autorizacaoAoSolicitar(exigeAutorizacao: boolean): SituacaoAutorizacao | null {
  return exigeAutorizacao ? 'aguardando' : null;
}

/** A decisão do responsável: solicitação aberta e aguardando, outro usuário que não o solicitante, negativa com motivo. */
export function conferirDecisaoAutorizacao(p: {
  readonly situacao: SituacaoSolicitacao;
  readonly autorizacao: SituacaoAutorizacao | null;
  readonly decisao: DecisaoAutorizacao;
  readonly justificativa: string | null;
  readonly solicitante: number;
  readonly responsavel: number;
}): ProblemaTramite[] {
  const r = conferirSolicitacaoAberta(p.situacao);
  if (p.autorizacao === null)
    r.push({ campo: 'solicitacao', mensagem: 'O motivo desta solicitação não exige autorização.' });
  else if (p.autorizacao !== 'aguardando')
    r.push({ campo: 'solicitacao', mensagem: 'A autorização desta solicitação já foi decidida.' });
  if (p.solicitante === p.responsavel)
    r.push({ campo: 'responsavel', mensagem: 'Quem pediu o prontuário não autoriza o próprio pedido.' });
  if (p.decisao === 'negar' && !p.justificativa?.trim())
    r.push({ campo: 'justificativa', mensagem: 'A negativa exige a justificativa.' });
  return r;
}

/** A entrega (empréstimo) diante da autorização: nada sai aguardando ou negado; motivo que exige, só autorizado. */
export function conferirAutorizacaoDaEntrega(p: {
  readonly exigeAutorizacao: boolean;
  readonly autorizacao: SituacaoAutorizacao | null;
  readonly comSolicitacao: boolean;
}): ProblemaTramite[] {
  if (p.autorizacao === 'aguardando')
    return [
      { campo: 'solicitacao', mensagem: 'A solicitação aguarda a autorização do responsável do arquivo.' },
    ];
  if (p.autorizacao === 'negada')
    return [{ campo: 'solicitacao', mensagem: 'A autorização desta solicitação foi negada.' }];
  if (p.exigeAutorizacao && p.autorizacao !== 'autorizada')
    return [
      {
        campo: 'motivo',
        mensagem: p.comSolicitacao
          ? 'A solicitação não tem a autorização que o motivo exige.'
          : 'O motivo exige autorização: registre a solicitação e aguarde a decisão do responsável.',
      },
    ];
  return [];
}
