// Porta PRÓPRIA dos grupos comparativos de resultados e do filtro salvo do profissional (F3.3, linha 03-PEP L128):
//   - grupos (`painel_resultado_grupo` + `painel_resultado_grupo_exame`): cadastro do hospital, com a versão lida;
//     os itens são o exame inteiro ou um analito dele, em ordem (o item é configuração, não registro clínico: o que
//     sai do grupo é removido, com a trilha da operação); tirar o grupo de uso é `ativo = FALSE` (nada se apaga);
//   - filtros (`filtro_resultado_usuario`): só do usuário da sessão; um padrão por usuário (marcar um desmarca os
//     outros na mesma operação);
//   - comparativo do paciente: os valores dos resultados liberados (ou retificados; com "além dos liberados", também
//     os conferidos, marcados como preliminares) dos exames escolhidos, no estabelecimento da sessão, recortados pelo
//     período, pelo atendimento e pelos pedidos do profissional; a matriz, a faixa e a tendência são do domínio.
// Toda gravação pelo executor (trilha da operação), SQL parametrizado.
import { randomUUID } from 'node:crypto';
import {
  type Comparativo,
  ESCOPOS_FILTRO,
  type ItemComparativo,
  itensDoFiltro,
  montarComparativo,
  TIPOS_EXAME_GRUPO,
  validarFiltroResultado,
  validarGrupoResultado,
  type ValorComparativo,
  type ErroGrupoResultado,
} from '@sgh/dominio-pep';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { ContextoDocs } from './documentos-porta.js';
import type { NucleoEquipePainel } from './equipe-painel-propria.js';
import { dataHora, fusoValido } from './registro-porta-propria.js';

export const PORTA_GRUPOS_RESULTADO = Symbol('PORTA_GRUPOS_RESULTADO');

const id = z.number().int().positive();

export const esquemaGrupo = z
  .object({
    id: id.nullable().default(null),
    nome: z.string().min(1).max(100),
    tipoExame: z.enum(TIPOS_EXAME_GRUPO).default('laboratorio'),
    ordem: z.number().int().min(0).max(9999).default(0),
    ativo: z.boolean().default(true),
    itens: z
      .array(
        z
          .object({
            exame: id,
            exameAnalito: id.nullable().default(null),
            rotulo: z.string().max(60).nullable().default(null),
          })
          .strict(),
      )
      .max(60),
    versao: id.nullable().default(null),
  })
  .strict();

export const esquemaFiltro = z
  .object({
    id: id.nullable().default(null),
    nome: z.string().min(1).max(80),
    padrao: z.boolean().default(false),
    escopo: z.enum(ESCOPOS_FILTRO).default('atual'),
    incluirPendentes: z.boolean().default(false),
    somenteLiberados: z.boolean().default(true),
    somenteMeusPedidos: z.boolean().default(false),
    periodoDias: z.number().int().nullable().default(null),
    grupos: z.array(id).max(50).default([]),
    exames: z.array(id).max(200).default([]),
    versao: id.nullable().default(null),
  })
  .strict();

export type FiltroLido = Omit<z.infer<typeof esquemaFiltro>, 'id' | 'versao'> & {
  readonly id: number;
  readonly versao: number;
};

export interface ItemGrupoLido {
  readonly exame: number;
  readonly nomeExame: string;
  readonly exameAnalito: number | null;
  readonly analito: number | null;
  readonly nomeAnalito: string | null;
  readonly rotulo: string | null;
}

export interface GrupoLido {
  readonly id: number;
  readonly nome: string;
  readonly tipoExame: string;
  readonly ordem: number;
  readonly ativo: boolean;
  readonly versao: number;
  readonly itens: readonly ItemGrupoLido[];
}

export interface PedidoComparativo {
  readonly grupo?: number | null;
  readonly filtro?: number | null;
  readonly atendimento?: number | null;
  readonly dias?: number | null;
}

