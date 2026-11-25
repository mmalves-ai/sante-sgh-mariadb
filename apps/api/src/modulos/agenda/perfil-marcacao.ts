// Perfis de marcação (02-AGE linha 46) sobre perfil_marcacao, perfil_marcacao_escopo e perfil_marcacao_usuario: o
// que cada grupo de usuários marca, por convênio, especialidade, setor, agenda (serviço), profissional e unidade. A
// regra é do domínio (`decidirPerfilMarcacao`, `validarRecortes` em @sgh/dominio-agenda); aqui ficam a leitura, as
// gravações pelo executor (trilha na mesma transação) e a trava aplicada pela porta da agenda na marcação, junto do
// escopo do cargo e da lista nominal. Nada se apaga: recorte retirado, usuário desligado e perfil desativado ficam
// com exclusão lógica ou "ativo = falso", e a trilha guarda o histórico.
import {
  type AlvoMarcacao,
  decidirPerfilMarcacao,
  DIMENSOES_PERFIL,
  type DimensaoPerfil,
  type PerfilDoUsuario,
  type RecortePerfil,
  TIPOS_PERFIL,
  validarPerfil,
  validarRecortes,
  validarVigencia,
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
const dataIso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);

/** Coluna de alvo de cada dimensão do recorte (tipo_escopo = a dimensão). */
const COLUNA: Record<DimensaoPerfil, string> = {
  fonte_pagadora: 'fonte_pagadora_id',
  especialidade: 'especialidade_medica_id',
  setor: 'setor_funcional_id',
  agenda: 'agenda_servico_id',
  profissional: 'profissional_id',
  estabelecimento: 'escopo_estabelecimento_id',
};
const COLUNAS_ALVO = Object.values(COLUNA);
const SELECAO_RECORTE = `SELECT id, versao, perfil_marcacao_id, sequencia, tipo_escopo, permitido, excluido_em, ${COLUNAS_ALVO.join(', ')}
  FROM perfil_marcacao_escopo`;

const alvoDaLinha = (x: Linha): number => num(x[COLUNA[x['tipo_escopo'] as DimensaoPerfil]]);

const dataTexto = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.');

export const esquemaSalvarPerfil = z
  .object({
    id: z.number().int().positive().optional(),
    /** Versão que a tela leu (obrigatória na alteração): diferente da do banco, 409 conflito-versao. */
    versao: z.number().int().positive().optional(),
    codigo: z.string().trim().min(1).max(30),
    descricao: z.string().trim().min(1).max(150),
    tipoPerfil: z.enum(TIPOS_PERFIL),
    permiteEncaixe: z.boolean(),
    ativo: z.boolean(),
    recortes: z
      .array(
        z
          .object({
            dimensao: z.enum(DIMENSOES_PERFIL),
            alvo: z.number().int().positive(),
            permitido: z.boolean(),
          })
          .strict(),
      )
      .max(200),
  })
  .strict()
  .refine((e) => e.id === undefined || e.versao !== undefined, {
    message: 'Informe a versão do perfil que está sendo alterado.',
    path: ['versao'],
  });
export type EntradaSalvarPerfil = z.infer<typeof esquemaSalvarPerfil>;

export const esquemaUsuarioPerfil = z
  .object({
    perfil: z.number().int().positive(),
    acao: z.enum(['incluir', 'remover']),
    usuario: z.number().int().positive(),
    vigenciaInicio: dataTexto.nullable().optional(),
    vigenciaFim: dataTexto.nullable().optional(),
  })
  .strict();
export type EntradaUsuarioPerfil = z.infer<typeof esquemaUsuarioPerfil>;

export interface RecorteLido extends RecortePerfil {
  readonly nome: string;
}
export interface UsuarioDoPerfil {
  readonly usuario: number;
  readonly login: string;
  readonly nome: string;
  readonly vigenciaInicio: string | null;
  readonly vigenciaFim: string | null;
}
export interface PerfilLido {
  readonly id: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly tipoPerfil: string;
  readonly permiteEncaixe: boolean;
  readonly ativo: boolean;
  readonly versao: number;
  readonly recortes: readonly RecorteLido[];
  readonly usuarios: readonly UsuarioDoPerfil[];
}
export interface OpcaoRecorte {
  readonly id: number;
  readonly nome: string;
}
export type OpcoesRecorte = Record<DimensaoPerfil, OpcaoRecorte[]>;

type Consulta = Pick<Leitor, 'consultar'>;

