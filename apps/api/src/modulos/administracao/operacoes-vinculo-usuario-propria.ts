// Vínculo da conta ao estabelecimento no banco próprio (01-ADM L59), pelo Executor (trilha, saída e idempotência na
// mesma transação): dar acesso a este estabelecimento a uma conta que já existe no cliente (vínculo + perfil
// principal numa gravação só, sem criar conta nova) e encerrar esse acesso (a vigência fecha ontem; o que começou
// hoje é anulado por exclusão lógica; nada é apagado). As regras ficam no domínio (`@sgh/dominio-acesso`,
// vinculo-estabelecimento.ts); aqui só a leitura do fato e a gravação.
// Nenhum log nem trilha leva login, nome ou CPF: só ids.
import { esquemaLogin } from '@sgh/contratos';
import {
  conferirVinculoEstabelecimento,
  MENSAGEM_VINCULO_ESTABELECIMENTO,
  planoEncerramentoVinculo,
  type RecusaVinculoEstabelecimento,
} from '@sgh/dominio-acesso';
import { definirOperacao, recusa, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';

const num = (v: unknown): number => Number(v);
const recusar = (r: RecusaVinculoEstabelecimento) => recusa(r, MENSAGEM_VINCULO_ESTABELECIMENTO[r]);
const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const diaIso = (v: unknown): string =>
  iso(v instanceof Date ? v : new Date(`${String(v).slice(0, 10)}T12:00:00`));

const VIGENTE = `excluido_em IS NULL AND vigencia_inicio <= CURRENT_DATE AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)`;

/** A conta pelo login, travada (qualquer estabelecimento do cliente). */
async function contaPeloLogin(
  tx: TxOperacao,
  login: string,
): Promise<{ id: number; situacao: string } | null> {
  const [u] = await tx.consultarParaAtualizar(
    'SELECT id, situacao FROM usuario WHERE login = ? AND excluido_em IS NULL',
    [login],
    { teto: 1 },
  );
  return u ? { id: num(u['id']), situacao: String(u['situacao'] ?? '') } : null;
}

/** Linhas vigentes da conta numa tabela de vigência, travadas (as deste estabelecimento ou as dos outros). */
async function vigentes(
  tx: TxOperacao,
  tabela: 'usuario_estabelecimento' | 'usuario_perfil',
  usuario: number,
  estabelecimento: number,
  outros = false,
): Promise<{ id: number; versao: number; inicio: string; padrao: boolean; perfil: number }[]> {
  const linhas = await tx.consultarParaAtualizar(
    `SELECT * FROM ${tabela} WHERE usuario_id = ? AND estabelecimento_id ${outros ? '<>' : '='} ? AND ${VIGENTE} ORDER BY id`,
    [usuario, estabelecimento],
    { teto: 200 },
  );
  return linhas.map((l) => ({
    id: num(l['id']),
    versao: num(l['versao']),
    inicio: diaIso(l['vigencia_inicio']),
    padrao: l['padrao'] === true || num(l['padrao']) === 1,
    perfil: num(l['perfil_acesso_id'] ?? 0),
  }));
}

/** Fecha a vigência no dia anterior, ou anula por exclusão lógica a linha que começou hoje. */
async function fecharOuAnular(
  tx: TxOperacao,
  tabela: 'usuario_estabelecimento' | 'usuario_perfil',
  linha: { id: number; versao: number; inicio: string },
  hoje: string,
  ontem: string,
  extras: Record<string, unknown> = {},
): Promise<void> {
  await tx.alterar(
    tabela,
    linha.id,
    linha.versao,
    linha.inicio >= hoje
      ? { ...extras, excluido_em: new Date(), excluido_por: tx.contexto.usuario }
      : { ...extras, vigencia_fim: ontem },
  );
}

const operacaoVincular = definirOperacao({
  nome: 'acesso.vincular_estabelecimento_usuario',
  tabelas: ['usuario_estabelecimento', 'usuario_perfil'],
  entrada: z.object({ login: esquemaLogin, grupo: z.string().trim().min(1).max(60) }).strict(),
  async gravar(tx, e, ctx) {
    const est = num(ctx.estabelecimento);
    const u = await contaPeloLogin(tx, e.login);
    const aqui = u ? await vigentes(tx, 'usuario_estabelecimento', u.id, est) : [];
    const g = await tx.uma(
      `SELECT id, ativo FROM perfil_acesso WHERE codigo = ? AND excluido_em IS NULL
         AND (estabelecimento_id IS NULL OR estabelecimento_id = ?) ORDER BY estabelecimento_id IS NULL, id LIMIT 1`,
      [e.grupo, est],
    );
    const r = conferirVinculoEstabelecimento({
      situacaoConta: u ? u.situacao : null,
      jaVinculada: aqui.length > 0,
      grupoAtivo: g ? g['ativo'] === true || num(g['ativo']) === 1 : null,
    });
    if (r || !u || !g) throw recusar(r ?? 'usuario-inexistente');
    const agora = new Date();
    const hoje = iso(agora);
    const ontem = iso(new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - 1));
    const outros = await vigentes(tx, 'usuario_estabelecimento', u.id, est, true);
    const vinculo = await tx.incluir('usuario_estabelecimento', {
      usuario_id: u.id,
      estabelecimento_id: est,
      // Entrada após o login: só se a conta não tem outro estabelecimento vigente.
      padrao: outros.length === 0,
      vigencia_inicio: hoje,
    });
    // Perfil que tenha sobrado vigente neste estabelecimento: o do grupo pedido fica; os outros fecham.
    let perfil = 0;
    for (const p of await vigentes(tx, 'usuario_perfil', u.id, est)) {
      if (p.perfil === num(g['id']) && perfil === 0) perfil = p.id;
      else await fecharOuAnular(tx, 'usuario_perfil', p, hoje, ontem);
    }
    if (perfil === 0)
      perfil = await tx.incluir('usuario_perfil', {
        usuario_id: u.id,
        perfil_acesso_id: num(g['id']),
        estabelecimento_id: est,
        vigencia_inicio: hoje,
      });
    return { idUsuario: u.id, vinculo, perfil };
  },
  alvo: (_e, r) => ({ tabela: 'usuario_estabelecimento', id: r.vinculo }),
  eventos: (_e, r) => [
    {
      tipo: 'acesso.usuario.estabelecimento_vinculado',
      carga: { idUsuario: r.idUsuario, vinculo: r.vinculo },
    },
  ],
  trilha: (_e, r) => ({ dados: { idUsuario: r.idUsuario, perfil: r.perfil } }),
});

