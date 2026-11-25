// Porta PRÓPRIA dos painéis gerenciais montados pelo hospital (01-REL L112; F3), sobre o banco do cliente. As regras são
// do @sgh/dominio-relatorio (painel-gerencial.ts); aqui ficam as leituras e as gravações:
//   - o CATÁLOGO do editor: os indicadores ativos (com a unidade e as casas da ficha) e os perfis de acesso;
//   - os PAINÉIS do estabelecimento e da rede (painel_gerencial): o editor geral vê todos; os demais, só os que podem
//     abrir (dono ou permissão vigente pelo perfil ou pela pessoa em painel_gerencial_permissao);
//   - CRIAR (em montagem: inativo, com a pessoa como dona), SALVAR o painel inteiro de uma vez (dados, quadros em ordem
//     em painel_gerencial_item e permissões; trava pela versão lida) e PÔR EM USO ou TIRAR DE USO (em uso exige
//     quadro e permissão). Nada é apagado: o quadro ou a permissão que sai fica marcado como excluído e volta se for
//     posto de novo;
//   - ABRIR: o painel com a série apurada de cada indicador (apuracao_indicador, sem recorte) nas competências do
//     período padrão, com numerador, denominador, meta e a situação frente à meta (só agregados).
import {
  acessoAoPainel,
  competenciasDoPeriodo,
  conferirAtivacaoPainel,
  conferirItensPainel,
  conferirPermissoesPainel,
  type ErroRegraPainel,
  FORMAS_EXIBICAO_PAINEL,
  type ItemPainelEntrada,
  MAXIMO_ITENS_PAINEL,
  MAXIMO_PERMISSOES_PAINEL,
  PERIODOS_PAINEL,
  type PeriodoPainel,
  type PermissaoPainelGravada,
  PUBLICOS_PAINEL,
  TIPOS_ITEM_PAINEL,
  variacaoDaSerie,
} from '@sgh/dominio-relatorio';
import { ErroOperacao, type Leitor, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import {
  BaseComunicacaoPropria,
  bool,
  conflito,
  type ContextoComunicacao,
  entradaValida,
  naoEncontrado,
  num,
  numOuNull,
  txtOuNull,
} from '../integracao/comunicacao-base-propria.js';

/** Recusa com todas as regras violadas: o código de cada uma vai em `regras`, para a tela marcar todos os campos. */
function recusaPainel(erros: readonly ErroRegraPainel[], titulo: string): ErroOperacao {
  return new ErroOperacao(422, erros[0]!.codigo, titulo, erros.map((e) => e.mensagem).join(' '), {
    campos: erros.map((e) => e.campo),
    regras: erros.map((e) => ({ codigo: e.codigo, mensagem: e.mensagem })),
  });
}

export const PORTA_PAINEL_GERENCIAL = Symbol('PORTA_PAINEL_GERENCIAL');

const T_PAINEL = 'painel_gerencial';
const T_ITEM = 'painel_gerencial_item';
const T_PERMISSAO = 'painel_gerencial_permissao';
export const TABELAS_PAINEL_GERENCIAL = [T_PAINEL, T_ITEM, T_PERMISSAO] as const;

export const OPERACOES_PAINEL_GERENCIAL = {
  criar: 'relatorio.painel_gerencial.criar',
  salvar: 'relatorio.painel_gerencial.salvar',
  uso: 'relatorio.painel_gerencial.uso',
} as const;

const texto = (max: number) => z.string().trim().max(max);
const dia = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();
const dadosPainel = {
  nome: texto(150).min(3),
  descricao: texto(500).nullable(),
  publico: z.enum(PUBLICOS_PAINEL),
  periodoPadrao: z.enum(PERIODOS_PAINEL),
};
export const esquemaCriarPainel = z
  .object({
    codigo: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_.-]{2,30}$/),
    ...dadosPainel,
    rede: z.boolean(),
  })
  .strict();
const esquemaItem = z
  .object({
    tipo: z.enum(TIPOS_ITEM_PAINEL),
    indicadorId: z.number().int().positive().nullable(),
    titulo: texto(150).nullable(),
    texto: z.string().max(4000).nullable(),
    forma: z.enum(FORMAS_EXIBICAO_PAINEL),
    largura: z.number().int(),
    casasDecimais: z.number().int().nullable(),
    exibirMeta: z.boolean(),
  })
  .strict();
