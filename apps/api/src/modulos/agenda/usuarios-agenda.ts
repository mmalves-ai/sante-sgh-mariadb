// Usuários permitidos por agenda (02-AGE linha 40), sobre a tabela agenda_usuario: a lista nominal de quem vê e de
// quem marca numa agenda restrita. A regra é do domínio (`acessoNominal`, `mudarLista` em @sgh/dominio-agenda); aqui
// ficam a leitura, a gravação pelo executor (trilha na mesma transação) e as travas usadas pela porta da agenda:
//   - leitura: a agenda restrita some da lista e do detalhe de quem não está nela (o gestor de agendas a vê);
//   - marcação: marcar, encaixar e remarcar numa agenda restrita exige estar na lista com "pode marcar".
// Retirar alguém da lista nunca apaga a linha: fica a exclusão lógica (quem e quando), e a trilha guarda o histórico.
import {
  acessoNominal,
  type AcessoNominal,
  type GravacaoNaAgenda,
  mudarLista,
  type PermitidoNaAgenda,
  podeGravarNaAgenda,
  podeVerAgenda,
} from '@sgh/dominio-agenda';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type Linha,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { NucleoAgenda } from './porta-propria.js';

const num = (v: unknown): number => Number(v);

export const esquemaDefinirUsuarioAgenda = z
  .object({
    agenda: z.number().int().positive(),
    acao: z.enum(['incluir', 'alterar', 'remover', 'liberarTodos']),
    usuario: z.number().int().positive().optional(),
    podeMarcar: z.boolean().optional(),
  })
  .strict()
  .refine((e) => e.acao === 'liberarTodos' || e.usuario !== undefined, {
    message: 'Informe o usuário.',
    path: ['usuario'],
  })
  .refine((e) => !(e.acao === 'incluir' || e.acao === 'alterar') || e.podeMarcar !== undefined, {
    message: 'Informe se o usuário marca ou só consulta.',
    path: ['podeMarcar'],
  });
export type EntradaUsuarioAgenda = z.infer<typeof esquemaDefinirUsuarioAgenda>;

export interface UsuarioDaAgenda {
  readonly usuario: number;
  readonly login: string;
  readonly nome: string;
  readonly podeMarcar: boolean;
}

export interface ListaUsuariosAgenda {
  readonly agenda: number;
  /** Com lista: só quem está nela vê e marca. Sem lista: vale só o escopo do cargo. */
  readonly restrita: boolean;
  readonly usuarios: readonly UsuarioDaAgenda[];
  /** O acesso de quem pergunta. */
  readonly meuAcesso: AcessoNominal;
}

type Consulta = Pick<Leitor, 'consultar'>;

/** A lista nominal ativa da agenda. */
export async function listaNominal(l: Consulta, agenda: number): Promise<PermitidoNaAgenda[]> {
  return (
    await l.consultar(
      'SELECT usuario_id, pode_marcar FROM agenda_usuario WHERE agenda_servico_id = ? AND excluido_em IS NULL',
      [agenda],
    )
  ).map((x) => ({ usuario: num(x['usuario_id']), podeMarcar: Boolean(Number(x['pode_marcar'])) }));
}

/** Papel da sessão que a lista nominal considera além da própria lista. */
export interface PapelNominal {
  /** Gestor de agendas (cargo com a manutenção da agenda): vê e mantém, mas só marca se estiver na lista. */
  readonly gestor: boolean;
  /** Administrador da plataforma: pode tudo (ADR 0002). */
  readonly administrador: boolean;
}

const SEM_PAPEL: PapelNominal = { gestor: false, administrador: false };

/**
 * Trava nominal de uma gravação na agenda (dentro da transação da porta): marcação exige estar na lista com
 * "pode marcar"; manutenção aceita também o gestor de agendas. Agenda sem lista: vale só o escopo do cargo.
 */
export async function exigirGravacaoNominal(
  tx: TxOperacao,
  agenda: number,
  usuario: number | null,
  tipo: GravacaoNaAgenda,
  papel: PapelNominal = SEM_PAPEL,
): Promise<void> {
  // Processo automático do sistema (sem usuário): a lista nominal é das sessões de usuário.
  if (usuario === null) return;
  const a = acessoNominal(await listaNominal(tx, agenda), usuario, papel.gestor, papel.administrador);
  if (podeGravarNaAgenda(a, tipo)) return;
  throw recusa(
    'agenda-restrita',
    a === 'consulta'
      ? 'Você só consulta esta agenda: a gravação nela é de quem está na lista com permissão de marcar.'
      : a === 'gestor'
        ? 'Como gestor de agendas você mantém esta agenda, mas a marcação nela é de quem está na lista com permissão de marcar.'
        : 'Esta agenda é restrita a uma lista de usuários, e você não está nela.',
  );
}

