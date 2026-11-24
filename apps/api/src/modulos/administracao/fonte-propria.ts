// Fonte PRÓPRIA das telas do M10 (F2.2, lote 02-05): as leituras sobre o banco do cliente pelo Leitor do @sgh/nucleo
// (sempre no estabelecimento da sessão, sem registro excluído) e as gravações pelo Executor (trilha, saída e
// idempotência na mesma transação; trava otimista pela coluna versao).
//   - acesso: usuario, usuario_estabelecimento, usuario_perfil/perfil_acesso (o "grupo" é o perfil principal),
//     perfil_acao, papel_seguranca(_acao), usuario_papel_seguranca, acao_sistema, modulo_sistema, politica_senha,
//     credencial_usuario, historico_senha, usuario_escopo/tipo_escopo_acesso, usuario_local_atendimento,
//     usuario_unidade, usuario_fonte_pagadora, usuario_tipo_agenda, usuario_tipo_prontuario, usuario_profissional;
//   - termo de uso: termo_uso_versao e aceite_termo_uso; quebra de vidro: acesso_emergencial e
//     revisao_acesso_emergencial;
//   - estrutura: estabelecimento, unidade_assistencial, bloco_internacao, acomodacao, leito_hospitalar,
//     ocupacao_leito, centro_custo, guiche_recepcao/ponto_recepcao, local_atendimento;
//   - consultas: regra_alerta, servidor_email; auditoria: trilha_auditoria, leitura_prontuario, registro_excluido,
//     paciente; privacidade: pedido_titular e pedido_titular_historico.
// Nenhum log leva login, nome, CPF ou texto: só códigos e contagens. O CPF nunca sai do banco no painel (a chave do
// grupo de logins repetidos é um resumo).
// Melhoria (decisão registrada, achado da revisão do 02-05): o bloqueio é da CONTA. No banco próprio há uma conta por
// login no cliente, valendo em todos os estabelecimentos do vínculo, e a credencial é uma só: um bloqueio por suspeita
// tem de valer onde ela entra. Por isso quem bloqueia precisa da permissão de bloquear usuários em CADA estabelecimento
// do vínculo (senão recusa 'exige-gestao-da-rede'), e a regra do último gestor de acessos (dominio-acesso) é conferida
// em todos eles, dentro da transação. A versão é a trava; recusa a si mesmo e a conta sem vínculo com o estabelecimento.
// Melhoria: o termo é publicado sempre no estabelecimento de quem publica (o geral da rede fica intacto e cede ao do
// estabelecimento); motivo e versão anterior vão à trilha.
// Melhoria: conceder e retirar setor conferem o vínculo do usuário com o estabelecimento e avisam pela saída.
// Melhoria: o aceite do termo é linha própria (aceite_termo_uso), com estabelecimento e data; a publicação guarda o
// resumo SHA-256 do texto e fecha a vigência da versão anterior na mesma transação.
// Melhoria: o pedido do titular recebe protocolo pela sequência de negócio, prazo legal, titular pelo cadastro e o
// andamento de cada passo em pedido_titular_historico.
// Melhoria: a revisão da quebra de vidro é registro próprio (parecer e revisor), uma por acesso.
import { createHash } from 'node:crypto';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  garantirSequencia,
  type Leitor,
  type Linha,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { PERMISSOES_M10_CODIGOS } from '@sgh/contratos';
import { conferirUltimoGestor, mensagemUltimoGestor } from '@sgh/dominio-acesso';
import { z } from 'zod';
import { ErroProblema } from '../../problema.filter.js';
import { NOMES_OPERACOES_USUARIO_PROPRIA, OPERACOES_USUARIO_PROPRIA } from './operacoes-usuario-propria.js';
import {
  NOMES_OPERACOES_IMPRESSAO_PROPRIA,
  OPERACOES_IMPRESSAO_PROPRIA,
} from './operacoes-impressao-propria.js';
import {
  lerPreferenciasDoUsuario,
  NOMES_OPERACOES_PREFERENCIAS_PROPRIA,
  OPERACOES_PREFERENCIAS_PROPRIA,
} from './operacoes-preferencias-propria.js';
import { CODIGOS_PAPEL, PERFIL_GESTOR_ACESSOS } from '../acesso/gestao-tipos.js';
import type { FonteAdministracao } from './fonte.js';
import {
  type AcaoMenu,
  type AcessoProntuarioLido,
  type ContaCpf,
  type ContaRede,
  type ContextoGestao,
  type Ctx,
  type EstadoOperacaoGestao,
  type FichaUsuario,
  type ItemEscopo,
  type LinhaTrilhaLida,
  type PedidoTitularLido,
  type PoliticaLogin,
  registroDaChave,
} from './tipos.js';

/** O que a fonte usa do NucleoProprio (os testes trocam). */
export interface NucleoAdministracao {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(opcoes?: {
    readonly log?: (mensagem: string, campos: Record<string, unknown>) => void;
  }): Executor;
}

export interface OpcoesFonteAdministracaoPropria {
  /** Código da rede desta hospedagem (ARQ-1); null: sem rede configurada. */
  readonly rede: string | null;
  /** Log do Executor (só códigos, ids e classe do erro). */
  readonly log?: (mensagem: string, campos: Record<string, unknown>) => void;
}

const TETO = 10_000;
const num = (v: unknown): number => Number(v);
const numOuNull = (v: unknown): number | null =>
  v === null || v === undefined || v === '' ? null : Number(v);
const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const txtOuNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const bool = (v: unknown): boolean => v === true || Number(v) === 1;
const data = (v: unknown): Date | null => (v instanceof Date ? v : v ? new Date(String(v)) : null);
const iso = (v: unknown): string => (data(v) ?? new Date(0)).toISOString();
const isoSeg = (v: unknown): string => iso(v).slice(0, 19);
const dia = (v: unknown): string | null => {
  const d = data(v);
  return d
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    : null;
};
const como = (s: string) => s.replace(/[\\%_]/g, (x) => `\\${x}`);

/** Perfil principal do usuário no estabelecimento (o "grupo" das telas). */
const SQL_GRUPO = `(SELECT p.codigo FROM usuario_perfil up JOIN perfil_acesso p ON p.id = up.perfil_acesso_id
   WHERE up.usuario_id = u.id AND up.estabelecimento_id = ? AND up.excluido_em IS NULL AND p.excluido_em IS NULL
     AND (up.vigencia_fim IS NULL OR up.vigencia_fim >= CURRENT_DATE) ORDER BY up.id LIMIT 1)`;
/** Vínculo vigente do usuário com o estabelecimento. */
const SQL_VINCULO = `EXISTS (SELECT 1 FROM usuario_estabelecimento ue WHERE ue.usuario_id = u.id
   AND ue.estabelecimento_id = ? AND ue.excluido_em IS NULL AND ue.vigencia_inicio <= CURRENT_DATE
   AND (ue.vigencia_fim IS NULL OR ue.vigencia_fim >= CURRENT_DATE))`;

// Contrato da tela ↔ modelo do pedido do titular.
const TIPO_PEDIDO: Readonly<Record<string, string>> = {
  compartilhamento: 'informacao_compartilhamento',
  'revogacao-consentimento': 'revogacao_consentimento',
  // Aceitos pelo modelo (ck_pedido_titular_tipo) e ainda fora do contrato da tela: o controller sinaliza e não quebra a
  // lista (pedido de contrato em saida/02-05.json).
  'revisao-decisao-automatizada': 'revisao_decisao_automatizada',
};
const TIPO_TELA = Object.fromEntries(Object.entries(TIPO_PEDIDO).map(([a, b]) => [b, a]));
const CANAIS_DO_MODELO = new Set(['presencial', 'email', 'portal', 'telefone', 'carta']);
const SITUACAO_TELA: Readonly<Record<string, string>> = {
  recebido: 'aberto',
  em_analise: 'identidade-verificada',
  aguardando_titular: 'identidade-verificada',
  atendido: 'atendido',
  atendido_parcial: 'atendido',
  indeferido: 'negado',
  cancelado: 'cancelado',
};
const FUNDAMENTOS = new Set([
  'guarda-legal-prontuario',
  'obrigacao-legal',
  'exercicio-de-direito',
  'identidade-nao-confirmada',
  'outro',
]);

/** Operações de gravação implementadas no banco próprio (as outras ficam desligadas, com o motivo). */
export const OPERACOES_IMPLEMENTADAS = [
  'acesso.bloquearUsuario',
  'acesso.desbloquearUsuario',
  'acesso.aceitarTermo',
  'acesso.publicarTermo',
  // Cadastro da conta e escopos (01-ADM L57 e L59): operacoes-usuario-propria.ts.
  ...NOMES_OPERACOES_USUARIO_PROPRIA,
  // Impressora por estação e reimpressão (01-ADM L79): operacoes-impressao-propria.ts.
  ...NOMES_OPERACOES_IMPRESSAO_PROPRIA,
  // Preferências da própria conta (01-ADM L84): operacoes-preferencias-propria.ts.
  ...NOMES_OPERACOES_PREFERENCIAS_PROPRIA,
];
export const MOTIVO_PENDENTE =
  'Esta operação ainda não tem implementação no banco próprio (pendência registrada da F2.2): nada foi gravado.';

const entradaLogin = z
  .object({ login: z.string().trim().min(1).max(60), motivo: z.string().max(500).optional() })
  .strict();

