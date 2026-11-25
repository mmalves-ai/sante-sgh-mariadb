// Porta PRÓPRIA da página inicial montada pelo hospital (01-ADM L114; F8), sobre o banco do cliente. As regras são do
// @sgh/dominio-relatorio (pagina-inicial.ts); aqui ficam as leituras e as gravações:
//   - o CATÁLOGO do editor: os tipos de bloco ativos (tipo_bloco_pagina: as listas de trabalho da página inicial, o
//     indicador, o atalho e o texto), os indicadores ativos e os perfis de acesso do estabelecimento ou da rede;
//   - os MODELOS do estabelecimento e da rede (modelo_pagina_inicial), com os blocos em ordem
//     (modelo_pagina_inicial_bloco) e os perfis com a prioridade (modelo_pagina_inicial_perfil);
//   - CRIAR (rascunho), SALVAR a página inteira de uma vez (nome, blocos em ordem e perfis; trava pela versão lida) e
//     MUDAR A SITUAÇÃO (publicar exige bloco e perfil; inativar tira de uso). Nada é apagado: o bloco ou o perfil que
//     sai fica marcado como excluído e volta se for posto de novo na mesma posição;
//   - a MINHA PÁGINA: o modelo publicado dos perfis vigentes da pessoa no estabelecimento, com os blocos que ela pode
//     ver e a série das últimas competências de cada indicador (só agregados). Sem modelo, nulo: a página fixa vale.
import {
  type BlocoInicioEntrada,
  blocosVisiveisInicio,
  COMPETENCIAS_GRAFICO_INICIO,
  conferirBlocosInicio,
  conferirPerfisInicio,
  conferirPublicacaoInicio,
  escolherModeloInicio,
  MAXIMO_BLOCOS_INICIO,
  MAXIMO_PERFIS_INICIO,
  podeTransitarModeloInicio,
  SITUACOES_MODELO_INICIO,
  type SituacaoModeloInicio,
  TIPOS_BLOCO_INICIO,
  type TipoBlocoInicio,
} from '@sgh/dominio-relatorio';
import type { Leitor, TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import {
  BaseComunicacaoPropria,
  conflito,
  type ContextoComunicacao,
  entradaValida,
  naoEncontrado,
  num,
  numOuNull,
  recusa,
  txtOuNull,
} from '../integracao/comunicacao-base-propria.js';

export const PORTA_PAGINA_INICIAL = Symbol('PORTA_PAGINA_INICIAL');

const T_MODELO = 'modelo_pagina_inicial';
const T_BLOCO = 'modelo_pagina_inicial_bloco';
const T_PERFIL = 'modelo_pagina_inicial_perfil';
export const TABELAS_PAGINA_INICIAL = [T_MODELO, T_BLOCO, T_PERFIL] as const;

export const OPERACOES_PAGINA_INICIAL = {
  criar: 'relatorio.pagina_inicial.criar',
  salvar: 'relatorio.pagina_inicial.salvar',
  situacao: 'relatorio.pagina_inicial.situacao',
} as const;

const texto = (max: number) => z.string().trim().max(max);
export const esquemaCriarModeloInicio = z
  .object({ nome: texto(150).min(3), descricao: texto(500).nullable(), rede: z.boolean() })
  .strict();
const esquemaBloco = z
  .object({
    tipo: z.enum(TIPOS_BLOCO_INICIO),
    catalogo: z.string().max(30).nullable(),
    indicadorId: z.number().int().positive().nullable(),
    titulo: texto(150).nullable(),
    endereco: texto(1000).nullable(),
    texto: z.string().max(2000).nullable(),
    largura: z.number().int(),
  })
  .strict();
export const esquemaSalvarModeloInicio = z
  .object({
    versao: z.number().int().positive(),
    nome: texto(150).min(3),
    descricao: texto(500).nullable(),
    blocos: z.array(esquemaBloco).max(MAXIMO_BLOCOS_INICIO + 1),
    perfis: z
      .array(z.object({ perfilId: z.number().int().positive(), prioridade: z.number().int() }).strict())
      .max(MAXIMO_PERFIS_INICIO + 1),
  })
  .strict();
export const esquemaSituacaoModeloInicio = z
  .object({ versao: z.number().int().positive(), situacao: z.enum(SITUACOES_MODELO_INICIO) })
  .strict();

const SQL_MODELOS = `SELECT m.id, m.nome, m.descricao, m.situacao, m.estabelecimento_id, m.versao, m.alterado_em, m.criado_em,
    (SELECT COUNT(*) FROM modelo_pagina_inicial_bloco b WHERE b.modelo_pagina_inicial_id = m.id AND b.excluido_em IS NULL) AS blocos,
    (SELECT COUNT(*) FROM modelo_pagina_inicial_perfil p WHERE p.modelo_pagina_inicial_id = m.id AND p.excluido_em IS NULL) AS perfis
  FROM modelo_pagina_inicial m
  WHERE (m.estabelecimento_id = ? OR m.estabelecimento_id IS NULL)
  ORDER BY m.situacao = 'inativo', m.nome, m.id LIMIT 500`;
const SQL_MODELO = `SELECT id, nome, descricao, situacao, estabelecimento_id, versao FROM modelo_pagina_inicial
  WHERE id = ? AND (estabelecimento_id = ? OR estabelecimento_id IS NULL)`;
const SQL_BLOCOS = `SELECT b.id, b.sequencia, b.tipo_bloco, t.codigo AS catalogo, b.indicador_id, i.nome AS indicador_nome,
    b.titulo, b.endereco_link, b.texto, b.largura
  FROM modelo_pagina_inicial_bloco b
    LEFT JOIN tipo_bloco_pagina t ON t.id = b.tipo_bloco_pagina_id
    LEFT JOIN indicador i ON i.id = b.indicador_id
  WHERE b.modelo_pagina_inicial_id = ? AND b.excluido_em IS NULL ORDER BY b.sequencia`;
const SQL_PERFIS = `SELECT p.perfil_acesso_id, a.nome, p.prioridade FROM modelo_pagina_inicial_perfil p
    JOIN perfil_acesso a ON a.id = p.perfil_acesso_id
  WHERE p.modelo_pagina_inicial_id = ? AND p.excluido_em IS NULL ORDER BY p.prioridade, a.nome`;
const SQL_TIPOS = `SELECT id, codigo, descricao, categoria, componente, detalhamento FROM tipo_bloco_pagina
  WHERE ativo = TRUE ORDER BY categoria = 'lista_trabalho' DESC, descricao LIMIT 200`;
const SQL_INDICADORES = `SELECT id, codigo, nome, unidade, simbolo FROM indicador
  WHERE ativo = TRUE AND excluido_em IS NULL ORDER BY nome LIMIT 2000`;
const SQL_PERFIS_ACESSO = `SELECT id, codigo, nome FROM perfil_acesso
  WHERE ativo = TRUE AND excluido_em IS NULL AND (estabelecimento_id = ? OR estabelecimento_id IS NULL)
  ORDER BY nome LIMIT 2000`;
const SQL_CANDIDATOS = `SELECT DISTINCT m.id AS modelo_id, m.situacao, m.estabelecimento_id, mp.prioridade
  FROM usuario_perfil up
    JOIN modelo_pagina_inicial_perfil mp ON mp.perfil_acesso_id = up.perfil_acesso_id AND mp.excluido_em IS NULL
    JOIN modelo_pagina_inicial m ON m.id = mp.modelo_pagina_inicial_id
  WHERE up.usuario_id = ? AND up.estabelecimento_id = ? AND up.excluido_em IS NULL
    AND up.vigencia_inicio <= CURRENT_DATE AND (up.vigencia_fim IS NULL OR up.vigencia_fim >= CURRENT_DATE)
    AND m.situacao = 'publicado'`;
const SQL_SERIE = `SELECT competencia, valor, valor_meta FROM apuracao_indicador
  WHERE indicador_id = ? AND estabelecimento_id = ? AND escopo_chave = '0-0' AND excluido_em IS NULL
  ORDER BY competencia DESC LIMIT ${COMPETENCIAS_GRAFICO_INICIO}`;

export interface BlocoModeloInicio {
  readonly tipo: TipoBlocoInicio;
  readonly catalogo: string | null;
  readonly indicadorId: number | null;
  readonly indicadorNome: string | null;
  readonly titulo: string | null;
  readonly endereco: string | null;
  readonly texto: string | null;
  readonly largura: number;
}

const dia = (v: unknown): string =>
  v instanceof Date
    ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
    : String(v).slice(0, 10);

function bloco(r: Record<string, unknown>): BlocoModeloInicio {
  return {
    tipo: String(r['tipo_bloco']) as TipoBlocoInicio,
    catalogo: txtOuNull(r['catalogo']),
    indicadorId: numOuNull(r['indicador_id']),
    indicadorNome: txtOuNull(r['indicador_nome']),
    titulo: txtOuNull(r['titulo']),
    endereco: txtOuNull(r['endereco_link']),
    texto: txtOuNull(r['texto']),
    largura: num(r['largura']),
  };
}

export class PortaPaginaInicialPropria extends BaseComunicacaoPropria {
  async catalogo(c: ContextoComunicacao) {
    return this.ler(c, 'pagina_inicial.catalogo', async (l, est) => ({
      tipos: (await l.consultar(SQL_TIPOS, [])).map((r) => ({
        codigo: String(r['codigo']),
        descricao: String(r['descricao']),
        categoria: String(r['categoria']),
        componente: String(r['componente']),
        detalhamento: txtOuNull(r['detalhamento']),
      })),
      indicadores: (await l.consultar(SQL_INDICADORES, [])).map((r) => ({
        id: num(r['id']),
        codigo: String(r['codigo']),
        nome: String(r['nome']),
        unidade: String(r['unidade']),
      })),
      perfis: (await l.consultar(SQL_PERFIS_ACESSO, [est])).map((r) => ({
        id: num(r['id']),
        codigo: String(r['codigo']),
        nome: String(r['nome']),
      })),
    }));
  }

  async modelos(c: ContextoComunicacao) {
    return this.ler(c, 'pagina_inicial.modelos', async (l, est) =>
      (await l.consultar(SQL_MODELOS, [est])).map((r) => ({
        id: num(r['id']),
        nome: String(r['nome']),
        descricao: txtOuNull(r['descricao']),
        situacao: String(r['situacao']) as SituacaoModeloInicio,
        rede: r['estabelecimento_id'] === null,
        blocos: num(r['blocos']),
        perfis: num(r['perfis']),
        versao: num(r['versao']),
      })),
    );
  }

  async detalhe(c: ContextoComunicacao, id: number) {
    return this.ler(c, 'pagina_inicial.detalhe', (l, est) => this.lerDetalhe(l, est, id));
  }

  private async lerDetalhe(l: Leitor, est: number, id: number) {
    const m = await l.uma(SQL_MODELO, [id, est]);
    if (!m) throw naoEncontrado('Modelo de página inicial');
    return {
      id,
      nome: String(m['nome']),
      descricao: txtOuNull(m['descricao']),
      situacao: String(m['situacao']) as SituacaoModeloInicio,
      rede: m['estabelecimento_id'] === null,
      versao: num(m['versao']),
      blocos: (await l.consultar(SQL_BLOCOS, [id])).map(bloco),
      perfis: (await l.consultar(SQL_PERFIS, [id])).map((r) => ({
        perfilId: num(r['perfil_acesso_id']),
        nome: String(r['nome']),
        prioridade: num(r['prioridade']),
      })),
    };
  }

  async criar(c: ContextoComunicacao, entrada: unknown): Promise<{ id: number; versao: number }> {
    const e = entradaValida(esquemaCriarModeloInicio, entrada);
    return this.gravar(c, OPERACOES_PAGINA_INICIAL.criar, TABELAS_PAGINA_INICIAL, async (tx, est) => {
      await this.conferirNomeLivre(tx, est, e.rede, e.nome, null);
      const id = await tx.incluir(T_MODELO, {
        estabelecimento_id: e.rede ? null : est,
        nome: e.nome,
        descricao: e.descricao || null,
        situacao: 'rascunho',
      });
      return { id, versao: 1 };
    });
  }

  async salvar(
    c: ContextoComunicacao,
    id: number,
    entrada: unknown,
  ): Promise<{ id: number; versao: number }> {
    const e = entradaValida(esquemaSalvarModeloInicio, entrada);
    return this.gravar(
      c,
      OPERACOES_PAGINA_INICIAL.salvar,
      TABELAS_PAGINA_INICIAL,
      async (tx, est, usuario) => {
        const m = await this.travar(tx, est, id);
        if (num(m['versao']) !== e.versao) throw conflito();
        const rede = m['estabelecimento_id'] === null;
        await this.conferirNomeLivre(tx, est, rede, e.nome, id);
        const tipos = new Map(
          (
            await tx.consultar('SELECT id, codigo FROM tipo_bloco_pagina WHERE ativo = TRUE', [], {
              teto: 500,
            })
          ).map((r) => [String(r['codigo']), num(r['id'])]),
        );
        const blocos: BlocoInicioEntrada[] = e.blocos.map((b) => ({
          ...b,
          titulo: b.titulo || null,
          endereco: b.endereco || null,
          texto: b.texto ?? null,
        }));
        const erros = [
          ...conferirBlocosInicio(blocos, new Set(tipos.keys())),
          ...conferirPerfisInicio(e.perfis),
        ];
        if (String(m['situacao']) === 'publicado')
          erros.push(...conferirPublicacaoInicio(blocos.length, e.perfis.length));
        await this.conferirAlvos(tx, est, blocos, e.perfis, erros);
        if (erros.length > 0) throw recusa(erros, 'Página inicial recusada');

        const agora = new Date();
        // Blocos: a posição (sequência) é a chave; o que sobra fica marcado como excluído (nada é apagado).
        const atuais = new Map(
          (
            await tx.consultar(
              'SELECT id, sequencia, versao, excluido_em FROM modelo_pagina_inicial_bloco WHERE modelo_pagina_inicial_id = ?',
              [id],
              { teto: 1000 },
            )
          ).map((r) => [num(r['sequencia']), r]),
        );
        for (const [i, b] of blocos.entries()) {
          const seq = i + 1;
          const valores = {
            tipo_bloco: b.tipo,
            tipo_bloco_pagina_id: tipos.get(b.tipo === 'lista_trabalho' ? b.catalogo! : b.tipo) ?? null,
            indicador_id: b.tipo === 'indicador' ? b.indicadorId : null,
            titulo: b.titulo?.trim() || null,
            endereco_link: b.tipo === 'link' ? b.endereco!.trim() : null,
            texto: b.tipo === 'texto' ? b.texto!.trim() : null,
            coluna: 1,
            linha: seq,
            largura: b.largura,
            altura: 1,
          };
          const r = atuais.get(seq);
          if (r)
            await tx.alterar(T_BLOCO, num(r['id']), num(r['versao']), {
              ...valores,
              excluido_em: null,
              excluido_por: null,
            });
          else await tx.incluir(T_BLOCO, { modelo_pagina_inicial_id: id, sequencia: seq, ...valores });
        }
        for (const [seq, r] of atuais)
          if (seq > blocos.length && r['excluido_em'] === null)
            await tx.alterar(T_BLOCO, num(r['id']), num(r['versao']), {
              excluido_em: agora,
              excluido_por: usuario,
            });

        // Perfis: o perfil é a chave; o que sai fica marcado como excluído.
        const perfisAtuais = new Map(
          (
            await tx.consultar(
              'SELECT id, perfil_acesso_id, versao, excluido_em FROM modelo_pagina_inicial_perfil WHERE modelo_pagina_inicial_id = ?',
              [id],
              { teto: 1000 },
            )
          ).map((r) => [num(r['perfil_acesso_id']), r]),
        );
        const novos = new Set(e.perfis.map((p) => p.perfilId));
        for (const p of e.perfis) {
          const r = perfisAtuais.get(p.perfilId);
          if (r)
            await tx.alterar(T_PERFIL, num(r['id']), num(r['versao']), {
              prioridade: p.prioridade,
              excluido_em: null,
              excluido_por: null,
            });
          else
            await tx.incluir(T_PERFIL, {
              modelo_pagina_inicial_id: id,
              perfil_acesso_id: p.perfilId,
              prioridade: p.prioridade,
            });
        }
        for (const [perfil, r] of perfisAtuais)
          if (!novos.has(perfil) && r['excluido_em'] === null)
            await tx.alterar(T_PERFIL, num(r['id']), num(r['versao']), {
              excluido_em: agora,
              excluido_por: usuario,
            });

        const versao = await tx.alterar(T_MODELO, id, e.versao, {
          nome: e.nome,
          descricao: e.descricao || null,
        });
        return { id, versao };
      },
    );
  }

  async mudarSituacao(
    c: ContextoComunicacao,
    id: number,
    entrada: unknown,
  ): Promise<{ id: number; situacao: SituacaoModeloInicio; versao: number }> {
    const e = entradaValida(esquemaSituacaoModeloInicio, entrada);
    return this.gravar(c, OPERACOES_PAGINA_INICIAL.situacao, TABELAS_PAGINA_INICIAL, async (tx, est) => {
      const m = await this.travar(tx, est, id);
      if (num(m['versao']) !== e.versao) throw conflito();
      const de = String(m['situacao']) as SituacaoModeloInicio;
      if (!podeTransitarModeloInicio(de, e.situacao))
        throw recusa(
          [
            {
              campo: 'situacao',
              codigo: 'transicao-invalida',
              mensagem: `O modelo ${de} não passa a ${e.situacao}.`,
            },
          ],
          'Situação recusada',
        );
      if (e.situacao === 'publicado') {
        const [q] = await tx.consultar(
          `SELECT (SELECT COUNT(*) FROM modelo_pagina_inicial_bloco WHERE modelo_pagina_inicial_id = ? AND excluido_em IS NULL) AS blocos,
                  (SELECT COUNT(*) FROM modelo_pagina_inicial_perfil WHERE modelo_pagina_inicial_id = ? AND excluido_em IS NULL) AS perfis`,
          [id, id],
          { teto: 1 },
        );
        const erros = conferirPublicacaoInicio(num(q?.['blocos']), num(q?.['perfis']));
        if (erros.length > 0) throw recusa(erros, 'Publicação recusada');
      }
      const versao = await tx.alterar(T_MODELO, id, e.versao, { situacao: e.situacao });
      return { id, situacao: e.situacao, versao };
    });
  }

  /** A página da pessoa (nula: a página fixa do perfil). `listas`: as filas liberadas para ela. */
  async minha(c: ContextoComunicacao, listas: ReadonlySet<string>) {
    if (c.usuario === null) return { modelo: null, blocos: [] };
    const usuario = c.usuario;
    return this.ler(c, 'pagina_inicial.minha', async (l, est) => {
      const candidatos = (await l.consultar(SQL_CANDIDATOS, [usuario, est])).map((r) => ({
        modeloId: num(r['modelo_id']),
        situacao: String(r['situacao']) as SituacaoModeloInicio,
        estabelecimentoId: numOuNull(r['estabelecimento_id']),
        prioridade: num(r['prioridade']),
      }));
      const id = escolherModeloInicio(candidatos, est);
      if (id === null) return { modelo: null, blocos: [] };
      const d = await this.lerDetalhe(l, est, id);
      const visiveis = blocosVisiveisInicio(d.blocos, listas);
      const blocos = [];
      for (const b of visiveis) {
        let indicador = null;
        if (b.tipo === 'indicador' && b.indicadorId !== null) {
          const i = await l.uma('SELECT id, codigo, nome, unidade, simbolo FROM indicador WHERE id = ?', [
            b.indicadorId,
          ]);
          const serie = (await l.consultar(SQL_SERIE, [b.indicadorId, est]))
            .map((r) => ({
              competencia: dia(r['competencia']),
              valor: r['valor'] === null ? null : Number(r['valor']),
              meta: r['valor_meta'] === null ? null : Number(r['valor_meta']),
            }))
            .reverse();
          if (i)
            indicador = {
              id: num(i['id']),
              codigo: String(i['codigo']),
              nome: String(i['nome']),
              unidade: String(i['unidade']),
              simbolo: txtOuNull(i['simbolo']),
              serie,
            };
        }
        blocos.push({ ...b, indicador });
      }
      return { modelo: { id: d.id, nome: d.nome }, blocos };
    });
  }

  private async travar(tx: TxOperacao, est: number, id: number): Promise<Record<string, unknown>> {
    const [r] = await tx.consultarParaAtualizar(
      'SELECT id, situacao, estabelecimento_id, versao FROM modelo_pagina_inicial WHERE id = ? AND (estabelecimento_id = ? OR estabelecimento_id IS NULL)',
      [id, est],
      { teto: 1 },
    );
    if (!r) throw naoEncontrado('Modelo de página inicial');
    return r;
  }

  private async conferirNomeLivre(
    tx: TxOperacao,
    est: number,
    rede: boolean,
    nome: string,
    proprio: number | null,
  ): Promise<void> {
    const [r] = await tx.consultar(
      'SELECT id FROM modelo_pagina_inicial WHERE nome = ? AND (estabelecimento_id <=> ?) AND id <> ? LIMIT 1',
      [nome.trim(), rede ? null : est, proprio ?? 0],
      { teto: 1 },
    );
    if (r)
      throw recusa(
        [{ campo: 'nome', codigo: 'nome-repetido', mensagem: 'Já existe um modelo com este nome.' }],
        'Nome repetido',
      );
  }

  /** O indicador e o perfil escolhidos existem e valem aqui. */
  private async conferirAlvos(
    tx: TxOperacao,
    est: number,
    blocos: readonly BlocoInicioEntrada[],
    perfis: readonly { perfilId: number }[],
    erros: { campo: string; codigo: string; mensagem: string }[],
  ): Promise<void> {
    for (const [i, b] of blocos.entries())
      if (b.tipo === 'indicador' && b.indicadorId !== null) {
        const [r] = await tx.consultar(
          'SELECT id FROM indicador WHERE id = ? AND ativo = TRUE AND excluido_em IS NULL',
          [b.indicadorId],
          { teto: 1 },
        );
        if (!r)
          erros.push({
            campo: `blocos[${i}]`,
            codigo: 'indicador-inexistente',
            mensagem: 'Indicador não encontrado.',
          });
      }
    for (const [i, p] of perfis.entries()) {
      const [r] = await tx.consultar(
        'SELECT id FROM perfil_acesso WHERE id = ? AND excluido_em IS NULL AND (estabelecimento_id = ? OR estabelecimento_id IS NULL)',
        [p.perfilId, est],
        { teto: 1 },
      );
      if (!r)
        erros.push({
          campo: `perfis[${i}]`,
          codigo: 'perfil-inexistente',
          mensagem: 'Perfil não encontrado.',
        });
    }
  }
}
