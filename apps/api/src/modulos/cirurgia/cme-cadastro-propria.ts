// Cadastro da central de material esterilizado (CME; F7, 04-CME linha 115; RDC ANVISA 15/2012) no banco do cliente,
// pelo @sgh/nucleo, sempre no estabelecimento da sessão. Regras em @sgh/dominio-cirurgia (cme/cadastro). Contrato de
// efeito (cme-cadastro-propria.int.spec):
//   - produto: inclui ou altera (versão) o produto reprocessável (produto_reprocessavel) e grava as fases dele em
//     produto_fase_reprocessamento na ordem do fluxo do catálogo; a fase retirada fica marcada como excluída (quem e
//     quando) e a que volta reaproveita a mesma linha;
//   - situação do produto: ativo, em manutenção, inativo ou descartado (o descartado não volta; nada é apagado);
//   - caixa: inclui ou altera (versão) a caixa, o kit ou o pacote avulso (caixa_instrumental) com a composição inteira
//     em ordem de montagem (caixa_instrumental_item: a peça mantida é alterada, a nova é incluída, a tirada fica
//     marcada como excluída, com a sequência movida para fora da faixa da montagem) e as fases dela;
//   - situação da caixa: ativa ou inativa (nada apagado);
//   - foto: a imagem (PNG, JPEG ou WebP, conferida pelo conteúdo) entra pela porta de arquivos (disco local, ADR 0004)
//     com a caixa ou a peça como dono e o id fica em foto_arquivo_id; a leitura devolve a imagem conferida pelo hash.
//   - referências: o bem patrimonial da peça, o setor da caixa e o arsenal de guarda do produto têm de ser do
//     estabelecimento da sessão (422 por campo, sem escrita); a leitura da caixa só junta o que é do estabelecimento.
// Recusa da regra: 422, sem escrita. Versão velha: 409. Outro estabelecimento: 404.
import {
  conferirCadastroCaixa,
  conferirFases,
  conferirFotoCme,
  conferirProdutoReprocessavel,
  conferirSituacaoProduto,
  type FaseDoCatalogo,
  ordenarFases,
  type ProblemaCme,
  type ProdutoDaComposicao,
  tipoDaFotoCme,
  usoDoLimite,
} from '@sgh/dominio-cirurgia';
import { ErroOperacao, type Leitor, type NucleoArmazem, type TxOperacao } from '@sgh/nucleo';
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
import { type ArquivosDoModulo, arquivosDoAmbiente } from '../arquivos-locais.js';

export const PORTA_CME_CADASTRO = Symbol('PORTA_CME_CADASTRO');

export const TABELAS_CME_CADASTRO = [
  'produto_reprocessavel',
  'produto_fase_reprocessamento',
  'caixa_instrumental',
  'caixa_instrumental_item',
] as const;

/** Finalidade do arquivo da foto na porta de arquivos. */
export const FINALIDADE_FOTO_CME = 'foto_cme';

/** A peça tirada da caixa sai da faixa da montagem (1 a 300) para cá, sem colidir com a ordem de montagem. */
const FAIXA_EXCLUIDAS = 1000;
/** Faixa provisória da troca de ordem (dentro da mesma transação; nada fica nela). */
const FAIXA_PROVISORIA = 65000;

type Linha = Record<string, unknown>;

const id = z.number().int().positive();
const idOuNull = id.nullable().default(null);
const textoLongo = z.string().trim().max(4000).nullable().default(null);
const esquemaFases = z.array(z.object({ fase: id, obrigatoria: z.boolean().default(true) }).strict()).max(30);

const esquemaProduto = z
  .object({
    versao: id.optional(),
    descricao: z.string().trim().max(150),
    tipo: z.string().max(30),
    codigoBarras: z.string().trim().max(100).nullable().default(null),
    insumo: idOuNull,
    bem: idOuNull,
    metodo: idOuNull,
    embalagem: idOuNull,
    guarda: idOuNull,
    limiteReprocessamentos: z.number().int().nullable().default(null),
    validadeDias: z.number().int().nullable().default(null),
    tempoMinutos: z.number().int().nullable().default(null),
    temperaturaCelsius: z.number().nullable().default(null),
    tecnicaExpurgo: textoLongo,
    tecnicaDesinfeccao: textoLongo,
    tecnicaPreparo: textoLongo,
    tecnicaEsterilizacao: textoLongo,
    conservacao: textoLongo,
    fases: esquemaFases,
  })
  .strict();

const esquemaPeca = z
  .object({
    id: id.optional(),
    produto: idOuNull,
    insumo: idOuNull,
    bem: idOuNull,
    quantidade: z.number(),
    pecaMestre: z.boolean().default(false),
    codigoBarras: z.string().trim().max(40).nullable().default(null),
    suspenso: z.boolean().default(false),
  })
  .strict();

const esquemaCaixa = z
  .object({
    versao: id.optional(),
    codigo: z.string().trim().max(30),
    descricao: z.string().trim().max(150),
    descricaoResumida: z.string().trim().max(40).nullable().default(null),
    natureza: z.string().max(30),
    especialidade: idOuNull,
    metodo: idOuNull,
    embalagem: idOuNull,
    setor: idOuNull,
    validadeDias: z.number().int().nullable().default(null),
    controlaReprocessamentos: z.boolean().default(false),
    limiteReprocessamentos: z.number().int().nullable().default(null),
    etiquetasPreparo: z.number().int().min(0).max(20).default(1),
    etiquetasEsterilizacao: z.number().int().min(0).max(20).default(1),
    pecas: z.array(esquemaPeca).max(400),
    fases: esquemaFases,
  })
  .strict();

