// Porta PRÓPRIA dos filtros salvos do painel de pacientes (F3.3, linha 03-PEP L90 da análise), sobre o banco do cliente
// pelo @sgh/nucleo:
//   - vários filtros nomeados por usuário e estabelecimento (`painel_filtro_usuario`): incluir, alterar com a versão
//     lida (renomear e trocar os recortes) e escolher o padrão (um só: os demais deixam de ser padrão na mesma
//     transação); o primeiro filtro nasce padrão;
//   - recortes por unidade, setor, acomodação, leito (do estabelecimento da sessão, ativos e não excluídos),
//     especialidade (ativa), tipo de atendimento, situação e "apenas meus pacientes";
//   - colunas por filtro com largura (`painel_coluna_usuario` com o filtro): exibir, ordem e largura em pixels; o filtro
//     sem colunas próprias usa as colunas gerais do usuário (as sem filtro, da porta do painel).
// Regras no domínio (`@sgh/dominio-pep`, filtros.ts); SQL parametrizado; gravações pelo executor (trilha). Nada é
// apagado: preferência do usuário trocada fica com nova versão da linha.
import { randomUUID } from 'node:crypto';
import { COLUNAS_PAINEL } from '@sgh/contratos';
import {
  type ErroRegraPainel,
  type FiltroExistente,
  type FiltroPainel,
  filtrosQueDeixamDeSerPadrao,
  nasceComoPadrao,
  SITUACOES_PACIENTE_FILTRO,
  TIPOS_ATENDIMENTO_FILTRO,
  validarColunasDoFiltro,
  validarFiltroPainel,
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
import { entradaValida, type NucleoEquipePainel } from './equipe-painel-propria.js';

export const PORTA_PAINEL_FILTROS = Symbol('PORTA_PAINEL_FILTROS');

export interface FiltroPainelLido extends FiltroPainel {
  readonly id: number;
  readonly versao: number;
}

export interface ColunaDoFiltroLida {
  readonly coluna: string;
  readonly largura: number | null;
}

const TABELAS = ['painel_filtro_usuario', 'painel_coluna_usuario'] as const;

type Existente = FiltroExistente & { readonly versao: number };

const id = z.number().int().positive().nullable();
const esquemaFiltro = z
  .object({
    nome: z.string().max(200),
    padrao: z.boolean().default(false),
    tipoAtendimento: z.enum(TIPOS_ATENDIMENTO_FILTRO as unknown as [string, ...string[]]).default('todos'),
    unidade: id.default(null),
    setor: id.default(null),
    acomodacao: id.default(null),
    leito: id.default(null),
    especialidade: id.default(null),
    situacao: z
      .enum(SITUACOES_PACIENTE_FILTRO as unknown as [string, ...string[]])
      .nullable()
      .default(null),
    apenasMeusPacientes: z.boolean().default(false),
  })
  .strict();
const esquemaAlterar = esquemaFiltro.extend({ versao: z.number().int().positive() }).strict();
const esquemaColunas = z
  .object({
    colunas: z
      .array(z.object({ coluna: z.string().max(60), largura: z.number().nullable().default(null) }).strict())
      .max(60),
  })
  .strict();

const num = (v: unknown): number => Number(v);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

const naoEncontrado = (o: string) =>
  new ErroOperacao(404, `${o}-inexistente`, 'Não encontrado', `${o} não encontrado neste estabelecimento.`);

function recusaRegra(erros: readonly ErroRegraPainel[]): ErroOperacao {
  return new ErroOperacao(
    422,
    erros[0]!.codigo,
    'Operação recusada',
    erros.map((e) => e.mensagem).join(' '),
    {
      campos: erros.map((e) => e.campo),
    },
  );
}

function filtroLido(x: Record<string, unknown>): FiltroPainelLido {
  return {
    id: num(x['id']),
    versao: num(x['versao']),
    nome: String(x['nome']),
    padrao: Boolean(Number(x['padrao'])),
    tipoAtendimento: String(x['tipo_atendimento']) as FiltroPainel['tipoAtendimento'],
    unidade: numOuNull(x['unidade_assistencial_id']),
    setor: numOuNull(x['setor_funcional_id']),
    acomodacao: numOuNull(x['acomodacao_id']),
    leito: numOuNull(x['leito_hospitalar_id']),
    especialidade: numOuNull(x['especialidade_medica_id']),
    situacao: (x['situacao_paciente'] ?? null) as FiltroPainel['situacao'],
    apenasMeusPacientes: Boolean(Number(x['apenas_meus_pacientes'])),
  };
}

const colunasDoFiltro = (f: FiltroPainel) => ({
  nome: f.nome.trim(),
  tipo_atendimento: f.tipoAtendimento,
  unidade_assistencial_id: f.unidade,
  setor_funcional_id: f.setor,
  acomodacao_id: f.acomodacao,
  leito_hospitalar_id: f.leito,
  especialidade_medica_id: f.especialidade,
  situacao_paciente: f.situacao,
  apenas_meus_pacientes: f.apenasMeusPacientes,
});

const SELECT_FILTRO = `SELECT id, versao, nome, padrao, tipo_atendimento, unidade_assistencial_id, setor_funcional_id,
  acomodacao_id, leito_hospitalar_id, especialidade_medica_id, situacao_paciente, apenas_meus_pacientes
  FROM painel_filtro_usuario`;

/** Cada recorte escolhido existe no estabelecimento da sessão (a especialidade é catálogo comum, só ativa). */
const RECORTES: readonly {
  campo: keyof FiltroPainel;
  nome: string;
  sql: string;
  doEstabelecimento: boolean;
}[] = [
  {
    campo: 'unidade',
    nome: 'Unidade',
    sql: 'SELECT id FROM unidade_assistencial WHERE id = ? AND estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL',
    doEstabelecimento: true,
  },
  {
    campo: 'setor',
    nome: 'Setor',
    sql: 'SELECT id FROM setor_funcional WHERE id = ? AND estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL',
    doEstabelecimento: true,
  },
  {
    campo: 'acomodacao',
    nome: 'Acomodação',
    sql: 'SELECT id FROM acomodacao WHERE id = ? AND estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL',
    doEstabelecimento: true,
  },
  {
    campo: 'leito',
    nome: 'Leito',
    sql: 'SELECT id FROM leito_hospitalar WHERE id = ? AND estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL',
    doEstabelecimento: true,
  },
  {
    campo: 'especialidade',
    nome: 'Especialidade',
    sql: 'SELECT id FROM especialidade_medica WHERE id = ? AND ativo = TRUE',
    doEstabelecimento: false,
  },
];

export class PortaPainelFiltrosPropria {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoEquipePainel,
    private readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private banco(c: ContextoDocs): string {
    return c.cliente || this.cliente;
  }

  private ler<T>(c: ContextoDocs, rotulo: string, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: this.banco(c), correlacao: `pep.painel.${rotulo}` },
      async (l) => {
        const e = await l.uma('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
          c.hospital,
        ]);
        if (!e) throw naoEncontrado('Estabelecimento');
        return fn(l, num(e['id']));
      },
    );
  }

  private async gravar<T extends Record<string, unknown>>(
    c: ContextoDocs,
    nome: string,
    fn: (tx: TxOperacao, est: number, usuario: number) => Promise<T & { tabela: string; id: number | null }>,
  ): Promise<T> {
    if (c.usuario === null)
      throw new ErroOperacao(
        403,
        'usuario-inexistente',
        'Operação recusada',
        'A sessão não tem usuário neste cliente.',
      );
    const usuario = c.usuario;
    const est = await this.ler(c, 'identidade', async (_l, e) => e);
    const contexto: ContextoOperacao = {
      cliente: this.banco(c),
      estabelecimento: est,
      usuario,
      correlacao: (c.correlacao || nome).slice(0, 64),
      chaveIdempotencia: `${nome}:${randomUUID()}`,
    };
    let feito: T | null = null;
    const op = definirOperacao({
      nome,
      tabelas: [...TABELAS],
      entrada: z.object({}).strict(),
      gravar: async (tx: TxOperacao) => {
        const r = await fn(tx, est, usuario);
        feito = r;
        return { tabela: r.tabela, id: r.id };
      },
      alvo: (_e, s) => ({ tabela: String(s['tabela']), id: s['id'] === null ? null : Number(s['id']) }),
    });
    await this.executor.executar(op, this.banco(c), {}, contexto);
    if (!feito) throw new Error(`A operação ${nome} terminou sem resultado.`);
    return feito;
  }

  /** Os filtros do usuário no estabelecimento da sessão, o padrão primeiro e depois por nome. */
  filtros(c: ContextoDocs): Promise<FiltroPainelLido[]> {
    return this.ler(c, 'filtros', async (l, est) => {
      const r = await l.consultar(
        `${SELECT_FILTRO} WHERE usuario_id = ? AND estabelecimento_id = ? ORDER BY padrao DESC, nome, id`,
        [c.usuario ?? 0, est],
      );
      return r.map(filtroLido);
    });
  }

  private async existentes(tx: TxOperacao, est: number, usuario: number): Promise<Existente[]> {
    const r = await tx.consultarParaAtualizar(
      'SELECT id, nome, padrao, versao FROM painel_filtro_usuario WHERE usuario_id = ? AND estabelecimento_id = ?',
      [usuario, est],
    );
    return r.map((x) => ({
      id: num(x['id']),
      nome: String(x['nome']),
      padrao: Boolean(Number(x['padrao'])),
      versao: num(x['versao']),
    }));
  }

  private async conferirRecortes(tx: TxOperacao, est: number, f: FiltroPainel): Promise<void> {
    for (const r of RECORTES) {
      const v = f[r.campo] as number | null;
      if (v === null) continue;
      const achou = await tx.uma(r.sql, r.doEstabelecimento ? [v, est] : [v]);
      if (!achou) throw naoEncontrado(r.nome);
    }
  }

  /** Desmarca os outros padrões (nova versão de cada linha), quando este filtro passa a ser o padrão. */
  private async padraoUnico(
    tx: TxOperacao,
    existentes: readonly Existente[],
    escolhido: number,
  ): Promise<void> {
    const sair = new Set(filtrosQueDeixamDeSerPadrao(existentes, escolhido));
    for (const e of existentes)
      if (sair.has(e.id)) await tx.alterar('painel_filtro_usuario', e.id, e.versao, { padrao: false });
  }

  async incluirFiltro(c: ContextoDocs, entrada: unknown): Promise<{ id: number }> {
    const f = entradaValida(esquemaFiltro, entrada) as FiltroPainel;
    return this.gravar(c, 'pep.painel.filtro_incluir', async (tx, est, usuario) => {
      const ex = await this.existentes(tx, est, usuario);
      const erros = validarFiltroPainel(f, ex, null);
      if (erros.length) throw recusaRegra(erros);
      await this.conferirRecortes(tx, est, f);
      const padrao = nasceComoPadrao(ex, f.padrao);
      const novo = await tx.incluir('painel_filtro_usuario', {
        estabelecimento_id: est,
        usuario_id: usuario,
        padrao,
        ...colunasDoFiltro(f),
      });
      if (padrao) await this.padraoUnico(tx, ex, novo);
      return { tabela: 'painel_filtro_usuario', id: novo };
    });
  }

  /** Altera (renomeia e troca recortes) com a versão lida; `padrao: true` torna este o padrão. */
  async alterarFiltro(c: ContextoDocs, filtro: number, entrada: unknown): Promise<{ id: number }> {
    const x = entradaValida(esquemaAlterar, entrada);
    const f = x as unknown as FiltroPainel;
    return this.gravar(c, 'pep.painel.filtro_alterar', async (tx, est, usuario) => {
      const ex = await this.existentes(tx, est, usuario);
      const atual = ex.find((e) => e.id === filtro);
      if (!atual) throw naoEncontrado('Filtro');
      const erros = validarFiltroPainel(f, ex, filtro);
      if (erros.length) throw recusaRegra(erros);
      await this.conferirRecortes(tx, est, f);
      // O padrão não se desmarca sozinho (sempre há um); outro filtro escolhido como padrão é que o desmarca.
      const padrao = f.padrao || atual.padrao;
      await tx.alterar('painel_filtro_usuario', filtro, x.versao, { padrao, ...colunasDoFiltro(f) });
      if (padrao) await this.padraoUnico(tx, ex, filtro);
      return { tabela: 'painel_filtro_usuario', id: filtro };
    });
  }

  /** Escolhe o filtro padrão (o que abre o painel); os demais deixam de ser padrão. */
  async escolherPadrao(c: ContextoDocs, filtro: number): Promise<{ id: number }> {
    return this.gravar(c, 'pep.painel.filtro_padrao_escolher', async (tx, est, usuario) => {
      const ex = await this.existentes(tx, est, usuario);
      const atual = ex.find((e) => e.id === filtro);
      if (!atual) throw naoEncontrado('Filtro');
      if (!atual.padrao) await tx.alterar('painel_filtro_usuario', filtro, atual.versao, { padrao: true });
      await this.padraoUnico(tx, ex, filtro);
      return { tabela: 'painel_filtro_usuario', id: filtro };
    });
  }

  /** Colunas próprias do filtro (com largura); vazio = o filtro usa as colunas gerais do usuário. */
  colunas(c: ContextoDocs, filtro: number): Promise<ColunaDoFiltroLida[]> {
    return this.ler(c, 'filtro-colunas', async (l, est) => {
      const f = await l.uma(
        'SELECT id FROM painel_filtro_usuario WHERE id = ? AND usuario_id = ? AND estabelecimento_id = ?',
        [filtro, c.usuario ?? 0, est],
      );
      if (!f) throw naoEncontrado('Filtro');
      const r = await l.consultar(
        `SELECT coluna, largura_pixels FROM painel_coluna_usuario
          WHERE usuario_id = ? AND painel_filtro_usuario_id = ? AND exibir = TRUE ORDER BY ordem, id`,
        [c.usuario ?? 0, filtro],
      );
      return r.map((x) => ({ coluna: String(x['coluna']), largura: numOuNull(x['largura_pixels']) }));
    });
  }

  /** Grava as colunas do filtro: as escolhidas com exibir, ordem e largura; as demais do catálogo, ocultas. */
  async gravarColunas(
    c: ContextoDocs,
    filtro: number,
    entrada: unknown,
  ): Promise<{ colunas: ColunaDoFiltroLida[] }> {
    const x = entradaValida(esquemaColunas, entrada);
    const escolhidas = x.colunas.map((k) => ({ coluna: k.coluna, largura: k.largura }));
    const erros = validarColunasDoFiltro(escolhidas, COLUNAS_PAINEL);
    if (erros.length) throw recusaRegra(erros);
    return this.gravar(c, 'pep.painel.filtro_colunas', async (tx, est, usuario) => {
      const f = await tx.uma(
        'SELECT id FROM painel_filtro_usuario WHERE id = ? AND usuario_id = ? AND estabelecimento_id = ?',
        [filtro, usuario, est],
      );
      if (!f) throw naoEncontrado('Filtro');
      const atuais = await tx.consultarParaAtualizar(
        `SELECT id, coluna, versao FROM painel_coluna_usuario WHERE usuario_id = ? AND painel_filtro_usuario_id = ?`,
        [usuario, filtro],
      );
      const porColuna = new Map(atuais.map((a) => [String(a['coluna']), a]));
      const nomes = escolhidas.map((k) => k.coluna);
      const todas = [
        ...escolhidas,
        ...COLUNAS_PAINEL.filter((k) => !nomes.includes(k)).map((k) => ({ coluna: k, largura: null })),
      ];
      for (const [i, k] of todas.entries()) {
        const valores = { exibir: nomes.includes(k.coluna), ordem: i + 1, largura_pixels: k.largura };
        const a = porColuna.get(k.coluna);
        if (a) await tx.alterar('painel_coluna_usuario', num(a['id']), num(a['versao']), valores);
        else
          await tx.incluir('painel_coluna_usuario', {
            usuario_id: usuario,
            painel_filtro_usuario_id: filtro,
            coluna: k.coluna,
            ...valores,
          });
      }
      return { tabela: 'painel_filtro_usuario', id: filtro, colunas: escolhidas };
    });
  }
}
