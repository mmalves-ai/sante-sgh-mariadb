// RECERTIFICAÇÃO DE ACESSOS no banco próprio (01-ADM L57, 2ª volta da F3): abrir a campanha com uma linha por conta do
// retrato (recertificacao_acesso + recertificacao_acesso_item), decidir cada conta uma vez só (com o validador do
// domínio sobre a campanha e o item relidos sob trava) e encerrar ou cancelar a campanha uma vez só. Nada se apaga: a
// decisão fica na linha do item (quem, quando, o motivo), o fechamento na linha da campanha, com a trilha pelo Executor.
// Os perfis de cada conta são os vigentes no dia da abertura, lidos do histórico de usuario_perfil (que nunca se apaga).
// Escopo: "grupo" grava o perfil revisado (escopo perfil), "setor" o setor funcional e "todos" nenhum alvo.
// Decisão: manter; retirar com bloqueio = revogar a conta; retirar com revogação de um perfil = reduzir. O efeito
// (bloqueio ou revogação) é aplicado pelo controlador na mesma requisição, como na memória.
import { ErroOperacao, type Linha, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import type { TrilhaGestao } from './gestao-tipos.js';
import type { GravarGestao, LerGestao } from './pedido-acesso-propria.js';
import {
  type CampanhaRecertLida,
  type DecisaoRecertGravar,
  type FechamentoRecertGravar,
  ITENS_RECERT_MAXIMO,
  type ItemRecertLido,
  type NovaCampanhaRecertGravar,
  type ValidarDecisaoRecert,
} from './tipos-gestao-acesso.js';

const recusa = (codigo: string, detalhe: string) =>
  new ErroOperacao(409, codigo, 'Operação recusada', detalhe);
const num = (v: unknown): number => Number(v);
const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const txtOuNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const data = (v: unknown): Date | null => (v instanceof Date ? v : v ? new Date(String(v)) : null);
const TETO = ITENS_RECERT_MAXIMO + 10;
const LOTE = 500;

const ESCOPO_BANCO = { grupo: 'perfil', setor: 'setor', todos: 'todos' } as const;
const ESCOPO_TELA = new Map(
  Object.entries(ESCOPO_BANCO).map(([t, b]) => [b, t as keyof typeof ESCOPO_BANCO]),
);

const SQL_CAMPANHA = `SELECT c.id, c.escopo, COALESCE(pf.codigo, sf.codigo) AS alvo, DATE_FORMAT(c.prazo, '%Y-%m-%d') AS prazo,
       c.motivo, c.situacao, uc.login AS criado_por, c.aberta_em, uf.login AS fechado_por, c.fechada_em, c.motivo_fechamento
  FROM recertificacao_acesso c
  LEFT JOIN perfil_acesso pf ON pf.id = c.perfil_acesso_id
  LEFT JOIN setor_funcional sf ON sf.id = c.setor_funcional_id
  LEFT JOIN usuario uc ON uc.id = c.criado_por
  LEFT JOIN usuario uf ON uf.id = c.fechada_por_usuario_id
 WHERE c.estabelecimento_id = ? AND c.excluido_em IS NULL`;

function campanhaDaLinha(x: Linha): CampanhaRecertLida {
  return {
    id: String(x['id']),
    escopo: ESCOPO_TELA.get(txt(x['escopo']) as 'perfil' | 'setor' | 'todos') ?? 'todos',
    alvo: txtOuNull(x['alvo']),
    prazo: txt(x['prazo']),
    motivo: txt(x['motivo']),
    situacao: txt(x['situacao']) as CampanhaRecertLida['situacao'],
    criadoPor: txt(x['criado_por']),
    criadoEm: data(x['aberta_em']),
    fechadoPor: txtOuNull(x['fechado_por']),
    fechadoEm: data(x['fechada_em']),
    motivoFechamento: txtOuNull(x['motivo_fechamento']),
  };
}

/** Os itens com os perfis vigentes no dia da abertura (histórico de usuario_perfil). */
const SQL_ITENS = `SELECT i.id, i.versao, u.login, i.decisao, i.acao, pf.codigo AS perfil, i.motivo, ud.login AS decidido_por,
       i.decidido_em,
       (SELECT GROUP_CONCAT(DISTINCT p2.codigo ORDER BY p2.codigo) FROM usuario_perfil up
          JOIN perfil_acesso p2 ON p2.id = up.perfil_acesso_id
         WHERE up.usuario_id = i.usuario_id AND up.estabelecimento_id = c.estabelecimento_id AND up.excluido_em IS NULL
           AND up.vigencia_inicio <= DATE(c.aberta_em) AND (up.vigencia_fim IS NULL OR up.vigencia_fim >= DATE(c.aberta_em))
       ) AS perfis
  FROM recertificacao_acesso_item i
  JOIN recertificacao_acesso c ON c.id = i.recertificacao_acesso_id
  JOIN usuario u ON u.id = i.usuario_id
  LEFT JOIN perfil_acesso pf ON pf.id = i.perfil_acesso_id
  LEFT JOIN usuario ud ON ud.id = i.decidido_por_usuario_id
 WHERE i.recertificacao_acesso_id = ? AND i.excluido_em IS NULL`;

function itemDaLinha(x: Linha): ItemRecertLido {
  const decisao = txtOuNull(x['decisao']);
  return {
    id: String(x['id']),
    login: txt(x['login']),
    grupo: null,
    perfis: txt(x['perfis'])
      .split(',')
      .filter((s) => s !== ''),
    decisao: decisao === null ? null : decisao === 'manter' ? 'manter' : 'retirar',
    acao: txtOuNull(x['acao']) as ItemRecertLido['acao'],
    perfil: txtOuNull(x['perfil']),
    motivo: txtOuNull(x['motivo']),
    decididoPor: txtOuNull(x['decidido_por']),
    decididoEm: data(x['decidido_em']),
  };
}

const ID = z.string().regex(/^\d{1,18}$/);
const ESQUEMA_ABRIR = z.object({
  escopo: z.enum(['grupo', 'setor', 'todos']),
  alvo: z.string().max(60).nullable(),
  prazo: z.string().max(10),
  motivo: z.string().max(500),
  hoje: z.string().max(10),
  itens: z.array(z.object({ login: z.string().min(1).max(60) })).max(ITENS_RECERT_MAXIMO + 1),
});
const ESQUEMA_DECIDIR = z.object({
  campanha: ID,
  login: z.string().min(1).max(60),
  decisao: z.enum(['manter', 'retirar']),
  acao: z.enum(['bloqueio', 'revogacao']).nullable(),
  perfil: z.string().max(60).nullable(),
  motivo: z.string().max(500),
});
const ESQUEMA_FECHAR = z.object({
  campanha: ID,
  situacao: z.enum(['encerrada', 'cancelada']),
  motivo: z.string().max(500),
});

async function campanhaTravada(tx: TxOperacao, est: number, id: string) {
  const [c] = await tx.consultarParaAtualizar(
    'SELECT id, situacao, versao FROM recertificacao_acesso WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [id, est],
    { teto: 1 },
  );
  if (!c) throw recusa('campanha-inexistente', 'Campanha de recertificação não encontrada.');
  return c;
}

export class RecertificacaoPropria {
  constructor(
    private readonly ler: LerGestao,
    private readonly gravar: GravarGestao,
  ) {}

  campanhasRecert(hospital: string): Promise<CampanhaRecertLida[]> {
    return this.ler(hospital, async (l, est) =>
      (await l.consultar(`${SQL_CAMPANHA} ORDER BY c.id DESC`, [est], { teto: 1000 })).map(campanhaDaLinha),
    );
  }

  campanhaRecert(
    hospital: string,
    id: string,
  ): Promise<{ campanha: CampanhaRecertLida; itens: ItemRecertLido[] } | null> {
    if (!/^\d{1,18}$/.test(id)) return Promise.resolve(null);
    return this.ler(hospital, async (l, est) => {
      const c = await l.uma(`${SQL_CAMPANHA} AND c.id = ?`, [est, id]);
      if (!c) return null;
      const itens = await l.consultar(`${SQL_ITENS} ORDER BY i.sequencia`, [id], { teto: TETO });
      return { campanha: campanhaDaLinha(c), itens: itens.map(itemDaLinha) };
    });
  }

  abrirCampanhaRecert(
    hospital: string,
    p: NovaCampanhaRecertGravar,
    t: TrilhaGestao,
  ): Promise<{ id: string; itens: number }> {
    const entrada = {
      escopo: p.escopo,
      alvo: p.escopo === 'todos' ? null : (p.alvo ?? '').trim(),
      prazo: p.prazo,
      motivo: p.motivo.trim(),
      hoje: p.hoje,
      itens: p.itens.map((i) => ({ login: i.login })),
    };
    return this.gravar(
      {
        nome: 'acesso.recertificacao.abrir',
        tabelas: ['recertificacao_acesso', 'recertificacao_acesso_item'],
        esquema: ESQUEMA_ABRIR,
        alvo: 'recertificacao_acesso',
        motivo: (e) => e.motivo,
        dados: (e) => ({ escopo: e.escopo, alvo: e.alvo, prazo: e.prazo, itens: e.itens.length }),
      },
      hospital,
      t,
      entrada,
      async (tx, e, est, operador) => {
        if (e.escopo !== 'todos' && !e.alvo)
          throw recusa('escopo-invalido', 'Escolha o escopo: um grupo, um setor ou todas as contas.');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(e.prazo) || e.prazo <= e.hoje)
          throw recusa('prazo-invalido', 'O prazo tem de ser uma data depois de hoje.');
        if (e.motivo.length < 10)
          throw recusa('motivo-curto', 'Justifique a campanha (ao menos 10 caracteres).');
        if (e.itens.length === 0)
          throw recusa('escopo-vazio', 'Nenhuma conta ativa neste escopo: não há o que recertificar.');
        if (e.itens.length > ITENS_RECERT_MAXIMO)
          throw recusa(
            'escopo-grande',
            `O escopo passa de ${ITENS_RECERT_MAXIMO} contas: divida a campanha por grupo ou setor.`,
          );
        let perfil: number | null = null;
        let setor: number | null = null;
        if (e.escopo === 'grupo') {
          const pf = await tx.uma(
            `SELECT id FROM perfil_acesso WHERE codigo = ? AND (estabelecimento_id = ? OR estabelecimento_id IS NULL)
               AND excluido_em IS NULL ORDER BY estabelecimento_id IS NULL LIMIT 1`,
            [e.alvo, est],
          );
          if (!pf) throw recusa('alvo-inexistente', 'O perfil escolhido não existe neste estabelecimento.');
          perfil = num(pf['id']);
        } else if (e.escopo === 'setor') {
          const sf = await tx.uma(
            'SELECT id FROM setor_funcional WHERE codigo = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
            [e.alvo, est],
          );
          if (!sf) throw recusa('alvo-inexistente', 'O setor escolhido não existe neste estabelecimento.');
          setor = num(sf['id']);
        }
        // As contas do retrato, conferidas no estabelecimento (vínculo vigente), na ordem do login.
        const logins = [...new Set(e.itens.map((i) => i.login))].sort();
        const ids = new Map<string, number>();
        for (let i = 0; i < logins.length; i += LOTE) {
          const lote = logins.slice(i, i + LOTE);
          const linhas = await tx.consultar(
            `SELECT u.id, u.login FROM usuario u WHERE u.login IN (${lote.map(() => '?').join(',')})
               AND u.excluido_em IS NULL AND EXISTS (SELECT 1 FROM usuario_estabelecimento ue
                 WHERE ue.usuario_id = u.id AND ue.estabelecimento_id = ? AND ue.excluido_em IS NULL)`,
            [...lote, est],
            { teto: LOTE },
          );
          for (const x of linhas) ids.set(txt(x['login']), num(x['id']));
        }
        const fora = logins.filter((l) => !ids.has(l));
        if (fora.length > 0)
          throw recusa('conta-fora', `${fora.length} conta(s) do retrato sem vínculo neste estabelecimento.`);
        const agora = new Date();
        const id = await tx.inserir(
          `INSERT INTO recertificacao_acesso (estabelecimento_id, escopo, perfil_acesso_id, setor_funcional_id, aberta_em,
             prazo, motivo, situacao, criado_em, criado_por) VALUES (?, ?, ?, ?, ?, ?, ?, 'aberta', ?, ?)`,
          [est, ESCOPO_BANCO[e.escopo], perfil, setor, agora, e.prazo, e.motivo, agora, operador],
        );
        for (let i = 0; i < logins.length; i += LOTE) {
          const lote = logins.slice(i, i + LOTE);
          await tx.executar(
            `INSERT INTO recertificacao_acesso_item (recertificacao_acesso_id, sequencia, usuario_id, criado_em, criado_por)
             VALUES ${lote.map(() => '(?, ?, ?, ?, ?)').join(', ')}`,
            lote.flatMap((l, k) => [id, i + k + 1, ids.get(l), agora, operador]),
          );
        }
        return { resultado: { id, itens: logins.length } };
      },
    ).then((r) => ({ id: String(r.id), itens: r.itens }));
  }

  decidirRecert(
    hospital: string,
    p: DecisaoRecertGravar,
    t: TrilhaGestao,
    validar: ValidarDecisaoRecert,
  ): Promise<{ item: string }> {
    const entrada = {
      campanha: p.campanha,
      login: p.login,
      decisao: p.decisao,
      acao: p.acao,
      perfil: p.perfil,
      motivo: p.motivo.trim(),
    };
    return this.gravar(
      {
        nome: 'acesso.recertificacao.decidir',
        tabelas: ['recertificacao_acesso_item'],
        esquema: ESQUEMA_DECIDIR,
        alvo: 'recertificacao_acesso_item',
        motivo: (e) => e.motivo || null,
        dados: (e) => ({
          campanha: e.campanha,
          login: e.login,
          decisao: e.decisao,
          acao: e.acao,
          perfil: e.perfil,
        }),
      },
      hospital,
      t,
      entrada,
      async (tx, e, est, operador) => {
        const c = await campanhaTravada(tx, est, e.campanha);
        const [x] = await tx.consultarParaAtualizar(`${SQL_ITENS} AND u.login = ?`, [e.campanha, e.login], {
          teto: 1,
        });
        if (!x) throw recusa('item-inexistente', 'Esta conta não faz parte da campanha.');
        if (txt(c['situacao']) !== 'aberta')
          throw recusa('campanha-fechada', 'Esta campanha já foi encerrada ou cancelada.');
        const item = itemDaLinha(x);
        if (item.decisao !== null)
          throw recusa('ja-decidido', 'Esta conta já foi decidida nesta campanha (a decisão é definitiva).');
        const r = validar('aberta', item);
        if (r) throw recusa(r.codigo, r.mensagem);
        let perfil: number | null = null;
        if (e.decisao === 'retirar' && e.acao === 'revogacao' && e.perfil) {
          const pf = await tx.uma(
            `SELECT id FROM perfil_acesso WHERE codigo = ? AND (estabelecimento_id = ? OR estabelecimento_id IS NULL)
               AND excluido_em IS NULL ORDER BY estabelecimento_id IS NULL LIMIT 1`,
            [e.perfil, est],
          );
          if (!pf) throw recusa('perfil-inexistente', 'O perfil escolhido não existe neste estabelecimento.');
          perfil = num(pf['id']);
        }
        const decisao = e.decisao === 'manter' ? 'manter' : e.acao === 'bloqueio' ? 'revogar' : 'reduzir';
        const agora = new Date();
        await tx.executar(
          `UPDATE recertificacao_acesso_item SET decisao = ?, acao = ?, perfil_acesso_id = ?, motivo = ?,
                  decidido_por_usuario_id = ?, decidido_em = ?, alterado_em = ?, alterado_por = ?, versao = versao + 1
            WHERE id = ? AND decisao IS NULL`,
          [
            decisao,
            e.decisao === 'manter' ? null : e.acao,
            perfil,
            e.motivo || null,
            operador,
            agora,
            agora,
            operador,
            num(item.id),
          ],
        );
        return { resultado: { id: num(item.id) }, antes: { decisao: null } };
      },
    ).then((r) => ({ item: String(r.id) }));
  }

  fecharCampanhaRecert(
    hospital: string,
    p: FechamentoRecertGravar,
    t: TrilhaGestao,
  ): Promise<{ id: string; situacao: 'encerrada' | 'cancelada'; pendentes: number }> {
    const entrada = { campanha: p.campanha, situacao: p.situacao, motivo: p.motivo.trim() };
    return this.gravar(
      {
        nome: 'acesso.recertificacao.fechar',
        tabelas: ['recertificacao_acesso'],
        esquema: ESQUEMA_FECHAR,
        alvo: 'recertificacao_acesso',
        motivo: (e) => e.motivo,
        dados: (e) => ({ situacao: e.situacao }),
      },
      hospital,
      t,
      entrada,
      async (tx, e, est, operador) => {
        if (e.motivo.length < 10)
          throw recusa('motivo-curto', 'Justifique o fechamento da campanha (ao menos 10 caracteres).');
        const c = await campanhaTravada(tx, est, e.campanha);
        if (txt(c['situacao']) !== 'aberta')
          throw recusa('campanha-fechada', 'Esta campanha já foi encerrada ou cancelada.');
        const pend = await tx.uma(
          `SELECT COUNT(*) AS n FROM recertificacao_acesso_item
            WHERE recertificacao_acesso_id = ? AND decisao IS NULL AND excluido_em IS NULL`,
          [e.campanha],
        );
        const agora = new Date();
        await tx.executar(
          `UPDATE recertificacao_acesso SET situacao = ?, fechada_em = ?, fechada_por_usuario_id = ?, motivo_fechamento = ?,
                  alterado_em = ?, alterado_por = ?, versao = versao + 1 WHERE id = ?`,
          [e.situacao, agora, operador, e.motivo, agora, operador, num(c['id'])],
        );
        return {
          resultado: { id: num(c['id']), situacao: e.situacao, pendentes: num(pend?.['n'] ?? 0) },
          antes: { situacao: 'aberta' },
        };
      },
    ).then((r) => ({ id: String(r.id), situacao: r.situacao, pendentes: r.pendentes }));
  }
}