const operacaoEncerrar = definirOperacao({
  nome: 'acesso.encerrar_vinculo_usuario',
  tabelas: ['usuario_estabelecimento', 'usuario_perfil'],
  entrada: z.object({ login: esquemaLogin }).strict(),
  async gravar(tx, e, ctx) {
    const est = num(ctx.estabelecimento);
    const u = await contaPeloLogin(tx, e.login);
    if (!u) throw recusar('usuario-inexistente');
    const aqui = await vigentes(tx, 'usuario_estabelecimento', u.id, est);
    const outros = await vigentes(tx, 'usuario_estabelecimento', u.id, est, true);
    const agora = new Date();
    const hoje = iso(agora);
    const ontem = iso(new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - 1));
    const plano = planoEncerramentoVinculo({
      inicio: aqui[0]?.inicio ?? null,
      hoje,
      proprio: num(ctx.usuario) === u.id,
      outrosVigentes: outros.length,
    });
    if ('recusa' in plano) throw recusar(plano.recusa);
    const eraPadrao = aqui.some((v) => v.padrao);
    for (const v of aqui)
      await fecharOuAnular(tx, 'usuario_estabelecimento', v, hoje, ontem, { padrao: false });
    const perfis = await vigentes(tx, 'usuario_perfil', u.id, est);
    for (const p of perfis) await fecharOuAnular(tx, 'usuario_perfil', p, hoje, ontem);
    // A entrada após o login passa para o vínculo vigente mais antigo, se o encerrado era o de entrada.
    const novoPadrao = eraPadrao && !outros.some((v) => v.padrao) ? outros[0] : undefined;
    if (novoPadrao)
      await tx.alterar('usuario_estabelecimento', novoPadrao.id, novoPadrao.versao, { padrao: true });
    return {
      idUsuario: u.id,
      vinculo: aqui[0]!.id,
      modo: plano.modo,
      perfis: perfis.length,
      novoPadrao: novoPadrao?.id ?? null,
    };
  },
  alvo: (_e, r) => ({ tabela: 'usuario_estabelecimento', id: r.vinculo }),
  eventos: (_e, r) => [
    {
      tipo: 'acesso.usuario.estabelecimento_encerrado',
      carga: { idUsuario: r.idUsuario, vinculo: r.vinculo },
    },
  ],
  trilha: (_e, r) => ({
    dados: { idUsuario: r.idUsuario, modo: r.modo, perfis: r.perfis, novoPadrao: r.novoPadrao },
  }),
});

/** Receitas do vínculo ao estabelecimento ligadas no banco próprio (o mapa OPERACOES da fonte própria as soma). */
export const OPERACOES_VINCULO_USUARIO_PROPRIA = {
  'acesso.vincularEstabelecimentoUsuario': operacaoVincular,
  'acesso.encerrarVinculoUsuario': operacaoEncerrar,
} as const;

export const NOMES_OPERACOES_VINCULO_USUARIO_PROPRIA = Object.keys(OPERACOES_VINCULO_USUARIO_PROPRIA);
