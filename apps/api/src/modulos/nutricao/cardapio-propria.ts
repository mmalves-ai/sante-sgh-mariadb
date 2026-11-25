// Cardápio do serviço de nutrição e dietética (F8, 04-HOT linha 141), no banco do cliente. Tabelas gravadas:
// `preparacao_culinaria`, `ficha_tecnica_preparacao`, `planejamento_cardapio`, `planejamento_cardapio_preparacao` e
// `escolha_cardapio_paciente`; lidas: refeição do dia, opção do cardápio, modalidade de dieta, gênero (insumo), unidade
// de medida, mapa de dietas, internação e o vínculo do usuário com o profissional e a ocupação (CBO).
// Contrato de efeito:
//   - salvar preparação: a regra do domínio calcula a ficha (líquido pelo fator de correção, custo per capita); grava a
//     preparação e uma linha por gênero; na edição (com a versão lida) a linha que sai é marcada excluída (nunca
//     apagada), a que volta é reativada e a que fica é atualizada;
//   - salvar planejamento: só em rascunho; cabeçalho (período, refeição, dieta, público) e as preparações por dia e
//     opção, sincronizadas do mesmo jeito (excluída, nunca apagada);
//   - ação: enviar, devolver (motivo na observação), publicar e cancelar (motivo; nada apagado); aprovar só por
//     nutricionista (CBO 2237 do profissional ligado ao usuário), com o profissional e o instante gravados;
//   - produção (só leitura): as porções de cada preparação do dia (escolha, mapa de dietas com margem ou planejado) e os
//     gêneros a separar com o custo;
//   - escolha do paciente: no cardápio publicado do dia, numa opção ofertada; a escolha ativa anterior do mesmo comensal
//     na mesma refeição e dia fica cancelada (nunca apagada) e a nova é gravada com quem registrou.
import {
  type AcaoPlanejamento,
  calcularFichaTecnica,
  preverProducao,
  type SituacaoPlanejamento,
  transicaoPlanejamento,
  planoParaEscolha,
  validarEscolhaCardapio,
  type PublicoCardapio,
  validarPlanejamento,
} from '@sgh/dominio-pep';
import { ErroOperacao, type Leitor, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import {
  bool,
  type ContextoPortaPropria,
  entradaValida,
  naoEncontrado,
  num,
  numOuNull,
  PortaEstabelecimentoPropria,
  recusaRegra,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';
import { civil } from '../exames/relogio.js';

export const PORTA_CARDAPIO = Symbol('PORTA_CARDAPIO');

const PREPARACAO = 'preparacao_culinaria';
const FICHA = 'ficha_tecnica_preparacao';
const PLANO = 'planejamento_cardapio';
const PLANO_ITEM = 'planejamento_cardapio_preparacao';
const ESCOLHA = 'escolha_cardapio_paciente';
const TABELAS = [PREPARACAO, FICHA, PLANO, PLANO_ITEM, ESCOLHA];

type Linha = Record<string, unknown>;

const id = z.number().int().positive();
const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dec = z.number().finite();
const TIPOS_PREPARACAO = [
  'prato_principal',
  'guarnicao',
  'acompanhamento',
  'salada',
  'sopa',
  'sobremesa',
  'bebida',
  'lanche',
  'mamadeira',
  'outro',
] as const;

const esquemaPreparacao = z
  .object({
    id: id.optional(),
    versao: id.optional(),
    codigo: z.string().trim().min(1).max(30),
    nome: z.string().trim().min(2).max(150),
    tipo: z.enum(TIPOS_PREPARACAO),
    modoPreparo: z.string().trim().max(8000).nullable().optional(),
    rendimentoPorcoes: dec.positive().nullable().optional(),
    pesoPorcaoGramas: dec.positive().nullable().optional(),
    ativo: z.boolean().optional(),
    ficha: z
      .array(
        z
          .object({
            insumo: id,
            unidade: id,
            perCapitaBruto: dec,
            fatorCorrecao: dec.nullable().optional(),
            perCapitaLiquido: dec.nullable().optional(),
            fatorCoccao: dec.nullable().optional(),
            custoUnidade: dec.nullable().optional(),
          })
          .strict(),
      )
      .max(80),
  })
  .strict();

const esquemaPlano = z
  .object({
    id: id.optional(),
    versao: id.optional(),
    descricao: z.string().trim().min(3).max(150),
    periodoInicio: DATA,
    periodoFim: DATA,
    refeicao: id,
    modalidade: id.nullable().optional(),
    publico: z.enum(['paciente', 'acompanhante', 'colaborador', 'todos']).optional(),
    porcoesPrevistas: z.number().int().positive().nullable().optional(),
    observacao: z.string().trim().max(4000).nullable().optional(),
    itens: z
      .array(
        z
          .object({
            data: DATA,
            alternativa: id.nullable(),
            preparacao: id,
            porcoes: dec,
          })
          .strict(),
      )
      .max(500),
  })
  .strict();

const esquemaAcao = z
  .object({
    acao: z.enum(['enviar', 'aprovar', 'devolver', 'publicar', 'cancelar']),
    versao: id,
    motivo: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();

const esquemaEscolha = z
  .object({
    internacao: id,
    data: DATA,
    refeicao: id,
    alternativa: id,
    acompanhante: id.nullable().optional(),
    quantidade: z.number().int().optional(),
    observacao: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

const dataIso = (v: unknown): string => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v ?? '').slice(0, 10);
};
const dec4 = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export interface PreparacaoResumo {
  readonly id: number;
  readonly codigo: string;
  readonly nome: string;
  readonly tipo: string;
  readonly ativo: boolean;
  readonly ingredientes: number;
  readonly custoPorcao: number | null;
  readonly versao: number;
}

export class PortaCardapioPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, TABELAS, 'nutricao.cardapio');
  }

  // ------------------------------------------------------------ cadastros de apoio

  cadastros(c: ContextoPortaPropria) {
    return this.ler(c, 'cadastros', async (l) => {
      const lista = async (sql: string) =>
        (await l.consultar<Linha>(sql)).map((x) => ({ id: num(x['id']), descricao: String(x['descricao']) }));
      return {
        refeicoes: await lista(
          'SELECT id, descricao FROM refeicao_do_dia WHERE ativo ORDER BY ordem LIMIT 50',
        ),
        alternativas: await lista(
          'SELECT id, descricao FROM alternativa_cardapio WHERE ativo ORDER BY ordem_exibicao, descricao LIMIT 50',
        ),
        modalidades: await lista(
          'SELECT id, descricao FROM modalidade_dieta WHERE ativo ORDER BY ordem, descricao LIMIT 200',
        ),
        unidades: await lista(
          "SELECT id, CONCAT(sigla, ' - ', descricao) AS descricao FROM unidade_medida WHERE ativo ORDER BY ordem_exibicao, sigla LIMIT 200",
        ),
        tipos: [...TIPOS_PREPARACAO],
      };
    });
  }

  /** Gêneros do estoque pelo nome ou código (para a ficha técnica). */
  generos(c: ContextoPortaPropria, termo: string) {
    return this.ler(c, 'generos', async (l) =>
      (
        await l.consultar<Linha>(
          `SELECT i.id, i.codigo, i.nome, i.estoque_unidade_medida_id, u.sigla FROM insumo i
             JOIN unidade_medida u ON u.id = i.estoque_unidade_medida_id
            WHERE i.excluido_em IS NULL AND i.situacao = 'ativo' AND (i.nome LIKE ? OR i.codigo = ?)
            ORDER BY i.nome LIMIT 30`,
          [`%${termo}%`, termo],
        )
      ).map((x) => ({
        id: num(x['id']),
        codigo: String(x['codigo']),
        nome: String(x['nome']),
        unidade: num(x['estoque_unidade_medida_id']),
        sigla: String(x['sigla']),
      })),
    );
  }

  // ------------------------------------------------------------ preparações e ficha técnica

  preparacoes(c: ContextoPortaPropria, termo: string): Promise<PreparacaoResumo[]> {
    return this.ler(c, 'preparacoes', async (l) =>
      (
        await l.consultar<Linha>(
          `SELECT p.id, p.codigo, p.nome, p.tipo, p.ativo, p.versao,
                  (SELECT COUNT(*) FROM ficha_tecnica_preparacao f
                    WHERE f.preparacao_culinaria_id = p.id AND f.excluido_em IS NULL) AS ingredientes,
                  (SELECT SUM(f.custo_per_capita) FROM ficha_tecnica_preparacao f
                    WHERE f.preparacao_culinaria_id = p.id AND f.excluido_em IS NULL) AS custo
             FROM preparacao_culinaria p
            WHERE p.excluido_em IS NULL AND (? = '' OR p.nome LIKE ? OR p.codigo = ?)
            ORDER BY p.ativo DESC, p.nome LIMIT 300`,
          [termo, `%${termo}%`, termo],
        )
      ).map((x) => ({
        id: num(x['id']),
        codigo: String(x['codigo']),
        nome: String(x['nome']),
        tipo: String(x['tipo']),
        ativo: bool(x['ativo']),
        ingredientes: num(x['ingredientes']),
        custoPorcao: dec4(x['custo']),
        versao: num(x['versao']),
      })),
    );
  }

  preparacao(c: ContextoPortaPropria, idPrep: number) {
    return this.ler(c, 'preparacao', async (l) => {
      const p = await l.uma(
        `SELECT id, codigo, nome, tipo, modo_preparo, rendimento_porcoes, peso_porcao_gramas, ativo, versao
           FROM preparacao_culinaria WHERE id = ? AND excluido_em IS NULL`,
        [idPrep],
      );
      if (!p) throw naoEncontrado('Preparação');
      const ficha = await l.consultar<Linha>(
        `SELECT f.insumo_id, i.nome, f.unidade_medida_id, u.sigla, f.per_capita_bruto, f.fator_correcao,
                f.per_capita_liquido, f.fator_coccao, f.custo_per_capita
           FROM ficha_tecnica_preparacao f
           JOIN insumo i ON i.id = f.insumo_id
           JOIN unidade_medida u ON u.id = f.unidade_medida_id
          WHERE f.preparacao_culinaria_id = ? AND f.excluido_em IS NULL
          ORDER BY f.sequencia`,
        [idPrep],
      );
      return {
        id: num(p['id']),
        codigo: String(p['codigo']),
        nome: String(p['nome']),
        tipo: String(p['tipo']),
        modoPreparo: txtOuNull(p['modo_preparo']),
        rendimentoPorcoes: dec4(p['rendimento_porcoes']),
        pesoPorcaoGramas: dec4(p['peso_porcao_gramas']),
        ativo: bool(p['ativo']),
        versao: num(p['versao']),
        ficha: ficha.map((f) => {
          const bruto = Number(f['per_capita_bruto']);
          const custo = dec4(f['custo_per_capita']);
          return {
            insumo: num(f['insumo_id']),
            nome: String(f['nome']),
            unidade: num(f['unidade_medida_id']),
            sigla: String(f['sigla']),
            perCapitaBruto: bruto,
            fatorCorrecao: Number(f['fator_correcao']),
            perCapitaLiquido: Number(f['per_capita_liquido']),
            fatorCoccao: dec4(f['fator_coccao']),
            custoPerCapita: custo,
            custoUnidade: custo === null ? null : Math.round((custo / bruto) * 10_000) / 10_000,
          };
        }),
      };
    });
  }

  async salvarPreparacao(
    c: ContextoPortaPropria,
    entrada: unknown,
  ): Promise<{ id: number; custoPorcao: number | null; mensagem: string }> {
    const e = entradaValida(esquemaPreparacao, entrada);
    const r = calcularFichaTecnica(e.ficha);
    if (!r.ok) throw recusaRegra('Ficha técnica inválida', r.problemas);
    const ficha = r.valor;
    return this.gravar(c, 'nutricao.cardapio.preparacao.salvar', [PREPARACAO, FICHA], async (tx, _est, u) => {
      const repetido = await tx.uma(
        'SELECT id FROM preparacao_culinaria WHERE codigo = ? AND (? IS NULL OR id <> ?)',
        [e.codigo, e.id ?? null, e.id ?? null],
      );
      if (repetido)
        throw recusaRegra('Código em uso', [
          { campo: 'codigo', mensagem: 'Já existe preparação com este código.' },
        ]);
      const cab = {
        codigo: e.codigo,
        nome: e.nome,
        tipo: e.tipo,
        modo_preparo: e.modoPreparo ?? null,
        rendimento_porcoes: e.rendimentoPorcoes ?? null,
        peso_porcao_gramas: e.pesoPorcaoGramas ?? null,
        ativo: e.ativo ?? true,
      };
      let idPrep: number;
      if (e.id) {
        if (!e.versao) throw recusaRegra('Versão', [{ campo: 'versao', mensagem: 'Informe a versão lida.' }]);
        const atual = await tx.uma(
          'SELECT id FROM preparacao_culinaria WHERE id = ? AND excluido_em IS NULL',
          [e.id],
        );
        if (!atual) throw naoEncontrado('Preparação');
        await tx.alterar(PREPARACAO, e.id, e.versao, cab);
        idPrep = e.id;
      } else {
        idPrep = await tx.incluir(PREPARACAO, cab);
      }
      const unidades = new Map(e.ficha.map((f) => [f.insumo, f.unidade]));
      await sincronizar(
        filhasDe(tx, 'ficha'),
        await tx.consultar<Linha>(
          'SELECT id, insumo_id AS chave, sequencia, versao, excluido_em FROM ficha_tecnica_preparacao WHERE preparacao_culinaria_id = ?',
          [idPrep],
        ),
        ficha.itens.map((i) => ({
          chave: String(i.insumo),
          valores: {
            insumo_id: i.insumo,
            unidade_medida_id: unidades.get(i.insumo) ?? null,
            per_capita_bruto: i.perCapitaBruto,
            fator_correcao: i.fatorCorrecao,
            per_capita_liquido: i.perCapitaLiquido,
            fator_coccao: i.fatorCoccao,
            custo_per_capita: i.custoPerCapita,
          },
        })),
        { preparacao_culinaria_id: idPrep },
        u,
      );
      return {
        tabela: PREPARACAO,
        id: idPrep,
        custoPorcao: ficha.custoPorcao,
        mensagem:
          ficha.semCusto > 0
            ? `Preparação salva; ${ficha.semCusto} gênero(s) sem custo: o custo da porção é parcial.`
            : 'Preparação salva.',
      };
    });
  }

  // ------------------------------------------------------------ planejamento

  planejamentos(c: ContextoPortaPropria, q: { de: string; ate: string }) {
    return this.ler(c, 'planejamentos', async (l, est) =>
      (
        await l.consultar<Linha>(
          `SELECT p.id, p.descricao, p.periodo_inicio, p.periodo_fim, p.situacao, p.publico, p.versao,
                  r.descricao AS refeicao, m.descricao AS modalidade, p.refeicao_do_dia_id, p.aprovado_em,
                  (SELECT COUNT(*) FROM planejamento_cardapio_preparacao i
                    WHERE i.planejamento_cardapio_id = p.id AND i.excluido_em IS NULL) AS itens
             FROM planejamento_cardapio p
             JOIN refeicao_do_dia r ON r.id = p.refeicao_do_dia_id
             LEFT JOIN modalidade_dieta m ON m.id = p.modalidade_dieta_id
            WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL AND p.periodo_fim >= ? AND p.periodo_inicio <= ?
            ORDER BY p.periodo_inicio DESC, r.ordem LIMIT 200`,
          [est.id, q.de, q.ate],
        )
      ).map((x) => ({
        id: num(x['id']),
        descricao: String(x['descricao']),
        periodoInicio: dataIso(x['periodo_inicio']),
        periodoFim: dataIso(x['periodo_fim']),
        situacao: String(x['situacao']),
        publico: String(x['publico']),
        refeicao: num(x['refeicao_do_dia_id']),
        refeicaoDescricao: String(x['refeicao']),
        modalidade: txtOuNull(x['modalidade']),
        itens: num(x['itens']),
        aprovado: x['aprovado_em'] !== null && x['aprovado_em'] !== undefined,
        versao: num(x['versao']),
      })),
    );
  }

  planejamento(c: ContextoPortaPropria, idPlano: number) {
    return this.ler(c, 'planejamento', async (l, est) => {
      const p = await l.uma(
        `SELECT p.*, pf.nome AS aprovador FROM planejamento_cardapio p
           LEFT JOIN profissional pr ON pr.id = p.aprovado_por_profissional_id
           LEFT JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
          WHERE p.id = ? AND p.estabelecimento_id = ? AND p.excluido_em IS NULL`,
        [idPlano, est.id],
      );
      if (!p) throw naoEncontrado('Planejamento do cardápio');
      const itens = await l.consultar<Linha>(
        `SELECT i.data_cardapio, i.alternativa_cardapio_id, a.descricao AS alternativa, i.preparacao_culinaria_id,
                pc.nome, pc.tipo, i.quantidade_porcoes
           FROM planejamento_cardapio_preparacao i
           JOIN preparacao_culinaria pc ON pc.id = i.preparacao_culinaria_id
           LEFT JOIN alternativa_cardapio a ON a.id = i.alternativa_cardapio_id
          WHERE i.planejamento_cardapio_id = ? AND i.excluido_em IS NULL
          ORDER BY i.data_cardapio, a.ordem_exibicao, i.sequencia`,
        [idPlano],
      );
      return {
        id: num(p['id']),
        descricao: String(p['descricao']),
        periodoInicio: dataIso(p['periodo_inicio']),
        periodoFim: dataIso(p['periodo_fim']),
        refeicao: num(p['refeicao_do_dia_id']),
        modalidade: numOuNull(p['modalidade_dieta_id']),
        publico: String(p['publico']),
        porcoesPrevistas: numOuNull(p['porcoes_previstas']),
        situacao: String(p['situacao']),
        observacao: txtOuNull(p['observacao']),
        aprovador: txtOuNull(p['aprovador']),
        versao: num(p['versao']),
        itens: itens.map((i) => ({
          data: dataIso(i['data_cardapio']),
          alternativa: numOuNull(i['alternativa_cardapio_id']),
          alternativaDescricao: txtOuNull(i['alternativa']),
          preparacao: num(i['preparacao_culinaria_id']),
          nome: String(i['nome']),
          tipo: String(i['tipo']),
          porcoes: Number(i['quantidade_porcoes']),
        })),
      };
    });
  }

  async salvarPlanejamento(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaPlano, entrada);
    const r = validarPlanejamento(e);
    if (!r.ok) throw recusaRegra('Planejamento inválido', r.problemas);
    const itens = r.valor.itens;
    return this.gravar(
      c,
      'nutricao.cardapio.planejamento.salvar',
      [PLANO, PLANO_ITEM],
      async (tx, est, u) => {
        const cab = {
          descricao: e.descricao,
          periodo_inicio: e.periodoInicio,
          periodo_fim: e.periodoFim,
          refeicao_do_dia_id: e.refeicao,
          modalidade_dieta_id: e.modalidade ?? null,
          publico: e.publico ?? 'paciente',
          porcoes_previstas: e.porcoesPrevistas ?? null,
          observacao: e.observacao ?? null,
        };
        let idPlano: number;
        if (e.id) {
          if (!e.versao)
            throw recusaRegra('Versão', [{ campo: 'versao', mensagem: 'Informe a versão lida.' }]);
          const atual = await tx.uma(
            'SELECT situacao FROM planejamento_cardapio WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
            [e.id, est.id],
          );
          if (!atual) throw naoEncontrado('Planejamento do cardápio');
          if (String(atual['situacao']) !== 'rascunho')
            throw recusaRegra('Planejamento fechado', [
              {
                campo: 'situacao',
                mensagem: 'Só o rascunho é editado: peça a devolução ou cancele e refaça.',
              },
            ]);
          await tx.alterar(PLANO, e.id, e.versao, cab);
          idPlano = e.id;
        } else {
          idPlano = await tx.incluir(PLANO, {
            ...cab,
            estabelecimento_id: est.id,
            situacao: 'rascunho',
            elaborado_por_usuario_id: u,
          });
        }
        await sincronizar(
          filhasDe(tx, 'plano'),
          await tx.consultar<Linha>(
            `SELECT id, CONCAT(DATE_FORMAT(data_cardapio, '%Y-%m-%d'), '|', COALESCE(alternativa_cardapio_id, 0), '|',
                  preparacao_culinaria_id) AS chave, sequencia, versao, excluido_em
             FROM planejamento_cardapio_preparacao WHERE planejamento_cardapio_id = ?`,
            [idPlano],
          ),
          itens.map((i) => ({
            chave: `${i.data}|${i.alternativa ?? 0}|${i.preparacao}`,
            valores: {
              data_cardapio: i.data,
              refeicao_do_dia_id: e.refeicao,
              alternativa_cardapio_id: i.alternativa,
              preparacao_culinaria_id: i.preparacao,
              quantidade_porcoes: i.porcoes,
            },
          })),
          { planejamento_cardapio_id: idPlano },
          u,
        );
        return { tabela: PLANO, id: idPlano };
      },
    );
  }

  /** CBOs ativos do profissional ligado ao usuário (vínculo vigente). */
  private async cbosDoUsuario(
    l: Leitor,
    usuario: number,
  ): Promise<{ profissional: number | null; cbos: string[] }> {
    const linhas = await l.consultar<Linha>(
      `SELECT up.profissional_id, oc.codigo_cbo FROM usuario_profissional up
         JOIN profissional pr ON pr.id = up.profissional_id AND pr.excluido_em IS NULL AND pr.situacao = 'ativo'
         JOIN profissional_ocupacao po ON po.profissional_id = pr.id AND po.excluido_em IS NULL AND po.ativo
         JOIN ocupacao_cbo oc ON oc.id = po.ocupacao_cbo_id
        WHERE up.usuario_id = ? AND up.excluido_em IS NULL
          AND (up.vigencia_fim IS NULL OR up.vigencia_fim >= CURRENT_DATE)
        ORDER BY po.principal DESC, po.id LIMIT 20`,
      [usuario],
    );
    const nutri = linhas.find((x) => /^2237/.test(String(x['codigo_cbo']).trim()));
    return {
      profissional: numOuNull((nutri ?? linhas[0])?.['profissional_id']),
      cbos: linhas.map((x) => String(x['codigo_cbo']).trim()),
    };
  }

  async agir(
    c: ContextoPortaPropria,
    idPlano: number,
    entrada: unknown,
  ): Promise<{ id: number; situacao: SituacaoPlanejamento }> {
    const e = entradaValida(esquemaAcao, entrada);
    return this.gravar(c, `nutricao.cardapio.planejamento.${e.acao}`, [PLANO], async (tx, est, u) => {
      const p = await tx.uma(
        `SELECT situacao, observacao,
                (SELECT COUNT(*) FROM planejamento_cardapio_preparacao i
                  WHERE i.planejamento_cardapio_id = p.id AND i.excluido_em IS NULL) AS itens
           FROM planejamento_cardapio p WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [idPlano, est.id],
      );
      if (!p) throw naoEncontrado('Planejamento do cardápio');
      const quem = await this.cbosDoUsuario(tx, u);
      const r = transicaoPlanejamento({
        situacao: String(p['situacao']) as SituacaoPlanejamento,
        acao: e.acao as AcaoPlanejamento,
        itens: num(p['itens']),
        cbosDoUsuario: quem.cbos,
        motivo: e.motivo ?? null,
      });
      if (!r.ok) throw recusaRegra('Ação recusada', r.problemas);
      const valores: Record<string, unknown> = { situacao: r.valor.situacao };
      if (r.valor.aprova) {
        valores['aprovado_por_profissional_id'] = quem.profissional;
        valores['aprovado_em'] = new Date();
      }
      if (e.acao === 'devolver' || e.acao === 'cancelar') {
        const nota = `[${e.acao === 'devolver' ? 'Devolvido' : 'Cancelado'} em ${new Date().toISOString().slice(0, 10)}] ${(e.motivo ?? '').trim()}`;
        const antes = txtOuNull(p['observacao']);
        valores['observacao'] = (antes ? `${antes}\n${nota}` : nota).slice(0, 4000);
      }
      await tx.alterar(PLANO, idPlano, e.versao, valores);
      return { tabela: PLANO, id: idPlano, situacao: r.valor.situacao };
    });
  }

  /** Previsão da produção de um dia do planejamento: porções por preparação e gêneros a separar. */
  producao(c: ContextoPortaPropria, idPlano: number, data: string, margem: number) {
    return this.ler(c, 'producao', async (l, est) => {
      const p = await l.uma(
        `SELECT id, refeicao_do_dia_id, modalidade_dieta_id, publico, situacao FROM planejamento_cardapio
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [idPlano, est.id],
      );
      if (!p) throw naoEncontrado('Planejamento do cardápio');
      const refeicao = num(p['refeicao_do_dia_id']);
      const modalidade = numOuNull(p['modalidade_dieta_id']);
      const itens = await l.consultar<Linha>(
        `SELECT i.preparacao_culinaria_id, i.alternativa_cardapio_id, i.quantidade_porcoes, pc.nome
           FROM planejamento_cardapio_preparacao i
           JOIN preparacao_culinaria pc ON pc.id = i.preparacao_culinaria_id
          WHERE i.planejamento_cardapio_id = ? AND i.data_cardapio = ? AND i.excluido_em IS NULL
          ORDER BY i.sequencia`,
        [idPlano, data],
      );
      const preps = [...new Set(itens.map((i) => num(i['preparacao_culinaria_id'])))];
      const fichas = preps.length
        ? await l.consultar<Linha>(
            `SELECT f.preparacao_culinaria_id, f.insumo_id, f.per_capita_bruto, f.custo_per_capita
               FROM ficha_tecnica_preparacao f
              WHERE f.excluido_em IS NULL AND f.preparacao_culinaria_id IN (${preps.map(() => '?').join(',')})`,
            preps,
          )
        : [];
      const mapa = await l.uma(
        `SELECT COUNT(*) AS pacientes, COALESCE(SUM(it.quantidade_acompanhantes), 0) AS acompanhantes
           FROM mapa_dieta_item it JOIN mapa_dieta m ON m.id = it.mapa_dieta_id
          WHERE m.estabelecimento_id = ? AND m.data_referencia = ? AND m.refeicao_do_dia_id = ?
            AND m.excluido_em IS NULL AND m.situacao <> 'cancelado' AND it.excluido_em IS NULL
            AND it.situacao <> 'cancelado' AND NOT it.jejum AND (? IS NULL OR it.modalidade_dieta_id = ?)`,
        [est.id, data, refeicao, modalidade, modalidade],
      );
      const publico = String(p['publico']);
      const comensais =
        (publico === 'acompanhante' ? 0 : num(mapa?.['pacientes'])) +
        (publico === 'paciente' ? 0 : num(mapa?.['acompanhantes']));
      // Só as escolhas que contam neste plano (a opção é cadastro comum a todos os planos) e do público dele.
      const escolhas = await l.consultar<Linha>(
        `SELECT alternativa_cardapio_id, SUM(quantidade) AS q FROM escolha_cardapio_paciente
          WHERE estabelecimento_id = ? AND planejamento_cardapio_id = ? AND data_refeicao = ? AND refeicao_do_dia_id = ?
            AND situacao <> 'cancelada' AND excluido_em IS NULL AND (? = 'todos' OR comensal = ?)
          GROUP BY alternativa_cardapio_id`,
        [est.id, idPlano, data, refeicao, publico, publico],
      );
      const prev = preverProducao({
        preparacoes: itens.map((i) => ({
          preparacao: num(i['preparacao_culinaria_id']),
          alternativa: numOuNull(i['alternativa_cardapio_id']),
          porcoesPlanejadas: Number(i['quantidade_porcoes']),
          ficha: fichas
            .filter((f) => num(f['preparacao_culinaria_id']) === num(i['preparacao_culinaria_id']))
            .map((f) => ({
              insumo: num(f['insumo_id']),
              perCapitaBruto: Number(f['per_capita_bruto']),
              custoPerCapita: dec4(f['custo_per_capita']),
            })),
        })),
        comensaisMapa: comensais,
        escolhas: new Map(escolhas.map((x) => [num(x['alternativa_cardapio_id']), num(x['q'])])),
        margemPercentual: margem,
      });
      const ids = prev.generos.map((g) => g.insumo);
      const nomes = ids.length
        ? await l.consultar<Linha>(
            `SELECT i.id, i.nome, u.sigla FROM insumo i JOIN unidade_medida u ON u.id = i.estoque_unidade_medida_id
              WHERE i.id IN (${ids.map(() => '?').join(',')})`,
            ids,
          )
        : [];
      const nomeDe = new Map(nomes.map((x) => [num(x['id']), x]));
      const nomePrep = new Map(itens.map((i) => [num(i['preparacao_culinaria_id']), String(i['nome'])]));
      return {
        data,
        situacao: String(p['situacao']),
        comensaisMapa: comensais,
        preparacoes: prev.preparacoes.map((x) => ({ ...x, nome: nomePrep.get(x.preparacao) ?? '' })),
        generos: prev.generos.map((g) => ({
          ...g,
          nome: String(nomeDe.get(g.insumo)?.['nome'] ?? ''),
          sigla: String(nomeDe.get(g.insumo)?.['sigla'] ?? ''),
        })),
        custoTotal: prev.custoTotal,
      };
    });
  }

  // ------------------------------------------------------------ escolha do paciente

  /** O cardápio publicado do dia e da refeição (opções com as preparações) e as escolhas da internação. */
  cardapioDoDia(c: ContextoPortaPropria, q: { data: string; refeicao: number; internacao: number | null }) {
    return this.ler(c, 'dia', async (l, est) => {
      const itens = await l.consultar<Linha>(
        `SELECT p.id AS plano, i.alternativa_cardapio_id, a.descricao AS alternativa, pc.nome, pc.tipo
           FROM planejamento_cardapio p
           JOIN planejamento_cardapio_preparacao i ON i.planejamento_cardapio_id = p.id AND i.excluido_em IS NULL
           JOIN preparacao_culinaria pc ON pc.id = i.preparacao_culinaria_id
           JOIN alternativa_cardapio a ON a.id = i.alternativa_cardapio_id
          WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL AND p.situacao = 'publicado'
            AND p.refeicao_do_dia_id = ? AND i.data_cardapio = ?
          ORDER BY a.ordem_exibicao, a.descricao, i.sequencia LIMIT 300`,
        [est.id, q.refeicao, q.data],
      );
      const opcoes = new Map<number, { alternativa: number; descricao: string; preparacoes: string[] }>();
      for (const i of itens) {
        const k = num(i['alternativa_cardapio_id']);
        const o = opcoes.get(k) ?? { alternativa: k, descricao: String(i['alternativa']), preparacoes: [] };
        o.preparacoes.push(String(i['nome']));
        opcoes.set(k, o);
      }
      let escolhas: unknown[] = [];
      if (q.internacao) {
        const linhas = await l.consultar<Linha>(
          `SELECT e.id, e.comensal, e.acompanhante_internacao_id, e.alternativa_cardapio_id, a.descricao,
                  e.quantidade, e.situacao, e.escolhido_em, e.versao
             FROM escolha_cardapio_paciente e
             JOIN internacao it ON it.atendimento_id = e.atendimento_id AND it.id = ?
             JOIN alternativa_cardapio a ON a.id = e.alternativa_cardapio_id
            WHERE e.estabelecimento_id = ? AND e.data_refeicao = ? AND e.refeicao_do_dia_id = ?
              AND e.excluido_em IS NULL
            ORDER BY e.situacao = 'cancelada', e.escolhido_em DESC LIMIT 50`,
          [q.internacao, est.id, q.data, q.refeicao],
        );
        escolhas = linhas.map((x) => {
          const t =
            x['escolhido_em'] instanceof Date ? x['escolhido_em'] : new Date(String(x['escolhido_em']));
          const cv = civil(t, est.fuso);
          return {
            id: num(x['id']),
            comensal: String(x['comensal']),
            acompanhante: numOuNull(x['acompanhante_internacao_id']),
            alternativa: num(x['alternativa_cardapio_id']),
            descricao: String(x['descricao']),
            quantidade: num(x['quantidade']),
            situacao: String(x['situacao']),
            escolhidoEm: `${cv.data}T${cv.hora}`,
            versao: num(x['versao']),
          };
        });
      }
      return { opcoes: [...opcoes.values()], escolhas };
    });
  }

  /**
   * Os comensais do dia e da refeição para a copa identificar à beira do leito: as internações ativas com o nome, o
   * leito, a dieta e o jejum do mapa de dietas, e os acompanhantes presentes com direito à refeição.
   */
  comensais(c: ContextoPortaPropria, q: { data: string; refeicao: number }) {
    return this.ler(c, 'comensais', async (l, est) => {
      const linhas = await l.consultar<Linha>(
        `SELECT i.id, i.numero, pf.nome, lh.codigo AS leito, ui.descricao AS unidade,
                md.descricao AS dieta, it.jejum
           FROM internacao i
           JOIN paciente p ON p.id = i.paciente_id
           JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
           LEFT JOIN leito_hospitalar lh ON lh.id = i.leito_hospitalar_id
           LEFT JOIN unidade_internacao ui ON ui.id = i.unidade_internacao_id
           LEFT JOIN mapa_dieta m ON m.estabelecimento_id = i.estabelecimento_id AND m.data_referencia = ?
                AND m.refeicao_do_dia_id = ? AND m.excluido_em IS NULL AND m.situacao <> 'cancelado'
           LEFT JOIN mapa_dieta_item it ON it.mapa_dieta_id = m.id AND it.atendimento_id = i.atendimento_id
                AND it.excluido_em IS NULL AND it.situacao <> 'cancelado'
           LEFT JOIN modalidade_dieta md ON md.id = it.modalidade_dieta_id
          WHERE i.estabelecimento_id = ? AND i.excluido_em IS NULL AND i.situacao = 'ativa'
          ORDER BY ui.descricao, lh.codigo, pf.nome LIMIT 1000`,
        [q.data, q.refeicao, est.id],
      );
      const internacoes = new Map<
        number,
        {
          internacao: number;
          numero: string;
          nome: string;
          leito: string | null;
          unidade: string | null;
          dieta: string | null;
          jejum: boolean;
          acompanhantes: { id: number; nome: string }[];
        }
      >();
      for (const x of linhas) {
        const k = num(x['id']);
        const atual = internacoes.get(k);
        if (atual) {
          atual.dieta ??= txtOuNull(x['dieta']);
          atual.jejum ||= Boolean(Number(x['jejum'] ?? 0));
          continue;
        }
        internacoes.set(k, {
          internacao: k,
          numero: String(x['numero']),
          nome: String(x['nome']),
          leito: txtOuNull(x['leito']),
          unidade: txtOuNull(x['unidade']),
          dieta: txtOuNull(x['dieta']),
          jejum: Boolean(Number(x['jejum'] ?? 0)),
          acompanhantes: [],
        });
      }
      const ids = [...internacoes.keys()];
      const acomp = ids.length
        ? await l.consultar<Linha>(
            `SELECT id, internacao_id, nome FROM acompanhante_internacao
              WHERE excluido_em IS NULL AND fim_em IS NULL AND recebe_refeicao
                AND internacao_id IN (${ids.map(() => '?').join(',')})
              ORDER BY nome`,
            ids,
          )
        : [];
      for (const a of acomp)
        internacoes
          .get(num(a['internacao_id']))
          ?.acompanhantes.push({ id: num(a['id']), nome: String(a['nome']) });
      return { itens: [...internacoes.values()] };
    });
  }

  async registrarEscolha(
    c: ContextoPortaPropria,
    entrada: unknown,
  ): Promise<{ id: number; substituida: number | null }> {
    const e = entradaValida(esquemaEscolha, entrada);
    return this.gravar(c, 'nutricao.cardapio.escolha.registrar', [ESCOLHA], async (tx, est, u) => {
      const int = await tx.uma(
        `SELECT id, atendimento_id, situacao FROM internacao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [e.internacao, est.id],
      );
      if (!int) throw naoEncontrado('Internação');
      if (e.acompanhante) {
        const a = await tx.uma(
          `SELECT id FROM acompanhante_internacao WHERE id = ? AND internacao_id = ? AND excluido_em IS NULL
             AND fim_em IS NULL AND recebe_refeicao`,
          [e.acompanhante, e.internacao],
        );
        if (!a)
          throw recusaRegra('Acompanhante sem refeição', [
            { campo: 'acompanhante', mensagem: 'O acompanhante não está presente com direito à refeição.' },
          ]);
      }
      // Os planos publicados que ofertam a opção no dia; a regra do domínio escolhe o que serve ao comensal.
      const ofertas = await tx.consultar<Linha>(
        `SELECT DISTINCT p.id, p.publico, p.modalidade_dieta_id FROM planejamento_cardapio p
           JOIN planejamento_cardapio_preparacao i ON i.planejamento_cardapio_id = p.id AND i.excluido_em IS NULL
          WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL AND p.situacao = 'publicado'
            AND p.refeicao_do_dia_id = ? AND i.data_cardapio = ? AND i.alternativa_cardapio_id = ?
          ORDER BY p.id DESC`,
        [est.id, e.refeicao, e.data, e.alternativa],
      );
      // A dieta do paciente no mapa de dietas do dia e da refeição (o item vigente, não cancelado).
      const item = await tx.uma(
        `SELECT it.modalidade_dieta_id, it.jejum FROM mapa_dieta_item it JOIN mapa_dieta m ON m.id = it.mapa_dieta_id
          WHERE m.estabelecimento_id = ? AND m.data_referencia = ? AND m.refeicao_do_dia_id = ? AND it.atendimento_id = ?
            AND m.excluido_em IS NULL AND m.situacao <> 'cancelado' AND it.excluido_em IS NULL
            AND it.situacao <> 'cancelado'
          ORDER BY it.id DESC LIMIT 1`,
        [est.id, e.data, e.refeicao, num(int['atendimento_id'])],
      );
      const dieta = item
        ? { modalidade: numOuNull(item['modalidade_dieta_id']), jejum: Boolean(Number(item['jejum'])) }
        : null;
      const comensal = e.acompanhante ? ('acompanhante' as const) : ('paciente' as const);
      const daDieta =
        comensal === 'paciente' && dieta?.modalidade
          ? await tx.uma(
              `SELECT p.id FROM planejamento_cardapio p
                 JOIN planejamento_cardapio_preparacao i ON i.planejamento_cardapio_id = p.id AND i.excluido_em IS NULL
                WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL AND p.situacao = 'publicado'
                  AND p.refeicao_do_dia_id = ? AND i.data_cardapio = ? AND p.modalidade_dieta_id = ?
                  AND p.publico IN ('paciente', 'todos') LIMIT 1`,
              [est.id, e.refeicao, e.data, dieta.modalidade],
            )
          : null;
      const publicado = await tx.uma(
        `SELECT p.id FROM planejamento_cardapio p
          WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL AND p.refeicao_do_dia_id = ?
            AND p.situacao = 'publicado' AND ? BETWEEN p.periodo_inicio AND p.periodo_fim LIMIT 1`,
        [est.id, e.refeicao, e.data],
      );
      const quantidade = e.quantidade ?? 1;
      const problemas = validarEscolhaCardapio({
        situacaoPlano: publicado ? 'publicado' : null,
        data: e.data,
        hoje: civil(new Date(), est.fuso).data,
        alternativaOfertada: ofertas.length > 0,
        quantidade,
        internacaoAtiva: String(int['situacao']) === 'ativa',
      });
      if (problemas.length) throw recusaRegra('Escolha do cardápio inválida', problemas);
      const escolhido = planoParaEscolha({
        comensal,
        dieta,
        planos: ofertas.map((o) => ({
          id: num(o['id']),
          publico: String(o['publico']) as PublicoCardapio,
          modalidade: numOuNull(o['modalidade_dieta_id']),
        })),
        haPlanoDaDieta: !!daDieta,
      });
      if (!escolhido.plano) throw recusaRegra('Escolha do cardápio inválida', escolhido.problemas);
      const anterior = await tx.uma(
        `SELECT id, versao FROM escolha_cardapio_paciente
          WHERE estabelecimento_id = ? AND atendimento_id = ? AND data_refeicao = ? AND refeicao_do_dia_id = ?
            AND comensal = ? AND COALESCE(acompanhante_internacao_id, 0) = ? AND situacao IN ('escolhida', 'confirmada')
            AND excluido_em IS NULL
          ORDER BY id DESC LIMIT 1`,
        [est.id, num(int['atendimento_id']), e.data, e.refeicao, comensal, e.acompanhante ?? 0],
      );
      if (anterior)
        await tx.alterar(ESCOLHA, num(anterior['id']), num(anterior['versao']), { situacao: 'cancelada' });
      const novo = await tx.incluir(ESCOLHA, {
        estabelecimento_id: est.id,
        atendimento_id: num(int['atendimento_id']),
        comensal,
        acompanhante_internacao_id: e.acompanhante ?? null,
        data_refeicao: e.data,
        refeicao_do_dia_id: e.refeicao,
        alternativa_cardapio_id: e.alternativa,
        planejamento_cardapio_id: escolhido.plano.id,
        quantidade,
        escolhido_em: new Date(),
        registrador_usuario_id: u,
        situacao: 'escolhida',
        observacao: e.observacao ?? null,
      });
      return { tabela: ESCOLHA, id: novo, substituida: anterior ? num(anterior['id']) : null };
    });
  }

  async cancelarEscolha(c: ContextoPortaPropria, idEscolha: number, versao: number): Promise<{ id: number }> {
    return this.gravar(c, 'nutricao.cardapio.escolha.cancelar', [ESCOLHA], async (tx, est) => {
      const x = await tx.uma(
        `SELECT situacao, data_refeicao FROM escolha_cardapio_paciente
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [idEscolha, est.id],
      );
      if (!x) throw naoEncontrado('Escolha do cardápio');
      if (String(x['situacao']) !== 'escolhida' && String(x['situacao']) !== 'confirmada')
        throw new ErroOperacao(
          422,
          'regra-violada',
          'Escolha encerrada',
          'A escolha já foi servida ou cancelada.',
          {
            campos: ['situacao'],
          },
        );
      if (dataIso(x['data_refeicao']) < civil(new Date(), est.fuso).data)
        throw new ErroOperacao(422, 'regra-violada', 'Refeição passada', 'A refeição passada não muda.', {
          campos: ['data'],
        });
      await tx.alterar(ESCOLHA, idEscolha, versao, { situacao: 'cancelada' });
      return { tabela: ESCOLHA, id: idEscolha };
    });
  }
}