const esquemaSituacaoProduto = z.object({ versao: id, situacao: z.string().max(30) }).strict();
const esquemaSituacaoCaixa = z.object({ versao: id, ativo: z.boolean() }).strict();
const esquemaFoto = z
  .object({
    versao: id,
    conteudo: z.string().min(1).max(4_000_000),
    nomeOriginal: z.string().trim().max(255).default('foto'),
  })
  .strict();

export type AlvoFotoCme = 'caixa' | 'peca';

interface Referencia {
  campo: string;
  id: number | null;
}

const recusa = (titulo: string, p: readonly ProblemaCme[]) => {
  if (p.length) throw recusaRegra(titulo, p);
};
const conflito = (detalhe: string) =>
  new ErroOperacao(409, 'conflito-registro', 'Registro já existe', detalhe);

export interface FaseLida {
  readonly fase: number;
  readonly descricao: string;
  readonly ordem: number;
  readonly obrigatoria: boolean;
}

export interface ProdutoReprocessavelLido {
  readonly id: number;
  readonly descricao: string;
  readonly tipo: string;
  readonly codigoBarras: string | null;
  readonly insumo: number | null;
  readonly bem: number | null;
  readonly metodo: number | null;
  readonly embalagem: number | null;
  readonly guarda: number | null;
  readonly limiteReprocessamentos: number | null;
  readonly contadorReprocessamentos: number;
  readonly restante: number | null;
  readonly alertaLimite: string;
  readonly validadeDias: number | null;
  readonly tempoMinutos: number | null;
  readonly temperaturaCelsius: number | null;
  readonly tecnicaExpurgo: string | null;
  readonly tecnicaDesinfeccao: string | null;
  readonly tecnicaPreparo: string | null;
  readonly tecnicaEsterilizacao: string | null;
  readonly conservacao: string | null;
  readonly situacao: string;
  readonly versao: number;
  readonly fases: FaseLida[];
}

export interface PecaLida {
  readonly id: number;
  readonly sequencia: number;
  readonly produto: number | null;
  readonly insumo: number | null;
  readonly bem: number | null;
  readonly descricao: string;
  readonly quantidade: number;
  readonly pecaMestre: boolean;
  readonly codigoBarras: string | null;
  readonly suspenso: boolean;
  readonly temFoto: boolean;
  readonly versao: number;
}

export interface CaixaCadastroLida {
  readonly id: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly descricaoResumida: string | null;
  readonly natureza: string;
  readonly especialidade: number | null;
  readonly metodo: number | null;
  readonly embalagem: number | null;
  readonly setor: number | null;
  readonly validadeDias: number | null;
  readonly controlaReprocessamentos: boolean;
  readonly limiteReprocessamentos: number | null;
  readonly reprocessamentos: number;
  readonly alertaLimite: string;
  readonly etiquetasPreparo: number;
  readonly etiquetasEsterilizacao: number;
  readonly ativo: boolean;
  readonly temFoto: boolean;
  readonly versao: number;
  readonly pecas: PecaLida[];
  readonly fases: FaseLida[];
}

export interface PainelCadastroCme {
  readonly produtos: ProdutoReprocessavelLido[];
  readonly caixas: {
    id: number;
    codigo: string;
    descricao: string;
    natureza: string;
    ativo: boolean;
    pecas: number;
    fases: number;
    temFoto: boolean;
    alertaLimite: string;
    versao: number;
  }[];
  readonly fases: (FaseDoCatalogo & { codigo: string; exigeOperador: boolean })[];
  readonly metodos: { id: number; descricao: string }[];
  readonly embalagens: { id: number; descricao: string; validadeDias: number | null }[];
  readonly setores: { id: number; nome: string }[];
  readonly especialidades: { id: number; descricao: string }[];
  readonly insumos: { id: number; descricao: string }[];
}

const SQL_PRODUTOS = `
  SELECT id, descricao, tipo, codigo_barras, insumo_id, bem_patrimonial_id, metodo_esterilizacao_id,
         tipo_embalagem_esteril_id, guarda_setor_funcional_id, limite_reprocessamentos, contador_reprocessamentos,
         validade_esterilizacao_dias, tempo_esterilizacao_minutos, temperatura_esterilizacao_celsius, tecnica_expurgo,
         tecnica_desinfeccao, tecnica_preparo, tecnica_esterilizacao, conservacao, situacao, versao
    FROM produto_reprocessavel
   WHERE estabelecimento_id = ? AND excluido_em IS NULL`;

const SQL_CAIXAS = `
  SELECT id, codigo, descricao, descricao_resumida, natureza, especialidade_medica_id, metodo_esterilizacao_id,
         tipo_embalagem_esteril_id, setor_funcional_id, validade_esterilizacao_dias, controla_reprocessamentos,
         limite_reprocessamentos, quantidade_reprocessamentos, etiquetas_preparo, etiquetas_esterilizacao, ativo,
         foto_arquivo_id, versao
    FROM caixa_instrumental
   WHERE estabelecimento_id = ? AND excluido_em IS NULL`;