/** Nome legível de um alvo do recorte (tela) e conferência de que ele existe (gravação). */
const SQL_ALVO: Record<DimensaoPerfil, string> = {
  fonte_pagadora: 'SELECT id, nome FROM fonte_pagadora WHERE id = ?',
  especialidade: 'SELECT id, descricao AS nome FROM especialidade_medica WHERE id = ?',
  setor: 'SELECT id, nome, estabelecimento_id FROM setor_funcional WHERE id = ?',
  agenda: 'SELECT id, nome, estabelecimento_id FROM agenda_servico WHERE id = ?',
  profissional:
    'SELECT pr.id, pf.nome FROM profissional pr JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id WHERE pr.id = ?',
  estabelecimento: 'SELECT id, nome_fantasia AS nome FROM estabelecimento WHERE id = ?',
};

/** Perfis vigentes do usuário (de qualquer unidade: o domínio decide quais alcançam a marcação). */
export async function perfisDoUsuario(l: Consulta, usuario: number): Promise<PerfilDoUsuario[]> {
  const ps = await l.consultar(
    `SELECT p.id, p.codigo, p.estabelecimento_id, p.ativo, p.permite_encaixe, pu.vigencia_inicio, pu.vigencia_fim
       FROM perfil_marcacao_usuario pu JOIN perfil_marcacao p ON p.id = pu.perfil_marcacao_id
      WHERE pu.usuario_id = ? AND pu.excluido_em IS NULL AND p.excluido_em IS NULL`,
    [usuario],
  );
  if (ps.length === 0) return [];
  const rs = await l.consultar(
    `${SELECAO_RECORTE} WHERE excluido_em IS NULL AND perfil_marcacao_id IN (${ps.map(() => '?').join(', ')})`,
    ps.map((p) => p['id']),
  );
  return ps.map((p) => ({
    id: num(p['id']),
    codigo: String(p['codigo']),
    estabelecimento: num(p['estabelecimento_id']),
    ativo: Boolean(Number(p['ativo'])),
    permiteEncaixe: Boolean(Number(p['permite_encaixe'])),
    vigenciaInicio: dataIso(p['vigencia_inicio']),
    vigenciaFim: dataIso(p['vigencia_fim']),
    recortes: rs
      .filter((r) => num(r['perfil_marcacao_id']) === num(p['id']))
      .map((r) => ({
        dimensao: r['tipo_escopo'] as DimensaoPerfil,
        alvo: alvoDaLinha(r),
        permitido: Boolean(Number(r['permitido'])),
      })),
  }));
}

/**
 * Trava do perfil de marcação (dentro da transação da marcação, junto do escopo e da lista nominal). Usuário sem
 * perfil vigente na unidade passa (escopo atual); processo automático (sem usuário) e administrador também.
 */
export async function exigirPerfilMarcacao(
  tx: TxOperacao,
  p: {
    usuario: number | null;
    estabelecimento: number;
    agenda: number;
    fontePagadora: number;
    encaixe: boolean;
    hoje: string;
    administrador?: boolean;
  },
): Promise<void> {
  if (p.usuario === null || p.administrador) return;
  const perfis = await perfisDoUsuario(tx, p.usuario);
  if (perfis.length === 0) return;
  const a = await tx.uma('SELECT setor_funcional_id, profissional_id FROM agenda_servico WHERE id = ?', [
    p.agenda,
  ]);
  const esp = await tx.consultar(
    'SELECT especialidade_medica_id FROM agenda_especialidade WHERE agenda_servico_id = ? AND excluido_em IS NULL',
    [p.agenda],
  );
  const alvo: AlvoMarcacao = {
    estabelecimento: p.estabelecimento,
    agenda: p.agenda,
    fontePagadora: p.fontePagadora,
    setor: a?.['setor_funcional_id'] == null ? null : num(a['setor_funcional_id']),
    profissional: a?.['profissional_id'] == null ? null : num(a['profissional_id']),
    especialidades: esp.map((x) => num(x['especialidade_medica_id'])),
    encaixe: p.encaixe,
  };
  const d = decidirPerfilMarcacao(perfis, alvo, p.hoje);
  if (!d.ok) throw recusa(d.codigo, d.mensagem);
}

export interface ContextoPerfis {
  readonly hospital: string;
  readonly login: string;
}