const esquemaPermissao = z
  .object({
    perfilId: z.number().int().positive().nullable(),
    usuarioId: z.number().int().positive().nullable(),
    podeExportar: z.boolean(),
    vigenciaInicio: dia,
    vigenciaFim: dia,
  })
  .strict();
export const esquemaSalvarPainel = z
  .object({
    versao: z.number().int().positive(),
    ...dadosPainel,
    itens: z.array(esquemaItem).max(MAXIMO_ITENS_PAINEL + 1),
    permissoes: z.array(esquemaPermissao).max(MAXIMO_PERMISSOES_PAINEL + 1),
  })
  .strict();
export const esquemaUsoPainel = z
  .object({ versao: z.number().int().positive(), ativo: z.boolean() })
  .strict();

const SQL_PAINEIS = `SELECT g.id, g.codigo, g.nome, g.descricao, g.publico, g.periodo_padrao, g.ativo, g.estabelecimento_id,
    g.dono_usuario_id, g.versao,
    (SELECT COUNT(*) FROM painel_gerencial_item i WHERE i.painel_gerencial_id = g.id AND i.excluido_em IS NULL) AS itens,
    (SELECT COUNT(*) FROM painel_gerencial_permissao p WHERE p.painel_gerencial_id = g.id AND p.excluido_em IS NULL) AS permissoes
  FROM painel_gerencial g
  WHERE (g.estabelecimento_id = ? OR g.estabelecimento_id IS NULL) AND g.excluido_em IS NULL
  ORDER BY g.ativo DESC, g.nome, g.id LIMIT 500`;
const SQL_PAINEL = `SELECT id, codigo, nome, descricao, publico, periodo_padrao, ativo, estabelecimento_id, dono_usuario_id, versao
  FROM painel_gerencial WHERE id = ? AND (estabelecimento_id = ? OR estabelecimento_id IS NULL) AND excluido_em IS NULL`;
const SQL_ITENS = `SELECT i.sequencia, i.tipo_item, i.indicador_id, d.nome AS indicador_nome, i.titulo, i.texto, i.forma_exibicao,
    i.largura, i.casas_decimais, i.exibir_meta
  FROM painel_gerencial_item i LEFT JOIN indicador d ON d.id = i.indicador_id
  WHERE i.painel_gerencial_id = ? AND i.excluido_em IS NULL ORDER BY i.sequencia`;
const SQL_PERMISSOES = `SELECT p.painel_gerencial_id, p.perfil_acesso_id, a.nome AS perfil_nome, p.usuario_id, p.pode_exportar,
    p.vigencia_inicio, p.vigencia_fim
  FROM painel_gerencial_permissao p LEFT JOIN perfil_acesso a ON a.id = p.perfil_acesso_id
  WHERE p.painel_gerencial_id = ? AND p.excluido_em IS NULL ORDER BY a.nome, p.usuario_id`;
const SQL_PERMISSOES_TODAS = `SELECT p.painel_gerencial_id, p.perfil_acesso_id, p.usuario_id, p.pode_exportar, p.vigencia_inicio,
    p.vigencia_fim
  FROM painel_gerencial_permissao p JOIN painel_gerencial g ON g.id = p.painel_gerencial_id
  WHERE (g.estabelecimento_id = ? OR g.estabelecimento_id IS NULL) AND p.excluido_em IS NULL LIMIT 20000`;
const SQL_PERFIS_PESSOA = `SELECT perfil_acesso_id FROM usuario_perfil
  WHERE usuario_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL
    AND vigencia_inicio <= CURRENT_DATE AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)`;
const SQL_INDICADORES = `SELECT id, codigo, nome, unidade, simbolo, casas_decimais, polaridade FROM indicador
  WHERE ativo = TRUE AND excluido_em IS NULL ORDER BY nome LIMIT 2000`;
const SQL_PERFIS_ACESSO = `SELECT id, codigo, nome FROM perfil_acesso
  WHERE ativo = TRUE AND excluido_em IS NULL AND (estabelecimento_id = ? OR estabelecimento_id IS NULL)
  ORDER BY nome LIMIT 2000`;
