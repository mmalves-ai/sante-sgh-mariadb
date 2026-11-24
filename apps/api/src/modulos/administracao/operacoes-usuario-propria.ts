// Gravações do cadastro da conta no banco próprio (01-ADM L57 e L59), pelo Executor (trilha, saída e idempotência na
// mesma transação; trava otimista pela versao): criar a conta (conta + vínculo ao estabelecimento + perfil principal
// numa gravação só), alterar o nome e o CPF, trocar o grupo (perfil principal, com histórico de vigência) e conceder
// ou retirar escopo (unidade, local de atendimento, convênio e tipo de prontuário; retirar é exclusão lógica, nunca
// apagamento). As regras ficam no domínio
// (`@sgh/dominio-acesso`, cadastro-usuario.ts); aqui só a leitura do fato e a gravação.
// Nenhum log nem trilha leva login, nome ou CPF: só ids e nomes de coluna (a troca de CPF leva a justificativa).
import {
  esquemaAlterarUsuario,
  esquemaCriarUsuario,
  esquemaEscopoUsuario,
  type TipoEscopo,
} from '@sgh/contratos';
import {
  conferirCriacaoUsuario,
  conferirEscopo,
  contaNova,
  MENSAGEM_CADASTRO_USUARIO,
  planoAlteracaoUsuario,
  planoTrocaGrupo,
  type RecusaCadastroUsuario,
} from '@sgh/dominio-acesso';
import { definirOperacao, erroConflitoVersao, recusa, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';

const num = (v: unknown): number => Number(v);
const recusar = (r: RecusaCadastroUsuario) => recusa(r, MENSAGEM_CADASTRO_USUARIO[r]);
const hoje = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const diaIso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** A conta pelo login, travada, com vínculo vigente ao estabelecimento do contexto. */
async function contaDoEstabelecimento(
  tx: TxOperacao,
  login: string,
): Promise<{ id: number; versao: number; nome: string; cpf: string | null }> {
  const [u] = await tx.consultarParaAtualizar(
    'SELECT id, versao, nome, cpf FROM usuario WHERE login = ? AND excluido_em IS NULL',
    [login],
    { teto: 1 },
  );
  if (!u) throw recusa('usuario-inexistente', 'Usuário inexistente.');
  const id = num(u['id']);
  const v = await tx.uma(
    `SELECT 1 AS ok FROM usuario_estabelecimento WHERE usuario_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL
       AND vigencia_inicio <= CURRENT_DATE AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)`,
    [id, tx.contexto.estabelecimento],
  );
  if (!v) throw recusa('usuario-inexistente', 'Usuário sem vínculo com este estabelecimento.');
  return {
    id,
    versao: num(u['versao']),
    nome: String(u['nome'] ?? ''),
    cpf: u['cpf'] === null || u['cpf'] === undefined ? null : String(u['cpf']),
  };
}

/** O grupo (perfil de acesso) pelo código, no estabelecimento do contexto ou geral. */
async function grupoPeloCodigo(
  tx: TxOperacao,
  codigo: string,
): Promise<{ id: number; ativo: boolean } | null> {
  const g = await tx.uma(
    `SELECT id, ativo FROM perfil_acesso WHERE codigo = ? AND excluido_em IS NULL
       AND (estabelecimento_id IS NULL OR estabelecimento_id = ?) ORDER BY estabelecimento_id IS NULL, id LIMIT 1`,
    [codigo, tx.contexto.estabelecimento],
  );
  return g ? { id: num(g['id']), ativo: g['ativo'] === true || num(g['ativo']) === 1 } : null;
}

const operacaoCriarUsuario = definirOperacao({
  nome: 'acesso.criar_usuario',
  tabelas: ['usuario', 'usuario_estabelecimento', 'usuario_perfil'],
  entrada: esquemaCriarUsuario,
  async gravar(tx, e, ctx) {
    const conta = contaNova(e);
    const login = await tx.uma('SELECT id FROM usuario WHERE login = ?', [conta.login]);
    const cpf = conta.cpf ? await tx.uma('SELECT id FROM usuario WHERE cpf = ?', [conta.cpf]) : null;
    const grupo = await grupoPeloCodigo(tx, e.grupo);
    const r = conferirCriacaoUsuario({
      loginEmUso: login !== null,
      cpfEmUso: cpf !== null,
      grupoAtivo: grupo === null ? null : grupo.ativo,
    });
    if (r || !grupo) throw recusar(r ?? 'grupo-inexistente');
    const idUsuario = await tx.incluir('usuario', conta);
    const inicio = hoje();
    const vinculo = await tx.incluir('usuario_estabelecimento', {
      usuario_id: idUsuario,
      estabelecimento_id: ctx.estabelecimento,
      padrao: true,
      vigencia_inicio: inicio,
    });
    const perfil = await tx.incluir('usuario_perfil', {
      usuario_id: idUsuario,
      perfil_acesso_id: grupo.id,
      estabelecimento_id: ctx.estabelecimento,
      vigencia_inicio: inicio,
    });
    return { idUsuario, vinculo, perfil, dispensaCpf: conta.dispensa_cpf };
  },
  alvo: (_e, r) => ({ tabela: 'usuario', id: r.idUsuario }),
  eventos: (_e, r) => [{ tipo: 'acesso.usuario.criado', carga: { idUsuario: r.idUsuario } }],
  trilha: (_e, r) => ({ dados: { vinculo: r.vinculo, perfil: r.perfil, dispensaCpf: r.dispensaCpf } }),
});

const operacaoAlterarUsuario = definirOperacao({
  nome: 'acesso.alterar_usuario',
  tabelas: ['usuario'],
  entrada: esquemaAlterarUsuario,
  async gravar(tx, e) {
    const u = await contaDoEstabelecimento(tx, e.login);
    const versao = num(/\d+/.exec(e.versao)?.[0] ?? NaN);
    if (!Number.isInteger(versao) || versao !== u.versao) throw erroConflitoVersao(['versao']);
    const outro =
      e.cpf !== undefined
        ? await tx.uma('SELECT id FROM usuario WHERE cpf = ? AND id <> ?', [e.cpf, u.id])
        : null;
    const p = planoAlteracaoUsuario({
      nomeAtual: u.nome,
      nomeNovo: e.nomeCompleto,
      cpfAtual: u.cpf,
      cpfNovo: e.cpf,
      justificativa: e.justificativa,
      cpfDeOutraConta: outro !== null,
    });
    if ('recusa' in p) throw recusar(p.recusa);
    await tx.alterar('usuario', u.id, u.versao, p.valores);
    return { idUsuario: u.id, trocouCpf: p.trocouCpf };
  },
  alvo: (_e, r) => ({ tabela: 'usuario', id: r.idUsuario }),
  eventos: (_e, r) => [{ tipo: 'acesso.usuario.alterado', carga: { idUsuario: r.idUsuario } }],
  trilha: (e, r) => ({ motivo: r.trocouCpf ? (e.justificativa ?? null) : null }),
});

const operacaoTrocarGrupo = definirOperacao({
  nome: 'acesso.trocar_grupo_usuario',
  tabelas: ['usuario_perfil'],
  entrada: z
    .object({ login: z.string().trim().min(1).max(60), grupo: z.string().trim().min(1).max(60) })
    .strict(),
  async gravar(tx, e, ctx) {
    const u = await contaDoEstabelecimento(tx, e.login);
    const grupo = await grupoPeloCodigo(tx, e.grupo);
    if (!grupo) throw recusar('grupo-inexistente');
    if (!grupo.ativo) throw recusar('grupo-inativo');
    const [atual] = await tx.consultarParaAtualizar(
      `SELECT id, perfil_acesso_id, vigencia_inicio, versao FROM usuario_perfil
        WHERE usuario_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL
          AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE) ORDER BY id LIMIT 1`,
      [u.id, ctx.estabelecimento],
      { teto: 1 },
    );
    if (atual && num(atual['perfil_acesso_id']) === grupo.id) throw recusar('mesmo-grupo');
    const inicio = hoje();
    const plano = planoTrocaGrupo(atual ? diaIso(atual['vigencia_inicio']) : null, inicio);
    if (atual && plano.modo === 'corrigir') {
      await tx.alterar('usuario_perfil', num(atual['id']), num(atual['versao']), {
        perfil_acesso_id: grupo.id,
      });
      return { id: num(atual['id']), anterior: num(atual['perfil_acesso_id']), idUsuario: u.id };
    }
    if (atual && plano.modo === 'fechar')
      await tx.alterar('usuario_perfil', num(atual['id']), num(atual['versao']), { vigencia_fim: plano.fim });
    const id = await tx.incluir('usuario_perfil', {
      usuario_id: u.id,
      perfil_acesso_id: grupo.id,
      estabelecimento_id: ctx.estabelecimento,
      vigencia_inicio: inicio,
    });
    return { id, anterior: atual ? num(atual['perfil_acesso_id']) : null, idUsuario: u.id };
  },
  alvo: (_e, r) => ({ tabela: 'usuario_perfil', id: r.id }),
  eventos: (_e, r) => [
    { tipo: 'acesso.usuario.grupo_trocado', carga: { idUsuario: r.idUsuario, anterior: r.anterior } },
  ],
});

/** Tabela de cada escopo, a coluna da entidade e a conferência de que a entidade vale no estabelecimento. */
const ESCOPOS: Partial<
  Record<TipoEscopo, { tabela: string; coluna: string; valida: string; noEst: boolean }>
> = {
  unidade: {
    tabela: 'usuario_unidade',
    coluna: 'unidade_assistencial_id',
    valida:
      'SELECT id FROM unidade_assistencial WHERE id = ? AND estabelecimento_id = ? AND ativo AND excluido_em IS NULL',
    noEst: true,
  },
  local: {
    tabela: 'usuario_local_atendimento',
    coluna: 'local_atendimento_id',
    valida:
      'SELECT id FROM local_atendimento WHERE id = ? AND estabelecimento_id = ? AND ativo AND excluido_em IS NULL',
    noEst: true,
  },
  convenio: {
    tabela: 'usuario_fonte_pagadora',
    coluna: 'fonte_pagadora_id',
    valida: "SELECT id FROM fonte_pagadora WHERE id = ? AND situacao = 'ativa' AND excluido_em IS NULL",
    noEst: false,
  },
  tipoProntuario: {
    tabela: 'usuario_tipo_prontuario',
    coluna: 'tipo_documento_clinico_id',
    valida: 'SELECT id FROM tipo_documento_clinico WHERE id = ? AND ativo',
    noEst: false,
  },
};

function operacaoEscopo(tipo: TipoEscopo, conceder: boolean) {
  const d = ESCOPOS[tipo];
  if (!d) throw new Error(`Escopo sem tabela: ${tipo}`);
  const nomeTipo = tipo.replace(/[A-Z]/g, (x) => `_${x.toLowerCase()}`);
  return definirOperacao({
    nome: `acesso.${conceder ? 'conceder' : 'retirar'}_${nomeTipo}_usuario`,
    tabelas: [d.tabela],
    entrada: esquemaEscopoUsuario,
    async gravar(tx, e, ctx) {
      const u = await contaDoEstabelecimento(tx, e.login);
      const valor = num(e.valor);
      const ent =
        Number.isInteger(valor) && valor > 0
          ? await tx.uma(d.valida, d.noEst ? [valor, ctx.estabelecimento] : [valor])
          : null;
      const [atual] = Number.isInteger(valor)
        ? await tx.consultarParaAtualizar(
            `SELECT id, versao FROM ${d.tabela} WHERE usuario_id = ? AND ${d.coluna} = ? AND excluido_em IS NULL`,
            [u.id, valor],
            { teto: 1 },
          )
        : [];
      const r = conferirEscopo({ conceder, entidadeValida: ent !== null, jaTem: atual !== undefined });
      if (r) throw recusar(r);
      if (conceder) {
        const id = await tx.incluir(d.tabela, { usuario_id: u.id, [d.coluna]: valor });
        return { id, idUsuario: u.id };
      }
      // Retirar é exclusão lógica: a linha fica no banco (quem teve acesso a quê e até quando); a unicidade do par
      // vale só entre as vigentes (migração 02_ADM/94), e a reconcessão grava uma linha nova.
      await tx.alterar(d.tabela, num(atual!['id']), num(atual!['versao']), {
        excluido_em: new Date(),
        excluido_por: ctx.usuario,
      });
      return { id: num(atual!['id']), idUsuario: u.id };
    },
    alvo: (_e, r) => ({ tabela: d.tabela, id: r.id }),
    eventos: (_e, r) => [
      {
        tipo: `acesso.usuario.escopo_${conceder ? 'concedido' : 'retirado'}`,
        carga: { idUsuario: r.idUsuario, tabela: d.tabela, escopo: r.id },
      },
    ],
  });
}

/** Receitas do cadastro da conta ligadas no banco próprio (o mapa OPERACOES da fonte própria as soma). */
export const OPERACOES_USUARIO_PROPRIA = {
  'acesso.criarUsuario': operacaoCriarUsuario,
  'acesso.alterarUsuario': operacaoAlterarUsuario,
  'acesso.trocarGrupoUsuario': operacaoTrocarGrupo,
  'acesso.concederUnidadeUsuario': operacaoEscopo('unidade', true),
  'acesso.retirarUnidadeUsuario': operacaoEscopo('unidade', false),
  'acesso.concederLocalUsuario': operacaoEscopo('local', true),
  'acesso.retirarLocalUsuario': operacaoEscopo('local', false),
  'acesso.concederConvenioUsuario': operacaoEscopo('convenio', true),
  'acesso.retirarConvenioUsuario': operacaoEscopo('convenio', false),
  'acesso.concederTipoProntuarioUsuario': operacaoEscopo('tipoProntuario', true),
  'acesso.retirarTipoProntuarioUsuario': operacaoEscopo('tipoProntuario', false),
} as const;

export const NOMES_OPERACOES_USUARIO_PROPRIA = Object.keys(OPERACOES_USUARIO_PROPRIA);