/** Trava da marcação (agenda de consulta, procedimento, sessão ou exame): só quem está na lista e marca. */
export const exigirMarcacaoNominal = (
  tx: TxOperacao,
  agenda: number,
  usuario: number | null,
  papel: PapelNominal = SEM_PAPEL,
): Promise<void> => exigirGravacaoNominal(tx, agenda, usuario, 'marcacao', papel);

/**
 * Agendas do estabelecimento que o login NÃO vê pela lista nominal (as livres e as em que ele está ficam fora).
 * O gestor de agendas vê todas (para manter a lista), e o administrador da plataforma também. Sem login (leitura interna do sistema, sem sessão), nada
 * se esconde: a trava vale para as sessões de usuário.
 */
export async function agendasOcultas(
  l: Consulta,
  estabelecimento: number,
  login: string | undefined,
  gestor: boolean,
  administrador = false,
): Promise<Set<number>> {
  if (!login || administrador) return new Set();
  const linhas = await l.consultar(
    `SELECT au.agenda_servico_id AS agenda, au.usuario_id, au.pode_marcar, (u.login = ?) AS eu
       FROM agenda_usuario au JOIN agenda_servico a ON a.id = au.agenda_servico_id
       JOIN usuario u ON u.id = au.usuario_id
      WHERE a.estabelecimento_id = ? AND au.excluido_em IS NULL AND a.excluido_em IS NULL`,
    [login ?? '', estabelecimento],
  );
  const porAgenda = new Map<number, { lista: PermitidoNaAgenda[]; eu: number | null }>();
  for (const x of linhas) {
    const id = num(x['agenda']);
    const g = porAgenda.get(id) ?? { lista: [], eu: null };
    const usuario = num(x['usuario_id']);
    g.lista.push({ usuario, podeMarcar: Boolean(Number(x['pode_marcar'])) });
    if (login && Number(x['eu']) === 1) g.eu = usuario;
    porAgenda.set(id, g);
  }
  const ocultas = new Set<number>();
  for (const [id, g] of porAgenda) if (!podeVerAgenda(acessoNominal(g.lista, g.eu, gestor))) ocultas.add(id);
  return ocultas;
}

export interface ContextoUsuariosAgenda {
  readonly hospital: string;
  readonly login: string;
  readonly gestor: boolean;
  readonly administrador?: boolean;
}

export class UsuariosAgendaPropria {
  private readonly executor: Executor;
  private readonly operacao = definirOperacao<EntradaUsuarioAgenda, { agenda: number; usuarios: number }>({
    nome: 'agenda.definir_usuarios',
    tabelas: ['agenda_usuario'],
    entrada: esquemaDefinirUsuarioAgenda as unknown as z.ZodType<EntradaUsuarioAgenda>,
    gravar: (tx, e, ctx) => this.gravar(tx, e, ctx),
    alvo: (e) => ({ tabela: 'agenda_servico', id: e.agenda }),
  });

  constructor(
    private readonly nucleo: NucleoAgenda,
    private readonly cliente: string,
    private readonly agora: () => Date = () => new Date(),
  ) {
    this.executor = nucleo.criarExecutor();
  }