const faseLida = (r: Linha): FaseLida => ({
  fase: num(r['fase_reprocessamento_id']),
  descricao: String(r['descricao']),
  ordem: num(r['ordem']),
  obrigatoria: bool(r['obrigatoria']),
});

const produtoLido = (r: Linha, fases: FaseLida[]): ProdutoReprocessavelLido => {
  const limite = numOuNull(r['limite_reprocessamentos']);
  const contador = num(r['contador_reprocessamentos']);
  const uso = usoDoLimite(contador, limite);
  return {
    id: num(r['id']),
    descricao: String(r['descricao']),
    tipo: String(r['tipo']),
    codigoBarras: txtOuNull(r['codigo_barras']),
    insumo: numOuNull(r['insumo_id']),
    bem: numOuNull(r['bem_patrimonial_id']),
    metodo: numOuNull(r['metodo_esterilizacao_id']),
    embalagem: numOuNull(r['tipo_embalagem_esteril_id']),
    guarda: numOuNull(r['guarda_setor_funcional_id']),
    limiteReprocessamentos: limite,
    contadorReprocessamentos: contador,
    restante: uso.restante,
    alertaLimite: uso.alerta,
    validadeDias: numOuNull(r['validade_esterilizacao_dias']),
    tempoMinutos: numOuNull(r['tempo_esterilizacao_minutos']),
    temperaturaCelsius: numOuNull(r['temperatura_esterilizacao_celsius']),
    tecnicaExpurgo: txtOuNull(r['tecnica_expurgo']),
    tecnicaDesinfeccao: txtOuNull(r['tecnica_desinfeccao']),
    tecnicaPreparo: txtOuNull(r['tecnica_preparo']),
    tecnicaEsterilizacao: txtOuNull(r['tecnica_esterilizacao']),
    conservacao: txtOuNull(r['conservacao']),
    situacao: String(r['situacao']),
    versao: num(r['versao']),
    fases,
  };
};

const alertaDaCaixa = (r: Linha): string =>
  bool(r['controla_reprocessamentos'])
    ? usoDoLimite(num(r['quantidade_reprocessamentos']), numOuNull(r['limite_reprocessamentos'])).alerta
    : 'sem_limite';

