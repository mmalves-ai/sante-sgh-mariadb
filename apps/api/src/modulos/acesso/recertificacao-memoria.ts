// W1-01 (parte 9c2): a RECERTIFICAÇÃO na memória (dev/ci; E2E), como SGH_ACESSO_RECERT_CAMPANHA e _ITEM (SGH_ 1206)
// com as mesmas travas e recusas de legado/acesso/gravacao/recertificacao-sgh.ts: abrir com os itens do retrato,
// decidir uma vez só (com o validador do domínio), encerrar ou cancelar uma vez só. Nada se apaga. Nenhum dado real.
import {
  type CampanhaRecertLida,
  type DecisaoRecertGravar,
  ErroOperacao,
  type FechamentoRecertGravar,
  ITENS_RECERT_MAXIMO,
  type ItemRecertLido,
  type NovaCampanhaRecertGravar,
  type ValidarDecisaoRecert,
} from '@sgh/legado';

const recusa = (codigo: string, detalhe: string) =>
  new ErroOperacao(409, codigo, 'Operação recusada', detalhe);

type Mutavel<T> = { -readonly [K in keyof T]: T[K] };

export class RecertificacaoMemoria {
  private readonly campanhas: Mutavel<CampanhaRecertLida>[] = [];
  private readonly itens = new Map<string, Mutavel<ItemRecertLido>[]>();
  private seqItem = 0;

  lerCampanhas(): CampanhaRecertLida[] {
    return [...this.campanhas].reverse().map((c) => ({ ...c }));
  }

  lerCampanha(id: string): { campanha: CampanhaRecertLida; itens: ItemRecertLido[] } | null {
    const c = this.campanhas.find((x) => x.id === id);
    if (!c) return null;
    return {
      campanha: { ...c },
      itens: (this.itens.get(id) ?? []).map((i) => ({ ...i, perfis: [...i.perfis] })),
    };
  }

  abrir(p: NovaCampanhaRecertGravar): { id: string; itens: number } {
    if (!['grupo', 'setor', 'todos'].includes(p.escopo) || (p.escopo !== 'todos' && !(p.alvo ?? '').trim()))
      throw recusa('escopo-invalido', 'Escolha o escopo: um grupo, um setor ou todas as contas.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.prazo) || p.prazo <= p.hoje)
      throw recusa('prazo-invalido', 'O prazo tem de ser uma data depois de hoje.');
    if (p.motivo.trim().length < 10)
      throw recusa('motivo-curto', 'Justifique a campanha (ao menos 10 caracteres).');
    if (p.itens.length === 0)
      throw recusa('escopo-vazio', 'Nenhuma conta ativa neste escopo: não há o que recertificar.');
    if (p.itens.length > ITENS_RECERT_MAXIMO)
      throw recusa(
        'escopo-grande',
        `O escopo passa de ${ITENS_RECERT_MAXIMO} contas: divida a campanha por grupo ou setor.`,
      );
    const id = String(this.campanhas.length + 1);
    this.campanhas.push({
      id,
      escopo: p.escopo,
      alvo: p.escopo === 'todos' ? null : (p.alvo ?? '').trim(),
      prazo: p.prazo,
      motivo: p.motivo.trim(),
      situacao: 'aberta',
      criadoPor: p.por,
      criadoEm: new Date(),
      fechadoPor: null,
      fechadoEm: null,
      motivoFechamento: null,
    });
    this.itens.set(
      id,
      p.itens.map((it) => ({
        id: String(++this.seqItem),
        login: it.login,
        grupo: it.grupo,
        perfis: [...it.perfis],
        decisao: null,
        acao: null,
        perfil: null,
        motivo: null,
        decididoPor: null,
        decididoEm: null,
      })),
    );
    return { id, itens: p.itens.length };
  }

  decidir(
    p: DecisaoRecertGravar,
    validar: ValidarDecisaoRecert,
  ): {
    item: string;
    decisao: DecisaoRecertGravar['decisao'];
    acao: DecisaoRecertGravar['acao'];
    perfil: string | null;
  } {
    const c = this.campanhas.find((x) => x.id === p.campanha);
    if (!c) throw recusa('campanha-inexistente', 'Campanha de recertificação não encontrada.');
    const item = (this.itens.get(c.id) ?? []).find((i) => i.login === p.login);
    if (!item) throw recusa('item-inexistente', 'Esta conta não faz parte da campanha.');
    if (c.situacao !== 'aberta')
      throw recusa('campanha-fechada', 'Esta campanha já foi encerrada ou cancelada.');
    if (item.decisao !== null)
      throw recusa('ja-decidido', 'Esta conta já foi decidida nesta campanha (a decisão é definitiva).');
    const r = validar(c.situacao, { ...item, perfis: [...item.perfis] });
    if (r) throw recusa(r.codigo, r.mensagem);
    item.decisao = p.decisao;
    item.acao = p.acao;
    item.perfil = p.perfil;
    item.motivo = p.motivo.trim() || null;
    item.decididoPor = p.por;
    item.decididoEm = new Date();
    return { item: item.id, decisao: p.decisao, acao: p.acao, perfil: p.perfil };
  }

  fechar(p: FechamentoRecertGravar): { id: string; situacao: 'encerrada' | 'cancelada'; pendentes: number } {
    const motivo = p.motivo.trim();
    if (motivo.length < 10)
      throw recusa('motivo-curto', 'Justifique o fechamento da campanha (ao menos 10 caracteres).');
    const c = this.campanhas.find((x) => x.id === p.campanha);
    if (!c) throw recusa('campanha-inexistente', 'Campanha de recertificação não encontrada.');
    if (c.situacao !== 'aberta')
      throw recusa('campanha-fechada', 'Esta campanha já foi encerrada ou cancelada.');
    const pendentes = (this.itens.get(c.id) ?? []).filter((i) => i.decisao === null).length;
    c.situacao = p.situacao;
    c.fechadoPor = p.por;
    c.fechadoEm = new Date();
    c.motivoFechamento = motivo;
    return { id: c.id, situacao: p.situacao, pendentes };
  }
}