const SQL_SERIE = `SELECT competencia, valor, numerador, denominador, valor_meta, situacao_meta FROM apuracao_indicador
  WHERE indicador_id = ? AND estabelecimento_id = ? AND escopo_chave = '0-0' AND excluido_em IS NULL
    AND competencia BETWEEN ? AND ? ORDER BY competencia LIMIT 24`;

const dataTxt = (v: unknown): string =>
  v instanceof Date
    ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
    : String(v).slice(0, 10);
const decimal = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const hojeLocal = (): string => dataTxt(new Date());

function permissaoGravada(r: Record<string, unknown>): PermissaoPainelGravada & { painelId: number } {
  return {
    painelId: num(r['painel_gerencial_id']),
    perfilId: numOuNull(r['perfil_acesso_id']),
    usuarioId: numOuNull(r['usuario_id']),
    podeExportar: bool(r['pode_exportar']),
    vigenciaInicio: r['vigencia_inicio'] === null ? null : dataTxt(r['vigencia_inicio']),
    vigenciaFim: r['vigencia_fim'] === null ? null : dataTxt(r['vigencia_fim']),
  };
}

function resumoPainel(r: Record<string, unknown>) {
  return {
    id: num(r['id']),
    codigo: String(r['codigo']),
    nome: String(r['nome']),
    descricao: txtOuNull(r['descricao']),
    publico: String(r['publico']),
    periodoPadrao: String(r['periodo_padrao']) as PeriodoPainel,
    ativo: bool(r['ativo']),
    rede: r['estabelecimento_id'] === null,
    donoId: numOuNull(r['dono_usuario_id']),
    versao: num(r['versao']),
  };
}

/** Quem pede: a conta da sessão e se tem a permissão de editar os painéis (o editor geral). */
export interface PessoaPainel {
  readonly editorGeral: boolean;
}

export class PortaPainelGerencialPropria extends BaseComunicacaoPropria {
  async catalogo(c: ContextoComunicacao) {
    return this.ler(c, 'painel_gerencial.catalogo', async (l, est) => ({
      indicadores: (await l.consultar(SQL_INDICADORES, [])).map((r) => ({
        id: num(r['id']),
        codigo: String(r['codigo']),
        nome: String(r['nome']),
        unidade: String(r['unidade']),
        casasDecimais: num(r['casas_decimais']),
      })),
      perfis: (await l.consultar(SQL_PERFIS_ACESSO, [est])).map((r) => ({
        id: num(r['id']),
        codigo: String(r['codigo']),
        nome: String(r['nome']),
      })),
    }));
  }

  private async perfisDaPessoa(l: Leitor, c: ContextoComunicacao, est: number): Promise<Set<number>> {
    if (c.usuario === null) return new Set();
    return new Set(
      (await l.consultar(SQL_PERFIS_PESSOA, [c.usuario, est])).map((r) => num(r['perfil_acesso_id'])),
    );
  }

  /** Os painéis que a pessoa pode abrir (o editor geral vê todos, inclusive os em montagem). */
  async paineis(c: ContextoComunicacao, quem: PessoaPainel) {
    return this.ler(c, 'painel_gerencial.paineis', async (l, est) => {
      const perfis = await this.perfisDaPessoa(l, c, est);
      const permissoes = (await l.consultar(SQL_PERMISSOES_TODAS, [est])).map(permissaoGravada);
      const hoje = hojeLocal();
      return (await l.consultar(SQL_PAINEIS, [est]))
        .map((r) => ({ ...resumoPainel(r), itens: num(r['itens']), permissoes: num(r['permissoes']) }))
        .filter(
          (p) =>
            acessoAoPainel(
              p,
              permissoes.filter((x) => x.painelId === p.id),
              { usuarioId: c.usuario, perfis, editorGeral: quem.editorGeral },
              hoje,
            ).ver,
        );
    });
  }

  /** O painel para o editor: dados, quadros em ordem e permissões. */
  async detalhe(c: ContextoComunicacao, id: number) {
    return this.ler(c, 'painel_gerencial.detalhe', (l, est) => this.lerDetalhe(l, est, id));
  }

