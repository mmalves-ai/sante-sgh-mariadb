// Manutenção dos locais de atendimento (consultórios e salas) no banco próprio — 02-REC linha 34. As regras são do
// domínio (@sgh/dominio-atendimento: validarHorarioLocal, validarLigacaoLocais, validarUsuariosLocal, diferencaLista);
// aqui ficam a leitura da unidade e a gravação pelo executor (trilha na mesma transação), numa operação só com cinco
// ações: incluir o local, alterar os dados do local, gravar a semana de funcionamento, os locais para onde encaminha,
// os locais que ele consulta e quem o opera ou atende nele. Ligação retirada nunca apaga a linha: fica a exclusão
// lógica (quem e quando) e volta pela mesma linha. A faixa de horário é configuração sem exclusão lógica: a semana
// anterior fica na trilha (entrada da operação) antes de ser trocada.
import {
  diferencaLista,
  type FaixaHorarioLocal,
  type LocalDaUnidade,
  validarHorarioLocal,
  validarLigacaoLocais,
  validarUsuariosLocal,
} from '@sgh/dominio-atendimento';
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

const num = (v: unknown): number => Number(v);
const bool = (v: unknown): boolean => Boolean(Number(v));
const hhmm = (v: unknown): string => String(v ?? '').slice(0, 5);

const faixa = z
  .object({
    diaSemana: z.number().int().min(1).max(7).nullable(),
    diaNaoUtil: z.boolean(),
    inicio: z.string(),
    fim: z.string(),
  })
  .strict();
const ids = z.array(z.number().int().positive()).max(200);

export const esquemaManterLocal = z.discriminatedUnion('acao', [
  z
    .object({
      acao: z.literal('incluir'),
      codigo: z.string().trim().min(1).max(30),
      descricao: z.string().trim().min(1).max(150),
      recepcao: z.number().int().positive(),
      permiteEncaminhamento: z.boolean(),
      /** Módulo de recepção em que o local trabalha (escopo da regra de campo do cadastro); sem ele, nenhum. */
      moduloRecepcao: z.number().int().positive().nullable().optional(),
    })
    .strict(),
  z
    .object({
      acao: z.literal('dados'),
      local: z.number().int().positive(),
      descricao: z.string().trim().min(1).max(150),
      permiteEncaminhamento: z.boolean(),
      ativo: z.boolean(),
      /** Ausente: o módulo do local não muda; nulo: o local deixa de ter módulo. */
      moduloRecepcao: z.number().int().positive().nullable().optional(),
    })
    .strict(),
  z
    .object({
      acao: z.literal('horario'),
      local: z.number().int().positive(),
      faixas: z.array(faixa).max(60),
    })
    .strict(),
  z
    .object({ acao: z.literal('encaminhamentos'), local: z.number().int().positive(), destinos: ids })
    .strict(),
  z
    .object({ acao: z.literal('visibilidade'), local: z.number().int().positive(), consultados: ids })
    .strict(),
  z
    .object({
      acao: z.literal('usuarios'),
      local: z.number().int().positive(),
      usuarios: z
        .array(
          z
            .object({
              usuario: z.number().int().positive(),
              atuaNoLocal: z.boolean(),
              podeOperar: z.boolean(),
            })
            .strict(),
        )
        .max(500),
    })
    .strict(),
]);
export type EntradaManterLocal = z.infer<typeof esquemaManterLocal>;

export interface LocalAtendimentoVisao {
  readonly id: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly recepcao: number;
  readonly recepcaoDescricao: string;
  /** Módulo de recepção em que o local trabalha (nulo: nenhum). */
  readonly moduloRecepcao: number | null;
  readonly permiteEncaminhamento: boolean;
  readonly ativo: boolean;
  readonly horario: readonly FaixaHorarioLocal[];
  readonly encaminhaPara: readonly number[];
  readonly consulta: readonly number[];
  readonly usuarios: readonly {
    usuario: number;
    login: string;
    nome: string;
    atuaNoLocal: boolean;
    podeOperar: boolean;
  }[];
}