/**
 * Sincroniza as linhas filhas pela chave de negócio: a que fica é atualizada, a que volta é reativada, a nova entra
 * com a próxima sequência e a que sai é marcada excluída (nunca apagada).
 */
interface GravacaoFilha {
  nova(valores: Record<string, unknown>): Promise<number>;
  mudar(id: number, versao: number, valores: Record<string, unknown>): Promise<number>;
}

const filhasDe = (tx: TxOperacao, alvo: 'ficha' | 'plano'): GravacaoFilha =>
  alvo === 'ficha'
    ? { nova: (v) => tx.incluir(FICHA, v), mudar: (i, ver, v) => tx.alterar(FICHA, i, ver, v) }
    : { nova: (v) => tx.incluir(PLANO_ITEM, v), mudar: (i, ver, v) => tx.alterar(PLANO_ITEM, i, ver, v) };

async function sincronizar(
  g: GravacaoFilha,
  existentes: readonly Linha[],
  novos: readonly { chave: string; valores: Record<string, unknown> }[],
  pai: Record<string, unknown>,
  usuario: number,
): Promise<void> {
  const porChave = new Map(existentes.map((x) => [String(x['chave']), x]));
  let seq = existentes.reduce((m, x) => Math.max(m, num(x['sequencia'])), 0);
  const ficam = new Set<string>();
  for (const n of novos) {
    ficam.add(n.chave);
    const atual = porChave.get(n.chave);
    if (atual) {
      await g.mudar(num(atual['id']), num(atual['versao']), {
        ...n.valores,
        excluido_em: null,
        excluido_por: null,
      });
    } else {
      seq += 1;
      await g.nova({ ...pai, ...n.valores, sequencia: seq });
    }
  }
  for (const x of existentes) {
    if (ficam.has(String(x['chave'])) || x['excluido_em'] !== null) continue;
    await g.mudar(num(x['id']), num(x['versao']), { excluido_em: new Date(), excluido_por: usuario });
  }
}