  private async lerDetalhe(l: Leitor, est: number, id: number) {
    const g = await l.uma(SQL_PAINEL, [id, est]);
    if (!g) throw naoEncontrado('Painel gerencial');
    return {
      ...resumoPainel(g),
      itens: (await l.consultar(SQL_ITENS, [id])).map((r) => ({
        tipo: String(r['tipo_item']) as ItemPainelEntrada['tipo'],
        indicadorId: numOuNull(r['indicador_id']),
        indicadorNome: txtOuNull(r['indicador_nome']),
        titulo: txtOuNull(r['titulo']),
        texto: txtOuNull(r['texto']),
        forma: String(r['forma_exibicao']) as ItemPainelEntrada['forma'],
        largura: num(r['largura']),
        casasDecimais: numOuNull(r['casas_decimais']),
        exibirMeta: bool(r['exibir_meta']),
      })),
      permissoes: (await l.consultar(SQL_PERMISSOES, [id])).map((r) => ({
        ...permissaoGravada(r),
        perfilNome: txtOuNull(r['perfil_nome']),
      })),
    };
  }

  async criar(c: ContextoComunicacao, entrada: unknown): Promise<{ id: number; versao: number }> {
    const e = entradaValida(esquemaCriarPainel, entrada);
    return this.gravar(
      c,
      OPERACOES_PAINEL_GERENCIAL.criar,
      TABELAS_PAINEL_GERENCIAL,
      async (tx, est, usuario) => {
        const [r] = await tx.consultar(
          'SELECT id FROM painel_gerencial WHERE codigo = ? AND (estabelecimento_id <=> ?) LIMIT 1',
          [e.codigo, e.rede ? null : est],
          { teto: 1 },
        );
        if (r)
          throw recusaPainel(
            [
              {
                campo: 'codigo',
                codigo: 'codigo-repetido',
                mensagem: 'Já existe um painel com este código.',
              },
            ],
            'Código repetido',
          );
        const id = await tx.incluir(T_PAINEL, {
          estabelecimento_id: e.rede ? null : est,
          codigo: e.codigo,
          nome: e.nome,
          descricao: e.descricao || null,
          publico: e.publico,
          periodo_padrao: e.periodoPadrao,
          fonte_dados: 'copia_diaria',
          dono_usuario_id: usuario,
          ativo: false,
        });
        return { id, versao: 1 };
      },
    );
  }