export interface LocaisDaUnidade {
  readonly recepcoes: readonly { id: number; descricao: string }[];
  /** Módulos de recepção ativos, para a escolha do módulo do local. */
  readonly modulos: readonly { id: number; descricao: string }[];
  readonly locais: readonly LocalAtendimentoVisao[];
}

/** O que a manutenção usa do NucleoProprio (os testes trocam). */
export interface NucleoLocais {
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

export interface ContextoLocais {
  readonly hospital: string;
  readonly login: string;
}

type Consulta = Pick<Leitor, 'consultar'>;

async function locaisDaUnidade(l: Consulta, estabelecimento: number): Promise<LocalDaUnidade[]> {
  return (
    await l.consultar(
      'SELECT id, ativo, permite_encaminhamento FROM local_atendimento WHERE estabelecimento_id = ? AND excluido_em IS NULL',
      [estabelecimento],
    )
  ).map((x) => ({
    id: num(x['id']),
    ativo: bool(x['ativo']),
    permiteEncaminhamento: bool(x['permite_encaminhamento']),
  }));
}

export class LocaisAtendimentoPropria {
  private readonly executor: Executor;
  private readonly operacao = definirOperacao<
    EntradaManterLocal,
    { local: number; acao: string; itens: number }
  >({
    nome: 'atendimento.manter_local',
    tabelas: [
      'local_atendimento',
      'local_atendimento_horario',
      'local_atendimento_encaminhamento',
      'local_atendimento_visibilidade',
      'usuario_local_atendimento',
    ],
    entrada: esquemaManterLocal as unknown as z.ZodType<EntradaManterLocal>,
    gravar: (tx, e, ctx) => this.gravar(tx, e, ctx),
    alvo: (_e, r) => ({ tabela: 'local_atendimento', id: r.local }),
  });

  constructor(
    private readonly nucleo: NucleoLocais,
    private readonly cliente: string,
    private readonly agora: () => Date = () => new Date(),
  ) {
    this.executor = nucleo.criarExecutor();
  }