export interface ComparativoPaciente extends Comparativo {
  readonly filtroAplicado: { readonly id: number; readonly nome: string } | null;
  readonly grupos: readonly number[];
  readonly periodoDias: number | null;
  readonly pendentes: readonly { readonly exame: string; readonly pedidoEm: string | null }[];
  /**
   * O recorte aplicado: 'atendimento' (escopo atual com o atendimento informado), 'todos' (escopo de todos os
   * atendimentos) ou 'sem-atendimento' (escopo atual pedido sem atendimento em curso: a tela avisa que mostra todos).
   */
  readonly recorte: 'atendimento' | 'todos' | 'sem-atendimento';
  readonly atendimento: number | null;
}

const num = (v: unknown): number => Number(v);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const bool = (v: unknown): boolean => Boolean(Number(v));
const marcadores = (n: number): string => Array.from({ length: n }, () => '?').join(', ');

function entradaValida<T>(esq: z.ZodType<T>, entrada: unknown): T {
  const r = esq.safeParse(entrada);
  if (!r.success)
    throw new ErroOperacao(400, 'entrada-invalida', 'Entrada inválida', 'Confira os campos indicados.', {
      campos: r.error.issues.map((i) => i.path.map(String).join('.')),
    });
  return r.data;
}

function recusa(erros: readonly ErroGrupoResultado[]): ErroOperacao {
  return new ErroOperacao(
    422,
    erros[0]!.codigo,
    'Cadastro recusado',
    erros.map((e) => e.mensagem).join(' '),
    {
      campos: erros.map((e) => e.campo),
    },
  );
}

const conflito = () =>
  new ErroOperacao(
    409,
    'conflito-versao',
    'Gravado por outra pessoa',
    'O cadastro foi alterado por outra pessoa enquanto você editava. Releia e grave de novo.',
  );

const naoEncontrado = (o: string) =>
  new ErroOperacao(404, 'nao-encontrado', 'Não encontrado', `${o} não encontrado.`);

function filtroLido(x: Record<string, unknown>): FiltroLido {
  let crit: { grupos?: unknown; exames?: unknown } = {};
  try {
    const bruto = x['criterios'];
    crit = (typeof bruto === 'string' ? JSON.parse(bruto) : (bruto ?? {})) as typeof crit;
  } catch {
    crit = {};
  }
  const ids = (v: unknown) =>
    Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  return {
    id: num(x['id']),
    nome: String(x['nome']),
    padrao: bool(x['padrao']),
    escopo: String(x['escopo_atendimento']) as FiltroLido['escopo'],
    incluirPendentes: bool(x['incluir_nao_emitidos']),
    somenteLiberados: bool(x['somente_liberados']),
    somenteMeusPedidos: bool(x['somente_meus_pedidos']),
    periodoDias: numOuNull(x['periodo_dias']),
    grupos: ids(crit.grupos),
    exames: ids(crit.exames),
    versao: num(x['versao']),
  };
}

export class PortaGruposResultadoPropria {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoEquipePainel,
    private readonly cliente: string,
    executor?: Executor,
    private readonly agora: () => Date = () => new Date(),
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private banco(c: ContextoDocs): string {
    return c.cliente || this.cliente;
  }