  async salvar(
    c: ContextoComunicacao,
    id: number,
    entrada: unknown,
  ): Promise<{ id: number; versao: number }> {
    const e = entradaValida(esquemaSalvarPainel, entrada);
    return this.gravar(
      c,
      OPERACOES_PAINEL_GERENCIAL.salvar,
      TABELAS_PAINEL_GERENCIAL,
      async (tx, est, usuario) => {
        const g = await this.travar(tx, est, id);
        if (num(g['versao']) !== e.versao) throw conflito();
        const itens: ItemPainelEntrada[] = e.itens.map((i) => ({
          ...i,
          titulo: i.titulo || null,
          texto: i.texto?.trim() || null,
        }));
        const erros = [...conferirItensPainel(itens), ...conferirPermissoesPainel(e.permissoes)];
        if (bool(g['ativo'])) erros.push(...conferirAtivacaoPainel(itens.length, e.permissoes.length));
        await this.conferirAlvos(tx, est, itens, e.permissoes, erros);
        if (erros.length > 0) throw recusaPainel(erros, 'Painel recusado');

        const agora = new Date();
        // Quadros: a posição (sequência) é a chave; o que sobra fica marcado como excluído (nada é apagado).
        const atuais = new Map(
          (
            await tx.consultar(
              'SELECT id, sequencia, versao, excluido_em FROM painel_gerencial_item WHERE painel_gerencial_id = ?',
              [id],
              { teto: 1000 },
            )
          ).map((r) => [num(r['sequencia']), r]),
        );
        for (const [i, it] of itens.entries()) {
          const seq = i + 1;
          const valores = {
            tipo_item: it.tipo,
            indicador_id: it.tipo === 'indicador' ? it.indicadorId : null,
            titulo: it.titulo?.trim() || null,
            texto: it.tipo === 'texto' ? it.texto : null,
            forma_exibicao: it.forma,
            coluna: 1,
            linha: seq,
            largura: it.largura,
            altura: 1,
            casas_decimais: it.casasDecimais,
            exibir_meta: it.exibirMeta,
          };
          const r = atuais.get(seq);
          if (r)
            await tx.alterar(T_ITEM, num(r['id']), num(r['versao']), {
              ...valores,
              excluido_em: null,
              excluido_por: null,
            });
          else await tx.incluir(T_ITEM, { painel_gerencial_id: id, sequencia: seq, ...valores });
        }
        for (const [seq, r] of atuais)
          if (seq > itens.length && r['excluido_em'] === null)
            await tx.alterar(T_ITEM, num(r['id']), num(r['versao']), {
              excluido_em: agora,
              excluido_por: usuario,
            });

        // Permissões: o perfil ou a pessoa é a chave; a que sai fica marcada como excluída.
        const chave = (perfil: unknown, pessoa: unknown) =>
          perfil !== null && perfil !== undefined ? `p:${num(perfil)}` : `u:${num(pessoa)}`;
        const permAtuais = new Map(
          (
            await tx.consultar(
              'SELECT id, perfil_acesso_id, usuario_id, versao, excluido_em FROM painel_gerencial_permissao WHERE painel_gerencial_id = ?',
              [id],
              { teto: 1000 },
            )
          ).map((r) => [chave(r['perfil_acesso_id'], r['usuario_id']), r]),
        );
        const novas = new Set<string>();
        for (const p of e.permissoes) {
          const k = chave(p.perfilId, p.usuarioId);
          novas.add(k);
          const valores = {
            pode_editar: false,
            pode_exportar: p.podeExportar,
            vigencia_inicio: p.vigenciaInicio,
            vigencia_fim: p.vigenciaFim,
          };
          const r = permAtuais.get(k);
          if (r)
            await tx.alterar(T_PERMISSAO, num(r['id']), num(r['versao']), {
              ...valores,
              excluido_em: null,
              excluido_por: null,
            });
          else
            await tx.incluir(T_PERMISSAO, {
              painel_gerencial_id: id,
              perfil_acesso_id: p.perfilId,
              usuario_id: p.usuarioId,
              ...valores,
            });
        }
        for (const [k, r] of permAtuais)
          if (!novas.has(k) && r['excluido_em'] === null)
            await tx.alterar(T_PERMISSAO, num(r['id']), num(r['versao']), {
              excluido_em: agora,
              excluido_por: usuario,
            });

        const versao = await tx.alterar(T_PAINEL, id, e.versao, {
          nome: e.nome,
          descricao: e.descricao || null,
          publico: e.publico,
          periodo_padrao: e.periodoPadrao,
        });
        return { id, versao };
      },
    );
  }

  /** Põe o painel em uso (exige quadro e permissão) ou tira de uso (nada é apagado). */
  async mudarUso(
    c: ContextoComunicacao,
    id: number,
    entrada: unknown,
  ): Promise<{ id: number; ativo: boolean; versao: number }> {
    const e = entradaValida(esquemaUsoPainel, entrada);
    return this.gravar(c, OPERACOES_PAINEL_GERENCIAL.uso, TABELAS_PAINEL_GERENCIAL, async (tx, est) => {
      const g = await this.travar(tx, est, id);
      if (num(g['versao']) !== e.versao) throw conflito();
      if (e.ativo) {
        const [q] = await tx.consultar(
          `SELECT (SELECT COUNT(*) FROM painel_gerencial_item WHERE painel_gerencial_id = ? AND excluido_em IS NULL) AS itens,
                  (SELECT COUNT(*) FROM painel_gerencial_permissao WHERE painel_gerencial_id = ? AND excluido_em IS NULL) AS permissoes`,
          [id, id],
          { teto: 1 },
        );
        const erros = conferirAtivacaoPainel(num(q?.['itens']), num(q?.['permissoes']));
        if (erros.length > 0) throw recusaPainel(erros, 'Painel sem quadro ou sem permissão');
      }
      const versao = await tx.alterar(T_PAINEL, id, e.versao, { ativo: e.ativo });
      return { id, ativo: e.ativo, versao };
    });
  }