  private quem(c: ContextoLocais): Promise<{ estabelecimento: number; usuario: number | null }> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'locais-atendimento' }, async (l) => {
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

  /** Os locais da unidade da sessão, com horário, encaminhamentos, visibilidade e usuários (uma leitura só). */
  async lista(c: ContextoLocais): Promise<LocaisDaUnidade> {
    const q = await this.quem(c);
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: 'locais-atendimento', estabelecimento: q.estabelecimento },
      async (l) => {
        const est = [q.estabelecimento];
        const recepcoes = (
          await l.consultar(
            'SELECT id, descricao FROM ponto_recepcao WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY descricao',
            est,
          )
        ).map((x) => ({ id: num(x['id']), descricao: String(x['descricao']) }));
        const modulos = (
          await l.consultar(
            'SELECT id, descricao FROM modulo_recepcao WHERE ativo ORDER BY descricao, id',
            [],
          )
        ).map((x) => ({ id: num(x['id']), descricao: String(x['descricao']) }));
        const locais = await l.consultar(
          `SELECT la.id, la.codigo, la.descricao, la.ponto_recepcao_id, la.modulo_recepcao_id, pr.descricao AS recepcao,
                  la.permite_encaminhamento, la.ativo
             FROM local_atendimento la JOIN ponto_recepcao pr ON pr.id = la.ponto_recepcao_id
            WHERE la.estabelecimento_id = ? AND la.excluido_em IS NULL ORDER BY la.descricao`,
          est,
        );
        const doLocal = <T>(linhas: Linha[], campo: string, f: (x: Linha) => T) => {
          const m = new Map<number, T[]>();
          for (const x of linhas) m.set(num(x[campo]), [...(m.get(num(x[campo])) ?? []), f(x)]);
          return m;
        };
        const sub = (sql: string) => l.consultar(sql, est);
        const horarios = doLocal(
          await sub(`SELECT h.local_atendimento_id, h.dia_semana, h.dia_nao_util, h.hora_inicio, h.hora_fim
                       FROM local_atendimento_horario h JOIN local_atendimento la ON la.id = h.local_atendimento_id
                      WHERE la.estabelecimento_id = ? ORDER BY h.dia_nao_util, h.dia_semana, h.hora_inicio`),
          'local_atendimento_id',
          (x): FaixaHorarioLocal => ({
            diaSemana: x['dia_semana'] === null ? null : num(x['dia_semana']),
            diaNaoUtil: bool(x['dia_nao_util']),
            inicio: hhmm(x['hora_inicio']),
            fim: hhmm(x['hora_fim']),
          }),
        );
        const encaminha = doLocal(
          await sub(`SELECT e.local_atendimento_id, e.destino_local_atendimento_id AS d FROM local_atendimento_encaminhamento e
                       JOIN local_atendimento la ON la.id = e.local_atendimento_id
                      WHERE la.estabelecimento_id = ? AND e.excluido_em IS NULL`),
          'local_atendimento_id',
          (x) => num(x['d']),
        );
        const consulta = doLocal(
          await sub(`SELECT v.local_atendimento_id, v.consultado_local_atendimento_id AS d FROM local_atendimento_visibilidade v
                       JOIN local_atendimento la ON la.id = v.local_atendimento_id
                      WHERE la.estabelecimento_id = ? AND v.excluido_em IS NULL`),
          'local_atendimento_id',
          (x) => num(x['d']),
        );
        const usuarios = doLocal(
          await sub(`SELECT x.local_atendimento_id, x.usuario_id, u.login, u.nome, x.atua_no_local, x.pode_operar
                       FROM usuario_local_atendimento x JOIN local_atendimento la ON la.id = x.local_atendimento_id
                       JOIN usuario u ON u.id = x.usuario_id
                      WHERE la.estabelecimento_id = ? AND x.excluido_em IS NULL ORDER BY u.nome`),
          'local_atendimento_id',
          (x) => ({
            usuario: num(x['usuario_id']),
            login: String(x['login']),
            nome: String(x['nome'] ?? x['login']),
            atuaNoLocal: bool(x['atua_no_local']),
            podeOperar: bool(x['pode_operar']),
          }),
        );
        return {
          recepcoes,
          modulos,
          locais: locais.map((x) => {
            const id = num(x['id']);
            return {
              id,
              codigo: String(x['codigo']),
              descricao: String(x['descricao']),
              recepcao: num(x['ponto_recepcao_id']),
              recepcaoDescricao: String(x['recepcao']),
              moduloRecepcao: x['modulo_recepcao_id'] === null ? null : num(x['modulo_recepcao_id']),
              permiteEncaminhamento: bool(x['permite_encaminhamento']),
              ativo: bool(x['ativo']),
              horario: horarios.get(id) ?? [],
              encaminhaPara: (encaminha.get(id) ?? []).sort((a, b) => a - b),
              consulta: (consulta.get(id) ?? []).sort((a, b) => a - b),
              usuarios: usuarios.get(id) ?? [],
            };
          }),
        };
      },
    );
  }

  /** Usuários ativos do cliente para a escolha na tela (por nome ou login; até 20). */
  async candidatos(termo: string): Promise<{ usuario: number; login: string; nome: string }[]> {
    const t = `%${termo.replace(/[%_\\]/g, '').slice(0, 60)}%`;
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'locais-atendimento' }, async (l) =>
      (
        await l.consultar(
          'SELECT id, login, nome FROM usuario WHERE excluido_em IS NULL AND (nome LIKE ? OR login LIKE ?) ORDER BY nome LIMIT 20',
          [t, t],
        )
      ).map((x) => ({
        usuario: num(x['id']),
        login: String(x['login']),
        nome: String(x['nome'] ?? x['login']),
      })),
    );
  }

  async manter(
    c: ContextoLocais & { correlacao: string; chaveIdempotencia: string; enderecoIp?: string },
    entrada: unknown,
  ): Promise<{ resultado: { local: number; acao: string; itens: number }; repetida: boolean }> {
    const q = await this.quem(c);
    if (q.usuario === null)
      throw recusa(
        'usuario-sem-conta',
        'Manter o local exige uma conta de usuário do cliente (o responsável fica no registro).',
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

  /** O módulo de recepção escolhido para o local tem de existir e estar ativo (ausente ou nulo: nada a conferir). */
  private async exigirModulo(tx: TxOperacao, modulo: number | null | undefined): Promise<void> {
    if (modulo === null || modulo === undefined) return;
    const x = await tx.uma('SELECT id FROM modulo_recepcao WHERE id = ? AND ativo', [modulo]);
    if (!x)
      throw recusa('modulo-recepcao-invalido', 'O módulo de recepção escolhido não existe ou está inativo.', {
        campos: ['moduloRecepcao'],
      });
  }

  private async gravar(
    tx: TxOperacao,
    e: EntradaManterLocal,
    ctx: ContextoOperacao,
  ): Promise<{ local: number; acao: string; itens: number }> {
    const est = ctx.estabelecimento!;
    if (e.acao === 'incluir') {
      const r = await tx.uma(
        'SELECT id FROM ponto_recepcao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [e.recepcao, est],
      );
      if (!r) throw recusa('recepcao-invalida', 'A recepção escolhida não é desta unidade.');
      const dup = await tx.uma(
        'SELECT id FROM local_atendimento WHERE estabelecimento_id = ? AND codigo = ?',
        [est, e.codigo],
      );
      if (dup) throw recusa('local-codigo-repetido', 'Já existe um local com este código na unidade.');
      await this.exigirModulo(tx, e.moduloRecepcao);
      const id = await tx.incluir('local_atendimento', {
        estabelecimento_id: est,
        ponto_recepcao_id: e.recepcao,
        modulo_recepcao_id: e.moduloRecepcao ?? null,
        codigo: e.codigo,
        descricao: e.descricao,
        permite_encaminhamento: e.permiteEncaminhamento,
      });
      return { local: id, acao: e.acao, itens: 1 };
    }
    const [local] = await tx.consultarParaAtualizar(
      'SELECT id, versao, ativo, permite_encaminhamento FROM local_atendimento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [e.local, est],
      { teto: 1 },
    );
    if (!local)
      throw new ErroOperacao(
        404,
        'registro-inexistente',
        'Local não encontrado',
        'O local não existe nesta unidade.',
      );
    const agora = this.agora();
    if (e.acao === 'dados') {
      if (!e.permiteEncaminhamento) {
        const n = await tx.uma(
          'SELECT COUNT(*) AS n FROM local_atendimento_encaminhamento WHERE local_atendimento_id = ? AND excluido_em IS NULL',
          [e.local],
        );
        if (num(n?.['n']) > 0)
          throw recusa(
            'local-com-encaminhamentos',
            'Retire os locais de encaminhamento antes de desmarcar "encaminha para outros locais".',
          );
      }
      await this.exigirModulo(tx, e.moduloRecepcao);
      await tx.alterar('local_atendimento', e.local, num(local['versao']), {
        descricao: e.descricao,
        permite_encaminhamento: e.permiteEncaminhamento,
        ativo: e.ativo,
        ...(e.moduloRecepcao !== undefined ? { modulo_recepcao_id: e.moduloRecepcao } : {}),
      });
      return { local: e.local, acao: e.acao, itens: 1 };
    }
    if (e.acao === 'horario') {
      const v = validarHorarioLocal(e.faixas);
      if ('recusa' in v) throw recusa(v.recusa.codigo, v.recusa.mensagem);
      const antigas = await tx.consultarParaAtualizar(
        'SELECT id, versao FROM local_atendimento_horario WHERE local_atendimento_id = ?',
        [e.local],
      );
      for (const x of antigas) await tx.excluir('local_atendimento_horario', num(x['id']), num(x['versao']));
      for (const f of v.faixas)
        await tx.incluir('local_atendimento_horario', {
          local_atendimento_id: e.local,
          dia_semana: f.diaSemana,
          dia_nao_util: f.diaNaoUtil,
          hora_inicio: `${f.inicio}:00`,
          hora_fim: `${f.fim}:00`,
        });
      return { local: e.local, acao: e.acao, itens: v.faixas.length };
    }
    const origem: LocalDaUnidade = {
      id: e.local,
      ativo: bool(local['ativo']),
      permiteEncaminhamento: bool(local['permite_encaminhamento']),
    };
    if (e.acao === 'encaminhamentos' || e.acao === 'visibilidade') {
      const tipo = e.acao === 'encaminhamentos' ? 'encaminhamento' : 'visibilidade';
      const v = validarLigacaoLocais(
        tipo,
        origem,
        e.acao === 'encaminhamentos' ? e.destinos : e.consultados,
        await locaisDaUnidade(tx, est),
      );
      if ('recusa' in v) throw recusa(v.recusa.codigo, v.recusa.mensagem);
      const [tabela, coluna] =
        e.acao === 'encaminhamentos'
          ? ['local_atendimento_encaminhamento', 'destino_local_atendimento_id']
          : ['local_atendimento_visibilidade', 'consultado_local_atendimento_id'];
      await this.sincronizar(
        tx,
        tabela!,
        coluna!,
        e.local,
        v.destinos,
        agora,
        ctx.usuario ?? null,
        () => ({}),
      );
      return { local: e.local, acao: e.acao, itens: v.destinos.length };
    }
    const v = validarUsuariosLocal(e.usuarios);
    if ('recusa' in v) throw recusa(v.recusa.codigo, v.recusa.mensagem);
    for (const u of v.usuarios) {
      const ok = await tx.uma('SELECT id FROM usuario WHERE id = ? AND excluido_em IS NULL', [u.usuario]);
      if (!ok) throw recusa('usuario-inexistente', 'O usuário não existe ou foi desativado.');
    }
    const papel = new Map(v.usuarios.map((u) => [u.usuario, u]));
    await this.sincronizar(
      tx,
      'usuario_local_atendimento',
      'usuario_id',
      e.local,
      v.usuarios.map((u) => u.usuario),
      agora,
      ctx.usuario ?? null,
      (u) => ({ atua_no_local: papel.get(u)!.atuaNoLocal, pode_operar: papel.get(u)!.podeOperar }),
      true,
    );
    return { local: e.local, acao: e.acao, itens: v.usuarios.length };
  }

  /** Leva a tabela de ligação do local à lista desejada: inclui, reativa a linha excluída e retira sem apagar. */
  private async sincronizar(
    tx: TxOperacao,
    tabela: string,
    coluna: string,
    local: number,
    desejados: readonly number[],
    agora: Date,
    usuario: number | null,
    extra: (id: number) => Record<string, unknown>,
    atualizarAtivos = false,
  ): Promise<void> {
    const linhas = await tx.consultarParaAtualizar(
      `SELECT id, versao, ${coluna} AS alvo, excluido_em FROM ${tabela} WHERE local_atendimento_id = ?`,
      [local],
    );
    const ativas = linhas.filter((x) => x['excluido_em'] === null);
    const excluidas = linhas.filter((x) => x['excluido_em'] !== null);
    const d = diferencaLista(
      ativas.map((x) => num(x['alvo'])),
      excluidas.map((x) => num(x['alvo'])),
      desejados,
    );
    const linha = (alvo: number) => linhas.find((x) => num(x['alvo']) === alvo)!;
    for (const a of d.retirar)
      await tx.alterar(tabela, num(linha(a)['id']), num(linha(a)['versao']), {
        excluido_em: agora,
        excluido_por: usuario,
      });
    for (const a of d.reativar)
      await tx.alterar(tabela, num(linha(a)['id']), num(linha(a)['versao']), {
        ...extra(a),
        excluido_em: null,
        excluido_por: null,
      });
    for (const a of d.incluir)
      await tx.incluir(tabela, { local_atendimento_id: local, [coluna]: a, ...extra(a) });
    if (atualizarAtivos)
      for (const x of ativas) {
        const a = num(x['alvo']);
        if (desejados.includes(a)) await tx.alterar(tabela, num(x['id']), num(x['versao']), extra(a));
      }
  }
}