  private ler<T>(
    c: ContextoDocs,
    rotulo: string,
    fn: (l: Leitor, est: { id: number; fuso: string }) => Promise<T>,
  ): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: this.banco(c), correlacao: `pep.gruposResultado.${rotulo}` },
      async (l) => {
        const e = await l.uma(
          'SELECT id, fuso_horario FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
          [c.hospital],
        );
        if (!e) throw naoEncontrado('Estabelecimento');
        return fn(l, { id: num(e['id']), fuso: fusoValido(texto(e['fuso_horario'])) });
      },
    );
  }

  private exigirUsuario(c: ContextoDocs): number {
    if (c.usuario === null)
      throw new ErroOperacao(
        403,
        'usuario-inexistente',
        'Operação recusada',
        'A sessão não tem usuário neste cliente.',
      );
    return c.usuario;
  }

  private async gravar(
    c: ContextoDocs,
    nome: string,
    tabela: string,
    fn: (tx: TxOperacao, usuario: number) => Promise<number>,
    extras: readonly string[] = [],
  ): Promise<{ id: number }> {
    const usuario = this.exigirUsuario(c);
    const est = await this.ler(c, 'identidade', async (_l, e) => e.id);
    const contexto: ContextoOperacao = {
      cliente: this.banco(c),
      estabelecimento: est,
      usuario,
      correlacao: (c.correlacao || nome).slice(0, 64),
      chaveIdempotencia: `${nome}:${randomUUID()}`,
    };
    let feito: number | null = null;
    const op = definirOperacao({
      nome,
      tabelas: [tabela, ...extras],
      entrada: z.object({}).strict(),
      gravar: async (tx: TxOperacao) => {
        feito = await fn(tx, usuario);
        return { tabela, id: feito };
      },
      alvo: (_e, s) => ({ tabela: String(s['tabela']), id: Number(s['id']) }),
    });
    await this.executor.executar(op, this.banco(c), {}, contexto);
    if (feito === null) throw new Error(`A operação ${nome} terminou sem resultado.`);
    return { id: feito };
  }

  // ── Grupos ────────────────────────────────────────────────────────────────────────────────────────

  private async gruposLidos(l: Leitor, ids: readonly number[] | null): Promise<GrupoLido[]> {
    const gs = await l.consultar(
      `SELECT id, nome, tipo_exame, ordem, ativo, versao FROM painel_resultado_grupo
        ${ids ? `WHERE id IN (${marcadores(ids.length)})` : ''} ORDER BY ordem, nome LIMIT 500`,
      ids ?? [],
    );
    if (!gs.length) return [];
    const is = await l.consultar(
      `SELECT gi.painel_resultado_grupo_id AS grupo, gi.exame_id, ex.nome AS nome_exame, gi.exame_analito_id,
              ea.analito_id, an.nome AS nome_analito, gi.rotulo
         FROM painel_resultado_grupo_exame gi
         JOIN exame ex ON ex.id = gi.exame_id
         LEFT JOIN exame_analito ea ON ea.id = gi.exame_analito_id
         LEFT JOIN analito an ON an.id = ea.analito_id
        WHERE gi.painel_resultado_grupo_id IN (${marcadores(gs.length)}) AND gi.excluido_em IS NULL
        ORDER BY gi.painel_resultado_grupo_id, gi.sequencia`,
      gs.map((g) => num(g['id'])),
    );
    return gs.map((g) => ({
      id: num(g['id']),
      nome: String(g['nome']),
      tipoExame: String(g['tipo_exame']),
      ordem: num(g['ordem']),
      ativo: bool(g['ativo']),
      versao: num(g['versao']),
      itens: is
        .filter((i) => num(i['grupo']) === num(g['id']))
        .map((i) => ({
          exame: num(i['exame_id']),
          nomeExame: String(i['nome_exame']),
          exameAnalito: numOuNull(i['exame_analito_id']),
          analito: numOuNull(i['analito_id']),
          nomeAnalito: texto(i['nome_analito']),
          rotulo: texto(i['rotulo']),
        })),
    }));
  }

  grupos(c: ContextoDocs): Promise<GrupoLido[]> {
    return this.ler(c, 'grupos', (l) => this.gruposLidos(l, null));
  }

  /** Exames e analitos para montar grupo ou filtro (busca por nome ou código, até 30 exames). */
  buscarExames(c: ContextoDocs, termo: string) {
    const t = termo.trim();
    if (t.length < 2) return Promise.resolve([]);
    return this.ler(c, 'exames', async (l) => {
      const es = await l.consultar(
        `SELECT id, codigo, nome FROM exame WHERE nome LIKE ? OR codigo = ? ORDER BY nome LIMIT 30`,
        [`%${t}%`, t],
      );
      if (!es.length) return [];
      const as = await l.consultar(
        `SELECT ea.id, ea.exame_id, an.nome FROM exame_analito ea JOIN analito an ON an.id = ea.analito_id
          WHERE ea.exame_id IN (${marcadores(es.length)}) AND ea.ativo AND NOT ea.titulo
          ORDER BY ea.exame_id, ea.ordem`,
        es.map((e) => num(e['id'])),
      );
      return es.map((e) => ({
        id: num(e['id']),
        codigo: String(e['codigo']),
        nome: String(e['nome']),
        analitos: as
          .filter((a) => num(a['exame_id']) === num(e['id']))
          .map((a) => ({ id: num(a['id']), nome: String(a['nome']) })),
      }));
    });
  }

  /** Inclui ou altera (com a versão lida) o grupo e os itens em ordem. */
  gravarGrupo(c: ContextoDocs, entrada: unknown): Promise<{ id: number }> {
    const x = entradaValida(esquemaGrupo, entrada);
    const itens = x.itens.map((i) => ({ ...i, rotulo: i.rotulo?.trim() ? i.rotulo.trim() : null }));
    const erros = validarGrupoResultado({ nome: x.nome, tipoExame: x.tipoExame, itens });
    if (erros.length) throw recusa(erros);
    return this.gravar(
      c,
      'pep.resultados.configurar_grupo',
      'painel_resultado_grupo',
      async (tx) => {
        // O analito escolhido tem de ser do exame do item (falha fechada).
        const comAnalito = itens.filter((i) => i.exameAnalito !== null);
        if (comAnalito.length) {
          const ok = await tx.consultar(
            `SELECT id, exame_id FROM exame_analito WHERE id IN (${marcadores(comAnalito.length)})`,
            comAnalito.map((i) => i.exameAnalito),
          );
          for (const i of comAnalito)
            if (!ok.some((o) => num(o['id']) === i.exameAnalito && num(o['exame_id']) === i.exame))
              throw recusa([
                {
                  codigo: 'analito-de-outro-exame',
                  campo: 'itens',
                  mensagem: 'O analito escolhido não é do exame.',
                },
              ]);
        }
        const exames = [...new Set(itens.map((i) => i.exame))];
        const achados = await tx.consultar(
          `SELECT id FROM exame WHERE id IN (${marcadores(exames.length)})`,
          exames,
        );
        if (achados.length !== exames.length) throw naoEncontrado('Exame');
        const valores = { nome: x.nome.trim(), tipo_exame: x.tipoExame, ordem: x.ordem, ativo: x.ativo };
        let grupo: number;
        if (x.id !== null) {
          const a = await tx.uma('SELECT id, versao FROM painel_resultado_grupo WHERE id = ? FOR UPDATE', [
            x.id,
          ]);
          if (!a) throw naoEncontrado('Grupo');
          if (x.versao === null || x.versao !== num(a['versao'])) throw conflito();
          await tx.alterar('painel_resultado_grupo', x.id, x.versao, valores);
          grupo = x.id;
        } else {
          const mesmo = await tx.uma('SELECT id FROM painel_resultado_grupo WHERE nome = ?', [valores.nome]);
          if (mesmo)
            throw new ErroOperacao(
              409,
              'nome-repetido',
              'Cadastro recusado',
              'Já existe um grupo com esse nome.',
            );
          grupo = await tx.incluir('painel_resultado_grupo', valores);
        }
        // Itens: todos vão para uma sequência provisória única (a chave única da ordem não colide na troca); os
        // escolhidos voltam a 1..n (uma linha com exclusão lógica vinda da carga é reativada) e os que saíram são removidos.
        const atuais = await tx.consultar(
          `SELECT id, exame_id, exame_analito_id, sequencia, versao, excluido_em FROM painel_resultado_grupo_exame
          WHERE painel_resultado_grupo_id = ? ORDER BY id FOR UPDATE`,
          [grupo],
        );
        const versao = new Map<number, number>(atuais.map((a) => [num(a['id']), num(a['versao'])]));
        for (const [n, a] of atuais.entries()) {
          const rid = num(a['id']);
          versao.set(
            rid,
            await tx.alterar('painel_resultado_grupo_exame', rid, versao.get(rid)!, { sequencia: 20000 + n }),
          );
        }
        const usados = new Set<number>();
        for (const [n, i] of itens.entries()) {
          const a = atuais.find(
            (r) => num(r['exame_id']) === i.exame && numOuNull(r['exame_analito_id']) === i.exameAnalito,
          );
          if (a) {
            const rid = num(a['id']);
            usados.add(rid);
            versao.set(
              rid,
              await tx.alterar('painel_resultado_grupo_exame', rid, versao.get(rid)!, {
                sequencia: n + 1,
                rotulo: i.rotulo,
                excluido_em: null,
                excluido_por: null,
              }),
            );
          } else
            await tx.incluir('painel_resultado_grupo_exame', {
              painel_resultado_grupo_id: grupo,
              sequencia: n + 1,
              exame_id: i.exame,
              exame_analito_id: i.exameAnalito,
              rotulo: i.rotulo,
            });
        }
        for (const a of atuais) {
          const rid = num(a['id']);
          if (!usados.has(rid)) await tx.excluir('painel_resultado_grupo_exame', rid, versao.get(rid)!);
        }
        return grupo;
      },
      ['painel_resultado_grupo_exame'],
    );
  }

  // ── Filtros do usuário ────────────────────────────────────────────────────────────────────────────

  filtros(c: ContextoDocs): Promise<FiltroLido[]> {
    const usuario = this.exigirUsuario(c);
    return this.ler(c, 'filtros', async (l) =>
      (
        await l.consultar(
          `SELECT id, nome, padrao, escopo_atendimento, incluir_nao_emitidos, somente_liberados, somente_meus_pedidos,
                  periodo_dias, criterios, versao
             FROM filtro_resultado_usuario WHERE usuario_id = ? ORDER BY padrao DESC, nome LIMIT 100`,
          [usuario],
        )
      ).map(filtroLido),
    );
  }

  gravarFiltro(c: ContextoDocs, entrada: unknown): Promise<{ id: number }> {
    const x = entradaValida(esquemaFiltro, entrada);
    const erros = validarFiltroResultado(x);
    if (erros.length) throw recusa(erros);
    return this.gravar(c, 'pep.resultados.salvar_filtro', 'filtro_resultado_usuario', async (tx, usuario) => {
      const valores = {
        nome: x.nome.trim(),
        padrao: x.padrao,
        escopo_atendimento: x.escopo,
        incluir_nao_emitidos: x.incluirPendentes,
        somente_liberados: x.somenteLiberados,
        somente_meus_pedidos: x.somenteMeusPedidos,
        periodo_dias: x.periodoDias,
        criterios: JSON.stringify({ grupos: x.grupos, exames: x.exames }),
      };
      let fid: number;
      if (x.id !== null) {
        const a = await tx.uma(
          'SELECT id, versao FROM filtro_resultado_usuario WHERE id = ? AND usuario_id = ? FOR UPDATE',
          [x.id, usuario],
        );
        if (!a) throw naoEncontrado('Filtro');
        if (x.versao === null || x.versao !== num(a['versao'])) throw conflito();
        await tx.alterar('filtro_resultado_usuario', x.id, x.versao, valores);
        fid = x.id;
      } else {
        const mesmo = await tx.uma(
          'SELECT id FROM filtro_resultado_usuario WHERE usuario_id = ? AND nome = ?',
          [usuario, valores.nome],
        );
        if (mesmo)
          throw new ErroOperacao(
            409,
            'nome-repetido',
            'Cadastro recusado',
            'Você já tem um filtro com esse nome.',
          );
        fid = await tx.incluir('filtro_resultado_usuario', { usuario_id: usuario, ...valores });
      }
      if (x.padrao) {
        const outros = await tx.consultar(
          'SELECT id, versao FROM filtro_resultado_usuario WHERE usuario_id = ? AND padrao AND id <> ? FOR UPDATE',
          [usuario, fid],
        );
        for (const o of outros)
          await tx.alterar('filtro_resultado_usuario', num(o['id']), num(o['versao']), { padrao: false });
      }
      return fid;
    });
  }

  /** O filtro é preferência do próprio usuário (não é registro clínico): sai de vez. */
  excluirFiltro(c: ContextoDocs, filtro: number, versao: number): Promise<{ id: number }> {
    return this.gravar(
      c,
      'pep.resultados.excluir_filtro',
      'filtro_resultado_usuario',
      async (tx, usuario) => {
        const a = await tx.uma(
          'SELECT id, versao FROM filtro_resultado_usuario WHERE id = ? AND usuario_id = ? FOR UPDATE',
          [filtro, usuario],
        );
        if (!a) throw naoEncontrado('Filtro');
        if (num(a['versao']) !== versao) throw conflito();
        await tx.excluir('filtro_resultado_usuario', filtro, versao);
        return filtro;
      },
    );
  }

  // ── Comparativo do paciente ───────────────────────────────────────────────────────────────────────

  /**
   * Sem grupo nem filtro: o filtro padrão do usuário; sem padrão, o primeiro grupo ativo. `atendimento` só recorta
   * quando o escopo do filtro é o atendimento atual (ou quando vem sem filtro). O paciente já foi conferido (vínculo e
   * leitura registrada) pela rota.
   */
  comparativo(c: ContextoDocs, paciente: number, p: PedidoComparativo): Promise<ComparativoPaciente> {
    const usuario = c.usuario;
    return this.ler(c, 'comparativo', async (l, est) => {
      let filtro: FiltroLido | null = null;
      if (p.filtro) {
        const f = await l.uma(
          `SELECT id, nome, padrao, escopo_atendimento, incluir_nao_emitidos, somente_liberados, somente_meus_pedidos,
                  periodo_dias, criterios, versao FROM filtro_resultado_usuario WHERE id = ? AND usuario_id = ?`,
          [p.filtro, usuario],
        );
        if (!f) throw naoEncontrado('Filtro');
        filtro = filtroLido(f);
      } else if (!p.grupo && usuario !== null) {
        const f = await l.uma(
          `SELECT id, nome, padrao, escopo_atendimento, incluir_nao_emitidos, somente_liberados, somente_meus_pedidos,
                  periodo_dias, criterios, versao FROM filtro_resultado_usuario WHERE usuario_id = ? AND padrao LIMIT 1`,
          [usuario],
        );
        filtro = f ? filtroLido(f) : null;
      }
      let gruposIds: number[];
      if (p.grupo) gruposIds = [p.grupo];
      else if (filtro) gruposIds = [...filtro.grupos];
      else {
        const g = await l.uma(
          'SELECT id FROM painel_resultado_grupo WHERE ativo ORDER BY ordem, nome LIMIT 1',
        );
        gruposIds = g ? [num(g['id'])] : [];
      }
      // Grupo fora de uso (ativo = FALSE) não abre no comparativo, nem escolhido nem pelo filtro salvo.
      const grupos = gruposIds.length ? (await this.gruposLidos(l, gruposIds)).filter((g) => g.ativo) : [];
      if (p.grupo && !grupos.length) throw naoEncontrado('Grupo');
      const porId = new Map(grupos.map((g) => [g.id, g]));
      const itens: ItemComparativo[] = itensDoFiltro(
        gruposIds
          .map((g) => porId.get(g))
          .filter((g): g is GrupoLido => !!g)
          .map((g) => g.itens.map((i) => ({ exame: i.exame, analito: i.analito, rotulo: i.rotulo }))),
        p.grupo ? [] : (filtro?.exames ?? []),
      );
      const periodoDias = p.dias ?? filtro?.periodoDias ?? null;
      const escopo = filtro?.escopo ?? 'atual';
      const porAtendimento = escopo === 'atual' && !!p.atendimento;
      const recorte: ComparativoPaciente['recorte'] =
        escopo === 'todos' ? 'todos' : porAtendimento ? 'atendimento' : 'sem-atendimento';
      const vazio: ComparativoPaciente = {
        colunas: [],
        linhas: [],
        foraDaFaixa: 0,
        criticos: 0,
        filtroAplicado: filtro ? { id: filtro.id, nome: filtro.nome } : null,
        grupos: gruposIds,
        periodoDias,
        pendentes: [],
        recorte,
        atendimento: porAtendimento ? p.atendimento! : null,
      };
      if (!itens.length) return vazio;
      const exames = [...new Set(itens.map((i) => i.exame))];
      const conds: string[] = [];
      const params: unknown[] = [est.id, paciente, ...exames];
      if (periodoDias) {
        conds.push('re.resultado_em >= ?');
        params.push(new Date(this.agora().getTime() - periodoDias * 86_400_000));
      }
      if (porAtendimento) {
        conds.push('r.atendimento_id = ?');
        params.push(p.atendimento);
      }
      if (filtro?.somenteMeusPedidos && usuario !== null) {
        // Vínculo vigente hoje no fuso do estabelecimento; sem vínculo de profissional, nenhum pedido é "meu".
        const hoje = (dataHora(this.agora(), est.fuso) ?? '').slice(0, 10);
        const v = await l.uma(
          `SELECT profissional_id FROM usuario_vinculo_profissional
            WHERE usuario_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND profissional_id IS NOT NULL
              AND vigencia_inicio <= ? AND (vigencia_fim IS NULL OR vigencia_fim >= ?)
            ORDER BY vigencia_inicio DESC, id DESC LIMIT 1`,
          [usuario, est.id, hoje, hoje],
        );
        const profissional = v ? num(v['profissional_id']) : 0;
        conds.push('r.solicitante_profissional_id = ?');
        params.push(profissional);
      }
      const situacoes =
        filtro && !filtro.somenteLiberados
          ? "'liberado','retificado','conferido'"
          : "'liberado','retificado'";
      const vs = await l.consultar(
        `SELECT re.id AS resultado, re.resultado_em, re.situacao, ei.exame_id, ra.analito_id, an.nome AS nome_analito,
                ra.sequencia, ra.valor_numerico, ra.valor_texto, COALESCE(u.simbolo, u.codigo) AS unidade,
                ra.referencia_minimo, ra.referencia_maximo, ra.referencia_texto, ra.critico_minimo, ra.critico_maximo,
                ra.critico
           FROM resultado_analito ra
           JOIN resultado_exame re ON re.id = ra.resultado_exame_id
           JOIN exame_item ei ON ei.id = re.exame_item_id AND ei.excluido_em IS NULL
           JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id AND r.excluido_em IS NULL
           JOIN analito an ON an.id = ra.analito_id
           LEFT JOIN unidade_resultado u ON u.id = ra.unidade_resultado_id
          WHERE r.estabelecimento_id = ? AND re.paciente_id = ? AND ei.exame_id IN (${marcadores(exames.length)})
            AND re.excluido_em IS NULL AND ra.excluido_em IS NULL AND re.situacao IN (${situacoes})
            ${conds.map((x) => `AND ${x}`).join(' ')}
          ORDER BY re.resultado_em DESC, re.id DESC LIMIT 3000`,
        params,
      );
      const valores: ValorComparativo[] = vs.map((v) => ({
        resultado: num(v['resultado']),
        em: (dataHora(v['resultado_em'], est.fuso) ?? '').slice(0, 16),
        exame: num(v['exame_id']),
        analito: num(v['analito_id']),
        nomeAnalito: String(v['nome_analito']),
        sequencia: num(v['sequencia']),
        numero: numOuNull(v['valor_numerico']),
        texto: texto(v['valor_texto']),
        unidade: texto(v['unidade']),
        refMin: numOuNull(v['referencia_minimo']),
        refMax: numOuNull(v['referencia_maximo']),
        refTexto: texto(v['referencia_texto']),
        critMin: numOuNull(v['critico_minimo']),
        critMax: numOuNull(v['critico_maximo']),
        critico: bool(v['critico']),
        preliminar: String(v['situacao']) === 'conferido',
      }));
      let pendentes: ComparativoPaciente['pendentes'] = [];
      if (filtro?.incluirPendentes) {
        const ps = await l.consultar(
          `SELECT ex.nome, r.solicitado_em FROM exame_item ei
             JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id AND r.excluido_em IS NULL
             JOIN exame ex ON ex.id = ei.exame_id
             LEFT JOIN resultado_exame re ON re.exame_item_id = ei.id AND re.excluido_em IS NULL
              AND re.situacao IN ('liberado','retificado')
            WHERE r.estabelecimento_id = ? AND r.paciente_id = ? AND ei.exame_id IN (${marcadores(exames.length)})
              AND ei.excluido_em IS NULL AND r.cancelado_em IS NULL AND re.id IS NULL
              ${periodoDias ? 'AND r.solicitado_em >= ?' : ''} ${porAtendimento ? 'AND r.atendimento_id = ?' : ''}
            ORDER BY r.solicitado_em DESC LIMIT 50`,
          [
            est.id,
            paciente,
            ...exames,
            ...(periodoDias ? [new Date(this.agora().getTime() - periodoDias * 86_400_000)] : []),
            ...(porAtendimento ? [p.atendimento] : []),
          ],
        );
        pendentes = ps.map((x) => ({
          exame: String(x['nome']),
          pedidoEm: dataHora(x['solicitado_em'], est.fuso),
        }));
      }
      return { ...vazio, ...montarComparativo(itens, valores), pendentes };
    });
  }
}