/** A conta pelo login, travada, com o vínculo vigente ao estabelecimento do contexto. */
async function contaTravada(
  tx: TxOperacao,
  login: string,
): Promise<{ id: number; situacao: string; versao: number }> {
  const [u] = await tx.consultarParaAtualizar(
    'SELECT id, situacao, versao FROM usuario WHERE login = ? AND excluido_em IS NULL',
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
  return { id, situacao: txt(u['situacao']), versao: num(u['versao']) };
}

const ACAO_BLOQUEAR = PERMISSOES_M10_CODIGOS.usuarioBloquear;
const VIGENTE_UE =
  'ue.excluido_em IS NULL AND ue.vigencia_inicio <= CURRENT_DATE AND (ue.vigencia_fim IS NULL OR ue.vigencia_fim >= CURRENT_DATE)';
const VIGENTE_UP =
  'up.excluido_em IS NULL AND up.vigencia_inicio <= CURRENT_DATE AND (up.vigencia_fim IS NULL OR up.vigencia_fim >= CURRENT_DATE)';
const VIGENTE_UPS =
  'ups.excluido_em IS NULL AND ups.vigencia_inicio <= CURRENT_DATE AND (ups.vigencia_fim IS NULL OR ups.vigencia_fim >= CURRENT_DATE)';

/**
 * O bloqueio vale para a conta inteira: confere (1) que o operador pode bloquear usuários em cada OUTRO estabelecimento
 * do vínculo do alvo (perfil administrador ou ação concedida, sem negação explícita; o administrador da plataforma, sem
 * usuário no cliente, pode tudo) e (2) a regra do último gestor de acessos em TODOS os estabelecimentos do vínculo.
 */
async function conferirAlcanceDoBloqueio(tx: TxOperacao, idAlvo: number, login: string): Promise<void> {
  const ests = (
    await tx.consultar(
      `SELECT DISTINCT ue.estabelecimento_id AS id FROM usuario_estabelecimento ue WHERE ue.usuario_id = ? AND ${VIGENTE_UE}`,
      [idAlvo],
      {
        teto: 1000,
      },
    )
  ).map((x) => num(x['id']));
  const operador = tx.contexto.usuario;
  const outros = ests.filter((e) => e !== tx.contexto.estabelecimento);
  if (operador !== null && outros.length > 0) {
    const [r] = await tx.consultar(
      `SELECT COUNT(DISTINCT ue.estabelecimento_id) AS n FROM usuario_estabelecimento ue
        WHERE ue.usuario_id = ? AND ue.estabelecimento_id IN (${outros.map(() => '?').join(', ')}) AND ${VIGENTE_UE}
          AND EXISTS (SELECT 1 FROM usuario_perfil up JOIN perfil_acesso p ON p.id = up.perfil_acesso_id AND p.ativo AND p.excluido_em IS NULL
                WHERE up.usuario_id = ue.usuario_id AND up.estabelecimento_id = ue.estabelecimento_id AND ${VIGENTE_UP}
                  AND (p.administrador OR EXISTS (SELECT 1 FROM perfil_acao pa JOIN acao_sistema a ON a.id = pa.acao_sistema_id AND a.ativo
                         WHERE pa.perfil_acesso_id = p.id AND pa.permitido AND pa.excluido_em IS NULL AND a.codigo = ?)))
          AND NOT EXISTS (SELECT 1 FROM usuario_perfil up
                JOIN perfil_acao pa ON pa.perfil_acesso_id = up.perfil_acesso_id AND pa.excluido_em IS NULL AND NOT pa.permitido
                JOIN acao_sistema a ON a.id = pa.acao_sistema_id
                WHERE up.usuario_id = ue.usuario_id AND up.estabelecimento_id = ue.estabelecimento_id AND ${VIGENTE_UP} AND a.codigo = ?)`,
      [operador, ...outros, ACAO_BLOQUEAR, ACAO_BLOQUEAR],
    );
    if (num(r?.['n'] ?? 0) < outros.length)
      throw recusa(
        'exige-gestao-da-rede',
        `A conta também dá acesso a ${outros.length} outro(s) estabelecimento(s) e o bloqueio vale para a conta inteira: é preciso ter a permissão de bloquear usuários em todos eles.`,
      );
  }
  const acao = { tipo: 'bloquear' as const, login };
  for (const est of ests) {
    const gestores = await tx.consultar(
      `SELECT u.login,
          (SELECT COUNT(*) FROM usuario_papel_seguranca ups JOIN papel_seguranca ps ON ps.id = ups.papel_seguranca_id AND ps.excluido_em IS NULL
            WHERE ups.usuario_id = u.id AND ps.codigo = ? AND ${VIGENTE_UPS}) AS papel_gestor,
          (SELECT GROUP_CONCAT(up.id ORDER BY up.id) FROM usuario_perfil up JOIN perfil_acesso pa ON pa.id = up.perfil_acesso_id
            WHERE up.usuario_id = u.id AND up.estabelecimento_id = ? AND pa.codigo = ? AND ${VIGENTE_UP}) AS concessoes
         FROM usuario u
        WHERE u.excluido_em IS NULL AND u.situacao IN ('ativo','dormente')
          AND EXISTS (SELECT 1 FROM usuario_estabelecimento ue WHERE ue.usuario_id = u.id AND ue.estabelecimento_id = ? AND ${VIGENTE_UE})`,
      [CODIGOS_PAPEL[0], est, PERFIL_GESTOR_ACESSOS, est],
      { teto: TETO },
    );
    const r = conferirUltimoGestor(
      gestores.map((g) => ({
        login: txt(g['login']),
        grupoAcessoTotal: false,
        papelGestor: num(g['papel_gestor']) > 0,
        concessoes: txt(g['concessoes'])
          .split(',')
          .filter((x) => x !== ''),
      })),
      acao,
    );
    if (r) throw recusa(r, mensagemUltimoGestor(acao));
  }
}

function operacaoBloqueio(bloquear: boolean) {
  return definirOperacao({
    nome: bloquear ? 'acesso.bloquear_usuario' : 'acesso.desbloquear_usuario',
    tabelas: ['usuario'],
    entrada: entradaLogin,
    async gravar(tx, e, ctx) {
      const u = await contaTravada(tx, e.login);
      if (ctx.usuario !== null && u.id === ctx.usuario)
        throw recusa('a-si-mesmo', 'Ninguém bloqueia nem desbloqueia a si mesmo.');
      if (u.situacao === 'inativo') throw recusa('usuario-inativo', 'A conta está inativa.');
      if (bloquear === (u.situacao === 'bloqueado'))
        throw recusa(
          bloquear ? 'ja-bloqueado' : 'ja-livre',
          bloquear ? 'O usuário já está bloqueado.' : 'O usuário não está bloqueado.',
        );
      if (bloquear) await conferirAlcanceDoBloqueio(tx, u.id, e.login);
      await tx.alterar(
        'usuario',
        u.id,
        u.versao,
        bloquear
          ? { situacao: 'bloqueado', bloqueado_em: new Date() }
          : { situacao: 'ativo', bloqueado_em: null, tentativas_login_invalidas: 0 },
      );
      return { idUsuario: u.id };
    },
    alvo: (_e, r) => ({ tabela: 'usuario', id: r.idUsuario }),
    eventos: (_e, r) => [
      {
        tipo: bloquear ? 'acesso.usuario.bloqueado' : 'acesso.usuario.desbloqueado',
        carga: { idUsuario: r.idUsuario },
      },
    ],
    trilha: (e) => ({ motivo: e.motivo ?? null }),
  });
}

/** Termo vigente do público "sistema" no estabelecimento (o do estabelecimento antes do geral). */
const SQL_TERMO_VIGENTE = `SELECT id, estabelecimento_id, texto, vigencia_inicio, versao FROM termo_uso_versao
  WHERE publico = 'sistema' AND situacao = 'publicado' AND excluido_em IS NULL
    AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)
    AND vigencia_inicio <= NOW(3) AND (vigencia_fim IS NULL OR vigencia_fim > NOW(3))
  ORDER BY estabelecimento_id IS NULL, vigencia_inicio DESC, id DESC LIMIT 1`;

const operacaoAceitarTermo = definirOperacao({
  nome: 'acesso.aceitar_termo',
  tabelas: ['aceite_termo_uso'],
  entrada: z.object({ termo: z.number().int().positive() }).passthrough(),
  async gravar(tx, e, ctx) {
    if (ctx.usuario === null) throw recusa('sem-usuario', 'A conta da sessão não aceita termo neste banco.');
    const t = await tx.uma(SQL_TERMO_VIGENTE, [ctx.estabelecimento]);
    if (!t || num(t['id']) !== e.termo)
      throw recusa('termo-desatualizado', 'O termo mudou desde que a tela abriu.');
    const ja = await tx.uma(
      `SELECT id FROM aceite_termo_uso WHERE termo_uso_versao_id = ? AND usuario_id = ? AND valido
         AND revogado_em IS NULL`,
      [e.termo, ctx.usuario],
    );
    if (ja) throw recusa('ja-aceito', 'Você já aceitou esta versão do termo.');
    const id = await tx.incluir('aceite_termo_uso', {
      termo_uso_versao_id: e.termo,
      usuario_id: ctx.usuario,
      estabelecimento_id: ctx.estabelecimento,
      ocorrido_em: new Date(),
      valido: true,
      endereco_ip: ctx.enderecoIp ?? null,
    });
    return { id, termo: e.termo };
  },
  alvo: (_e, r) => ({ tabela: 'aceite_termo_uso', id: r.id }),
  eventos: (_e, r) => [{ tipo: 'acesso.termo.aceito', carga: { termo: r.termo } }],
});

const normalizarTexto = (t: unknown) =>
  String(t ?? '')
    .replace(/\r\n/g, '\n')
    .trim();

/** Termo publicado do próprio estabelecimento (sem o geral da rede), travado para a troca de versão. */
const SQL_TERMO_DO_ESTABELECIMENTO = `SELECT id, texto, versao FROM termo_uso_versao
  WHERE publico = 'sistema' AND situacao = 'publicado' AND excluido_em IS NULL AND estabelecimento_id = ?
    AND vigencia_inicio <= NOW(3) AND (vigencia_fim IS NULL OR vigencia_fim > NOW(3))
  ORDER BY vigencia_inicio DESC, id DESC LIMIT 1`;

const operacaoPublicarTermo = definirOperacao({
  nome: 'acesso.publicar_termo',
  tabelas: ['termo_uso_versao'],
  critica: true,
  entrada: z
    .object({
      termoAnterior: z.number().int().positive().nullable(),
      texto: z.string().min(1).max(1_000_000),
      motivo: z.string().trim().min(10).max(500),
    })
    .strict(),
  async gravar(tx, e, ctx) {
    // O que a tela mostrou: o vigente no estabelecimento (o dele, ou o geral da rede quando ele não tem um).
    const atual = await tx.uma(SQL_TERMO_VIGENTE, [ctx.estabelecimento]);
    const idAtual = atual ? num(atual['id']) : null;
    if ((e.termoAnterior ?? null) !== idAtual)
      throw recusa(
        'termo-desatualizado',
        'Outra versão do termo foi publicada desde que a tela abriu; recarregue.',
      );
    const texto = normalizarTexto(e.texto);
    if (atual && texto === normalizarTexto(atual['texto']))
      throw recusa('texto-igual', 'O texto é igual ao da versão vigente: nada a publicar.');
    // A versão nova vale SÓ no estabelecimento de quem publica: o termo geral da rede nunca é trocado por aqui (exige
    // gestão da rede; pedido registrado). Fecha-se só a vigência da versão do próprio estabelecimento, travada.
    const [proprio] = await tx.consultarParaAtualizar(SQL_TERMO_DO_ESTABELECIMENTO, [ctx.estabelecimento], {
      teto: 1,
    });
    const [n] = await tx.consultar(
      `SELECT COALESCE(MAX(CAST(numero_versao AS UNSIGNED)), 0) AS n FROM termo_uso_versao
        WHERE publico = 'sistema' AND estabelecimento_id = ?`,
      [ctx.estabelecimento],
    );
    const numeroVersao = String(num(n?.['n'] ?? 0) + 1);
    const agora = new Date();
    if (proprio)
      await tx.alterar('termo_uso_versao', num(proprio['id']), num(proprio['versao']), {
        vigencia_fim: agora,
      });
    const id = await tx.incluir('termo_uso_versao', {
      estabelecimento_id: ctx.estabelecimento,
      publico: 'sistema',
      numero_versao: numeroVersao,
      titulo: 'Termo de uso do sistema',
      texto,
      hash_texto: createHash('sha256').update(texto, 'utf8').digest('hex'),
      situacao: 'publicado',
      vigencia_inicio: agora,
      exige_novo_aceite: true,
      publicado_em: agora,
      publicado_por_usuario_id: ctx.usuario,
    });
    return { id, anterior: idAtual, fechada: proprio ? num(proprio['id']) : null, numeroVersao };
  },
  alvo: (_e, r) => ({ tabela: 'termo_uso_versao', id: r.id }),
  eventos: (_e, r) => [{ tipo: 'acesso.termo.publicado', carga: { termo: r.id, anterior: r.anterior } }],
  trilha: (e, r) => ({
    motivo: e.motivo,
    dados: { anterior: r.anterior, fechada: r.fechada, numeroVersao: r.numeroVersao },
  }),
});

const OPERACOES = {
  'acesso.bloquearUsuario': operacaoBloqueio(true),
  'acesso.desbloquearUsuario': operacaoBloqueio(false),
  'acesso.aceitarTermo': operacaoAceitarTermo,
  'acesso.publicarTermo': operacaoPublicarTermo,
  ...OPERACOES_USUARIO_PROPRIA,
  ...OPERACOES_IMPRESSAO_PROPRIA,
  ...OPERACOES_PREFERENCIAS_PROPRIA,
} as const;

/** Pedido do titular lido do modelo, na forma da tela. */
function pedidoDaLinha(l: Linha): PedidoTitularLido {
  const situacao = txt(l['situacao']);
  const tipo = txt(l['tipo']);
  const motivo = txtOuNull(l['motivo_indeferimento']);
  return {
    id: String(l['id']),
    protocolo: txt(l['numero']),
    tipo: TIPO_TELA[tipo] ?? tipo,
    canal: txt(l['canal_recebimento']),
    situacao: SITUACAO_TELA[situacao] ?? situacao,
    // Titular que não é paciente (portal, integração): sem paciente, nunca um sentinela.
    idPaciente: numOuNull(l['paciente_id']),
    prontuario: numOuNull(l['numero_prontuario']),
    abertoEm: data(l['recebido_em']) ?? new Date(0),
    prazo: data(l['prazo_em']) ?? new Date(0),
    identidadeVerificada: bool(l['identidade_confirmada']),
    fundamento: situacao !== 'indeferido' || !motivo ? null : FUNDAMENTOS.has(motivo) ? motivo : 'outro',
    decididoPor: txtOuNull(l['decidido_por']),
    decididoEm: data(l['respondido_em']),
    registradoPor: txt(l['registrado_por']),
    versao: num(l['versao']),
    motivoCancelamento: situacao === 'cancelado' ? motivo : null,
  };
}

const SQL_PEDIDO = `SELECT p.id, p.numero, p.tipo, p.canal_recebimento, p.situacao, p.paciente_id, pa.numero_prontuario,
    p.recebido_em, p.prazo_em, p.identidade_confirmada, p.motivo_indeferimento, p.respondido_em, p.versao,
    ur.login AS decidido_por, uc.login AS registrado_por
  FROM pedido_titular p
  LEFT JOIN paciente pa ON pa.id = p.paciente_id
  LEFT JOIN usuario ur ON ur.id = p.responsavel_usuario_id
  LEFT JOIN usuario uc ON uc.id = p.criado_por
  WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL`;

const operacaoRegistrarPedido = definirOperacao({
  nome: 'auditoria.registrar_pedido_titular',
  tabelas: ['pedido_titular', 'pedido_titular_historico', 'sequencia_negocio'],
  entrada: z
    .object({
      idPaciente: z.number().int().positive().optional(),
      prontuario: z.number().int().positive().optional(),
      tipo: z.string().min(1).max(40),
      canal: z.string().min(1).max(30),
      descricao: z.string().max(4000).nullable(),
      prazoDias: z.number().int().positive().max(365),
    })
    .strict(),
  async gravar(tx, e, ctx) {
    if (!CANAIS_DO_MODELO.has(e.canal))
      throw recusa(
        'canal-indisponivel',
        'Este canal de recebimento ainda não é aceito: escolha outro canal.',
      );
    const pac = await tx.uma(
      `SELECT pa.id, pf.nome, pf.cpf FROM paciente pa JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
        WHERE pa.excluido_em IS NULL AND ${e.idPaciente !== undefined ? 'pa.id = ?' : 'pa.numero_prontuario = ?'}
        ORDER BY pa.id LIMIT 1`,
      [e.idPaciente ?? String(e.prontuario ?? '')],
    );
    if (!pac) throw recusa('paciente-inexistente', 'Paciente não encontrado.');
    await garantirSequencia(
      tx,
      { tipo: 'pedido_titular', estabelecimento: ctx.estabelecimento, prefixo: 'LGPD-' },
      { usuario: ctx.usuario, agora: new Date() },
    );
    const numero = await tx.proximoNumero('pedido_titular');
    const agora = new Date();
    const prazo = new Date(agora.getTime() + e.prazoDias * 86_400_000);
    const id = await tx.incluir('pedido_titular', {
      estabelecimento_id: ctx.estabelecimento,
      numero: numero.formatado,
      paciente_id: num(pac['id']),
      titular_nome: txt(pac['nome']).slice(0, 150),
      titular_cpf: txtOuNull(pac['cpf']),
      tipo: TIPO_PEDIDO[e.tipo] ?? e.tipo,
      canal_recebimento: e.canal,
      descricao: e.descricao ?? 'Pedido registrado sem descrição.',
      recebido_em: agora,
      prazo_em: dia(prazo),
    });
    await tx.incluir('pedido_titular_historico', {
      pedido_titular_id: id,
      operacao: 'inclusao',
      ocorrido_em: agora,
      usuario_id: ctx.usuario,
      situacao_nova: 'recebido',
      descricao: 'Pedido registrado',
    });
    return { id, protocolo: numero.formatado };
  },
  alvo: (_e, r) => ({ tabela: 'pedido_titular', id: r.id }),
  eventos: (_e, r) => [{ tipo: 'auditoria.pedido_titular.registrado', carga: { pedido: r.id } }],
});

/** A transição do pedido: a regra pura vem da tela (dominio-acesso), conferida sobre a linha travada. */
function operacaoTratarPedido(conferir: (p: PedidoTitularLido) => string | null) {
  return definirOperacao({
    nome: 'auditoria.tratar_pedido_titular',
    tabelas: ['pedido_titular', 'pedido_titular_historico'],
    entrada: z
      .object({
        id: z.number().int().positive(),
        acao: z.enum(['confirmar-identidade', 'atender', 'negar']),
        fundamento: z.string().max(60).nullable(),
        resposta: z.string().max(4000).nullable(),
      })
      .strict(),
    async gravar(tx, e, ctx) {
      const [l] = await tx.consultarParaAtualizar(`${SQL_PEDIDO} AND p.id = ?`, [ctx.estabelecimento, e.id], {
        teto: 1,
      });
      if (!l)
        throw new ErroOperacao(404, 'pedido-inexistente', 'Pedido não encontrado', 'Pedido não encontrado.');
      const lido = pedidoDaLinha(l);
      const r = conferir(lido);
      if (r) throw recusa('transicao-recusada', r);
      const agora = new Date();
      const antes = txt(l['situacao']);
      const valores =
        e.acao === 'confirmar-identidade'
          ? { identidade_confirmada: true, identidade_confirmada_em: agora, situacao: 'em_analise' }
          : e.acao === 'atender'
            ? {
                situacao: 'atendido',
                resposta: e.resposta,
                respondido_em: agora,
                responsavel_usuario_id: ctx.usuario,
              }
            : {
                situacao: 'indeferido',
                motivo_indeferimento: e.fundamento ?? 'outro',
                resposta: e.resposta,
                respondido_em: agora,
                responsavel_usuario_id: ctx.usuario,
              };
      await tx.alterar('pedido_titular', e.id, lido.versao, valores);
      await tx.incluir('pedido_titular_historico', {
        pedido_titular_id: e.id,
        operacao: 'alteracao',
        ocorrido_em: agora,
        usuario_id: ctx.usuario,
        situacao_anterior: antes,
        situacao_nova: valores.situacao,
        descricao: e.acao === 'atender' && e.fundamento ? `atender: ${e.fundamento}` : e.acao,
      });
      return { id: e.id, situacao: SITUACAO_TELA[valores.situacao] ?? valores.situacao };
    },
    alvo: (_e, r) => ({ tabela: 'pedido_titular', id: r.id }),
    eventos: (_e, r) => [{ tipo: 'auditoria.pedido_titular.tratado', carga: { pedido: r.id } }],
  });
}

const operacaoRevisarQuebra = definirOperacao({
  nome: 'acesso.revisar_emergencia',
  tabelas: ['revisao_acesso_emergencial'],
  entrada: z
    .object({ id: z.number().int().positive(), classificacao: z.enum(['justificado', 'nao-justificado']) })
    .strict(),
  async gravar(tx, e, ctx) {
    if (ctx.usuario === null) throw recusa('sem-usuario', 'A revisão exige o usuário revisor.');
    const [a] = await tx.consultarParaAtualizar(
      'SELECT id, usuario_id FROM acesso_emergencial WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [e.id, ctx.estabelecimento],
      { teto: 1 },
    );
    if (!a)
      throw new ErroOperacao(
        404,
        'emergencia-inexistente',
        'Acesso de emergência não encontrado',
        'Não encontrado.',
      );
    if (num(a['usuario_id']) === ctx.usuario)
      throw recusa('a-si-mesmo', 'Ninguém revisa o próprio acesso de emergência (segregação de funções).');
    if (await tx.uma('SELECT id FROM revisao_acesso_emergencial WHERE acesso_emergencial_id = ?', [e.id]))
      throw recusa('ja-revisado', 'Este acesso de emergência já foi revisado.');
    const agora = new Date();
    const id = await tx.incluir('revisao_acesso_emergencial', {
      acesso_emergencial_id: e.id,
      operacao: 'inclusao',
      ocorrido_em: agora,
      usuario_id: ctx.usuario,
      revisor_usuario_id: ctx.usuario,
      parecer: e.classificacao === 'justificado' ? 'procedente' : 'improcedente',
      justificativa:
        e.classificacao === 'justificado'
          ? 'Acesso de emergência justificado na revisão.'
          : 'Acesso de emergência não justificado na revisão.',
      encaminhamento: 'nenhum',
    });
    return { id };
  },
  alvo: (_e, r) => ({ tabela: 'revisao_acesso_emergencial', id: r.id }),
  eventos: (_e, r) => [{ tipo: 'acesso.emergencia.revisada', carga: { revisao: r.id } }],
});

const operacaoSetor = (conceder: boolean) =>
  definirOperacao({
    nome: conceder ? 'acesso.conceder_setor_usuario' : 'acesso.retirar_setor_usuario',
    tabelas: ['usuario_escopo'],
    entrada: z.object({ idUsuario: z.number().int().positive(), bloco: z.string().min(1).max(30) }).strict(),
    async gravar(tx, e, ctx) {
      const tipo = await tx.uma(
        "SELECT id FROM tipo_escopo_acesso WHERE entidade = 'bloco_internacao' AND ativo ORDER BY id LIMIT 1",
      );
      if (!tipo)
        throw recusa(
          'escopo-nao-configurado',
          'O recorte de acesso por bloco de internação não está configurado neste cliente.',
        );
      const b = await tx.uma(
        'SELECT id FROM bloco_internacao WHERE estabelecimento_id = ? AND codigo = ? AND excluido_em IS NULL',
        [ctx.estabelecimento, e.bloco],
      );
      if (!b) throw recusa('valor-inexistente', 'Escolha um bloco existente.');
      const vinculo = await tx.uma(
        `SELECT 1 AS ok FROM usuario_estabelecimento ue WHERE ue.usuario_id = ? AND ue.estabelecimento_id = ? AND ${VIGENTE_UE}`,
        [e.idUsuario, ctx.estabelecimento],
      );
      if (!vinculo) throw recusa('usuario-inexistente', 'Usuário sem vínculo com este estabelecimento.');
      const [atual] = await tx.consultarParaAtualizar(
        `SELECT id, versao FROM usuario_escopo WHERE usuario_id = ? AND tipo_escopo_acesso_id = ? AND estabelecimento_id = ?
           AND entidade_id = ? AND excluido_em IS NULL AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)`,
        [e.idUsuario, num(tipo['id']), ctx.estabelecimento, num(b['id'])],
        { teto: 1 },
      );
      if (conceder) {
        if (atual) throw recusa('ja-concedido', 'O usuário já tem este setor.');
        const id = await tx.incluir('usuario_escopo', {
          usuario_id: e.idUsuario,
          tipo_escopo_acesso_id: num(tipo['id']),
          estabelecimento_id: ctx.estabelecimento,
          entidade_id: num(b['id']),
          pode_consultar: true,
          pode_operar: true,
          vigencia_inicio: dia(new Date()),
        });
        return { id };
      }
      if (!atual) throw recusa('nao-concedido', 'O usuário não tem este setor.');
      await tx.excluir('usuario_escopo', num(atual['id']), num(atual['versao']));
      return { id: num(atual['id']) };
    },
    alvo: (_e, r) => ({ tabela: 'usuario_escopo', id: r.id }),
    eventos: (e, r) => [
      {
        tipo: conceder ? 'acesso.usuario.setor_concedido' : 'acesso.usuario.setor_retirado',
        carga: { idUsuario: e.idUsuario, escopo: r.id },
      },
    ],
  });

export class FonteAdministracaoPropria implements FonteAdministracao {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;
  private estabelecimentos: { id: number; codigo: string; nome: string; fuso: string }[] = [];
  private lidoEm = 0;

  constructor(
    private readonly nucleo: NucleoAdministracao,
    private readonly cliente: string,
    private readonly opcoes: OpcoesFonteAdministracaoPropria = { rede: null },
  ) {
    this.executor = nucleo.criarExecutor(opcoes.log ? { log: opcoes.log } : {});
    void this.carregar().catch(() => undefined);
  }

  /** Lê (ou relê) os estabelecimentos do cliente (a lista da rede e o mapa código → id). */
  async carregar(): Promise<void> {
    const ls = await this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: 'administracao-estabelecimentos' },
      (l) =>
        l.consultar(
          'SELECT id, codigo, nome_fantasia, fuso_horario FROM estabelecimento WHERE excluido_em IS NULL AND ativo',
          [],
          {
            teto: TETO,
          },
        ),
    );
    this.estabelecimentos = ls.map((x) => ({
      id: num(x['id']),
      codigo: txt(x['codigo']),
      nome: txt(x['nome_fantasia']),
      fuso: txt(x['fuso_horario']) || 'America/Sao_Paulo',
    }));
    this.lidoEm = Date.now();
  }

  private ler<T>(c: Ctx, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: c.traceId.slice(0, 64) || 'administracao' },
      async (l) => fn(l, await this.idEstabelecimento(l, c.hospital)),
    );
  }

  private async idEstabelecimento(l: Leitor, codigo: string): Promise<number> {
    const x = await l.uma('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
      codigo,
    ]);
    if (!x) throw new ErroProblema('nao-encontrado', 404, 'Estabelecimento não encontrado');
    return num(x['id']);
  }

  private async contexto(
    hospital: string,
    correlacao: string,
    usuario: number | null,
    chave: string,
    reaut?: number,
  ): Promise<ContextoOperacao> {
    const est = await this.nucleo.lerSomente({ cliente: this.cliente, correlacao }, (l) =>
      this.idEstabelecimento(l, hospital),
    );
    return {
      cliente: this.cliente,
      estabelecimento: est,
      usuario,
      correlacao: correlacao.slice(0, 64),
      chaveIdempotencia: chave,
      ...(reaut !== undefined ? { reautenticadoEm: reaut } : {}),
    };
  }

  private async idDoLogin(c: Ctx, login: string): Promise<number | null> {
    return this.ler(c, async (l) => {
      const u = await l.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [login]);
      return u ? num(u['id']) : null;
    });
  }

  // ── Acesso ───────────────────────────────────────────────────────────────────────────────────
  listarUsuarios: FonteAdministracao['listarUsuarios'] = (c, f) =>
    this.ler(c, async (l, est) => {
      const onde: string[] = ['u.excluido_em IS NULL', SQL_VINCULO];
      const p: unknown[] = [est];
      if (f.busca) {
        onde.push('(u.login LIKE ? OR u.nome LIKE ?)');
        const b = `%${como(f.busca.trim())}%`;
        p.push(b, b);
      }
      if (f.situacao === 'ativos') onde.push("u.situacao IN ('ativo','dormente')");
      if (f.situacao === 'inativos') onde.push("u.situacao = 'inativo'");
      if (f.situacao === 'bloqueados') onde.push("u.situacao = 'bloqueado'");
      if (f.grupo) {
        onde.push(`${SQL_GRUPO} = ?`);
        p.push(est, f.grupo);
      }
      const where = onde.join(' AND ');
      const [t] = await l.consultar(`SELECT COUNT(*) AS n FROM usuario u WHERE ${where}`, p);
      const ls = await l.consultar(
        `SELECT u.login, u.nome, u.situacao, u.ultimo_acesso_em, ${SQL_GRUPO} AS grupo
           FROM usuario u WHERE ${where} ORDER BY u.login LIMIT ? OFFSET ?`,
        [est, ...p, f.porPagina, (f.pagina - 1) * f.porPagina],
        { teto: TETO },
      );
      return {
        total: num(t?.['n'] ?? 0),
        itens: ls.map((x) => ({
          login: txt(x['login']),
          nome: txtOuNull(x['nome']),
          grupo: txtOuNull(x['grupo']),
          ativo: txt(x['situacao']) !== 'inativo',
          bloqueado: txt(x['situacao']) === 'bloqueado',
          ultimoAcesso: x['ultimo_acesso_em'] ? iso(x['ultimo_acesso_em']) : null,
        })),
      };
    });

  private conta(x: Linha): ContaCpf {
    return {
      login: txt(x['login']),
      nome: txtOuNull(x['nome']),
      grupo: txtOuNull(x['grupo']),
      ativo: txt(x['situacao']) !== 'inativo',
      bloqueado: txt(x['situacao']) === 'bloqueado',
    };
  }

  painelCpf: FonteAdministracao['painelCpf'] = (c) =>
    this.ler(c, async (l, est) => {
      const base = `SELECT u.login, u.nome, u.situacao, ${SQL_GRUPO} AS grupo`;
      const sem = await l.consultar(
        // Conta de pessoa sem CPF só existe com a dispensa registrada (ck_usuario_cpf_pessoa): são estas as listadas.
        `${base} FROM usuario u WHERE u.excluido_em IS NULL AND ${SQL_VINCULO} AND u.cpf IS NULL
           AND u.situacao <> 'inativo' AND u.tipo_conta = 'pessoa' ORDER BY u.login`,
        [est, est],
        { teto: TETO },
      );
      // CPF repetido entre logins é barrado pelo banco (uq_usuario_cpf): a lista fica vazia no produto; a consulta
      // continua como conferência (uma carga externa que contornasse a chave apareceria aqui).
      const dup = await l.consultar(
        `${base}, LEFT(SHA2(u.cpf, 256), 16) AS chave FROM usuario u
          WHERE u.excluido_em IS NULL AND ${SQL_VINCULO} AND u.cpf IN (
            SELECT cpf FROM usuario WHERE cpf IS NOT NULL AND excluido_em IS NULL GROUP BY cpf HAVING COUNT(*) > 1)
          ORDER BY chave, u.login`,
        [est, est],
        { teto: TETO },
      );
      return {
        semCpf: sem.map((x) => this.conta(x)),
        duplicadas: dup.map((x) => ({ ...this.conta(x), chave: txt(x['chave']) })),
      };
    });

  redeDoAcesso: FonteAdministracao['redeDoAcesso'] = () => {
    if (Date.now() - this.lidoEm > 60_000) void this.carregar().catch(() => undefined);
    return {
      rede: this.opcoes.rede,
      estabelecimentos: this.estabelecimentos.map((e) => ({ codigo: e.codigo, nome: e.nome })),
    };
  };

  contasDoCpf: FonteAdministracao['contasDoCpf'] = (c, cpf) =>
    this.ler(c, async (l, est) => {
      const ls = await l.consultar(
        `SELECT u.login, u.nome, u.situacao, ${SQL_GRUPO} AS grupo,
            (SELECT GROUP_CONCAT(p.codigo ORDER BY p.codigo SEPARATOR ',') FROM usuario_perfil up
               JOIN perfil_acesso p ON p.id = up.perfil_acesso_id
              WHERE up.usuario_id = u.id AND up.estabelecimento_id = ? AND up.excluido_em IS NULL
                AND (up.vigencia_fim IS NULL OR up.vigencia_fim >= CURRENT_DATE)) AS perfis
           FROM usuario u WHERE u.cpf = ? AND u.excluido_em IS NULL AND ${SQL_VINCULO} ORDER BY u.login`,
        [est, est, cpf.replace(/\D/g, ''), est],
        { teto: 100 },
      );
      return ls.map((x): ContaRede => ({
        ...this.conta(x),
        perfis: txt(x['perfis']) ? txt(x['perfis']).split(',') : [],
      }));
    });

  fichaUsuario: FonteAdministracao['fichaUsuario'] = (c, login, _auditor, opcoes) =>
    this.ler(c, async (l, est): Promise<FichaUsuario | null> => {
      const u = await l.uma(
        `SELECT u.id, u.login, u.nome, u.cpf, u.situacao, u.versao, ${SQL_GRUPO} AS grupo,
            (SELECT p.ativo FROM usuario_perfil up JOIN perfil_acesso p ON p.id = up.perfil_acesso_id
              WHERE up.usuario_id = u.id AND up.estabelecimento_id = ? AND up.excluido_em IS NULL ORDER BY up.id LIMIT 1) AS grupo_ativo,
            (SELECT COUNT(*) FROM credencial_usuario cr WHERE cr.usuario_id = u.id AND cr.excluido_em IS NULL) AS credenciais
           FROM usuario u WHERE u.login = ? AND u.excluido_em IS NULL AND ${SQL_VINCULO}`,
        [est, est, login, est],
      );
      if (!u) return null;
      const id = num(u['id']);
      const papeis = await l.consultar(
        `SELECT ps.id, ps.nome, (ups.vigencia_fim IS NULL OR ups.vigencia_fim >= CURRENT_DATE) AS vigente
           FROM usuario_papel_seguranca ups JOIN papel_seguranca ps ON ps.id = ups.papel_seguranca_id
          WHERE ups.usuario_id = ? AND ups.excluido_em IS NULL ORDER BY ps.id`,
        [id],
        { teto: 100 },
      );
      const escopo = async (sql: string, p: unknown[]): Promise<ItemEscopo[]> =>
        (await l.consultar(sql, p, { teto: TETO })).map((x) => ({
          valor: txt(x['valor']),
          rotulo: txt(x['rotulo']),
        }));
      const escopos: Record<string, ItemEscopo[]> = {
        unidade: await escopo(
          `SELECT ua.id AS valor, ua.nome AS rotulo FROM usuario_unidade x JOIN unidade_assistencial ua ON ua.id = x.unidade_assistencial_id
            WHERE x.usuario_id = ? AND x.excluido_em IS NULL AND ua.estabelecimento_id = ? ORDER BY ua.nome`,
          [id, est],
        ),
        local: await escopo(
          `SELECT la.id AS valor, la.descricao AS rotulo FROM usuario_local_atendimento x JOIN local_atendimento la ON la.id = x.local_atendimento_id
            WHERE x.usuario_id = ? AND x.excluido_em IS NULL AND la.estabelecimento_id = ? ORDER BY la.descricao`,
          [id, est],
        ),
        convenio: await escopo(
          `SELECT fp.id AS valor, fp.nome AS rotulo FROM usuario_fonte_pagadora x JOIN fonte_pagadora fp ON fp.id = x.fonte_pagadora_id
            WHERE x.usuario_id = ? AND x.excluido_em IS NULL ORDER BY fp.nome`,
          [id],
        ),
        tipoProntuario: await escopo(
          `SELECT t.id AS valor, t.descricao AS rotulo FROM usuario_tipo_prontuario x JOIN tipo_documento_clinico t ON t.id = x.tipo_documento_clinico_id
            WHERE x.usuario_id = ? AND x.excluido_em IS NULL ORDER BY t.descricao`,
          [id],
        ),
      };
      const [cons] = await l.consultar(
        `SELECT (SELECT COUNT(*) FROM local_estoque_usuario WHERE usuario_id = ? AND excluido_em IS NULL) AS estoques,
                (SELECT COUNT(*) FROM permissao_conta_bancaria WHERE usuario_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL) AS contas,
                (SELECT COUNT(*) FROM centro_custo WHERE responsavel_usuario_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL) AS centros`,
        [id, id, est, id, est],
      );
      const conexao = await l.uma(
        "SELECT MAX(ocorrido_em) AS ultima FROM trilha_auditoria WHERE usuario_id = ? AND acao = 'login'",
        [id],
      );
      const termo = await l.uma(SQL_TERMO_VIGENTE, [est]);
      const aceite = termo
        ? await l.uma(
            `SELECT ocorrido_em FROM aceite_termo_uso WHERE termo_uso_versao_id = ? AND usuario_id = ? AND valido
               AND revogado_em IS NULL ORDER BY id DESC LIMIT 1`,
            [num(termo['id']), id],
          )
        : null;
      const [senha] = await l.consultar(
        'SELECT COUNT(*) AS trocas, MAX(ocorrido_em) AS ultima FROM historico_senha WHERE usuario_id = ?',
        [id],
      );
      const prof = await l.uma(
        `SELECT pr.id, COALESCE(pr.nome_exibicao, pf.nome) AS nome FROM usuario_profissional up
           JOIN profissional pr ON pr.id = up.profissional_id JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
          WHERE up.usuario_id = ? AND up.excluido_em IS NULL AND (up.vigencia_fim IS NULL OR up.vigencia_fim >= CURRENT_DATE)
          ORDER BY up.id DESC LIMIT 1`,
        [id],
      );
      return {
        login: txt(u['login']),
        id,
        nome: txtOuNull(u['nome']),
        grupo: txtOuNull(u['grupo']),
        ativo: txt(u['situacao']) !== 'inativo',
        bloqueado: txt(u['situacao']) === 'bloqueado',
        cpfInformado: u['cpf'] !== null && u['cpf'] !== undefined,
        cpf: opcoes?.cpf === true ? txtOuNull(u['cpf']) : null,
        senhaDefinida: num(u['credenciais']) > 0,
        versao: [String(num(u['versao']))],
        grupoAtivo:
          u['grupo_ativo'] === null || u['grupo_ativo'] === undefined ? null : bool(u['grupo_ativo']),
        papeis: papeis.map((x) => ({ papel: num(x['id']), nome: txt(x['nome']), ativo: bool(x['vigente']) })),
        escopos,
        escoposConsulta: {
          centrosCusto: num(cons?.['centros'] ?? 0),
          locaisEstoque: num(cons?.['estoques'] ?? 0),
          contasBancarias: num(cons?.['contas'] ?? 0),
        },
        // As permissões complementares por coluna-letra do sistema de origem não existem no produto: as exceções
        // por ação (usuario_acao_excecao) ficam para a tela nova (pendência registrada).
        flags: [],
        conexoes: conexao?.['ultima'] ? [{ modulo: 0, nome: 'Sistema', ultima: iso(conexao['ultima']) }] : [],
        termo: { aceitouVigente: aceite !== null, aceitoEm: aceite ? iso(aceite['ocorrido_em']) : null },
        historicoSenha: {
          trocas: num(senha?.['trocas'] ?? 0),
          ultima: senha?.['ultima'] ? iso(senha['ultima']) : null,
        },
        profissionalVinculado: prof ? { id: num(prof['id']), nome: txt(prof['nome']) } : null,
      };
    });

  opcoesEscopo: FonteAdministracao['opcoesEscopo'] = (c) =>
    this.ler(c, async (l, est) => {
      const q = async (sql: string, p: unknown[]): Promise<ItemEscopo[]> =>
        (await l.consultar(sql, p, { teto: TETO })).map((x) => ({
          valor: txt(x['valor']),
          rotulo: txt(x['rotulo']),
        }));
      return {
        unidade: await q(
          'SELECT id AS valor, nome AS rotulo FROM unidade_assistencial WHERE estabelecimento_id = ? AND ativo AND excluido_em IS NULL ORDER BY nome',
          [est],
        ),
        local: await q(
          'SELECT id AS valor, descricao AS rotulo FROM local_atendimento WHERE estabelecimento_id = ? AND ativo AND excluido_em IS NULL ORDER BY descricao',
          [est],
        ),
        // Fonte pagadora é cadastro da rede inteira (sem estabelecimento_id).
        convenio: await q(
          "SELECT id AS valor, nome AS rotulo FROM fonte_pagadora WHERE situacao = 'ativa' AND excluido_em IS NULL ORDER BY nome",
          [],
        ),
        tipoProntuario: await q(
          'SELECT id AS valor, descricao AS rotulo FROM tipo_documento_clinico WHERE ativo ORDER BY descricao',
          [],
        ),
      };
    });

  setores: FonteAdministracao['setores'] = (c, login) =>
    this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT b.codigo AS valor, b.nome AS rotulo FROM usuario_escopo ue
             JOIN tipo_escopo_acesso t ON t.id = ue.tipo_escopo_acesso_id AND t.entidade = 'bloco_internacao'
             JOIN bloco_internacao b ON b.id = ue.entidade_id
             JOIN usuario u ON u.id = ue.usuario_id
            WHERE u.login = ? AND ue.estabelecimento_id = ? AND ue.excluido_em IS NULL
              AND (ue.vigencia_fim IS NULL OR ue.vigencia_fim >= CURRENT_DATE) ORDER BY b.codigo`,
          [login, est],
          { teto: 1000 },
        )
      ).map((x) => ({ valor: txt(x['valor']), rotulo: txt(x['rotulo']) })),
    );

  grupos: FonteAdministracao['grupos'] = (c) =>
    this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT p.codigo, p.ativo,
              (SELECT COUNT(DISTINCT up.usuario_id) FROM usuario_perfil up JOIN usuario u ON u.id = up.usuario_id
                WHERE up.perfil_acesso_id = p.id AND up.estabelecimento_id = ? AND up.excluido_em IS NULL
                  AND (up.vigencia_fim IS NULL OR up.vigencia_fim >= CURRENT_DATE)
                  AND u.situacao = 'ativo' AND u.excluido_em IS NULL) AS ativos
             FROM perfil_acesso p WHERE p.excluido_em IS NULL AND (p.estabelecimento_id IS NULL OR p.estabelecimento_id = ?)
            ORDER BY p.codigo`,
          [est, est],
          { teto: TETO },
        )
      ).map((x) => ({ nome: txt(x['codigo']), ativo: bool(x['ativo']), usuariosAtivos: num(x['ativos']) })),
    );

  /** Preferências da própria conta (01-ADM L84). */
  lerPreferencias(c: Ctx, usuario: number | null, tela?: string, permissoes?: ReadonlySet<string>) {
    return this.ler(c, (l) => lerPreferenciasDoUsuario(l, usuario, tela, permissoes));
  }

  receita = (nome: string): EstadoOperacaoGestao =>
    nome in OPERACOES
      ? { estado: 'ligada', ligada: true, motivo: null }
      : { estado: 'pendente', ligada: false, motivo: MOTIVO_PENDENTE };

  async executar(nome: string, entrada: unknown, ctx: ContextoGestao): Promise<Record<string, unknown>> {
    const op = (OPERACOES as Record<string, (typeof OPERACOES)[keyof typeof OPERACOES]>)[nome];
    if (!op)
      throw new ErroProblema('recusa-de-negocio', 409, 'Operação indisponível', MOTIVO_PENDENTE, {
        codigo: 'operacao-pendente',
      });
    const contexto = await this.contexto(
      ctx.hospital,
      ctx.correlacao,
      ctx.usuario,
      ctx.chaveIdempotencia,
      ctx.reautenticadoEm,
    );
    const r = await this.executor.executar(op as never, this.cliente, entrada, contexto);
    return { ...r.resultado };
  }

  async setor(
    c: Ctx,
    p: Parameters<FonteAdministracao['setor']>[1],
    acao: 'conceder' | 'retirar',
    t: Parameters<FonteAdministracao['setor']>[3],
  ) {
    const usuario = await this.idDoLogin(c, t.usuario);
    const chave = `setor-${createHash('sha256').update(`${t.correlacao}|${p.login}|${p.bloco}|${acao}`).digest('hex').slice(0, 40)}`;
    const ctx = await this.contexto(c.hospital, t.correlacao, usuario, chave);
    await this.executor.executar(
      operacaoSetor(acao === 'conceder'),
      this.cliente,
      { idUsuario: p.idUsuario, bloco: p.bloco },
      ctx,
    );
  }

  arvore: FonteAdministracao['arvore'] = (c) =>
    this.ler(c, async (l) => {
      const acoes = await l.consultar(
        `SELECT id, codigo, descricao, ativo, modulo_sistema_id, ordem FROM acao_sistema
          WHERE permissionavel AND modulo_sistema_id IS NOT NULL ORDER BY modulo_sistema_id, ordem, id`,
        [],
        { teto: 100_000 },
      );
      const modulos = await l.consultar(
        'SELECT id, codigo, descricao FROM modulo_sistema WHERE ativo ORDER BY ordem, id',
        [],
        {
          teto: TETO,
        },
      );
      const porModulo = new Map<number, number>();
      return {
        opcoes: acoes.map((x): AcaoMenu => {
          const m = num(x['modulo_sistema_id']);
          const indice = (porModulo.get(m) ?? 0) + 1;
          porModulo.set(m, indice);
          return {
            id: num(x['id']),
            modulo: m,
            indice,
            nivel: 1,
            ativo: bool(x['ativo']),
            avulsa: false,
            nome: txt(x['codigo']),
            titulo: txt(x['descricao']),
          };
        }),
        modulos: modulos.map((x) => ({
          id: num(x['id']),
          sistema: txt(x['codigo']),
          executavel: null,
          nome: txt(x['descricao']),
        })),
      };
    });

  opcoesDoGrupo: FonteAdministracao['opcoesDoGrupo'] = (c, grupo) =>
    this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT pa.acao_sistema_id AS id FROM perfil_acao pa JOIN perfil_acesso p ON p.id = pa.perfil_acesso_id
            WHERE p.codigo = ? AND (p.estabelecimento_id IS NULL OR p.estabelecimento_id = ?) AND pa.permitido
              AND pa.excluido_em IS NULL AND p.excluido_em IS NULL ORDER BY pa.acao_sistema_id`,
          [grupo, est],
          { teto: 100_000 },
        )
      ).map((x) => num(x['id'])),
    );

  opcoesDoPapel: FonteAdministracao['opcoesDoPapel'] = (c, papel) =>
    this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT acao_sistema_id AS id FROM papel_seguranca_acao WHERE papel_seguranca_id = ? AND excluido_em IS NULL
              AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE) ORDER BY acao_sistema_id`,
          [papel],
          { teto: 100_000 },
        )
      ).map((x) => num(x['id'])),
    );

  papeis: FonteAdministracao['papeis'] = (c) =>
    this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT ps.id, ps.nome,
              (SELECT COUNT(DISTINCT ups.usuario_id) FROM usuario_papel_seguranca ups JOIN usuario u ON u.id = ups.usuario_id
                WHERE ups.papel_seguranca_id = ps.id AND ups.excluido_em IS NULL AND u.situacao = 'ativo'
                  AND (ups.vigencia_fim IS NULL OR ups.vigencia_fim >= CURRENT_DATE)) AS usuarios,
              (SELECT COUNT(*) FROM papel_seguranca_acao a WHERE a.papel_seguranca_id = ps.id AND a.excluido_em IS NULL) AS acoes
             FROM papel_seguranca ps WHERE ps.ativo AND ps.excluido_em IS NULL ORDER BY ps.id`,
          [],
          { teto: 1000 },
        )
      ).map((x) => ({
        papel: num(x['id']),
        nome: txt(x['nome']),
        usuariosAtivos: num(x['usuarios']),
        opcoes: num(x['acoes']),
      })),
    );

  politica: FonteAdministracao['politica'] = (c) =>
    this.ler(c, async (l, est): Promise<PoliticaLogin> => {
      const p = await l.uma(
        'SELECT * FROM politica_senha WHERE estabelecimento_id = ? ORDER BY id DESC LIMIT 1',
        [est],
      );
      return {
        senha: {
          minimoCaracteres: p ? numOuNull(p['tamanho_minimo']) : null,
          exigeLetra: p ? bool(p['exige_maiuscula']) || bool(p['exige_minuscula']) : false,
          exigeNumero: p ? bool(p['exige_numero']) : false,
          exigeEspecial: p ? bool(p['exige_especial']) : false,
          exigeMinuscula: p ? bool(p['exige_minuscula']) : false,
          exigeMaiuscula: p ? bool(p['exige_maiuscula']) : false,
          periodoTrocaDias: p ? numOuNull(p['validade_dias']) : null,
          periodoReutilizacaoDias: null,
        },
        tempo: {
          inatividadeSegundos: p ? num(p['inatividade_sessao_minutos']) * 60 : null,
          avisoSegundos:
            p && p['aviso_fim_sessao_minutos'] !== null ? num(p['aviso_fim_sessao_minutos']) * 60 : null,
        },
        limiteTentativas: p ? numOuNull(p['tentativas_ate_bloqueio']) : null,
        termoPeriodico: p ? bool(p['exige_aceite_periodico']) : false,
        quantidadePeriodoTermo: p ? numOuNull(p['periodicidade_aceite_dias']) : null,
        tipoPeriodoTermo: p && p['periodicidade_aceite_dias'] !== null ? 'dias' : null,
      };
    });

  tiposAcessoProntuario: FonteAdministracao['tiposAcessoProntuario'] = (c) =>
    this.ler(c, async (l) =>
      (
        await l.consultar(
          'SELECT id, descricao FROM tipo_documento_clinico WHERE ativo ORDER BY ordem, descricao',
          [],
          { teto: TETO },
        )
      ).map((x) => ({ id: num(x['id']), descricao: txt(x['descricao']) })),
    );

  termoVigente: FonteAdministracao['termoVigente'] = (c) =>
    this.ler(c, async (l, est) => {
      const t = await l.uma(SQL_TERMO_VIGENTE, [est]);
      if (!t) return null;
      const id = num(t['id']);
      const [n] = await l.consultar(
        'SELECT COUNT(*) AS n FROM aceite_termo_uso WHERE termo_uso_versao_id = ? AND valido AND revogado_em IS NULL',
        [id],
      );
      const ult = await l.consultar(
        `SELECT u.login, a.ocorrido_em FROM aceite_termo_uso a JOIN usuario u ON u.id = a.usuario_id
          WHERE a.termo_uso_versao_id = ? AND a.valido AND a.revogado_em IS NULL ORDER BY a.ocorrido_em DESC, a.id DESC LIMIT 10`,
        [id],
      );
      return {
        id,
        texto: txt(t['texto']),
        desde: dia(t['vigencia_inicio']) ?? '',
        aceites: num(n?.['n'] ?? 0),
        ultimos: ult.map((x) => ({ login: txt(x['login']), em: iso(x['ocorrido_em']) })),
      };
    });

  termoAceito: FonteAdministracao['termoAceito'] = (c, login, termo) =>
    this.ler(
      c,
      async (l) =>
        (await l.uma(
          `SELECT a.id FROM aceite_termo_uso a JOIN usuario u ON u.id = a.usuario_id
          WHERE a.termo_uso_versao_id = ? AND u.login = ? AND a.valido AND a.revogado_em IS NULL LIMIT 1`,
          [termo, login],
        )) !== null,
    );

  versoesTermo: FonteAdministracao['versoesTermo'] = (c) =>
    this.ler(c, async (l, est) => {
      const vigente = await l.uma(SQL_TERMO_VIGENTE, [est]);
      const vs = await l.consultar(
        `SELECT t.id, t.vigencia_inicio, u.login,
            (SELECT COUNT(*) FROM aceite_termo_uso a WHERE a.termo_uso_versao_id = t.id AND a.valido AND a.revogado_em IS NULL) AS aceites
           FROM termo_uso_versao t LEFT JOIN usuario u ON u.id = t.publicado_por_usuario_id
          WHERE t.publico = 'sistema' AND t.situacao <> 'rascunho' AND t.excluido_em IS NULL
            AND (t.estabelecimento_id IS NULL OR t.estabelecimento_id = ?)
          ORDER BY t.vigencia_inicio DESC, t.id DESC`,
        [est],
        { teto: 1000 },
      );
      return vs.map((x) => ({
        id: num(x['id']),
        desde: dia(x['vigencia_inicio']) ?? '',
        vigente: vigente !== null && num(vigente['id']) === num(x['id']),
        publicadoPor: txt(x['login']),
        aceites: num(x['aceites']),
      }));
    });

  versaoTermo: FonteAdministracao['versaoTermo'] = (c, id, pagina) =>
    this.ler(c, async (l, est) => {
      const t = await l.uma(
        `SELECT id, texto, vigencia_inicio FROM termo_uso_versao WHERE id = ? AND publico = 'sistema' AND excluido_em IS NULL
            AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)`,
        [id, est],
      );
      if (!t) return null;
      const vigente = await l.uma(SQL_TERMO_VIGENTE, [est]);
      const [n] = await l.consultar(
        'SELECT COUNT(*) AS n FROM aceite_termo_uso WHERE termo_uso_versao_id = ? AND valido',
        [id],
      );
      const itens = await l.consultar(
        `SELECT u.login, a.ocorrido_em FROM aceite_termo_uso a JOIN usuario u ON u.id = a.usuario_id
          WHERE a.termo_uso_versao_id = ? AND a.valido ORDER BY a.ocorrido_em DESC, a.id DESC LIMIT 50 OFFSET ?`,
        [id, (pagina - 1) * 50],
      );
      return {
        id,
        texto: txt(t['texto']),
        desde: dia(t['vigencia_inicio']) ?? '',
        vigente: vigente !== null && num(vigente['id']) === id,
        aceites: num(n?.['n'] ?? 0),
        pagina,
        itens: itens.map((x) => ({ login: txt(x['login']), em: iso(x['ocorrido_em']) })),
      };
    });

  quebras: FonteAdministracao['quebras'] = (c) =>
    this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT a.id, u.login, a.paciente_id, pa.numero_prontuario, m.descricao AS motivo, a.justificativa, a.inicio_em, a.fim_em,
              r.parecer, ur.login AS revisor, r.ocorrido_em AS revisado_em
             FROM acesso_emergencial a JOIN usuario u ON u.id = a.usuario_id
             LEFT JOIN paciente pa ON pa.id = a.paciente_id
             LEFT JOIN motivo_acesso_emergencial m ON m.id = a.motivo_acesso_emergencial_id
             LEFT JOIN revisao_acesso_emergencial r ON r.acesso_emergencial_id = a.id
             LEFT JOIN usuario ur ON ur.id = r.revisor_usuario_id
            WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL ORDER BY a.inicio_em DESC, a.id DESC LIMIT 1000`,
          [est],
          { teto: 1000 },
        )
      ).map((x) => ({
        id: String(x['id']),
        login: txt(x['login']),
        idPaciente: numOuNull(x['paciente_id']),
        prontuario: numOuNull(x['numero_prontuario']),
        motivo: txtOuNull(x['motivo']),
        justificativa: txtOuNull(x['justificativa']),
        inicio: data(x['inicio_em']),
        fim: data(x['fim_em']),
        revisao: x['parecer']
          ? {
              classificacao: txt(x['parecer']) === 'procedente' ? 'justificado' : 'nao-justificado',
              por: txt(x['revisor']),
              em: data(x['revisado_em']) ?? new Date(0),
            }
          : null,
      })),
    );

  async revisarQuebra(
    c: Ctx,
    r: Parameters<FonteAdministracao['revisarQuebra']>[1],
    t: Parameters<FonteAdministracao['revisarQuebra']>[2],
  ) {
    const usuario = r.idUsuario > 0 ? r.idUsuario : await this.idDoLogin(c, r.login);
    const chave = `revisao-${createHash('sha256').update(`${r.idEmergencia}|${r.classificacao}`).digest('hex').slice(0, 40)}`;
    const ctx = await this.contexto(c.hospital, t.correlacao, usuario, chave);
    const x = await this.executor.executar(
      operacaoRevisarQuebra,
      this.cliente,
      { id: Number(r.idEmergencia), classificacao: r.classificacao },
      ctx,
    );
    return String(x.resultado.id);
  }

  // ── Estrutura ────────────────────────────────────────────────────────────────────────────────
  estrutura: FonteAdministracao['estrutura'] = (c) =>
    this.ler(c, async (l, est) => {
      const e = await l.uma(
        `SELECT e.id, e.nome_fantasia, e.razao_social, e.cnpj, e.codigo_cnes, e.fuso_horario, e.ativo,
            m.nome AS municipio, uf.sigla AS uf, ea.descricao AS esfera, ce.descricao AS complexidade
           FROM estabelecimento e
           LEFT JOIN municipio_ibge m ON m.id = e.municipio_ibge_id
           LEFT JOIN unidade_federativa uf ON uf.id = m.unidade_federativa_id
           LEFT JOIN esfera_administrativa ea ON ea.id = e.esfera_administrativa_id
           LEFT JOIN complexidade_estabelecimento ce ON ce.id = e.complexidade_estabelecimento_id
          WHERE e.id = ?`,
        [est],
      );
      const us = await l.consultar(
        'SELECT id, nome, codigo_cnes, ativo FROM unidade_assistencial WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY nome',
        [est],
        { teto: TETO },
      );
      return {
        empresa: e
          ? { codigo: est, nome: txt(e['razao_social']), cnpj: txtOuNull(e['cnpj']), ativa: bool(e['ativo']) }
          : null,
        hospital: e
          ? {
              codigo: est,
              nome: txt(e['nome_fantasia']),
              cnes: numOuNull(e['codigo_cnes']),
              cnpj: txtOuNull(e['cnpj']),
              municipio: txtOuNull(e['municipio']),
              uf: txtOuNull(e['uf']),
              esfera: txtOuNull(e['esfera']),
              complexidade: txtOuNull(e['complexidade']),
              fusoHorario: txtOuNull(e['fuso_horario']),
            }
          : null,
        unidades: us.map((u) => ({
          codigo: num(u['id']),
          nome: txt(u['nome']),
          cnes: numOuNull(u['codigo_cnes']),
          ativa: bool(u['ativo']),
        })),
      };
    });

  leitos: FonteAdministracao['leitos'] = (c) =>
    this.ler(c, async (l, est) => {
      const blocos = await l.consultar(
        'SELECT codigo, nome, quantidade_andares FROM bloco_internacao WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY codigo',
        [est],
        { teto: TETO },
      );
      const acs = await l.consultar(
        `SELECT a.codigo, a.nome, a.andar, a.quantidade_leitos, a.sexo_permitido, a.abrangencia_cobertura, a.centro_custo_id, a.versao,
            a.categoria_acomodacao_id, b.codigo AS bloco
           FROM acomodacao a LEFT JOIN bloco_internacao b ON b.id = a.bloco_internacao_id
          WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL ORDER BY b.codigo, a.codigo`,
        [est],
        { teto: TETO },
      );
      const leitos = await l.consultar(
        `SELECT lh.id, lh.codigo, lh.ativo, lh.ramal, lh.andar, lh.versao, a.codigo AS acomodacao, b.codigo AS bloco,
            EXISTS (SELECT 1 FROM ocupacao_leito o WHERE o.leito_hospitalar_id = lh.id AND o.data_hora_fim IS NULL
                      AND o.excluido_em IS NULL) AS ocupado
           FROM leito_hospitalar lh JOIN acomodacao a ON a.id = lh.acomodacao_id
           LEFT JOIN bloco_internacao b ON b.id = COALESCE(lh.bloco_internacao_id, a.bloco_internacao_id)
          WHERE lh.estabelecimento_id = ? AND lh.excluido_em IS NULL ORDER BY b.codigo, a.codigo, lh.codigo`,
        [est],
        { teto: 100_000 },
      );
      const centros = await l.consultar(
        'SELECT id, nome FROM centro_custo WHERE estabelecimento_id = ? AND ativo AND excluido_em IS NULL ORDER BY nome',
        [est],
        { teto: TETO },
      );
      // Categoria de acomodação é cadastro do cliente inteiro (sem estabelecimento_id).
      const categorias = await l.consultar(
        'SELECT id, descricao FROM categoria_acomodacao WHERE ativo ORDER BY descricao',
        [],
        {
          teto: TETO,
        },
      );
      return {
        blocos: blocos.map((b) => ({
          bloco: txt(b['codigo']),
          nome: txt(b['nome']),
          andares: numOuNull(b['quantidade_andares']),
        })),
        acomodacoes: acs.map((a) => ({
          bloco: txt(a['bloco']),
          acomodacao: txt(a['codigo']),
          nome: txt(a['nome']),
          andar: numOuNull(a['andar']),
          leitosPrevistos: numOuNull(a['quantidade_leitos']),
          sexo: txtOuNull(a['sexo_permitido']),
          tipo: numOuNull(a['categoria_acomodacao_id']),
          convenio: txtOuNull(a['abrangencia_cobertura']),
          centroCusto: numOuNull(a['centro_custo_id']),
          localConta: null,
          versao: num(a['versao']),
        })),
        leitos: leitos.map((x) => ({
          id: num(x['id']),
          bloco: txt(x['bloco']),
          acomodacao: txt(x['acomodacao']),
          leito: txt(x['codigo']),
          ativo: bool(x['ativo']),
          ocupado: bool(x['ocupado']),
          ramal: numOuNull(x['ramal']),
          andar: numOuNull(x['andar']),
          versao: num(x['versao']),
        })),
        opcoes: {
          tipos: categorias.map((x) => ({ valor: num(x['id']), rotulo: txt(x['descricao']) })),
          centrosCusto: centros.map((x) => ({ valor: num(x['id']), rotulo: txt(x['nome']) })),
          locaisConta: [],
          tiposTiss: [],
        },
      };
    });

  locaisComplementos: FonteAdministracao['locaisComplementos'] = (c) =>
    this.ler(c, async (l, est) => {
      const g = await l.consultar(
        `SELECT g.numero, p.descricao FROM guiche_recepcao g JOIN ponto_recepcao p ON p.id = g.ponto_recepcao_id
          WHERE p.estabelecimento_id = ? AND g.ativo AND g.excluido_em IS NULL AND p.excluido_em IS NULL ORDER BY p.descricao, g.numero`,
        [est],
        { teto: TETO },
      );
      const [n] = await l.consultar(
        `SELECT COUNT(*) AS n FROM local_atendimento WHERE estabelecimento_id = ? AND permite_encaminhamento AND ativo AND excluido_em IS NULL`,
        [est],
      );
      return {
        guiches: g.map((x) => ({ numero: num(x['numero']), recepcao: txt(x['descricao']) })),
        // Sem tabela no modelo (pedido de DDL/contrato em saida/02-05.json): null, nunca um zero inventado.
        horarios: null,
        encaminhamentos: num(n?.['n'] ?? 0),
        pesquisados: null,
      };
    });

  // ── Consultas ────────────────────────────────────────────────────────────────────────────────
  alertas: FonteAdministracao['alertas'] = (c) =>
    this.ler(c, async (l, est) => {
      const rs = await l.consultar(
        `SELECT r.id, r.nome, r.ativo, r.idade_minima_anos, r.idade_maxima_anos, ca.descricao AS cenario,
            (SELECT COUNT(DISTINCT d.usuario_id) FROM regra_alerta_destinatario d
              WHERE d.regra_alerta_id = r.id AND d.usuario_id IS NOT NULL AND d.ativo AND d.excluido_em IS NULL)
          + (SELECT COUNT(DISTINCT s.usuario_id) FROM assinatura_alerta s
              WHERE s.regra_alerta_id = r.id AND s.ativo AND s.excluido_em IS NULL
                AND s.usuario_id NOT IN (SELECT d2.usuario_id FROM regra_alerta_destinatario d2 WHERE d2.regra_alerta_id = r.id
                      AND d2.usuario_id IS NOT NULL AND d2.ativo AND d2.excluido_em IS NULL)) AS usuarios
           FROM regra_alerta r JOIN cenario_alerta ca ON ca.id = r.cenario_alerta_id
          WHERE (r.estabelecimento_id IS NULL OR r.estabelecimento_id = ?) ORDER BY r.nome`,
        [est],
        { teto: TETO },
      );
      const gs = rs.length
        ? await l.consultar(
            `SELECT g.regra_alerta_id, COALESCE(a.codigo, t.codigo) AS opcao, g.evento FROM alerta_gatilho g
               LEFT JOIN acao_sistema a ON a.id = g.acao_sistema_id LEFT JOIN tela_sistema t ON t.id = g.tela_sistema_id
              WHERE g.regra_alerta_id IN (${rs.map(() => '?').join(', ')}) AND g.ativo AND g.excluido_em IS NULL
              ORDER BY g.regra_alerta_id, g.sequencia`,
            rs.map((x) => num(x['id'])),
            { teto: TETO },
          )
        : [];
      return rs.map((x) => ({
        id: num(x['id']),
        nome: txt(x['nome']),
        ativo: bool(x['ativo']),
        origem: 'sistema' as const,
        exibicao: null,
        idadeInicial: numOuNull(x['idade_minima_anos']),
        idadeFinal: numOuNull(x['idade_maxima_anos']),
        cenario: txtOuNull(x['cenario']),
        gatilhos: gs
          .filter((g) => num(g['regra_alerta_id']) === num(x['id']))
          .map((g) => ({ opcao: txt(g['opcao']), evento: txt(g['evento']) })),
        // Usuários que recebem: destinatários nominais e assinaturas (os por perfil/setor não entram na contagem).
        usuarios: num(x['usuarios']),
      }));
    });

  email: FonteAdministracao['email'] = (c) =>
    this.ler(c, async (l, est) => ({
      servidores: (
        await l.consultar(
          `SELECT id, host, porta, seguranca, usuario_autenticacao IS NOT NULL AS com_usuario, referencia_cofre IS NOT NULL AS com_senha
             FROM servidor_email WHERE ativo AND (estabelecimento_id IS NULL OR estabelecimento_id = ?) ORDER BY padrao DESC, id`,
          [est],
          { teto: 100 },
        )
      ).map((x) => ({
        id: num(x['id']),
        servidor: txt(x['host']),
        porta: num(x['porta']),
        ssl: txt(x['seguranca']) !== 'nenhuma',
        usuarioDefinido: bool(x['com_usuario']),
        senhaDefinida: bool(x['com_senha']),
      })),
      // Finalidades atendidas pelos servidores ativos (servidor sem finalidade atende todas).
      modulos: (
        await l.consultar(
          `SELECT f.id, f.descricao FROM finalidade_email f
            WHERE f.ativo AND EXISTS (SELECT 1 FROM servidor_email s WHERE s.ativo AND (s.estabelecimento_id IS NULL OR s.estabelecimento_id = ?)
                    AND (s.finalidade_email_id IS NULL OR s.finalidade_email_id = f.id))
            ORDER BY f.descricao`,
          [est],
          { teto: 1000 },
        )
      ).map((x) => ({ id: num(x['id']), nome: txt(x['descricao']) })),
    }));

  fiscais: FonteAdministracao['fiscais'] = (c) =>
    this.ler(c, async (l, est) => {
      const e = await l.uma(
        `SELECT e.id, e.razao_social, e.cnpj, e.inscricao_estadual, e.inscricao_municipal, e.ativo,
            m.nome AS municipio, uf.sigla AS uf, mt.id AS mantenedora, mt.cnae_principal, mt.registro_ans, mt.optante_simples
           FROM estabelecimento e
           LEFT JOIN municipio_ibge m ON m.id = e.municipio_ibge_id
           LEFT JOIN unidade_federativa uf ON uf.id = m.unidade_federativa_id
           LEFT JOIN mantenedora mt ON mt.id = e.mantenedora_id AND mt.excluido_em IS NULL
          WHERE e.id = ?`,
        [est],
      );
      return e
        ? {
            codigo: est,
            nome: txt(e['razao_social']),
            cnpj: txtOuNull(e['cnpj']),
            inscricaoEstadual: txtOuNull(e['inscricao_estadual']),
            inscricaoMunicipal: txtOuNull(e['inscricao_municipal']),
            cnae: txtOuNull(e['cnae_principal']),
            municipio: txtOuNull(e['municipio']),
            uf: txtOuNull(e['uf']),
            // Da mantenedora (dado fiscal dela). Sem mantenedora cadastrada, o contrato (z.boolean) obriga um valor:
            // sai false e o pedido de contrato anulável está em saida/02-05.json.
            optanteSimples:
              e['mantenedora'] !== null && e['mantenedora'] !== undefined
                ? bool(e['optante_simples'])
                : false,
            registroAns: numOuNull(e['registro_ans']),
            tipoEmpresa: null,
            cooperativa: null,
            construtora: null,
            ativa: bool(e['ativo']),
          }
        : null;
    });

  /** Os catálogos da verificação de cópia (verificacao_backup): situações e procedimentos do modelo. */
  backup: FonteAdministracao['backup'] = () =>
    Promise.resolve({
      situacoes: [
        { id: 1, descricao: 'Em andamento' },
        { id: 2, descricao: 'Concluído' },
        { id: 3, descricao: 'Falhou' },
        { id: 4, descricao: 'Cancelado' },
      ],
      procedimentos: [
        { id: 1, descricao: 'Cópia completa' },
        { id: 2, descricao: 'Cópia incremental' },
        { id: 3, descricao: 'Cópia diferencial' },
        { id: 4, descricao: 'Cópia do log' },
        { id: 5, descricao: 'Restauração' },
      ],
    });

  // ── Auditoria ────────────────────────────────────────────────────────────────────────────────
  trilha: FonteAdministracao['trilha'] = (c, f) =>
    this.ler(c, async (l, est) => {
      const onde = ['t.estabelecimento_id = ?', 't.ocorrido_em >= ?', 't.ocorrido_em < ?'];
      const p: unknown[] = [est, f.inicio, f.fimExclusivo];
      if (f.usuario) {
        onde.push('u.login = ?');
        p.push(f.usuario);
      }
      if (f.evento) {
        onde.push('(t.acao = ? OR t.entidade = ?)');
        p.push(f.evento, f.evento);
      }
      if (f.paciente !== undefined) {
        onde.push("t.entidade = 'paciente' AND t.entidade_id = ?");
        p.push(f.paciente);
      }
      const ls = await l.consultar(
        `SELECT t.id, t.ocorrido_em, u.login, t.acao, t.entidade, t.entidade_id, t.endereco_ip
           FROM trilha_auditoria t LEFT JOIN usuario u ON u.id = t.usuario_id
          WHERE ${onde.join(' AND ')} ORDER BY t.ocorrido_em DESC, t.id DESC LIMIT ?`,
        [...p, f.limite],
        { teto: f.limite },
      );
      return ls.map((x): LinhaTrilhaLida => ({
        id: `T${String(x['id']).padStart(15, '0')}`,
        dataHora: isoSeg(x['ocorrido_em']),
        usuario: txtOuNull(x['login']),
        acao: txt(x['acao']),
        opcao: txtOuNull(x['entidade']),
        criticidade: null,
        estacao: txtOuNull(x['endereco_ip']),
        alvo: x['entidade'] ? `${txt(x['entidade'])}:${txt(x['entidade_id'])}` : null,
        paciente: txt(x['entidade']) === 'paciente' ? numOuNull(x['entidade_id']) : null,
        resultado: txt(x['acao']) === 'acesso_negado' ? 'negado' : 'sucesso',
        atorReal: null,
      }));
    });

  acessosProntuario: FonteAdministracao['acessosProntuario'] = (c, f) =>
    this.ler(c, async (l, est) => {
      const onde = ['r.estabelecimento_id = ?', 'r.ocorrido_em >= ?', 'r.ocorrido_em < ?'];
      const p: unknown[] = [est, f.inicio, f.fimExclusivo];
      if (f.usuario) {
        onde.push('u.login = ?');
        p.push(f.usuario);
      }
      if (f.paciente !== undefined) {
        onde.push('r.paciente_id = ?');
        p.push(f.paciente);
      }
      const ls = await l.consultar(
        `SELECT r.id, r.ocorrido_em, u.login, r.tipo_acesso, r.paciente_id, pa.numero_prontuario, r.atendimento_id,
            COALESCE(r.nome_maquina, r.endereco_ip) AS estacao
           FROM leitura_prontuario r JOIN usuario u ON u.id = r.usuario_id LEFT JOIN paciente pa ON pa.id = r.paciente_id
          WHERE ${onde.join(' AND ')} ORDER BY r.ocorrido_em DESC, r.id DESC LIMIT ?`,
        [...p, f.limite],
        { teto: f.limite },
      );
      return ls.map((x): AcessoProntuarioLido => ({
        id: `L${String(x['id'])}`,
        dataHora: isoSeg(x['ocorrido_em']),
        usuario: txtOuNull(x['login']),
        acao: txt(x['tipo_acesso']),
        opcao: null,
        criticidade: null,
        estacao: txtOuNull(x['estacao']),
        alvo: null,
        paciente: numOuNull(x['paciente_id']),
        resultado: 'sucesso',
        atorReal: null,
        atendimento: numOuNull(x['atendimento_id']),
        prontuario: numOuNull(x['numero_prontuario']),
      }));
    });

  /** O prontuário é número do cliente inteiro (paciente da rede, sem estabelecimento). */
  pacientesDoProntuario: FonteAdministracao['pacientesDoProntuario'] = (c, prontuario) =>
    this.ler(c, async (l) =>
      (
        await l.consultar(
          'SELECT id FROM paciente WHERE numero_prontuario = ? AND excluido_em IS NULL ORDER BY id LIMIT 2',
          [String(prontuario)],
        )
      ).map((x) => num(x['id'])),
    );

  exclusoes: FonteAdministracao['exclusoes'] = (c, inicio, fim) =>
    this.ler(c, async (l, est) => {
      const tipos = await l.consultar(
        `SELECT entidade, COUNT(*) AS n FROM registro_excluido WHERE estabelecimento_id = ? AND ocorrido_em >= ? AND ocorrido_em < ?
            AND excluido_em IS NULL GROUP BY entidade ORDER BY entidade`,
        [est, inicio, fim],
        { teto: TETO },
      );
      const [cx] = await l.consultar(
        `SELECT COUNT(DISTINCT usuario_id) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? AND acao = 'login'
            AND ocorrido_em >= ? AND ocorrido_em < ?`,
        [est, inicio, fim],
      );
      return {
        tipos: tipos.map((x) => {
          const r = registroDaChave(txt(x['entidade']));
          return {
            chave: txt(x['entidade']),
            rotulo: r?.rotulo ?? txt(x['entidade']),
            quantidade: num(x['n']),
          };
        }),
        conexoes: [{ modulo: 0, nome: 'Sistema', usuarios: num(cx?.['n'] ?? 0) }],
      };
    });

  registrosExclusao: FonteAdministracao['registrosExclusao'] = (c, r, f) =>
    this.ler(c, async (l, est) => {
      const p: unknown[] = [est, r.chave, f.inicio, f.fimExclusivo];
      const filtro = f.usuario ? ' AND u.login = ?' : '';
      if (f.usuario) p.push(f.usuario);
      const ls = await l.consultar(
        `SELECT x.ocorrido_em, u.login, x.entidade_id, x.justificativa FROM registro_excluido x JOIN usuario u ON u.id = x.usuario_id
          WHERE x.estabelecimento_id = ? AND x.entidade = ? AND x.ocorrido_em >= ? AND x.ocorrido_em < ? AND x.excluido_em IS NULL${filtro}
          ORDER BY x.ocorrido_em DESC, x.id DESC LIMIT ? OFFSET ?`,
        [...p, f.porPagina + 1, (f.pagina - 1) * f.porPagina],
        { teto: f.porPagina + 1 },
      );
      return ls.map((x) => ({
        dataHora: isoSeg(x['ocorrido_em']),
        usuario: txtOuNull(x['login']),
        registro: numOuNull(x['entidade_id']),
        justificativa: txtOuNull(x['justificativa']),
      }));
    });

  conexoes: FonteAdministracao['conexoes'] = (c, f) =>
    this.ler(c, async (l, est) => {
      const p: unknown[] = [est, f.inicio, f.fimExclusivo];
      const filtro = f.usuario ? ' AND u.login = ?' : '';
      if (f.usuario) p.push(f.usuario);
      const ls = await l.consultar(
        `SELECT t.ocorrido_em, u.login FROM trilha_auditoria t JOIN usuario u ON u.id = t.usuario_id
          WHERE t.estabelecimento_id = ? AND t.acao = 'login' AND t.ocorrido_em >= ? AND t.ocorrido_em < ?${filtro}
          ORDER BY t.ocorrido_em DESC, t.id DESC LIMIT ? OFFSET ?`,
        [...p, f.porPagina + 1, (f.pagina - 1) * f.porPagina],
        { teto: f.porPagina + 1 },
      );
      return ls.map((x) => ({
        dataHora: isoSeg(x['ocorrido_em']),
        usuario: txt(x['login']),
        modulo: 0,
        nome: 'Sistema',
      }));
    });

  pedidos: FonteAdministracao['pedidos'] = (c) =>
    this.ler(c, async (l, est) =>
      (await l.consultar(`${SQL_PEDIDO} ORDER BY p.recebido_em DESC, p.id DESC`, [est], { teto: TETO })).map(
        pedidoDaLinha,
      ),
    );

  async registrarPedido(
    c: Ctx,
    p: Parameters<FonteAdministracao['registrarPedido']>[1],
    t: Parameters<FonteAdministracao['registrarPedido']>[2],
  ) {
    const ctx = await this.contexto(
      c.hospital,
      t.correlacao,
      p.usuario ?? null,
      p.chave ?? `pedido-${t.correlacao}`,
    );
    const r = await this.executor.executar(
      operacaoRegistrarPedido,
      this.cliente,
      {
        ...(p.idPaciente !== undefined ? { idPaciente: p.idPaciente } : {}),
        ...(p.prontuario !== undefined ? { prontuario: p.prontuario } : {}),
        tipo: p.tipo,
        canal: p.canal,
        descricao: p.descricao,
        prazoDias: p.prazoDias,
      },
      ctx,
    );
    return { id: String(r.resultado.id), protocolo: String(r.resultado.protocolo) };
  }

  async tratarPedido(
    c: Ctx,
    d: Parameters<FonteAdministracao['tratarPedido']>[1],
    t: Parameters<FonteAdministracao['tratarPedido']>[2],
  ) {
    const ctx = await this.contexto(
      c.hospital,
      t.correlacao,
      d.usuario ?? null,
      d.chave ?? `tratar-${t.correlacao}`,
    );
    const r = await this.executor.executar(
      operacaoTratarPedido(d.conferir),
      this.cliente,
      { id: Number(d.id), acao: d.acao, fundamento: d.fundamento, resposta: d.resposta },
      ctx,
    );
    return { id: String(r.resultado.id), situacao: String(r.resultado.situacao) };
  }

  hoje: FonteAdministracao['hoje'] = async (c) => {
    if (this.estabelecimentos.length === 0) await this.carregar().catch(() => undefined);
    const fuso = this.estabelecimentos.find((e) => e.codigo === c.hospital)?.fuso ?? 'America/Sao_Paulo';
    return new Intl.DateTimeFormat('en-CA', { timeZone: fuso }).format(new Date());
  };
}

/** Rótulo do estado de uma operação (exportado para os testes e para a tela de permissões). */
export function estadoDaOperacao(nome: string): EstadoOperacaoGestao {
  return (OPERACOES_IMPLEMENTADAS as readonly string[]).includes(nome)
    ? { estado: 'ligada', ligada: true, motivo: null }
    : { estado: 'pendente', ligada: false, motivo: MOTIVO_PENDENTE };
}