export class PerfisMarcacaoPropria {
  private readonly executor: Executor;
  private readonly salvarOp = definirOperacao<EntradaSalvarPerfil, { perfil: number; recortes: number }>({
    nome: 'agenda.perfil_marcacao_salvar',
    tabelas: ['perfil_marcacao', 'perfil_marcacao_escopo'],
    entrada: esquemaSalvarPerfil as unknown as z.ZodType<EntradaSalvarPerfil>,
    gravar: (tx, e, ctx) => this.gravarPerfil(tx, e, ctx),
    alvo: (_e, r) => ({ tabela: 'perfil_marcacao', id: r.perfil }),
  });
  private readonly usuarioOp = definirOperacao<EntradaUsuarioPerfil, { perfil: number; usuarios: number }>({
    nome: 'agenda.perfil_marcacao_usuario',
    tabelas: ['perfil_marcacao_usuario'],
    entrada: esquemaUsuarioPerfil as unknown as z.ZodType<EntradaUsuarioPerfil>,
    gravar: (tx, e, ctx) => this.gravarUsuario(tx, e, ctx),
    alvo: (e) => ({ tabela: 'perfil_marcacao', id: e.perfil }),
  });

  constructor(
    private readonly nucleo: NucleoAgenda,
    private readonly cliente: string,
  ) {
    this.executor = nucleo.criarExecutor();
  }

