// Anotação administrativa do caso (03-PEP L147), no banco próprio do cliente: o registro NÃO clínico da equipe
// (serviço social, NIR, gestão de leito, faturamento) sobre o atendimento, por categoria e com o alcance de leitura
// escolhido (equipe do estabelecimento, só os destinatários ou toda a rede). Regras no domínio (@sgh/dominio-pep,
// anotacao-administrativa.ts); aqui ficam a leitura por paciente (só o que quem lê pode ver), a fila de leitura de
// quem recebeu e a gravação pelo executor (trilha na mesma transação). Nada é apagado nem tem o texto reescrito: o
// cancelamento guarda quem, quando e por quê; a leitura do destinatário guarda quando. As categorias
// (categoria_anotacao_administrativa) são mantidas no cadastro genérico da configuração.
import {
  ACESSOS_ANOTACAO,
  anotacaoVisivel,
  type FalhaRegra,
  MOTIVO_CANCELAMENTO_ANOTACAO_MAXIMO,
  normalizarDestinatarios,
  passoAnotacao,
  situacaoAnotacao,
  TEXTO_ANOTACAO_MAXIMO,
  validarNovaAnotacao,
} from '@sgh/dominio-pep';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';

const num = (v: unknown): number => Number(v);
const txt = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const bool = (v: unknown): boolean => Boolean(Number(v));
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
const id = z.number().int().positive();
/** Conta que pode receber anotação: ativa, sem bloqueio e dentro da validade (02_ADM, usuario). */
const CONTA_ATIVA = `excluido_em IS NULL AND situacao = 'ativo' AND bloqueado_em IS NULL
  AND (expira_em IS NULL OR expira_em > ?)`;

export const esquemaAnotacao = z.discriminatedUnion('acao', [
  z
    .object({
      acao: z.literal('registrar'),
      paciente: id,
      atendimento: id,
      categoria: id,
      texto: z.string().max(TEXTO_ANOTACAO_MAXIMO + 100),
      acesso: z.enum(ACESSOS_ANOTACAO).default('equipe'),
      destinatarios: z.array(id).max(50).default([]),
      finalizaAcao: z.boolean().default(false),
      /** A reserva de leito do NIR de onde a anotação partiu (contexto opcional). */
      reserva: id.optional(),
    })
    .strict(),
  z.object({ acao: z.literal('marcar_lida'), anotacao: id }).strict(),
  z
    .object({
      acao: z.literal('cancelar'),
      anotacao: id,
      versao: z.number().int().positive(),
      motivo: z.string().max(MOTIVO_CANCELAMENTO_ANOTACAO_MAXIMO + 50),
    })
    .strict(),
]);
export type EntradaAnotacao = z.infer<typeof esquemaAnotacao>;