export class PortaCmeCadastroPropria extends PortaEstabelecimentoPropria {
  constructor(
    nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0],
    cliente: string,
    /** Porta de arquivos (disco local, ADR 0004) da foto; sem ela, o envio e a leitura da foto dão 503. */
    private arquivos?: ArquivosDoModulo | null,
  ) {
    super(nucleo, cliente, TABELAS_CME_CADASTRO, 'cirurgia.cme.cadastro');
  }

  private arquivosDe(c: ContextoPortaPropria): ArquivosDoModulo {
    if (this.arquivos === undefined)
      this.arquivos = arquivosDoAmbiente(this.nucleo as unknown as NucleoArmazem, this.cliente);
    if (!this.arquivos || !c.hospital)
      throw new ErroOperacao(
        503,
        'indisponivel',
        'Armazenamento de arquivos indisponível',
        'O armazenamento de arquivos não está configurado.',
      );
    return this.arquivos;
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────────────────

  private async catalogoFases(l: Pick<Leitor, 'consultar'>): Promise<PainelCadastroCme['fases']> {
    const r = await l.consultar(
      'SELECT id, codigo, descricao, ordem, ativo, exige_operador, exige_ciclo FROM fase_reprocessamento ORDER BY ordem',
    );
    return r.map((f) => ({
      id: num(f['id']),
      codigo: String(f['codigo']),
      descricao: String(f['descricao']),
      ordem: num(f['ordem']),
      ativo: bool(f['ativo']),
      exigeCiclo: bool(f['exige_ciclo']),
      exigeOperador: bool(f['exige_operador']),
    }));
  }

  private async fasesDe(
    l: Pick<Leitor, 'consultar'>,
    coluna: 'produto_reprocessavel_id' | 'caixa_instrumental_id',
    ids: readonly number[],
  ): Promise<Map<number, FaseLida[]>> {
    const m = new Map<number, FaseLida[]>();
    if (!ids.length) return m;
    const r = await l.consultar(
      `SELECT pf.${coluna} AS dono, pf.fase_reprocessamento_id, pf.ordem, pf.obrigatoria, f.descricao
         FROM produto_fase_reprocessamento pf
         JOIN fase_reprocessamento f ON f.id = pf.fase_reprocessamento_id
        WHERE pf.excluido_em IS NULL AND pf.${coluna} IN (${ids.map(() => '?').join(', ')})
        ORDER BY pf.ordem`,
      [...ids],
    );
    for (const x of r) {
      const k = num(x['dono']);
      m.set(k, [...(m.get(k) ?? []), faseLida(x)]);
    }
    return m;
  }

  painel(c: ContextoPortaPropria): Promise<PainelCadastroCme> {
    return this.ler(c, 'painel', async (l, est) => {
      const produtos = await l.consultar(`${SQL_PRODUTOS} ORDER BY descricao LIMIT 1000`, [est.id]);
      const fasesProd = await this.fasesDe(
        l,
        'produto_reprocessavel_id',
        produtos.map((r) => num(r['id'])),
      );
      const caixas = await l.consultar(
        `SELECT cx.id, cx.codigo, cx.descricao, cx.natureza, cx.ativo, cx.foto_arquivo_id, cx.versao,
                cx.controla_reprocessamentos, cx.limite_reprocessamentos, cx.quantidade_reprocessamentos,
                (SELECT COUNT(*) FROM caixa_instrumental_item i
                  WHERE i.caixa_instrumental_id = cx.id AND i.excluido_em IS NULL) AS pecas,
                (SELECT COUNT(*) FROM produto_fase_reprocessamento pf
                  WHERE pf.caixa_instrumental_id = cx.id AND pf.excluido_em IS NULL) AS fases
           FROM caixa_instrumental cx
          WHERE cx.estabelecimento_id = ? AND cx.excluido_em IS NULL
          ORDER BY cx.ativo DESC, cx.descricao LIMIT 1000`,
        [est.id],
      );
      const metodos = await l.consultar(
        'SELECT id, descricao FROM metodo_esterilizacao WHERE ativo = TRUE ORDER BY descricao',
      );
      const embalagens = await l.consultar(
        'SELECT id, descricao, validade_dias FROM tipo_embalagem_esteril WHERE ativo = TRUE ORDER BY descricao',
      );
      const setores = await l.consultar(
        'SELECT id, nome FROM setor_funcional WHERE estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL ORDER BY nome LIMIT 300',
        [est.id],
      );
      const especialidades = await l.consultar(
        'SELECT id, descricao FROM especialidade_medica WHERE ativo = TRUE ORDER BY descricao LIMIT 500',
      );
      const insumos = await l.consultar(
        'SELECT id, nome AS descricao FROM insumo WHERE excluido_em IS NULL ORDER BY nome LIMIT 2000',
      );
      return {
        produtos: produtos.map((r) => produtoLido(r, fasesProd.get(num(r['id'])) ?? [])),
        caixas: caixas.map((r) => ({
          id: num(r['id']),
          codigo: String(r['codigo']),
          descricao: String(r['descricao']),
          natureza: String(r['natureza']),
          ativo: bool(r['ativo']),
          pecas: num(r['pecas']),
          fases: num(r['fases']),
          temFoto: r['foto_arquivo_id'] !== null,
          alertaLimite: alertaDaCaixa(r),
          versao: num(r['versao']),
        })),
        fases: await this.catalogoFases(l),
        metodos: metodos.map((r) => ({ id: num(r['id']), descricao: String(r['descricao']) })),
        embalagens: embalagens.map((r) => ({
          id: num(r['id']),
          descricao: String(r['descricao']),
          validadeDias: numOuNull(r['validade_dias']),
        })),
        setores: setores.map((r) => ({ id: num(r['id']), nome: String(r['nome']) })),
        especialidades: especialidades.map((r) => ({ id: num(r['id']), descricao: String(r['descricao']) })),
        insumos: insumos.map((r) => ({ id: num(r['id']), descricao: String(r['descricao']) })),
      };
    });
  }

  caixa(c: ContextoPortaPropria, caixa: number): Promise<CaixaCadastroLida> {
    return this.ler(c, 'caixa', async (l, est) => {
      const r = await l.uma(`${SQL_CAIXAS} AND id = ?`, [est.id, caixa]);
      if (!r) throw naoEncontrado('Caixa');
      const pecas = await l.consultar(
        `SELECT i.id, i.sequencia, i.produto_reprocessavel_id, i.insumo_id, i.bem_patrimonial_id, i.quantidade,
                i.peca_mestre, i.codigo_barras, i.suspenso, i.foto_arquivo_id, i.versao,
                COALESCE(p.descricao, s.nome, b.descricao, '') AS descricao
           FROM caixa_instrumental_item i
           LEFT JOIN produto_reprocessavel p ON p.id = i.produto_reprocessavel_id AND p.estabelecimento_id = ?
           LEFT JOIN insumo s ON s.id = i.insumo_id
           LEFT JOIN bem_patrimonial b ON b.id = i.bem_patrimonial_id AND b.estabelecimento_id = ?
          WHERE i.caixa_instrumental_id = ? AND i.excluido_em IS NULL
          ORDER BY i.sequencia`,
        [est.id, est.id, caixa],
      );
      const fases = await this.fasesDe(l, 'caixa_instrumental_id', [caixa]);
      return {
        id: num(r['id']),
        codigo: String(r['codigo']),
        descricao: String(r['descricao']),
        descricaoResumida: txtOuNull(r['descricao_resumida']),
        natureza: String(r['natureza']),
        especialidade: numOuNull(r['especialidade_medica_id']),
        metodo: numOuNull(r['metodo_esterilizacao_id']),
        embalagem: numOuNull(r['tipo_embalagem_esteril_id']),
        setor: numOuNull(r['setor_funcional_id']),
        validadeDias: numOuNull(r['validade_esterilizacao_dias']),
        controlaReprocessamentos: bool(r['controla_reprocessamentos']),
        limiteReprocessamentos: numOuNull(r['limite_reprocessamentos']),
        reprocessamentos: num(r['quantidade_reprocessamentos']),
        alertaLimite: alertaDaCaixa(r),
        etiquetasPreparo: num(r['etiquetas_preparo']),
        etiquetasEsterilizacao: num(r['etiquetas_esterilizacao']),
        ativo: bool(r['ativo']),
        temFoto: r['foto_arquivo_id'] !== null,
        versao: num(r['versao']),
        pecas: pecas.map((p) => ({
          id: num(p['id']),
          sequencia: num(p['sequencia']),
          produto: numOuNull(p['produto_reprocessavel_id']),
          insumo: numOuNull(p['insumo_id']),
          bem: numOuNull(p['bem_patrimonial_id']),
          descricao: String(p['descricao']),
          quantidade: Number(p['quantidade']),
          pecaMestre: bool(p['peca_mestre']),
          codigoBarras: txtOuNull(p['codigo_barras']),
          suspenso: bool(p['suspenso']),
          temFoto: p['foto_arquivo_id'] !== null,
          versao: num(p['versao']),
        })),
        fases: fases.get(caixa) ?? [],
      };
    });
  }

  // ── Gravações ─────────────────────────────────────────────────────────────────────────────────────────────────

  /** As fases do dono na ordem do fluxo: a mantida é alterada, a retirada fica excluída, a que volta é reaproveitada. */
  private async gravarFases(
    tx: TxOperacao,
    coluna: 'produto_reprocessavel_id' | 'caixa_instrumental_id',
    dono: number,
    escolhidas: readonly { fase: number; obrigatoria: boolean }[],
    catalogo: readonly FaseDoCatalogo[],
    usuario: number,
  ): Promise<void> {
    const atuais = await tx.consultarParaAtualizar(
      `SELECT id, fase_reprocessamento_id, ordem, obrigatoria, excluido_em, versao
         FROM produto_fase_reprocessamento WHERE ${coluna} = ?`,
      [dono],
    );
    const porFase = new Map(atuais.map((r) => [num(r['fase_reprocessamento_id']), r]));
    const ordenadas = ordenarFases(escolhidas, catalogo);
    const agora = new Date();
    for (const [i, e] of ordenadas.entries()) {
      const r = porFase.get(e.fase);
      if (!r)
        await tx.incluir('produto_fase_reprocessamento', {
          [coluna]: dono,
          fase_reprocessamento_id: e.fase,
          ordem: i + 1,
          obrigatoria: e.obrigatoria,
        });
      else if (
        r['excluido_em'] !== null ||
        num(r['ordem']) !== i + 1 ||
        bool(r['obrigatoria']) !== e.obrigatoria
      )
        await tx.alterar('produto_fase_reprocessamento', num(r['id']), num(r['versao']), {
          ordem: i + 1,
          obrigatoria: e.obrigatoria,
          excluido_em: null,
          excluido_por: null,
        });
    }
    const ficam = new Set(ordenadas.map((e) => e.fase));
    for (const r of atuais)
      if (r['excluido_em'] === null && !ficam.has(num(r['fase_reprocessamento_id'])))
        await tx.alterar('produto_fase_reprocessamento', num(r['id']), num(r['versao']), {
          excluido_em: agora,
          excluido_por: usuario,
        });
  }

  /**
   * O bem patrimonial e o setor (responsável ou de guarda) citados têm de ser do estabelecimento da sessão: a chave
   * estrangeira só exige que a linha exista, e as duas tabelas são por estabelecimento. Devolve um problema por campo.
   */
  private async conferirReferencias(
    l: Pick<Leitor, 'consultar'>,
    estabelecimento: number,
    bens: readonly Referencia[],
    setores: readonly Referencia[],
  ): Promise<ProblemaCme[]> {
    const ids = (refs: readonly Referencia[]) => [
      ...new Set(refs.map((r) => r.id).filter((v): v is number => v !== null)),
    ];
    const fora = (refs: readonly Referencia[], achados: readonly Linha[], mensagem: string) => {
      const ok = new Set(achados.map((r) => num(r['id'])));
      return refs.filter((r) => r.id !== null && !ok.has(r.id)).map((r) => ({ campo: r.campo, mensagem }));
    };
    const idsBens = ids(bens);
    const idsSetores = ids(setores);
    const marcasBens = idsBens.map(() => '?').join(', ');
    const marcasSetores = idsSetores.map(() => '?').join(', ');
    const achadosBens = idsBens.length
      ? await l.consultar(
          `SELECT id FROM bem_patrimonial WHERE estabelecimento_id = ? AND id IN (${marcasBens})`,
          [estabelecimento, ...idsBens],
        )
      : [];
    const achadosSetores = idsSetores.length
      ? await l.consultar(
          `SELECT id FROM setor_funcional WHERE estabelecimento_id = ? AND id IN (${marcasSetores})`,
          [estabelecimento, ...idsSetores],
        )
      : [];
    return [
      ...fora(bens, achadosBens, 'O bem patrimonial não é deste estabelecimento.'),
      ...fora(setores, achadosSetores, 'O setor não é deste estabelecimento.'),
    ];
  }

  private async conferirFasesNoBanco(
    c: ContextoPortaPropria,
    fases: readonly { fase: number; obrigatoria: boolean }[],
  ): Promise<FaseDoCatalogo[]> {
    const catalogo = await this.ler(c, 'fases', (l) => this.catalogoFases(l));
    recusa('Fases do reprocessamento recusadas', conferirFases(fases, catalogo));
    return catalogo;
  }

  /** Inclui (sem `produto`) ou altera (com `versao`) o produto reprocessável e as fases dele. */
  async gravarProduto(
    c: ContextoPortaPropria,
    produto: number | null,
    corpo: unknown,
  ): Promise<{ produto: number; versao: number }> {
    const e = entradaValida(esquemaProduto, corpo);
    if (produto !== null && e.versao === undefined)
      throw recusaRegra('Versão ausente', [
        { campo: 'versao', mensagem: 'Informe a versão lida do produto.' },
      ]);
    const atual =
      produto === null
        ? null
        : await this.ler(c, 'produto', (l, est) =>
            l.uma(
              'SELECT contador_reprocessamentos FROM produto_reprocessavel WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
              [produto, est.id],
            ),
          );
    if (produto !== null && !atual) throw naoEncontrado('Produto reprocessável');
    const referencias = await this.ler(c, 'referencias', (l, est) =>
      this.conferirReferencias(l, est.id, [{ campo: 'bem', id: e.bem }], [{ campo: 'guarda', id: e.guarda }]),
    );
    recusa('Produto reprocessável recusado', [
      ...conferirProdutoReprocessavel({
        descricao: e.descricao,
        tipo: e.tipo,
        codigoBarras: e.codigoBarras || null,
        limiteReprocessamentos: e.limiteReprocessamentos,
        contadorReprocessamentos: atual ? num(atual['contador_reprocessamentos']) : 0,
        validadeDias: e.validadeDias,
        tempoMinutos: e.tempoMinutos,
        temperaturaCelsius: e.temperaturaCelsius,
      }),
      ...referencias,
    ]);
    const catalogo = await this.conferirFasesNoBanco(c, e.fases);
    return this.gravar(c, 'cirurgia.cme.produto_gravar', TABELAS_CME_CADASTRO, async (tx, est, usuario) => {
      const codigo = e.codigoBarras || null;
      if (codigo) {
        const dup = await tx.uma(
          'SELECT id FROM produto_reprocessavel WHERE estabelecimento_id = ? AND codigo_barras = ? AND id <> ?',
          [est.id, codigo, produto ?? 0],
        );
        if (dup)
          throw conflito('Já existe produto reprocessável com este código de barras neste estabelecimento.');
      }
      const valores = {
        descricao: e.descricao,
        tipo: e.tipo,
        codigo_barras: codigo,
        insumo_id: e.insumo,
        bem_patrimonial_id: e.bem,
        metodo_esterilizacao_id: e.metodo,
        tipo_embalagem_esteril_id: e.embalagem,
        guarda_setor_funcional_id: e.guarda,
        limite_reprocessamentos: e.limiteReprocessamentos,
        validade_esterilizacao_dias: e.validadeDias,
        tempo_esterilizacao_minutos: e.tempoMinutos,
        temperatura_esterilizacao_celsius: e.temperaturaCelsius,
        tecnica_expurgo: e.tecnicaExpurgo,
        tecnica_desinfeccao: e.tecnicaDesinfeccao,
        tecnica_preparo: e.tecnicaPreparo,
        tecnica_esterilizacao: e.tecnicaEsterilizacao,
        conservacao: e.conservacao,
      };
      let idProduto: number;
      let versao: number;
      if (produto === null) {
        idProduto = await tx.incluir('produto_reprocessavel', {
          estabelecimento_id: est.id,
          situacao: 'ativo',
          ...valores,
        });
        versao = 1;
      } else {
        idProduto = produto;
        versao = await tx.alterar('produto_reprocessavel', produto, e.versao!, valores);
      }
      await this.gravarFases(tx, 'produto_reprocessavel_id', idProduto, e.fases, catalogo, usuario);
      return { tabela: 'produto_reprocessavel', id: idProduto, produto: idProduto, versao };
    });
  }

  /** Troca a situação do produto (o descartado não volta; nada é apagado). */
  async situacaoProduto(
    c: ContextoPortaPropria,
    produto: number,
    corpo: unknown,
  ): Promise<{ produto: number; versao: number }> {
    const e = entradaValida(esquemaSituacaoProduto, corpo);
    return this.gravar(c, 'cirurgia.cme.produto_situacao', ['produto_reprocessavel'], async (tx, est) => {
      const [r] = await tx.consultarParaAtualizar(
        'SELECT situacao FROM produto_reprocessavel WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [produto, est.id],
      );
      if (!r) throw naoEncontrado('Produto reprocessável');
      recusa('Situação recusada', conferirSituacaoProduto(String(r['situacao']), e.situacao));
      const versao = await tx.alterar('produto_reprocessavel', produto, e.versao, { situacao: e.situacao });
      return { tabela: 'produto_reprocessavel', id: produto, produto, versao };
    });
  }

  /** Inclui (sem `caixa`) ou altera (com `versao`) a caixa com a composição inteira e as fases. */
  async gravarCaixa(
    c: ContextoPortaPropria,
    caixa: number | null,
    corpo: unknown,
  ): Promise<{ caixa: number; versao: number; pecas: number }> {
    const e = entradaValida(esquemaCaixa, corpo);
    if (caixa !== null && e.versao === undefined)
      throw recusaRegra('Versão ausente', [{ campo: 'versao', mensagem: 'Informe a versão lida da caixa.' }]);
    const { produtos, reprocessamentos, referencias } = await this.ler(c, 'composicao', async (l, est) => {
      const ids = [...new Set(e.pecas.map((p) => p.produto).filter((v): v is number => v !== null))];
      const rs = ids.length
        ? await l.consultar(
            `SELECT id, descricao, situacao FROM produto_reprocessavel
              WHERE estabelecimento_id = ? AND excluido_em IS NULL AND id IN (${ids.map(() => '?').join(', ')})`,
            [est.id, ...ids],
          )
        : [];
      const cx =
        caixa === null
          ? null
          : await l.uma(
              'SELECT quantidade_reprocessamentos FROM caixa_instrumental WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
              [caixa, est.id],
            );
      if (caixa !== null && !cx) throw naoEncontrado('Caixa');
      return {
        produtos: new Map<number, ProdutoDaComposicao>(
          rs.map((r) => [
            num(r['id']),
            { descricao: String(r['descricao']), situacao: String(r['situacao']) },
          ]),
        ),
        reprocessamentos: cx ? num(cx['quantidade_reprocessamentos']) : 0,
        referencias: await this.conferirReferencias(
          l,
          est.id,
          e.pecas.map((p, n) => ({ campo: `pecas.${n}.bem`, id: p.bem })),
          [{ campo: 'setor', id: e.setor }],
        ),
      };
    });
    const pecas = e.pecas.map((p) => ({ ...p, codigoBarras: p.codigoBarras || null }));
    recusa('Caixa recusada', [
      ...conferirCadastroCaixa(
        {
          codigo: e.codigo,
          descricao: e.descricao,
          natureza: e.natureza,
          validadeDias: e.validadeDias,
          controlaReprocessamentos: e.controlaReprocessamentos,
          limiteReprocessamentos: e.limiteReprocessamentos,
          reprocessamentos,
          pecas,
        },
        produtos,
      ),
      ...referencias,
    ]);
    const catalogo = await this.conferirFasesNoBanco(c, e.fases);
    return this.gravar(c, 'cirurgia.cme.caixa_gravar', TABELAS_CME_CADASTRO, async (tx, est, usuario) => {
      const dup = await tx.uma(
        'SELECT id FROM caixa_instrumental WHERE estabelecimento_id = ? AND codigo = ? AND id <> ?',
        [est.id, e.codigo, caixa ?? 0],
      );
      if (dup) throw conflito('Já existe caixa com este código neste estabelecimento.');
      const valores = {
        codigo: e.codigo,
        descricao: e.descricao,
        descricao_resumida: e.descricaoResumida || null,
        natureza: e.natureza,
        especialidade_medica_id: e.especialidade,
        metodo_esterilizacao_id: e.metodo,
        tipo_embalagem_esteril_id: e.embalagem,
        setor_funcional_id: e.setor,
        validade_esterilizacao_dias: e.validadeDias,
        controla_reprocessamentos: e.controlaReprocessamentos,
        limite_reprocessamentos: e.controlaReprocessamentos ? e.limiteReprocessamentos : null,
        etiquetas_preparo: e.etiquetasPreparo,
        etiquetas_esterilizacao: e.etiquetasEsterilizacao,
      };
      let idCaixa: number;
      let versao: number;
      if (caixa === null) {
        idCaixa = await tx.incluir('caixa_instrumental', {
          estabelecimento_id: est.id,
          ativo: true,
          ...valores,
        });
        versao = 1;
      } else {
        // A versão da caixa trava a composição: duas gravações da mesma versão, uma dá 409.
        idCaixa = caixa;
        versao = await tx.alterar('caixa_instrumental', caixa, e.versao!, valores);
      }
      const atuais = await tx.consultarParaAtualizar(
        `SELECT id, sequencia, versao FROM caixa_instrumental_item
          WHERE caixa_instrumental_id = ? AND excluido_em IS NULL`,
        [idCaixa],
      );
      const vers = new Map(atuais.map((r) => [num(r['id']), num(r['versao'])]));
      for (const p of pecas)
        if (p.id !== undefined && !vers.has(p.id))
          throw recusaRegra('Peça de outra caixa', [
            {
              campo: 'pecas',
              mensagem: 'Uma das peças não é desta caixa (ou já foi tirada): releia a caixa.',
            },
          ]);
      const mantidas = new Set(pecas.map((p) => p.id).filter((v): v is number => v !== undefined));
      const agora = new Date();
      const maxima = await tx.uma(
        'SELECT COALESCE(MAX(sequencia), 0) AS m FROM caixa_instrumental_item WHERE caixa_instrumental_id = ? AND sequencia < ?',
        [idCaixa, FAIXA_PROVISORIA],
      );
      let livre = Math.max(FAIXA_EXCLUIDAS, num(maxima?.['m']) + 1);
      for (const r of atuais) {
        const pid = num(r['id']);
        if (mantidas.has(pid)) continue;
        await tx.alterar('caixa_instrumental_item', pid, vers.get(pid)!, {
          excluido_em: agora,
          excluido_por: usuario,
          sequencia: livre++,
        });
      }
      for (const [i, p] of pecas.entries())
        if (p.id !== undefined)
          vers.set(
            p.id,
            await tx.alterar('caixa_instrumental_item', p.id, vers.get(p.id)!, {
              sequencia: FAIXA_PROVISORIA + i,
            }),
          );
      for (const [i, p] of pecas.entries()) {
        const linha = {
          sequencia: i + 1,
          produto_reprocessavel_id: p.produto,
          insumo_id: p.insumo,
          bem_patrimonial_id: p.bem,
          quantidade: p.quantidade,
          peca_mestre: p.pecaMestre,
          codigo_barras: p.codigoBarras,
          suspenso: p.suspenso,
        };
        if (p.id !== undefined) await tx.alterar('caixa_instrumental_item', p.id, vers.get(p.id)!, linha);
        else await tx.incluir('caixa_instrumental_item', { caixa_instrumental_id: idCaixa, ...linha });
      }
      await this.gravarFases(tx, 'caixa_instrumental_id', idCaixa, e.fases, catalogo, usuario);
      return { tabela: 'caixa_instrumental', id: idCaixa, caixa: idCaixa, versao, pecas: pecas.length };
    });
  }

  /** Ativa ou inativa a caixa (nada apagado). */
  async situacaoCaixa(
    c: ContextoPortaPropria,
    caixa: number,
    corpo: unknown,
  ): Promise<{ caixa: number; versao: number }> {
    const e = entradaValida(esquemaSituacaoCaixa, corpo);
    return this.gravar(c, 'cirurgia.cme.caixa_situacao', ['caixa_instrumental'], async (tx, est) => {
      const [r] = await tx.consultarParaAtualizar(
        'SELECT ativo FROM caixa_instrumental WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [caixa, est.id],
      );
      if (!r) throw naoEncontrado('Caixa');
      if (bool(r['ativo']) === e.ativo)
        throw recusaRegra('Situação recusada', [
          { campo: 'ativo', mensagem: e.ativo ? 'A caixa já está ativa.' : 'A caixa já está inativa.' },
        ]);
      const versao = await tx.alterar('caixa_instrumental', caixa, e.versao, { ativo: e.ativo });
      return { tabela: 'caixa_instrumental', id: caixa, caixa, versao };
    });
  }

  /** Confere que a caixa ou a peça é do estabelecimento; devolve o id do arquivo da foto atual. */
  private dono(c: ContextoPortaPropria, alvo: AlvoFotoCme, alvoId: number) {
    return this.ler(c, 'foto', async (l, est) => {
      const r =
        alvo === 'caixa'
          ? await l.uma(
              'SELECT foto_arquivo_id FROM caixa_instrumental WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
              [alvoId, est.id],
            )
          : await l.uma(
              `SELECT i.foto_arquivo_id FROM caixa_instrumental_item i
                 JOIN caixa_instrumental cx ON cx.id = i.caixa_instrumental_id
                WHERE i.id = ? AND cx.estabelecimento_id = ? AND i.excluido_em IS NULL AND cx.excluido_em IS NULL`,
              [alvoId, est.id],
            );
      if (!r) throw naoEncontrado(alvo === 'caixa' ? 'Caixa' : 'Peça');
      return numOuNull(r['foto_arquivo_id']);
    });
  }

  /** A foto de conferência da caixa ou da peça: guarda pela porta de arquivos e liga o arquivo (versão do dono). */
  async enviarFoto(
    c: ContextoPortaPropria,
    alvo: AlvoFotoCme,
    alvoId: number,
    corpo: unknown,
  ): Promise<{ arquivo: number; versao: number }> {
    const e = entradaValida(esquemaFoto, corpo);
    const conteudo = new Uint8Array(Buffer.from(e.conteudo.replace(/^data:[^,]*,/, ''), 'base64'));
    recusa('Foto recusada', conferirFotoCme(conteudo));
    await this.dono(c, alvo, alvoId);
    const tabela = alvo === 'caixa' ? 'caixa_instrumental' : 'caixa_instrumental_item';
    const arquivos = this.arquivosDe(c);
    const a = await arquivos.guardar(c.hospital, {
      conteudo,
      nomeOriginal: e.nomeOriginal || 'foto',
      tipoMime: tipoDaFotoCme(conteudo)!,
      finalidade: FINALIDADE_FOTO_CME,
      entidade: tabela,
      entidadeId: alvoId,
    });
    try {
      return await this.gravar(c, 'cirurgia.cme.foto_ligar', [tabela], async (tx) => {
        const versao = await tx.alterar(tabela, alvoId, e.versao, { foto_arquivo_id: a.id });
        return { tabela, id: alvoId, arquivo: a.id, versao };
      });
    } catch (erro) {
      // O arquivo novo sem dono não fica para trás (o reaproveitado já é de outra foto: fica).
      if (!a.reaproveitado) await arquivos.excluir(c.hospital, a.id).catch(() => undefined);
      throw erro;
    }
  }

  /** A imagem da foto (conferida pelo hash na leitura). */
  async foto(
    c: ContextoPortaPropria,
    alvo: AlvoFotoCme,
    alvoId: number,
  ): Promise<{ tipo: string; conteudo: Buffer }> {
    const arquivo = await this.dono(c, alvo, alvoId);
    if (arquivo === null) throw naoEncontrado('Foto');
    const a = await this.arquivosDe(c).ler(c.hospital, arquivo);
    if (!a) throw naoEncontrado('Foto');
    return { tipo: a.metadado.tipoMime, conteudo: a.conteudo };
  }
}
