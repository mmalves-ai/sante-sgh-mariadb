// Composição nutricional dos alimentos (F8, 04-HOT linha 142), no banco do cliente. Lidas: `alimento_referencia`,
// `alimento_referencia_nutriente`, `nutriente_referencia`, `grupo_alimento` (carregadas pelo catálogo público TACO 4ª ed.,
// catalogos/carregadores/taco.py; TBCA só com licença) e `insumo` (o gênero do estoque). Gravada: `alimento_referencia`.
// Contrato de efeito:
//   - consultas (só leitura): grupos; alimentos vigentes pela descrição ou pelo código na fonte; o alimento com os
//     nutrientes vigentes por 100 g e na porção pedida (regra do domínio: composicaoDaPorcao) e o gênero ligado;
//   - ligar o gênero: com a versão lida, grava insumo_id (ou nulo para desligar) no alimento vigente; o gênero precisa
//     existir, ativo e não excluído; nada além da ligação muda (descrição, valores e edição são da fonte oficial).
import { composicaoDaPorcao, type NutrienteDoAlimento, validarPorcao } from '@sgh/dominio-pep';
import { z } from 'zod';
import {
  type ContextoPortaPropria,
  entradaValida,
  naoEncontrado,
  num,
  numOuNull,
  PortaEstabelecimentoPropria,
  recusaRegra,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';

export const PORTA_COMPOSICAO = Symbol('PORTA_COMPOSICAO');
const ALIMENTO = 'alimento_referencia';
type Linha = Record<string, unknown>;

const FONTES = { taco: 'TACO', tbca: 'TBCA', propria: 'Própria' } as const;

export interface AlimentoResumo {
  readonly id: number;
  readonly fonte: string;
  readonly codigo: string;
  readonly descricao: string;
  readonly grupo: string | null;
  readonly energiaKcal: number | null;
}

const esquemaLigar = z
  .object({ genero: z.number().int().positive().nullable(), versao: z.number().int().positive() })
  .strict();

const resumo = (x: Linha): AlimentoResumo => ({
  id: num(x['id']),
  fonte: String(x['fonte_composicao']),
  codigo: String(x['codigo_fonte']),
  descricao: String(x['descricao']),
  grupo: txtOuNull(x['grupo']),
  energiaKcal: numOuNull(x['energia_kcal']),
});

const SELECT_ALIMENTO = `SELECT a.id, a.fonte_composicao, a.codigo_fonte, a.descricao, g.descricao AS grupo, a.energia_kcal
   FROM alimento_referencia a LEFT JOIN grupo_alimento g ON g.id = a.grupo_alimento_id
  WHERE a.vigencia_fim IS NULL`;

export class PortaComposicaoPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, [ALIMENTO], 'nutricao.composicao');
  }

  grupos(c: ContextoPortaPropria) {
    return this.ler(c, 'grupos', async (l) =>
      (
        await l.consultar<Linha>(
          `SELECT g.id, g.descricao FROM grupo_alimento g
            WHERE g.ativo AND EXISTS (SELECT 1 FROM alimento_referencia a WHERE a.grupo_alimento_id = g.id AND a.vigencia_fim IS NULL)
            ORDER BY g.descricao LIMIT 100`,
        )
      ).map((x) => ({ id: num(x['id']), descricao: String(x['descricao']) })),
    );
  }

  /** Alimentos vigentes pela descrição (cada palavra) ou pelo código na fonte, opcionalmente do grupo. */
  alimentos(c: ContextoPortaPropria, termo: string, grupo: number | null) {
    return this.ler(c, 'alimentos', async (l) => {
      const palavras = termo
        .split(/\s+/)
        .filter((p) => p.length > 0)
        .slice(0, 5);
      const filtros: string[] = [];
      const args: unknown[] = [];
      if (palavras.length) {
        filtros.push(`(a.codigo_fonte = ? OR (${palavras.map(() => 'a.descricao LIKE ?').join(' AND ')}))`);
        args.push(termo, ...palavras.map((p) => `%${p}%`));
      }
      if (grupo !== null) {
        filtros.push('a.grupo_alimento_id = ?');
        args.push(grupo);
      }
      const where = filtros.length ? ` AND ${filtros.join(' AND ')}` : '';
      return (await l.consultar<Linha>(`${SELECT_ALIMENTO}${where} ORDER BY a.descricao LIMIT 30`, args)).map(
        resumo,
      );
    });
  }

  /** O alimento com os nutrientes vigentes por 100 g e na porção (g), e o gênero do estoque ligado. */
  async alimento(c: ContextoPortaPropria, id: number, porcao: number) {
    const erro = validarPorcao(porcao);
    if (erro) throw recusaRegra('Porção', [{ campo: 'porcao', mensagem: erro }]);
    return this.ler(c, 'alimento', async (l) => {
      const a = await l.uma(
        `SELECT a.id, a.fonte_composicao, a.codigo_fonte, a.descricao, g.descricao AS grupo, a.energia_kcal,
                a.versao_fonte, a.versao, a.insumo_id, i.codigo AS genero_codigo, i.nome AS genero_nome
           FROM alimento_referencia a
           LEFT JOIN grupo_alimento g ON g.id = a.grupo_alimento_id
           LEFT JOIN insumo i ON i.id = a.insumo_id
          WHERE a.id = ? AND a.vigencia_fim IS NULL`,
        [id],
      );
      if (!a) throw naoEncontrado('Alimento');
      const linhas = await l.consultar<Linha>(
        `SELECT n.codigo_infoods, n.descricao, n.tipo, n.simbolo_unidade, an.quantidade_100g
           FROM alimento_referencia_nutriente an
           JOIN nutriente_referencia n ON n.id = an.nutriente_referencia_id
          WHERE an.alimento_referencia_id = ? AND an.vigencia_fim IS NULL
          ORDER BY COALESCE(n.ordem_exibicao, 999), n.descricao`,
        [id],
      );
      const nutrientes: NutrienteDoAlimento[] = linhas.map((x) => ({
        codigo: String(x['codigo_infoods']),
        descricao: String(x['descricao']),
        tipo: String(x['tipo']) as NutrienteDoAlimento['tipo'],
        unidade: String(x['simbolo_unidade']),
        quantidade100g: num(x['quantidade_100g']),
      }));
      const fonte = String(a['fonte_composicao']) as keyof typeof FONTES;
      return {
        ...resumo(a),
        fonteNome: FONTES[fonte] ?? fonte,
        edicao: String(a['versao_fonte']),
        versao: num(a['versao']),
        genero:
          a['insumo_id'] === null || a['insumo_id'] === undefined
            ? null
            : {
                id: num(a['insumo_id']),
                codigo: txtOuNull(a['genero_codigo']),
                nome: txtOuNull(a['genero_nome']),
              },
        porcao,
        nutrientes: composicaoDaPorcao(nutrientes, porcao),
      };
    });
  }

  /** Liga (ou desliga, com nulo) o alimento ao gênero do estoque, com a versão lida. */
  async ligarGenero(c: ContextoPortaPropria, id: number, entrada: unknown) {
    const e = entradaValida(esquemaLigar, entrada);
    return this.gravar(c, 'nutricao.composicao.genero.ligar', [ALIMENTO], async (tx) => {
      const atual = await tx.uma('SELECT id FROM alimento_referencia WHERE id = ? AND vigencia_fim IS NULL', [
        id,
      ]);
      if (!atual) throw naoEncontrado('Alimento');
      if (e.genero !== null) {
        const g = await tx.uma(
          "SELECT id FROM insumo WHERE id = ? AND excluido_em IS NULL AND situacao = 'ativo'",
          [e.genero],
        );
        if (!g)
          throw recusaRegra('Gênero', [
            { campo: 'genero', mensagem: 'O gênero não existe ou não está ativo.' },
          ]);
      }
      await tx.alterar(ALIMENTO, id, e.versao, { insumo_id: e.genero });
      return { tabela: ALIMENTO, id, alimento: id, genero: e.genero };
    });
  }
}