export interface NucleoAnotacoes {
  lerSomente<T>(
    contexto: {
      readonly cliente: string;
      readonly correlacao: string;
      readonly estabelecimento?: number | null;
    },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

export interface ContextoAnotacoes {
  readonly hospital: string;
  readonly login: string;
}
export type ContextoGravacaoAnotacoes = ContextoAnotacoes & {
  readonly correlacao: string;
  readonly chaveIdempotencia: string;
  readonly enderecoIp?: string;
};

export interface DestinatarioLido {
  readonly usuario: number;
  readonly nome: string;
  readonly lidaEm: string | null;
}
export interface AnotacaoLida {
  readonly id: number;
  readonly versao: number;
  readonly atendimento: { id: number; numero: string };
  readonly categoria: { id: number; descricao: string };
  readonly texto: string;
  readonly acesso: string;
  readonly finalizaAcao: boolean;
  readonly automatica: boolean;
  /** A reserva de leito do NIR de onde a anotação partiu, quando houver. */
  readonly reserva: number | null;
  readonly registradaEm: string | null;
  readonly autor: string | null;
  readonly doAutor: boolean;
  readonly destinatarios: readonly DestinatarioLido[];
  /** Endereçada a quem lê e ainda não marcada como lida. */
  readonly pendenteParaMim: boolean;
  readonly situacao: 'ativa' | 'cancelada';
  readonly canceladaEm: string | null;
  readonly motivoCancelamento: string | null;
}
export interface AnotacoesDoPaciente {
  readonly anotacoes: readonly AnotacaoLida[];
  readonly atendimentos: readonly { id: number; numero: string; entradaEm: string | null }[];
  readonly categorias: readonly { id: number; descricao: string }[];
  readonly pendentesParaMim: number;
  readonly podeEscrever: boolean;
}
export interface PendenteDeLeitura {
  readonly anotacao: number;
  readonly paciente: number;
  readonly prontuario: string | null;
  readonly atendimento: string;
  readonly categoria: string;
  readonly registradaEm: string | null;
  readonly autor: string | null;
}

// A reserva guarda o paciente; na do pré-cadastro, vale o paciente da solicitação de leito que ela atende.
const SQL_PACIENTE_DA_RESERVA = `SELECT COALESCE(r.paciente_id, p.paciente_id) AS paciente
    FROM reserva_leito r
    LEFT JOIN pedido_leito p ON p.id = r.pedido_leito_id
   WHERE r.id = ? AND r.excluido_em IS NULL`;

const recusar = (f: readonly FalhaRegra[]): never => {
  throw recusa(f[0]!.codigo, f.map((x) => x.mensagem).join(' '));
};
const inexistente = (): ErroOperacao =>
  new ErroOperacao(
    404,
    'registro-inexistente',
    'Anotação não encontrada',
    'A anotação não existe neste cliente.',
  );

export class AnotacoesAdministrativasPropria {
  private executorCache: Executor | null = null;
  private get executor(): Executor {
    return (this.executorCache ??= this.nucleo.criarExecutor());
  }

  private readonly opAnotacao = definirOperacao<EntradaAnotacao, { anotacao: number; situacao: string }>({
    nome: 'pep.anotacao_administrativa',
    tabelas: ['anotacao_administrativa_caso', 'anotacao_administrativa_caso_destinatario'],
    entrada: esquemaAnotacao as unknown as z.ZodType<EntradaAnotacao>,
    gravar: (tx, e, ctx) => this.gravar(tx, e, ctx),
    alvo: (_e, r) => ({ tabela: 'anotacao_administrativa_caso', id: r.anotacao }),
  });

  constructor(
    private readonly nucleo: NucleoAnotacoes,
    private readonly cliente: string,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  private ler<T>(fn: (l: Leitor) => Promise<T>, estabelecimento?: number): Promise<T> {
    return this.nucleo.lerSomente(
      {
        cliente: this.cliente,
        correlacao: 'pep.anotacoes',
        ...(estabelecimento ? { estabelecimento } : {}),
      },
      fn,
    );
  }

  private quem(c: ContextoAnotacoes) {
    return this.ler(async (l) => {
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

  pacienteExiste(paciente: number): Promise<boolean> {
    return this.ler(async (l) =>
      Boolean(await l.uma('SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL', [paciente])),
    );
  }

  /** O paciente dono da anotação (o vínculo assistencial é conferido antes de gravar); null quando não existe. */
  /** O paciente da reserva de leito do NIR (null quando a reserva não existe ou ainda não tem paciente). */
  pacienteDaReserva(reserva: number): Promise<number | null> {
    return this.ler(async (l) => {
      const r = await l.uma(SQL_PACIENTE_DA_RESERVA, [reserva]);
      return r && r['paciente'] !== null && r['paciente'] !== undefined ? num(r['paciente']) : null;
    });
  }

  pacienteDaAnotacao(anotacao: number): Promise<number | null> {
    return this.ler(async (l) => {
      const x = await l.uma(
        'SELECT paciente_id FROM anotacao_administrativa_caso WHERE id = ? AND excluido_em IS NULL',
        [anotacao],
      );
      return x ? num(x['paciente_id']) : null;
    });
  }

  private async destinatariosDe(l: Leitor, anotacoes: readonly number[]) {
    const mapa = new Map<number, DestinatarioLido[]>();
    if (!anotacoes.length) return mapa;
    const linhas = await l.consultar(
      `SELECT d.anotacao_administrativa_caso_id AS anotacao, d.usuario_id, u.nome, d.lida_em
         FROM anotacao_administrativa_caso_destinatario d
         JOIN usuario u ON u.id = d.usuario_id
        WHERE d.anotacao_administrativa_caso_id IN (${anotacoes.map(() => '?').join(',')})
          AND d.excluido_em IS NULL
        ORDER BY u.nome, d.id`,
      [...anotacoes],
    );
    for (const x of linhas) {
      const k = num(x['anotacao']);
      const lista = mapa.get(k) ?? [];
      lista.push({ usuario: num(x['usuario_id']), nome: String(x['nome']), lidaEm: iso(x['lida_em']) });
      mapa.set(k, lista);
    }
    return mapa;
  }

  /** As anotações que quem lê pode ver, da mais nova para a mais antiga, com os atendimentos e as categorias. */
  async doPaciente(c: ContextoAnotacoes, paciente: number): Promise<AnotacoesDoPaciente> {
    const q = await this.quem(c);
    return this.ler(async (l) => {
      const linhas = await l.consultar(
        `SELECT a.id, a.versao, a.atendimento_id, at.numero AS atendimento_numero, a.categoria_anotacao_administrativa_id,
                c.descricao AS categoria, a.texto, a.acesso, a.finaliza_acao, a.automatica, a.reserva_leito_id, a.registrado_em,
                a.registrado_por_usuario_id, u.nome AS autor, a.estabelecimento_id, a.cancelada_em,
                a.motivo_cancelamento
           FROM anotacao_administrativa_caso a
           JOIN atendimento at ON at.id = a.atendimento_id
           JOIN categoria_anotacao_administrativa c ON c.id = a.categoria_anotacao_administrativa_id
           LEFT JOIN usuario u ON u.id = a.registrado_por_usuario_id
          WHERE a.paciente_id = ? AND a.excluido_em IS NULL
          ORDER BY a.registrado_em DESC, a.id DESC
          LIMIT 500`,
        [paciente],
      );
      const dest = await this.destinatariosDe(
        l,
        linhas.map((x) => num(x['id'])),
      );
      const leitor = { usuario: q.usuario, estabelecimento: q.estabelecimento };
      const anotacoes: AnotacaoLida[] = linhas
        .map((x) => ({ x, d: dest.get(num(x['id'])) ?? [] }))
        .filter(({ x, d }) =>
          anotacaoVisivel(
            {
              acesso: String(x['acesso']),
              autorUsuarioId: num(x['registrado_por_usuario_id']),
              estabelecimentoId: num(x['estabelecimento_id']),
              destinatarios: d.map((y) => y.usuario),
            },
            leitor,
          ),
        )
        .map(({ x, d }) => {
          const situacao = situacaoAnotacao(iso(x['cancelada_em']));
          const minha = d.find((y) => y.usuario === q.usuario);
          return {
            id: num(x['id']),
            versao: num(x['versao']),
            atendimento: { id: num(x['atendimento_id']), numero: String(x['atendimento_numero']) },
            categoria: {
              id: num(x['categoria_anotacao_administrativa_id']),
              descricao: String(x['categoria']),
            },
            texto: String(x['texto']),
            acesso: String(x['acesso']),
            finalizaAcao: bool(x['finaliza_acao']),
            automatica: bool(x['automatica']),
            reserva: x['reserva_leito_id'] === null ? null : num(x['reserva_leito_id']),
            registradaEm: iso(x['registrado_em']),
            autor: txt(x['autor']),
            doAutor: q.usuario !== null && q.usuario === num(x['registrado_por_usuario_id']),
            destinatarios: d,
            pendenteParaMim: situacao === 'ativa' && !!minha && minha.lidaEm === null,
            situacao,
            canceladaEm: iso(x['cancelada_em']),
            motivoCancelamento: txt(x['motivo_cancelamento']),
          };
        });
      const atendimentos = await l.consultar(
        `SELECT id, numero, entrada_em FROM atendimento
          WHERE paciente_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL
          ORDER BY entrada_em DESC, id DESC LIMIT 30`,
        [paciente, q.estabelecimento],
      );
      const categorias = await l.consultar(
        'SELECT id, descricao FROM categoria_anotacao_administrativa WHERE ativo = TRUE ORDER BY ordem, descricao, id',
      );
      return {
        anotacoes,
        atendimentos: atendimentos.map((a) => ({
          id: num(a['id']),
          numero: String(a['numero']),
          entradaEm: iso(a['entrada_em']),
        })),
        categorias: categorias.map((x) => ({ id: num(x['id']), descricao: String(x['descricao']) })),
        pendentesParaMim: anotacoes.filter((a) => a.pendenteParaMim).length,
        podeEscrever: q.usuario !== null,
      };
    }, q.estabelecimento);
  }

  /** A fila de leitura de quem recebeu: as anotações ativas endereçadas a ele e ainda não lidas (sem o nome do
   *  paciente: o caso abre pela visão do paciente, que confere o vínculo e registra a leitura). */
  async pendentes(c: ContextoAnotacoes): Promise<readonly PendenteDeLeitura[]> {
    const q = await this.quem(c);
    if (q.usuario === null) return [];
    return this.ler(async (l) => {
      const linhas = await l.consultar(
        `SELECT a.id, a.paciente_id, p.numero_prontuario, at.numero AS atendimento, c.descricao AS categoria,
                a.registrado_em, u.nome AS autor
           FROM anotacao_administrativa_caso_destinatario d
           JOIN anotacao_administrativa_caso a ON a.id = d.anotacao_administrativa_caso_id
           JOIN paciente p ON p.id = a.paciente_id
           JOIN atendimento at ON at.id = a.atendimento_id
           JOIN categoria_anotacao_administrativa c ON c.id = a.categoria_anotacao_administrativa_id
           LEFT JOIN usuario u ON u.id = a.registrado_por_usuario_id
          WHERE d.usuario_id = ? AND d.lida_em IS NULL AND d.excluido_em IS NULL
            AND a.cancelada_em IS NULL AND a.excluido_em IS NULL
          ORDER BY a.registrado_em, a.id
          LIMIT 200`,
        [q.usuario],
      );
      return linhas.map((x) => ({
        anotacao: num(x['id']),
        paciente: num(x['paciente_id']),
        prontuario: txt(x['numero_prontuario']),
        atendimento: String(x['atendimento']),
        categoria: String(x['categoria']),
        registradaEm: iso(x['registrado_em']),
        autor: txt(x['autor']),
      }));
    }, q.estabelecimento);
  }

  /** Contas ativas do cliente para escolher como destinatário (nome ou login, a partir de 3 letras). */
  async usuarios(termo: string): Promise<readonly { id: number; nome: string }[]> {
    const t = termo.trim();
    if (t.length < 3) return [];
    const padrao = `%${t.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    return this.ler(async (l) =>
      (
        await l.consultar(
          `SELECT id, nome FROM usuario
            WHERE ${CONTA_ATIVA} AND (nome LIKE ? OR login LIKE ?)
            ORDER BY nome, id LIMIT 20`,
          [this.agora(), padrao, padrao],
        )
      ).map((x) => ({ id: num(x['id']), nome: String(x['nome']) })),
    );
  }

  async gravarAnotacao(c: ContextoGravacaoAnotacoes, entrada: unknown) {
    const q = await this.quem(c);
    if (q.usuario === null)
      throw recusa('usuario-sem-conta', 'A gravação exige uma conta de usuário do cliente.');
    const ctx: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: q.estabelecimento,
      usuario: q.usuario,
      correlacao: c.correlacao.slice(0, 64),
      chaveIdempotencia: c.chaveIdempotencia.slice(0, 80),
      ...(c.enderecoIp ? { enderecoIp: c.enderecoIp } : {}),
    };
    const r = await this.executor.executar(this.opAnotacao, this.cliente, entrada, ctx);
    return { resultado: r.resultado, repetida: r.repetida };
  }

  private async gravar(tx: TxOperacao, e: EntradaAnotacao, ctx: ContextoOperacao) {
    const agora = this.agora();
    const usuario = Number(ctx.usuario);
    const estabelecimento = Number(ctx.estabelecimento);
    if (e.acao === 'registrar') {
      const p = await tx.uma('SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL', [e.paciente]);
      if (!p)
        throw new ErroOperacao(
          404,
          'registro-inexistente',
          'Paciente não encontrado',
          'O paciente não existe.',
        );
      const at = await tx.uma(
        'SELECT paciente_id, estabelecimento_id FROM atendimento WHERE id = ? AND excluido_em IS NULL',
        [e.atendimento],
      );
      const cat = await tx.uma('SELECT ativo FROM categoria_anotacao_administrativa WHERE id = ?', [
        e.categoria,
      ]);
      const destinatarios = normalizarDestinatarios(e.destinatarios, usuario);
      const validos = destinatarios.length
        ? num(
            (
              await tx.uma(
                `SELECT COUNT(*) AS n FROM usuario
                  WHERE id IN (${destinatarios.map(() => '?').join(',')}) AND ${CONTA_ATIVA}`,
                [...destinatarios, agora],
              )
            )?.['n'],
          )
        : 0;
      const reserva =
        e.reserva === undefined ? undefined : await tx.uma(SQL_PACIENTE_DA_RESERVA, [e.reserva]);
      const falhas = validarNovaAnotacao({
        ...(reserva === undefined
          ? {}
          : { reserva: reserva ? { doPaciente: num(reserva['paciente']) === e.paciente } : null }),
        texto: e.texto,
        categoriaAtiva: cat ? bool(cat['ativo']) : null,
        acesso: e.acesso,
        destinatarios,
        destinatariosValidos: validos,
        atendimento: at
          ? {
              doPaciente: num(at['paciente_id']) === e.paciente,
              doEstabelecimento: num(at['estabelecimento_id']) === estabelecimento,
            }
          : null,
      });
      if (falhas.length) recusar(falhas);
      const anotacao = await tx.incluir('anotacao_administrativa_caso', {
        estabelecimento_id: estabelecimento,
        atendimento_id: e.atendimento,
        paciente_id: e.paciente,
        reserva_leito_id: e.reserva ?? null,
        categoria_anotacao_administrativa_id: e.categoria,
        registrado_em: agora,
        registrado_por_usuario_id: usuario,
        texto: e.texto.trim(),
        acesso: e.acesso,
        automatica: false,
        finaliza_acao: e.finalizaAcao,
        origem: 'sistema',
      });
      for (const u of destinatarios)
        await tx.incluir('anotacao_administrativa_caso_destinatario', {
          anotacao_administrativa_caso_id: anotacao,
          usuario_id: u,
          lida_em: null,
        });
      return { anotacao, situacao: 'ativa' };
    }
    const [a] = await tx.consultarParaAtualizar(
      `SELECT id, versao, registrado_por_usuario_id, acesso, estabelecimento_id, cancelada_em
         FROM anotacao_administrativa_caso WHERE id = ? AND excluido_em IS NULL`,
      [e.anotacao],
      { teto: 1 },
    );
    if (!a) throw inexistente();
    const dest = await tx.consultar(
      `SELECT id, usuario_id, lida_em, versao FROM anotacao_administrativa_caso_destinatario
        WHERE anotacao_administrativa_caso_id = ? AND excluido_em IS NULL`,
      [e.anotacao],
    );
    // Quem não vê a anotação não dá passo nenhum nela (nem fica sabendo que existe).
    const visivel = anotacaoVisivel(
      {
        acesso: String(a['acesso']),
        autorUsuarioId: num(a['registrado_por_usuario_id']),
        estabelecimentoId: num(a['estabelecimento_id']),
        destinatarios: dest.map((d) => num(d['usuario_id'])),
      },
      { usuario, estabelecimento },
    );
    if (!visivel) throw inexistente();
    const minha = dest.find((d) => num(d['usuario_id']) === usuario);
    const falhas = passoAnotacao({
      acao: e.acao,
      cancelada: a['cancelada_em'] !== null && a['cancelada_em'] !== undefined,
      ehAutor: num(a['registrado_por_usuario_id']) === usuario,
      ehDestinatario: !!minha,
      lida: !!minha && minha['lida_em'] !== null && minha['lida_em'] !== undefined,
      motivo: e.acao === 'cancelar' ? e.motivo : null,
    });
    if (falhas.length) recusar(falhas);
    if (e.acao === 'marcar_lida') {
      await tx.alterar(
        'anotacao_administrativa_caso_destinatario',
        num(minha!['id']),
        num(minha!['versao']),
        {
          lida_em: agora,
        } as never,
      );
      return { anotacao: e.anotacao, situacao: 'ativa' };
    }
    const versao = num(a['versao']);
    if (versao !== e.versao)
      throw new ErroOperacao(
        409,
        'conflito-versao',
        'Anotação alterada por outra pessoa',
        'Recarregue a anotação antes de seguir.',
      );
    await tx.alterar('anotacao_administrativa_caso', e.anotacao, versao, {
      cancelada_em: agora,
      cancelada_por_usuario_id: usuario,
      motivo_cancelamento: e.motivo.trim(),
    } as never);
    return { anotacao: e.anotacao, situacao: 'cancelada' };
  }
}