  /** Abre o painel: a série apurada de cada indicador no período padrão (só agregados). 403 para quem não pode. */
  async abrir(c: ContextoComunicacao, id: number, quem: PessoaPainel) {
    return this.ler(c, 'painel_gerencial.abrir', async (l, est) => {
      const d = await this.lerDetalhe(l, est, id);
      const perfis = await this.perfisDaPessoa(l, c, est);
      const hoje = hojeLocal();
      const acesso = acessoAoPainel(
        d,
        d.permissoes,
        { usuarioId: c.usuario, perfis, editorGeral: quem.editorGeral },
        hoje,
      );
      if (!acesso.ver) throw naoEncontrado('Painel gerencial');
      const periodo = competenciasDoPeriodo(d.periodoPadrao, hoje);
      const quadros = [];
      for (const it of d.itens) {
        let indicador = null;
        if (it.tipo === 'indicador' && it.indicadorId !== null) {
          const i = await l.uma(
            'SELECT id, codigo, nome, unidade, simbolo, casas_decimais, polaridade FROM indicador WHERE id = ?',
            [it.indicadorId],
          );
          const serie = (await l.consultar(SQL_SERIE, [it.indicadorId, est, periodo.de, periodo.ate])).map(
            (r) => ({
              competencia: dataTxt(r['competencia']),
              valor: decimal(r['valor']),
              numerador: decimal(r['numerador']),
              denominador: decimal(r['denominador']),
              meta: decimal(r['valor_meta']),
              situacaoMeta: String(r['situacao_meta']),
            }),
          );
          if (i)
            indicador = {
              id: num(i['id']),
              codigo: String(i['codigo']),
              nome: String(i['nome']),
              unidade: String(i['unidade']),
              simbolo: txtOuNull(i['simbolo']),
              casasDecimais: it.casasDecimais ?? num(i['casas_decimais']),
              polaridade: String(i['polaridade']),
              ultima: serie.length > 0 ? serie[serie.length - 1]! : null,
              variacao: variacaoDaSerie(serie.map((s) => s.valor)),
              serie,
            };
        }
        quadros.push({ ...it, indicador });
      }
      return {
        painel: {
          id: d.id,
          nome: d.nome,
          descricao: d.descricao,
          periodoPadrao: d.periodoPadrao,
          ativo: d.ativo,
        },
        periodo,
        exportar: acesso.exportar,
        quadros,
      };
    });
  }

  private async travar(tx: TxOperacao, est: number, id: number): Promise<Record<string, unknown>> {
    const [r] = await tx.consultarParaAtualizar(
      'SELECT id, ativo, estabelecimento_id, versao FROM painel_gerencial WHERE id = ? AND (estabelecimento_id = ? OR estabelecimento_id IS NULL) AND excluido_em IS NULL',
      [id, est],
      { teto: 1 },
    );
    if (!r) throw naoEncontrado('Painel gerencial');
    return r;
  }

  /** O indicador, o perfil e a pessoa escolhidos existem e valem aqui. */
  private async conferirAlvos(
    tx: TxOperacao,
    est: number,
    itens: readonly ItemPainelEntrada[],
    permissoes: readonly { perfilId: number | null; usuarioId: number | null }[],
    erros: { campo: string; codigo: string; mensagem: string }[],
  ): Promise<void> {
    for (const [i, it] of itens.entries())
      if (it.tipo === 'indicador' && it.indicadorId !== null) {
        const [r] = await tx.consultar(
          'SELECT id FROM indicador WHERE id = ? AND ativo = TRUE AND excluido_em IS NULL',
          [it.indicadorId],
          { teto: 1 },
        );
        if (!r)
          erros.push({
            campo: `itens[${i}]`,
            codigo: 'indicador-inexistente',
            mensagem: 'Indicador não encontrado.',
          });
      }
    for (const [i, p] of permissoes.entries()) {
      if (p.perfilId !== null) {
        const [r] = await tx.consultar(
          'SELECT id FROM perfil_acesso WHERE id = ? AND excluido_em IS NULL AND (estabelecimento_id = ? OR estabelecimento_id IS NULL)',
          [p.perfilId, est],
          { teto: 1 },
        );
        if (!r)
          erros.push({
            campo: `permissoes[${i}]`,
            codigo: 'perfil-inexistente',
            mensagem: 'Perfil não encontrado.',
          });
      } else if (p.usuarioId !== null) {
        const [r] = await tx.consultar(
          'SELECT id FROM usuario WHERE id = ? AND excluido_em IS NULL',
          [p.usuarioId],
          {
            teto: 1,
          },
        );
        if (!r)
          erros.push({
            campo: `permissoes[${i}]`,
            codigo: 'pessoa-inexistente',
            mensagem: 'Pessoa não encontrada.',
          });
      }
    }
  }
}