  private async quem(c: ContextoPerfis): Promise<{ estabelecimento: number; usuario: number | null }> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'perfil-marcacao' }, async (l) => {
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

  /** Perfis da unidade, com os recortes (nome do alvo) e os usuários ativos. */
  async listar(c: ContextoPerfis): Promise<PerfilLido[]> {
    const q = await this.quem(c);
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: 'perfil-marcacao', estabelecimento: q.estabelecimento },
      async (l) => {
        const ps = await l.consultar(
          `SELECT id, codigo, descricao, tipo_perfil, permite_encaixe, ativo, versao FROM perfil_marcacao
            WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY ativo DESC, descricao`,
          [q.estabelecimento],
        );
        if (ps.length === 0) return [];
        const ids = ps.map((p) => p['id']);
        const marc = ids.map(() => '?').join(', ');
        const rs = await l.consultar(
          `${SELECAO_RECORTE} WHERE excluido_em IS NULL AND perfil_marcacao_id IN (${marc}) ORDER BY sequencia`,
          ids,
        );
        const nomes = new Map<string, string>();
        for (const r of rs) {
          const d = r['tipo_escopo'] as DimensaoPerfil;
          const k = `${d}:${alvoDaLinha(r)}`;
          if (nomes.has(k)) continue;
          const [x] = await l.consultar(SQL_ALVO[d], [alvoDaLinha(r)]);
          nomes.set(k, x ? String(x['nome']) : `#${alvoDaLinha(r)}`);
        }
        const us = await l.consultar(
          `SELECT pu.perfil_marcacao_id, pu.usuario_id, pu.vigencia_inicio, pu.vigencia_fim, u.login, u.nome
             FROM perfil_marcacao_usuario pu JOIN usuario u ON u.id = pu.usuario_id
            WHERE pu.excluido_em IS NULL AND pu.perfil_marcacao_id IN (${marc}) ORDER BY u.nome`,
          ids,
        );
        return ps.map((p) => ({
          id: num(p['id']),
          codigo: String(p['codigo']),
          descricao: String(p['descricao']),
          tipoPerfil: String(p['tipo_perfil']),
          permiteEncaixe: Boolean(Number(p['permite_encaixe'])),
          ativo: Boolean(Number(p['ativo'])),
          versao: num(p['versao']),
          recortes: rs
            .filter((r) => num(r['perfil_marcacao_id']) === num(p['id']))
            .map((r) => {
              const dimensao = r['tipo_escopo'] as DimensaoPerfil;
              const alvo = alvoDaLinha(r);
              return {
                dimensao,
                alvo,
                permitido: Boolean(Number(r['permitido'])),
                nome: nomes.get(`${dimensao}:${alvo}`) ?? `#${alvo}`,
              };
            }),
          usuarios: us
            .filter((u) => num(u['perfil_marcacao_id']) === num(p['id']))
            .map((u) => ({
              usuario: num(u['usuario_id']),
              login: String(u['login']),
              nome: String(u['nome'] ?? u['login']),
              vigenciaInicio: dataIso(u['vigencia_inicio']),
              vigenciaFim: dataIso(u['vigencia_fim']),
            })),
        }));
      },
    );
  }

  /** Opções de cada recorte para os combos da tela (ativos; setores e agendas da unidade). */
  async opcoes(c: ContextoPerfis): Promise<OpcoesRecorte> {
    const q = await this.quem(c);
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: 'perfil-marcacao', estabelecimento: q.estabelecimento },
      async (l) => {
        const lista = async (sql: string, p: unknown[] = []) =>
          (await l.consultar(sql, p)).map((x) => ({ id: num(x['id']), nome: String(x['nome']) }));
        return {
          fonte_pagadora: await lista(
            'SELECT id, nome FROM fonte_pagadora WHERE excluido_em IS NULL ORDER BY nome LIMIT 500',
          ),
          especialidade: await lista(
            'SELECT id, descricao AS nome FROM especialidade_medica WHERE ativo ORDER BY descricao LIMIT 500',
          ),
          setor: await lista(
            'SELECT id, nome FROM setor_funcional WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY nome LIMIT 500',
            [q.estabelecimento],
          ),
          agenda: await lista(
            'SELECT id, nome FROM agenda_servico WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY nome LIMIT 500',
            [q.estabelecimento],
          ),
          profissional: await lista(
            `SELECT DISTINCT pr.id, pf.nome FROM agenda_servico a JOIN profissional pr ON pr.id = a.profissional_id
               JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
              WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL ORDER BY pf.nome LIMIT 500`,
            [q.estabelecimento],
          ),
          estabelecimento: await lista(
            'SELECT id, nome_fantasia AS nome FROM estabelecimento WHERE excluido_em IS NULL ORDER BY nome_fantasia LIMIT 200',
          ),
        };
      },
    );
  }

  private async contexto(
    c: ContextoPerfis & { correlacao: string; chaveIdempotencia: string; enderecoIp?: string },
  ): Promise<ContextoOperacao> {
    const q = await this.quem(c);
    if (q.usuario === null)
      throw recusa(
        'usuario-sem-conta',
        'Gravar o perfil exige uma conta de usuário do cliente (o responsável fica no registro).',
      );
    return {
      cliente: this.cliente,
      estabelecimento: q.estabelecimento,
      usuario: q.usuario,
      correlacao: c.correlacao.slice(0, 64),
      chaveIdempotencia: c.chaveIdempotencia.slice(0, 80),
      ...(c.enderecoIp ? { enderecoIp: c.enderecoIp } : {}),
    };
  }

  async salvar(
    c: ContextoPerfis & { correlacao: string; chaveIdempotencia: string; enderecoIp?: string },
    entrada: unknown,
  ): Promise<{ resultado: { perfil: number; recortes: number }; repetida: boolean }> {
    const r = await this.executor.executar(this.salvarOp, this.cliente, entrada, await this.contexto(c));
    return { resultado: r.resultado, repetida: r.repetida };
  }

  async definirUsuario(
    c: ContextoPerfis & { correlacao: string; chaveIdempotencia: string; enderecoIp?: string },
    entrada: unknown,
  ): Promise<{ resultado: { perfil: number; usuarios: number }; repetida: boolean }> {
    const r = await this.executor.executar(this.usuarioOp, this.cliente, entrada, await this.contexto(c));
    return { resultado: r.resultado, repetida: r.repetida };
  }

  private async travarPerfil(tx: TxOperacao, id: number, estabelecimento: number): Promise<Linha> {
    const [p] = await tx.consultarParaAtualizar(
      'SELECT id, versao FROM perfil_marcacao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [id, estabelecimento],
      { teto: 1 },
    );
    if (!p)
      throw new ErroOperacao(
        404,
        'registro-inexistente',
        'Perfil não encontrado',
        'O perfil não existe mais.',
      );
    return p;
  }

  private async gravarPerfil(
    tx: TxOperacao,
    e: EntradaSalvarPerfil,
    ctx: ContextoOperacao,
  ): Promise<{ perfil: number; recortes: number }> {
    const est = Number(ctx.estabelecimento);
    const rp = validarPerfil(e) ?? validarRecortes(e.recortes);
    if (rp) throw recusa(rp.codigo, rp.mensagem, rp.campo ? { campos: [rp.campo] } : undefined);
    const codigo = e.codigo.trim().toUpperCase();
    const dono = await tx.uma('SELECT id FROM perfil_marcacao WHERE estabelecimento_id = ? AND codigo = ?', [
      est,
      codigo,
    ]);
    if (dono && num(dono['id']) !== e.id)
      throw recusa('codigo-repetido', 'Já existe um perfil com este código na unidade.', {
        campos: ['codigo'],
      });
    // Alvos existem (e o setor e a agenda são da unidade).
    for (const r of e.recortes) {
      const x = await tx.uma(SQL_ALVO[r.dimensao], [r.alvo]);
      const daUnidade = r.dimensao !== 'setor' && r.dimensao !== 'agenda';
      if (!x || (!daUnidade && num(x['estabelecimento_id']) !== est))
        throw recusa('recorte-inexistente', 'Um item do recorte não existe ou não é desta unidade.', {
          campos: ['recortes'],
        });
    }
    const valores = {
      codigo,
      descricao: e.descricao.trim(),
      tipo_perfil: e.tipoPerfil,
      permite_encaixe: e.permiteEncaixe,
      ativo: e.ativo,
    };
    let id: number;
    if (e.id) {
      await this.travarPerfil(tx, e.id, est);
      id = e.id;
      // A versão vem da tela: outro gestor que gravou antes faz esta alteração cair em 409 conflito-versao, em vez de
      // a lista de recortes antiga retirar em silêncio o que ele acabou de incluir.
      await tx.alterar('perfil_marcacao', id, e.versao!, valores);
    } else {
      id = await tx.incluir('perfil_marcacao', { estabelecimento_id: est, ...valores });
    }
    const linhas = await tx.consultarParaAtualizar(`${SELECAO_RECORTE} WHERE perfil_marcacao_id = ?`, [id]);
    const chave = (d: string, a: number) => `${d}:${a}`;
    const novos = new Map(e.recortes.map((r) => [chave(r.dimensao, r.alvo), r]));
    let seq = linhas.reduce((m, x) => Math.max(m, num(x['sequencia'])), 0);
    const agora = new Date();
    const vistas = new Set<string>();
    for (const x of linhas) {
      const k = chave(String(x['tipo_escopo']), alvoDaLinha(x));
      const n = novos.get(k);
      const ativa = x['excluido_em'] === null;
      if (!n) {
        if (ativa)
          await tx.alterar('perfil_marcacao_escopo', num(x['id']), num(x['versao']), {
            excluido_em: agora,
            excluido_por: ctx.usuario,
          });
        continue;
      }
      if (vistas.has(k)) continue;
      vistas.add(k);
      if (!ativa || Boolean(Number(x['permitido'])) !== n.permitido)
        await tx.alterar('perfil_marcacao_escopo', num(x['id']), num(x['versao']), {
          permitido: n.permitido,
          excluido_em: null,
          excluido_por: null,
        });
    }
    for (const r of e.recortes) {
      if (vistas.has(chave(r.dimensao, r.alvo))) continue;
      seq += 1;
      await tx.incluir('perfil_marcacao_escopo', {
        perfil_marcacao_id: id,
        sequencia: seq,
        tipo_escopo: r.dimensao,
        permitido: r.permitido,
        [COLUNA[r.dimensao]]: r.alvo,
      });
    }
    return { perfil: id, recortes: e.recortes.length };
  }

  private async gravarUsuario(
    tx: TxOperacao,
    e: EntradaUsuarioPerfil,
    ctx: ContextoOperacao,
  ): Promise<{ perfil: number; usuarios: number }> {
    await this.travarPerfil(tx, e.perfil, Number(ctx.estabelecimento));
    const ini = e.vigenciaInicio ?? null;
    const fim = e.vigenciaFim ?? null;
    const rv = validarVigencia(ini, fim);
    if (rv) throw recusa(rv.codigo, rv.mensagem, { campos: [rv.campo ?? 'vigenciaFim'] });
    const [x] = await tx.consultarParaAtualizar(
      'SELECT id, versao, excluido_em FROM perfil_marcacao_usuario WHERE perfil_marcacao_id = ? AND usuario_id = ?',
      [e.perfil, e.usuario],
      { teto: 1 },
    );
    if (e.acao === 'remover') {
      if (!x || x['excluido_em'] !== null)
        throw recusa('usuario-fora-do-perfil', 'O usuário não está neste perfil.');
      await tx.alterar('perfil_marcacao_usuario', num(x['id']), num(x['versao']), {
        excluido_em: new Date(),
        excluido_por: ctx.usuario,
      });
    } else {
      const u = await tx.uma('SELECT id FROM usuario WHERE id = ? AND excluido_em IS NULL', [e.usuario]);
      if (!u) throw recusa('usuario-inexistente', 'O usuário não existe ou foi desativado.');
      const v = { vigencia_inicio: ini, vigencia_fim: fim };
      if (x)
        await tx.alterar('perfil_marcacao_usuario', num(x['id']), num(x['versao']), {
          ...v,
          excluido_em: null,
          excluido_por: null,
        });
      else
        await tx.incluir('perfil_marcacao_usuario', {
          perfil_marcacao_id: e.perfil,
          usuario_id: e.usuario,
          ...v,
        });
    }
    const [n] = await tx.consultar(
      'SELECT COUNT(*) AS n FROM perfil_marcacao_usuario WHERE perfil_marcacao_id = ? AND excluido_em IS NULL',
      [e.perfil],
    );
    return { perfil: e.perfil, usuarios: num(n?.['n'] ?? 0) };
  }
}