  private async quem(
    c: ContextoUsuariosAgenda,
  ): Promise<{ estabelecimento: number; usuario: number | null }> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'agenda-usuarios' }, async (l) => {
      const e = await l.uma('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
        c.hospital,
      ]);
      if (!e)
        throw new ErroOperacao(
          403,
          'estabelecimento-desconhecido',
          'Estabelecimento',
          'O estabelecimento da sessão não existe no cliente.',
        );
      const u = await l.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [c.login]);
      return { estabelecimento: num(e['id']), usuario: u ? num(u['id']) : null };
    });
  }

  async lista(c: ContextoUsuariosAgenda, agenda: number): Promise<ListaUsuariosAgenda | null> {
    const q = await this.quem(c);
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: 'agenda-usuarios', estabelecimento: q.estabelecimento },
      async (l) => {
        const a = await l.uma(
          'SELECT id FROM agenda_servico WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [agenda, q.estabelecimento],
        );
        if (!a) return null;
        const linhas = await l.consultar(
          `SELECT au.usuario_id, au.pode_marcar, u.login, u.nome FROM agenda_usuario au
             JOIN usuario u ON u.id = au.usuario_id
            WHERE au.agenda_servico_id = ? AND au.excluido_em IS NULL ORDER BY u.nome`,
          [agenda],
        );
        const usuarios = linhas.map((x) => ({
          usuario: num(x['usuario_id']),
          login: String(x['login']),
          nome: String(x['nome'] ?? x['login']),
          podeMarcar: Boolean(Number(x['pode_marcar'])),
        }));
        const meuAcesso = acessoNominal(usuarios, q.usuario, c.gestor, c.administrador === true);
        // Quem não vê a agenda não vê a lista dela (falha fechada: 404 como agenda inexistente).
        if (!podeVerAgenda(meuAcesso)) return null;
        return { agenda, restrita: usuarios.length > 0, usuarios, meuAcesso };
      },
    );
  }

  /** Usuários ativos do cliente para a escolha na tela (por nome ou login; até 20). */
  async candidatos(termo: string): Promise<{ usuario: number; login: string; nome: string }[]> {
    const t = `%${termo.replace(/[%_\\]/g, '').slice(0, 60)}%`;
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'agenda-usuarios' }, async (l) =>
      (
        await l.consultar(
          `SELECT id, login, nome FROM usuario WHERE excluido_em IS NULL AND (nome LIKE ? OR login LIKE ?)
            ORDER BY nome LIMIT 20`,
          [t, t],
        )
      ).map((x) => ({
        usuario: num(x['id']),
        login: String(x['login']),
        nome: String(x['nome'] ?? x['login']),
      })),
    );
  }

  async definir(
    c: ContextoUsuariosAgenda & { correlacao: string; chaveIdempotencia: string; enderecoIp?: string },
    entrada: unknown,
  ): Promise<{ resultado: { agenda: number; usuarios: number }; repetida: boolean }> {
    const q = await this.quem(c);
    if (q.usuario === null)
      throw recusa(
        'usuario-sem-conta',
        'Gravar na agenda exige uma conta de usuário do cliente (o responsável fica no registro).',
      );
    const ctx: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: q.estabelecimento,
      usuario: q.usuario,
      correlacao: c.correlacao.slice(0, 64),
      chaveIdempotencia: c.chaveIdempotencia.slice(0, 80),
      ...(c.enderecoIp ? { enderecoIp: c.enderecoIp } : {}),
    };
    const r = await this.executor.executar(this.operacao, this.cliente, entrada, ctx);
    return { resultado: r.resultado, repetida: r.repetida };
  }

  private async gravar(
    tx: TxOperacao,
    e: EntradaUsuarioAgenda,
    ctx: ContextoOperacao,
  ): Promise<{ agenda: number; usuarios: number }> {
    const [a] = await tx.consultarParaAtualizar(
      'SELECT id FROM agenda_servico WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [e.agenda, ctx.estabelecimento],
      { teto: 1 },
    );
    if (!a)
      throw new ErroOperacao(
        404,
        'registro-inexistente',
        'Agenda não encontrada',
        'A agenda não existe mais.',
      );
    if (e.usuario !== undefined) {
      const u = await tx.uma('SELECT id FROM usuario WHERE id = ? AND excluido_em IS NULL', [e.usuario]);
      if (!u) throw recusa('usuario-inexistente', 'O usuário não existe ou foi desativado.');
    }
    const linhas: Linha[] = await tx.consultarParaAtualizar(
      'SELECT id, versao, usuario_id, pode_marcar, excluido_em FROM agenda_usuario WHERE agenda_servico_id = ?',
      [e.agenda],
    );
    const ativas = linhas.filter((x) => x['excluido_em'] === null);
    const lista = ativas.map((x) => ({
      usuario: num(x['usuario_id']),
      podeMarcar: Boolean(Number(x['pode_marcar'])),
    }));
    const mudanca =
      e.acao === 'liberarTodos'
        ? ({ acao: 'liberarTodos' } as const)
        : e.acao === 'remover'
          ? ({ acao: 'remover', usuario: e.usuario! } as const)
          : ({ acao: e.acao, usuario: e.usuario!, podeMarcar: e.podeMarcar! } as const);
    const r = mudarLista(lista, mudanca);
    if ('recusa' in r) throw recusa(r.recusa.codigo, r.recusa.mensagem);
    const agora = this.agora();
    const retirar = (x: Linha) =>
      tx.alterar('agenda_usuario', num(x['id']), num(x['versao']), {
        excluido_em: agora,
        excluido_por: ctx.usuario,
      });
    const minha = linhas.find((x) => num(x['usuario_id']) === e.usuario);
    if (e.acao === 'liberarTodos') for (const x of ativas) await retirar(x);
    else if (e.acao === 'remover') await retirar(minha!);
    else if (e.acao === 'alterar')
      await tx.alterar('agenda_usuario', num(minha!['id']), num(minha!['versao']), {
        pode_marcar: e.podeMarcar!,
      });
    else if (minha)
      await tx.alterar('agenda_usuario', num(minha['id']), num(minha['versao']), {
        pode_marcar: e.podeMarcar!,
        excluido_em: null,
        excluido_por: null,
      });
    else
      await tx.incluir('agenda_usuario', {
        agenda_servico_id: e.agenda,
        usuario_id: e.usuario!,
        pode_marcar: e.podeMarcar!,
      });
    return { agenda: e.agenda, usuarios: r.lista.length };
  }
}
