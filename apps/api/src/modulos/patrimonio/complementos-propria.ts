// Porta PRÓPRIA dos complementos do patrimônio (F8, 07-FIN linha 149; CPC 27 / NBC TG 27) sobre o MariaDB do cliente:
// agregação de valor ao bem (agregacao_bem), imobilizado em andamento com a apropriação dos custos
// (imobilizado_andamento, apropriacao_imobilizado_andamento) e a ativação que gera o bem (bem_patrimonial), e o seguro
// dos bens (apolice_seguro, bem_segurado). As regras vêm de @sgh/dominio-patrimonio (complementos.ts) e são conferidas
// DENTRO da transação, com o registro travado pela versão; as gravações vão pelo Executor (trilha na mesma transação).
// Nada se apaga: a retirada do componente, o cancelamento da obra, o da apólice e a retirada do bem segurado gravam a
// data e o motivo. A agregação que soma ao custo entra na base da depreciação da competência seguinte (a leitura do
// cálculo soma as agregações vigentes ao custo do bem, em porta-propria.ts).
import {
  type CodigoAgregacao,
  type CodigoAndamento,
  type CodigoDesagregacao,
  type CodigoSeguro,
  cobertura,
  errosAberturaObra,
  errosAgregacao,
  errosApolice,
  errosApropriacao,
  errosBemSegurado,
  errosCancelamentoObra,
  errosDesagregacao,
  MENSAGENS_AGREGACAO,
  MENSAGENS_ANDAMENTO,
  MENSAGENS_DESAGREGACAO,
  MENSAGENS_SEGURO,
  type ObraParaRegra,
  planejarAtivacao,
  proximaSequencia,
  situacaoDaApolice,
  situacaoOrcamento,
  valorAgregadoNaCompetencia,
} from '@sgh/dominio-patrimonio';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  garantirSequencia,
  type Leitor,
  type Operacao,
  recusa,
  restricaoUnicaViolada,
  type ResultadoOperacao,
  travarEConferir,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import type { ContextoPatrimonio } from './porta.js';
import type { NucleoPatrimonio } from './porta-propria.js';

export const PORTA_COMPLEMENTOS_PATRIMONIO = Symbol('PORTA_COMPLEMENTOS_PATRIMONIO');

const TETO = 500;
const T_AGREGACAO = 'agregacao_bem';
const T_OBRA = 'imobilizado_andamento';
const T_APROPRIACAO = 'apropriacao_imobilizado_andamento';
const T_APOLICE = 'apolice_seguro';
const T_SEGURADO = 'bem_segurado';
const T_BEM = 'bem_patrimonial';

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Math.trunc(Number(v)) || 0);
const nn = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : n(v));
const t = (v: unknown): string | null =>
  v === null || v === undefined || String(v).trim() === '' ? null : String(v);
const b = (v: unknown): boolean => v === true || v === 1 || v === '1' || v === 1n;
function cent(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const m = /^(-?)(\d+)(?:\.(\d{1,2})\d*)?$/.exec(String(v).trim());
  if (!m) return Math.round(Number(v) * 100);
  const c = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  return m[1] ? -c : c;
}
const dec = (c: number): string =>
  `${c < 0 ? '-' : ''}${Math.trunc(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, '0')}`;
const dia = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    const p = (x: number) => String(x).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  return String(v).slice(0, 10);
};
export const hojeLocal = (): string => dia(new Date())!;

function recusar<C extends string>(erros: readonly C[], msg: Record<C, string>): void {
  if (!erros.length) return;
  throw recusa(erros[0]!, erros.map((e) => msg[e]).join(' '), { campos: [...erros] });
}
const naoEncontrado = (o: string) =>
  new ErroOperacao(404, 'nao-encontrado', `${o} não encontrado`, `${o} não existe neste estabelecimento.`);
const desatualizado = () =>
  new ErroOperacao(
    409,
    'versao-desatualizada',
    'Registro alterado',
    'Outra pessoa alterou o registro: releia e refaça.',
  );

/** Trava o registro do estabelecimento pela versão lida (404 de outro estabelecimento, 409 na versão velha). */
/** Uma linha lida com trava (SELECT ... FOR UPDATE pelo escritor), ou null. */
async function umaTravada(
  tx: TxOperacao,
  sql: string,
  p: readonly unknown[],
): Promise<Record<string, unknown> | null> {
  return (await tx.consultarParaAtualizar(sql, p))[0] ?? null;
}
async function travar(
  tx: TxOperacao,
  tabela: string,
  id: number,
  versao: number | null,
  colunas: string[],
  nome: string,
  doEstabelecimento: (r: Record<string, unknown>) => Promise<boolean> | boolean,
): Promise<Record<string, unknown>> {
  let r: Record<string, unknown>;
  try {
    r = await travarEConferir(tx, { tabela, id, colunas: [...colunas, 'excluido_em'] });
  } catch (e) {
    if (e instanceof ErroOperacao && e.problema.status === 404) throw naoEncontrado(nome);
    throw e;
  }
  if (r['excluido_em'] != null || !(await doEstabelecimento(r))) throw naoEncontrado(nome);
  if (versao !== null && n(r['versao']) !== versao) throw desatualizado();
  return r;
}
const doEst = (tx: TxOperacao) => (r: Record<string, unknown>) =>
  n(r['estabelecimento_id']) === tx.contexto.estabelecimento;
async function bemDoEst(tx: TxOperacao, bem: number): Promise<boolean> {
  return !!(await tx.uma(
    `SELECT id FROM ${T_BEM} WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [bem, tx.contexto.estabelecimento],
  ));
}

const dadosZ = z.unknown();
const idZ = z.number().int().positive();
const versaoZ = z.number().int().min(0);
const dataZ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const centZ = z.number().int().min(-999_999_999_999_99).max(999_999_999_999_99);
const motivoZ = z.string().trim().max(500);

// ── Agregação ─────────────────────────────────────────────────────────────────────────────────────────────────────

const agregarZ = z.object({
  bem: idZ,
  versao: versaoZ,
  tipo: z.string().max(30),
  bemAgregado: idZ.nullable(),
  nota: idZ.nullable(),
  numeroDocumento: z.string().trim().max(30).nullable(),
  descricao: z.string().trim().max(250),
  data: z.string().max(10),
  valorCent: centZ,
  agregaValor: z.boolean(),
  conta: idZ.nullable(),
  observacao: z.string().trim().max(1000).nullable(),
  hoje: dataZ,
  dados: dadosZ,
});
export type EntradaAgregacao = Omit<z.infer<typeof agregarZ>, 'dados' | 'hoje'>;

const opAgregar = definirOperacao({
  nome: 'patrimonio.agregacao.registrar',
  tabelas: [T_AGREGACAO, T_BEM],
  entrada: agregarZ,
  async gravar(tx, x) {
    const bem = await travar(
      tx,
      T_BEM,
      x.bem,
      x.versao,
      ['estabelecimento_id', 'situacao', 'data_aquisicao'],
      'Bem',
      doEst(tx),
    );
    const marco = await tx.uma(
      `SELECT id FROM ajuste_valor_bem WHERE bem_patrimonial_id = ? AND tipo <> 'reavaliacao' AND estornado_em IS NULL
          AND excluido_em IS NULL LIMIT 1`,
      [x.bem],
    );
    let agregado: { id: number; situacao: string; jaAgregadoEm: number | null; versao: number } | null = null;
    if (x.tipo === 'componente' && x.bemAgregado !== null && x.bemAgregado !== x.bem) {
      const a = await umaTravada(
        tx,
        `SELECT id, situacao, bem_agregador_id, versao FROM ${T_BEM}
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [x.bemAgregado, tx.contexto.estabelecimento],
      );
      if (a)
        agregado = {
          id: n(a['id']),
          situacao: String(a['situacao']),
          jaAgregadoEm: nn(a['bem_agregador_id']),
          versao: n(a['versao']),
        };
    }
    recusar<CodigoAgregacao>(
      errosAgregacao(x, {
        bem: {
          id: x.bem,
          situacao: String(bem['situacao']),
          dataAquisicao: dia(bem['data_aquisicao']) ?? '',
          temMarcoAjuste: !!marco,
        },
        agregado,
        hoje: x.hoje,
      }),
      MENSAGENS_AGREGACAO,
    );
    const seqs = await tx.consultar(
      `SELECT sequencia FROM ${T_AGREGACAO} WHERE bem_patrimonial_id = ?`,
      [x.bem],
      {
        teto: 10_000,
      },
    );
    const id = await tx.incluir(T_AGREGACAO, {
      bem_patrimonial_id: x.bem,
      sequencia: proximaSequencia(seqs.map((s) => ({ sequencia: n(s['sequencia']) }))),
      tipo: x.tipo,
      bem_agregado_id: x.tipo === 'componente' ? x.bemAgregado : null,
      nota_entrada_id: x.nota,
      numero_documento: x.numeroDocumento,
      descricao: x.descricao,
      data_agregacao: x.data,
      valor: dec(x.valorCent),
      agrega_valor: x.agregaValor,
      contabiliza: x.agregaValor,
      conta_contabil_id: x.conta,
      observacao: x.observacao,
    });
    // O componente passa a apontar o bem principal; o principal sobe de versão (o valor dele mudou).
    if (agregado) await tx.alterar(T_BEM, agregado.id, agregado.versao, { bem_agregador_id: x.bem });
    await tx.alterar(T_BEM, x.bem, x.versao, {});
    return { id };
  },
  alvo: (_x, r) => ({ tabela: T_AGREGACAO, id: r.id }),
  trilha: (x) => ({ acao: 'inclusao', dados: x.dados }),
});

const desagregarZ = z.object({
  id: idZ,
  versao: versaoZ,
  data: z.string().max(10),
  motivo: motivoZ,
  hoje: dataZ,
  dados: dadosZ,
});

const opDesagregar = definirOperacao({
  nome: 'patrimonio.agregacao.retirar',
  tabelas: [T_AGREGACAO, T_BEM],
  entrada: desagregarZ,
  async gravar(tx, x) {
    const a = await travar(
      tx,
      T_AGREGACAO,
      x.id,
      x.versao,
      ['bem_patrimonial_id', 'bem_agregado_id', 'data_agregacao', 'data_desagregacao', 'observacao'],
      'Agregação',
      (r) => bemDoEst(tx, n(r['bem_patrimonial_id'])),
    );
    recusar<CodigoDesagregacao>(
      errosDesagregacao(
        { data: dia(a['data_agregacao']) ?? '', dataDesagregacao: dia(a['data_desagregacao']) },
        x,
        x.hoje,
      ),
      MENSAGENS_DESAGREGACAO,
    );
    const obs = [t(a['observacao']), `Retirada em ${x.data}: ${x.motivo}`]
      .filter(Boolean)
      .join(' | ')
      .slice(0, 1000);
    const versao = await tx.alterar(T_AGREGACAO, x.id, x.versao, {
      data_desagregacao: x.data,
      observacao: obs,
    });
    const agregado = nn(a['bem_agregado_id']);
    if (agregado !== null) {
      const c = await umaTravada(tx, `SELECT versao, bem_agregador_id FROM ${T_BEM} WHERE id = ?`, [
        agregado,
      ]);
      if (c && nn(c['bem_agregador_id']) === n(a['bem_patrimonial_id']))
        await tx.alterar(T_BEM, agregado, n(c['versao']), { bem_agregador_id: null });
    }
    const p = await umaTravada(tx, `SELECT versao FROM ${T_BEM} WHERE id = ?`, [n(a['bem_patrimonial_id'])]);
    if (p) await tx.alterar(T_BEM, n(a['bem_patrimonial_id']), n(p['versao']), {});
    return { versao };
  },
  alvo: (x) => ({ tabela: T_AGREGACAO, id: x.id }),
  trilha: (x) => ({ acao: 'alteracao', dados: x.dados, motivo: x.motivo }),
});

// ── Imobilizado em andamento ──────────────────────────────────────────────────────────────────────────────────────

const abrirObraZ = z.object({
  descricao: z.string().trim().max(200),
  grupo: idZ,
  conta: idZ.nullable(),
  centro: idZ.nullable(),
  dataInicio: z.string().max(10),
  dataPrevista: z.string().max(10).nullable(),
  orcadoCent: z.number().int().nullable(),
  observacao: z.string().trim().max(1000).nullable(),
  hoje: dataZ,
  dados: dadosZ,
});
export type EntradaObra = Omit<z.infer<typeof abrirObraZ>, 'dados' | 'hoje'>;

const opAbrirObra = definirOperacao({
  nome: 'patrimonio.andamento.abrir',
  tabelas: [T_OBRA, 'sequencia_negocio'],
  entrada: abrirObraZ,
  async gravar(tx, x, ctx) {
    recusar<CodigoAndamento>(
      errosAberturaObra(
        {
          descricao: x.descricao,
          dataInicio: x.dataInicio,
          dataPrevista: x.dataPrevista,
          valorOrcadoCent: x.orcadoCent,
        },
        x.hoje,
      ),
      MENSAGENS_ANDAMENTO,
    );
    const g = await tx.uma(
      'SELECT id, imobilizado_andamento_conta_contabil_id AS conta FROM grupo_bem WHERE id = ?',
      [x.grupo],
    );
    if (!g)
      throw recusa('grupo-inexistente', 'Escolha o grupo em que o bem será ativado.', { campos: ['grupo'] });
    const conta = x.conta ?? nn(g['conta']);
    if (conta === null)
      throw recusa(
        'sem-conta',
        'Informe a conta de imobilizado em andamento (o grupo não tem conta configurada).',
        { campos: ['conta'] },
      );
    await garantirSequencia(
      tx,
      { tipo: T_OBRA, estabelecimento: ctx.estabelecimento },
      { usuario: ctx.usuario, agora: new Date() },
    );
    const numero = (await tx.proximoNumero(T_OBRA)).valor;
    const id = await tx.incluir(T_OBRA, {
      estabelecimento_id: ctx.estabelecimento,
      numero,
      descricao: x.descricao,
      grupo_bem_id: x.grupo,
      conta_contabil_id: conta,
      centro_custo_id: x.centro,
      data_inicio: x.dataInicio,
      data_prevista_conclusao: x.dataPrevista,
      valor_orcado: x.orcadoCent === null ? null : dec(x.orcadoCent),
      valor_acumulado: '0.00',
      situacao: 'em_andamento',
      observacao: x.observacao,
    });
    return { id, numero: Number(numero) };
  },
  alvo: (_x, r) => ({ tabela: T_OBRA, id: r.id }),
  trilha: (x) => ({ acao: 'inclusao', dados: x.dados }),
});

async function obraParaRegra(tx: TxOperacao, o: Record<string, unknown>, id: number): Promise<ObraParaRegra> {
  const ap = await tx.consultar(
    `SELECT data_apropriacao, titulo_pagar_id, nota_entrada_id, valor, sequencia FROM ${T_APROPRIACAO}
      WHERE imobilizado_andamento_id = ? AND excluido_em IS NULL`,
    [id],
    { teto: 10_000 },
  );
  return {
    situacao: String(o['situacao']),
    dataInicio: dia(o['data_inicio']) ?? '',
    acumuladoCent: cent(o['valor_acumulado']),
    valorOrcadoCent: o['valor_orcado'] == null ? null : cent(o['valor_orcado']),
    apropriacoes: ap.map((a) => ({
      data: dia(a['data_apropriacao']) ?? '',
      titulo: nn(a['titulo_pagar_id']),
      nota: nn(a['nota_entrada_id']),
      valorCent: cent(a['valor']),
      sequencia: n(a['sequencia']),
    })),
  };
}
const COLS_OBRA = [
  'estabelecimento_id',
  'situacao',
  'data_inicio',
  'valor_acumulado',
  'valor_orcado',
  'conta_contabil_id',
  'grupo_bem_id',
  'centro_custo_id',
  'descricao',
  'observacao',
];

const apropriarZ = z.object({
  obra: idZ,
  versao: versaoZ,
  data: z.string().max(10),
  titulo: idZ.nullable(),
  nota: idZ.nullable(),
  conta: idZ.nullable(),
  descricao: z.string().trim().max(250).nullable(),
  valorCent: centZ,
  hoje: dataZ,
  dados: dadosZ,
});
export type EntradaApropriacao = Omit<z.infer<typeof apropriarZ>, 'dados' | 'hoje'>;

const opApropriar = definirOperacao({
  nome: 'patrimonio.andamento.apropriar',
  tabelas: [T_APROPRIACAO, T_OBRA],
  entrada: apropriarZ,
  async gravar(tx, x) {
    const o = await travar(tx, T_OBRA, x.obra, x.versao, COLS_OBRA, 'Obra', doEst(tx));
    const regra = await obraParaRegra(tx, o, x.obra);
    recusar<CodigoAndamento>(errosApropriacao(regra, x, x.hoje), MENSAGENS_ANDAMENTO);
    if (
      x.titulo !== null &&
      !(await tx.uma(
        'SELECT id FROM titulo_pagar WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [x.titulo, tx.contexto.estabelecimento],
      ))
    )
      throw recusa('titulo-inexistente', 'O título a pagar não existe neste estabelecimento.', {
        campos: ['titulo'],
      });
    if (
      x.nota !== null &&
      !(await tx.uma(
        'SELECT id FROM nota_entrada WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [x.nota, tx.contexto.estabelecimento],
      ))
    )
      throw recusa('nota-inexistente', 'A nota de entrada não existe neste estabelecimento.', {
        campos: ['nota'],
      });
    const id = await tx.incluir(T_APROPRIACAO, {
      imobilizado_andamento_id: x.obra,
      sequencia: proximaSequencia(regra.apropriacoes as unknown as { sequencia: number }[]),
      data_apropriacao: x.data,
      titulo_pagar_id: x.titulo,
      nota_entrada_id: x.nota,
      conta_contabil_id: x.conta ?? n(o['conta_contabil_id']),
      descricao: x.descricao,
      valor: dec(x.valorCent),
    });
    const versao = await tx.alterar(T_OBRA, x.obra, x.versao, {
      valor_acumulado: dec(regra.acumuladoCent + x.valorCent),
    });
    return { id, versao };
  },
  alvo: (_x, r) => ({ tabela: T_APROPRIACAO, id: r.id }),
  trilha: (x) => ({ acao: 'inclusao', dados: x.dados }),
});

const ativarZ = z.object({
  obra: idZ,
  versao: versaoZ,
  data: z.string().max(10),
  vidaUtilMeses: z.number().int(),
  plaqueta: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{1,20}$/),
  origem: idZ,
  centro: idZ.nullable(),
  residualCent: z.number().int().min(0),
  hoje: dataZ,
  dados: dadosZ,
});
export type EntradaAtivacao = Omit<z.infer<typeof ativarZ>, 'dados' | 'hoje'>;

const opAtivar = definirOperacao({
  nome: 'patrimonio.andamento.ativar',
  tabelas: [T_OBRA, T_BEM],
  entrada: ativarZ,
  async gravar(tx, x, ctx) {
    const o = await travar(tx, T_OBRA, x.obra, x.versao, COLS_OBRA, 'Obra', doEst(tx));
    const r = planejarAtivacao(await obraParaRegra(tx, o, x.obra), x, x.hoje);
    if ('erros' in r) {
      recusar<CodigoAndamento>(r.erros, MENSAGENS_ANDAMENTO);
      throw new Error('inalcançável');
    }
    const centro = x.centro ?? nn(o['centro_custo_id']);
    if (centro === null)
      throw recusa('sem-centro', 'Informe o centro de custo em que o bem fica e deprecia.', {
        campos: ['centro'],
      });
    if (x.residualCent > r.plano.valorCent)
      throw recusa('residual-maior', 'O valor residual passa do custo acumulado da obra.', {
        campos: ['residualCent'],
      });
    let bem: number;
    try {
      bem = await tx.incluir(T_BEM, {
        estabelecimento_id: ctx.estabelecimento,
        plaqueta: x.plaqueta,
        descricao: String(o['descricao']).slice(0, 150),
        grupo_bem_id: n(o['grupo_bem_id']),
        origem_bem_id: x.origem,
        centro_custo_id: centro,
        imobilizado_andamento_id: x.obra,
        data_aquisicao: r.plano.dataAquisicao,
        data_tombamento: r.plano.dataAquisicao,
        valor_aquisicao: dec(r.plano.valorCent),
        valor_residual: dec(x.residualCent),
        depreciavel: true,
        vida_util_meses: r.plano.vidaUtilMeses,
        inicio_depreciacao: `${r.plano.inicioDepreciacao}-01`,
        situacao: 'ativo',
      });
    } catch (e) {
      if (restricaoUnicaViolada(e) === 'uq_bem_patrimonial_estabelecimento_plaqueta')
        throw recusa('plaqueta-repetida', `A plaqueta ${x.plaqueta} já é de outro bem.`, {
          campos: ['plaqueta'],
        });
      throw e;
    }
    const versao = await tx.alterar(T_OBRA, x.obra, x.versao, {
      situacao: 'ativado',
      data_ativacao: r.plano.dataAquisicao,
      bem_patrimonial_id: bem,
    });
    return { bem, versao, estouroCent: r.plano.estouroCent };
  },
  alvo: (x) => ({ tabela: T_OBRA, id: x.obra }),
  trilha: (x) => ({ acao: 'alteracao', dados: x.dados }),
});

const cancelarObraZ = z.object({ obra: idZ, versao: versaoZ, motivo: motivoZ, dados: dadosZ });
const opCancelarObra = definirOperacao({
  nome: 'patrimonio.andamento.cancelar',
  tabelas: [T_OBRA],
  entrada: cancelarObraZ,
  async gravar(tx, x) {
    const o = await travar(tx, T_OBRA, x.obra, x.versao, COLS_OBRA, 'Obra', doEst(tx));
    recusar<CodigoAndamento>(
      errosCancelamentoObra(await obraParaRegra(tx, o, x.obra), x.motivo),
      MENSAGENS_ANDAMENTO,
    );
    const obs = [t(o['observacao']), `Cancelada: ${x.motivo}`].filter(Boolean).join(' | ').slice(0, 1000);
    const versao = await tx.alterar(T_OBRA, x.obra, x.versao, { situacao: 'cancelado', observacao: obs });
    return { versao };
  },
  alvo: (x) => ({ tabela: T_OBRA, id: x.obra }),
  trilha: (x) => ({ acao: 'alteracao', dados: x.dados, motivo: x.motivo }),
});

// ── Seguro ────────────────────────────────────────────────────────────────────────────────────────────────────────

const apoliceZ = z.object({
  numero: z.string().trim().max(40),
  tipo: z.string().max(30),
  seguradora: idZ.nullable(),
  corretorNome: z.string().trim().max(150).nullable(),
  corretorTelefone: z.string().trim().max(20).nullable(),
  corretorEmail: z.string().trim().max(254).nullable(),
  cobertura: z.string().trim().max(5000).nullable(),
  inicio: z.string().max(10),
  fim: z.string().max(10),
  premioCent: z.number().int(),
  franquiaCent: z.number().int().nullable(),
  titulo: idZ.nullable(),
  anterior: idZ.nullable(),
  dados: dadosZ,
});
export type EntradaApolice = Omit<z.infer<typeof apoliceZ>, 'dados'>;

const opIncluirApolice = definirOperacao({
  nome: 'patrimonio.apolice.incluir',
  tabelas: [T_APOLICE],
  entrada: apoliceZ,
  async gravar(tx, x, ctx) {
    recusar<CodigoSeguro>(errosApolice({ ...x, numero: x.numero }), MENSAGENS_SEGURO);
    if (
      !(await tx.uma('SELECT id FROM empresa_fornecedora WHERE id = ? AND excluido_em IS NULL', [
        x.seguradora,
      ]))
    )
      throw recusa('seguradora-inexistente', 'A seguradora não está no cadastro de empresas.', {
        campos: ['seguradora'],
      });
    let anterior: Record<string, unknown> | null = null;
    if (x.anterior !== null)
      anterior = await travar(
        tx,
        T_APOLICE,
        x.anterior,
        null,
        ['estabelecimento_id', 'situacao'],
        'Apólice anterior',
        doEst(tx),
      );
    let id: number;
    try {
      id = await tx.incluir(T_APOLICE, {
        estabelecimento_id: ctx.estabelecimento,
        seguradora_empresa_fornecedora_id: x.seguradora,
        numero_apolice: x.numero,
        tipo_seguro: x.tipo,
        corretor_nome: x.corretorNome,
        corretor_telefone: x.corretorTelefone,
        corretor_email: x.corretorEmail,
        cobertura: x.cobertura,
        vigencia_inicio: x.inicio,
        vigencia_fim: x.fim,
        valor_premio: dec(x.premioCent),
        valor_segurado_total: '0.00',
        valor_franquia: x.franquiaCent === null ? null : dec(x.franquiaCent),
        titulo_pagar_id: x.titulo,
        apolice_anterior_id: x.anterior,
        situacao: 'vigente',
      });
    } catch (e) {
      if (restricaoUnicaViolada(e) === 'uq_apolice_seguro_seguradora_numero')
        throw recusa('apolice-repetida', 'Esta seguradora já tem uma apólice com este número.', {
          campos: ['numero'],
        });
      throw e;
    }
    // A renovação marca a anterior como renovada (a cobertura dos bens dela fica no histórico).
    if (anterior && String(anterior['situacao']) === 'vigente')
      await tx.alterar(T_APOLICE, x.anterior!, n(anterior['versao']), { situacao: 'renovada' });
    return { id };
  },
  alvo: (_x, r) => ({ tabela: T_APOLICE, id: r.id }),
  trilha: (x) => ({ acao: 'inclusao', dados: x.dados }),
});

async function recalcularTotal(tx: TxOperacao, apolice: number, versao: number): Promise<number> {
  const s = await tx.uma(
    `SELECT COALESCE(SUM(valor_segurado), 0) AS s FROM ${T_SEGURADO}
      WHERE apolice_seguro_id = ? AND ativo = TRUE AND excluido_em IS NULL`,
    [apolice],
  );
  return tx.alterar(T_APOLICE, apolice, versao, { valor_segurado_total: dec(cent(s?.['s'])) });
}

const segurarZ = z.object({
  apolice: idZ,
  versao: versaoZ,
  bem: idZ,
  valorSeguradoCent: z.number().int(),
  inicio: z.string().max(10),
  hoje: dataZ,
  dados: dadosZ,
});
const COLS_APOLICE = ['estabelecimento_id', 'situacao', 'vigencia_inicio', 'vigencia_fim'];

const opSegurar = definirOperacao({
  nome: 'patrimonio.apolice.segurar-bem',
  tabelas: [T_SEGURADO, T_APOLICE],
  entrada: segurarZ,
  async gravar(tx, x) {
    const ap = await travar(tx, T_APOLICE, x.apolice, x.versao, COLS_APOLICE, 'Apólice', doEst(tx));
    const bem = await tx.uma(
      `SELECT situacao FROM ${T_BEM} WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [x.bem, tx.contexto.estabelecimento],
    );
    if (!bem) throw naoEncontrado('Bem');
    const ja = await tx.uma(
      `SELECT id FROM ${T_SEGURADO} WHERE apolice_seguro_id = ? AND bem_patrimonial_id = ? AND ativo = TRUE AND excluido_em IS NULL`,
      [x.apolice, x.bem],
    );
    recusar<CodigoSeguro>(
      errosBemSegurado(
        {
          situacao: String(ap['situacao']),
          inicio: dia(ap['vigencia_inicio']) ?? '',
          fim: dia(ap['vigencia_fim']) ?? '',
        },
        { situacao: String(bem['situacao']) },
        x,
        !!ja,
        x.hoje,
      ),
      MENSAGENS_SEGURO,
    );
    const id = await tx.incluir(T_SEGURADO, {
      apolice_seguro_id: x.apolice,
      bem_patrimonial_id: x.bem,
      valor_segurado: dec(x.valorSeguradoCent),
      vigencia_inicio: x.inicio,
      vigencia_fim: dia(ap['vigencia_fim']),
      ativo: true,
    });
    const versao = await recalcularTotal(tx, x.apolice, x.versao);
    return { id, versao };
  },
  alvo: (_x, r) => ({ tabela: T_SEGURADO, id: r.id }),
  trilha: (x) => ({ acao: 'inclusao', dados: x.dados }),
});

const retirarZ = z.object({ id: idZ, data: dataZ, motivo: motivoZ, dados: dadosZ });
const opRetirar = definirOperacao({
  nome: 'patrimonio.apolice.retirar-bem',
  tabelas: [T_SEGURADO, T_APOLICE],
  entrada: retirarZ,
  async gravar(tx, x) {
    const s = await travar(
      tx,
      T_SEGURADO,
      x.id,
      null,
      ['apolice_seguro_id', 'ativo', 'vigencia_inicio'],
      'Bem segurado',
      async (r) =>
        !!(await tx.uma(`SELECT id FROM ${T_APOLICE} WHERE id = ? AND estabelecimento_id = ?`, [
          n(r['apolice_seguro_id']),
          tx.contexto.estabelecimento,
        ])),
    );
    if (!b(s['ativo'])) throw recusa('ja-retirado', MENSAGENS_SEGURO['ja-retirado']);
    if (x.motivo.trim().length < 5)
      throw recusa('motivo-curto', MENSAGENS_SEGURO['motivo-curto'], { campos: ['motivo'] });
    const inicio = dia(s['vigencia_inicio']) ?? x.data;
    await tx.alterar(T_SEGURADO, x.id, n(s['versao']), {
      ativo: false,
      vigencia_fim: x.data < inicio ? inicio : x.data,
    });
    const ap = n(s['apolice_seguro_id']);
    const v = await umaTravada(tx, `SELECT versao FROM ${T_APOLICE} WHERE id = ?`, [ap]);
    const versao = await recalcularTotal(tx, ap, n(v?.['versao']));
    return { versao };
  },
  alvo: (x) => ({ tabela: T_SEGURADO, id: x.id }),
  trilha: (x) => ({ acao: 'alteracao', dados: x.dados, motivo: x.motivo }),
});

const cancelarApoliceZ = z.object({ id: idZ, versao: versaoZ, motivo: motivoZ, hoje: dataZ, dados: dadosZ });
const opCancelarApolice = definirOperacao({
  nome: 'patrimonio.apolice.cancelar',
  tabelas: [T_APOLICE, T_SEGURADO],
  entrada: cancelarApoliceZ,
  async gravar(tx, x) {
    const ap = await travar(tx, T_APOLICE, x.id, x.versao, COLS_APOLICE, 'Apólice', doEst(tx));
    if (String(ap['situacao']) === 'cancelada') throw recusa('ja-cancelada', 'A apólice já está cancelada.');
    if (x.motivo.trim().length < 5)
      throw recusa('motivo-curto', MENSAGENS_SEGURO['motivo-curto'], { campos: ['motivo'] });
    const bens = await tx.consultar(
      `SELECT id, versao, vigencia_inicio FROM ${T_SEGURADO} WHERE apolice_seguro_id = ? AND ativo = TRUE AND excluido_em IS NULL`,
      [x.id],
      { teto: 20_000 },
    );
    for (const s of bens) {
      const ini = dia(s['vigencia_inicio']) ?? x.hoje;
      await tx.alterar(T_SEGURADO, n(s['id']), n(s['versao']), {
        ativo: false,
        vigencia_fim: x.hoje < ini ? ini : x.hoje,
      });
    }
    const versao = await tx.alterar(T_APOLICE, x.id, x.versao, {
      situacao: 'cancelada',
      valor_segurado_total: '0.00',
    });
    return { versao, bens: bens.length };
  },
  alvo: (x) => ({ tabela: T_APOLICE, id: x.id }),
  trilha: (x) => ({ acao: 'alteracao', dados: x.dados, motivo: x.motivo }),
});

// ── Leituras: tipos ───────────────────────────────────────────────────────────────────────────────────────────────

export interface AgregacaoLida {
  readonly id: number;
  readonly sequencia: number;
  readonly tipo: string;
  readonly bemAgregado: { readonly id: number; readonly plaqueta: string; readonly descricao: string } | null;
  readonly numeroDocumento: string | null;
  readonly descricao: string;
  readonly data: string;
  readonly valorCent: number;
  readonly agregaValor: boolean;
  readonly dataDesagregacao: string | null;
  readonly observacao: string | null;
  readonly versao: number;
}
export interface AgregacoesDoBem {
  readonly bem: number;
  readonly versaoBem: number;
  readonly custoCent: number;
  /** O agregado que entra na base da depreciação da próxima competência. */
  readonly agregadoVigenteCent: number;
  readonly agregacoes: AgregacaoLida[];
}
export interface ObraLida {
  readonly id: number;
  readonly numero: number;
  readonly descricao: string;
  readonly grupo: { readonly id: number; readonly codigo: string; readonly descricao: string };
  readonly conta: number;
  readonly centro: number | null;
  readonly dataInicio: string;
  readonly dataPrevista: string | null;
  readonly dataAtivacao: string | null;
  readonly orcadoCent: number | null;
  readonly acumuladoCent: number;
  readonly orcamento: ReturnType<typeof situacaoOrcamento>;
  readonly bem: { readonly id: number; readonly plaqueta: string } | null;
  readonly situacao: string;
  readonly observacao: string | null;
  readonly versao: number;
  readonly apropriacoes?: {
    readonly id: number;
    readonly sequencia: number;
    readonly data: string;
    readonly titulo: number | null;
    readonly nota: number | null;
    readonly conta: number;
    readonly descricao: string | null;
    readonly valorCent: number;
  }[];
}
export interface ApoliceLida {
  readonly id: number;
  readonly numero: string;
  readonly tipo: string;
  readonly seguradora: { readonly id: number; readonly nome: string };
  readonly corretorNome: string | null;
  readonly corretorTelefone: string | null;
  readonly corretorEmail: string | null;
  readonly cobertura: string | null;
  readonly inicio: string;
  readonly fim: string;
  readonly premioCent: number;
  readonly franquiaCent: number | null;
  readonly totalSeguradoCent: number;
  readonly anterior: number | null;
  readonly situacao: string;
  readonly situacaoVista: string;
  readonly bensCobertos: number;
  readonly versao: number;
  readonly bens?: {
    readonly id: number;
    readonly bem: number;
    readonly plaqueta: string;
    readonly descricao: string;
    readonly valorSeguradoCent: number;
    readonly valorIndenizadoCent: number;
    readonly inicio: string;
    readonly fim: string | null;
    readonly ativo: boolean;
    readonly valorContabilCent: number;
    readonly cobertura: ReturnType<typeof cobertura>;
  }[];
}
export interface ApoioComplementos {
  readonly grupos: {
    readonly id: number;
    readonly codigo: string;
    readonly descricao: string;
    readonly vidaUtilMeses: number | null;
  }[];
  readonly contas: { readonly id: number; readonly codigo: string; readonly descricao: string }[];
  readonly seguradoras: { readonly id: number; readonly nome: string }[];
  readonly origens: { readonly id: number; readonly descricao: string }[];
  readonly centros: { readonly id: number; readonly codigo: string; readonly nome: string }[];
}

// ── A porta ───────────────────────────────────────────────────────────────────────────────────────────────────────

export class PortaComplementosPatrimonio {
  private readonly executor: Executor;
  constructor(
    private readonly nucleo: NucleoPatrimonio,
    private readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoPatrimonio, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: c.correlacao || 'patrimonio' },
      async (l) => {
        let est = c.estabelecimento;
        if (est === null) {
          const x = await l.uma<{ id: unknown }>(
            'SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
            [c.hospital],
          );
          if (!x) throw naoEncontrado('Estabelecimento');
          est = Number(x.id);
        }
        return fn(l, est);
      },
    );
  }

  private async gravar<E, S extends ResultadoOperacao>(
    c: ContextoPatrimonio,
    op: Operacao<E, S>,
    entrada: E,
    trilha: RegistroTrilhaTela,
  ): Promise<S> {
    const est = await this.ler(c, async (_l, e) => e);
    const contexto: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: est,
      usuario: c.usuario,
      correlacao: trilha.correlacao ?? c.correlacao,
      chaveIdempotencia:
        c.chaveIdempotencia ??
        `patrimonio-${op.nome}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    };
    return (await this.executor.executar(op, this.cliente, entrada, contexto)).resultado;
  }

  // Leituras

  apoio(c: ContextoPatrimonio): Promise<ApoioComplementos> {
    return this.ler(c, async (l, est) => {
      const o = { teto: TETO + 1 };
      const [grupos, contas, seguradoras, origens, centros] = await Promise.all([
        l.consultar(
          'SELECT id, codigo, descricao, vida_util_societaria_meses FROM grupo_bem WHERE ativo = TRUE ORDER BY descricao LIMIT 501',
          [],
          o,
        ),
        l.consultar(
          "SELECT id, classificacao, descricao FROM conta_contabil WHERE ativo = TRUE AND excluido_em IS NULL AND tipo = 'analitica' ORDER BY classificacao LIMIT 501",
          [],
          o,
        ),
        l.consultar(
          "SELECT id, razao_social FROM empresa_fornecedora WHERE excluido_em IS NULL AND tipo_pessoa = 'juridica' ORDER BY razao_social LIMIT 501",
          [],
          o,
        ),
        l.consultar(
          'SELECT id, descricao FROM origem_bem WHERE ativo = TRUE ORDER BY descricao LIMIT 501',
          [],
          o,
        ),
        l.consultar(
          'SELECT id, codigo, nome FROM centro_custo WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY codigo LIMIT 501',
          [est],
          o,
        ),
      ]);
      return {
        grupos: grupos.map((g) => ({
          id: n(g['id']),
          codigo: String(g['codigo']),
          descricao: String(g['descricao']),
          vidaUtilMeses: nn(g['vida_util_societaria_meses']),
        })),
        contas: contas.map((k) => ({
          id: n(k['id']),
          codigo: String(k['classificacao']),
          descricao: String(k['descricao']),
        })),
        seguradoras: seguradoras.map((s) => ({ id: n(s['id']), nome: String(s['razao_social']) })),
        origens: origens.map((s) => ({ id: n(s['id']), descricao: String(s['descricao']) })),
        centros: centros.map((s) => ({
          id: n(s['id']),
          codigo: String(s['codigo']),
          nome: String(s['nome']),
        })),
      };
    });
  }

  agregacoes(c: ContextoPatrimonio, bem: number, hoje = hojeLocal()): Promise<AgregacoesDoBem> {
    return this.ler(c, async (l, est) => {
      const x = await l.uma(
        `SELECT id, valor_aquisicao, versao FROM ${T_BEM} WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [bem, est],
      );
      if (!x) throw naoEncontrado('Bem');
      const ls = await l.consultar(
        `SELECT a.id, a.sequencia, a.tipo, a.bem_agregado_id, ba.plaqueta, ba.descricao AS bdesc, a.numero_documento,
                a.descricao, a.data_agregacao, a.valor, a.agrega_valor, a.data_desagregacao, a.observacao, a.versao
           FROM ${T_AGREGACAO} a LEFT JOIN ${T_BEM} ba ON ba.id = a.bem_agregado_id
          WHERE a.bem_patrimonial_id = ? AND a.excluido_em IS NULL ORDER BY a.sequencia`,
        [bem],
        { teto: TETO },
      );
      const agregacoes: AgregacaoLida[] = ls.map((a) => ({
        id: n(a['id']),
        sequencia: n(a['sequencia']),
        tipo: String(a['tipo']),
        bemAgregado:
          a['bem_agregado_id'] == null
            ? null
            : {
                id: n(a['bem_agregado_id']),
                plaqueta: String(a['plaqueta'] ?? ''),
                descricao: String(a['bdesc'] ?? ''),
              },
        numeroDocumento: t(a['numero_documento']),
        descricao: String(a['descricao']),
        data: dia(a['data_agregacao']) ?? '',
        valorCent: cent(a['valor']),
        agregaValor: b(a['agrega_valor']),
        dataDesagregacao: dia(a['data_desagregacao']),
        observacao: t(a['observacao']),
        versao: n(a['versao']),
      }));
      const [ano, mes] = hoje.split('-').map(Number) as [number, number];
      const proxima = mes === 12 ? `${ano + 1}-01` : `${ano}-${String(mes + 1).padStart(2, '0')}`;
      return {
        bem,
        versaoBem: n(x['versao']),
        custoCent: cent(x['valor_aquisicao']),
        agregadoVigenteCent: valorAgregadoNaCompetencia(
          agregacoes.map((a) => ({ ...a, data: a.data })),
          proxima,
        ),
        agregacoes,
      };
    });
  }

  private obraDe(o: Record<string, unknown>): ObraLida {
    const orcado = o['valor_orcado'] == null ? null : cent(o['valor_orcado']);
    const acumulado = cent(o['valor_acumulado']);
    return {
      id: n(o['id']),
      numero: n(o['numero']),
      descricao: String(o['descricao']),
      grupo: {
        id: n(o['grupo_bem_id']),
        codigo: String(o['gcod'] ?? ''),
        descricao: String(o['gdesc'] ?? ''),
      },
      conta: n(o['conta_contabil_id']),
      centro: nn(o['centro_custo_id']),
      dataInicio: dia(o['data_inicio']) ?? '',
      dataPrevista: dia(o['data_prevista_conclusao']),
      dataAtivacao: dia(o['data_ativacao']),
      orcadoCent: orcado,
      acumuladoCent: acumulado,
      orcamento: situacaoOrcamento(orcado, acumulado),
      bem:
        o['bem_patrimonial_id'] == null
          ? null
          : { id: n(o['bem_patrimonial_id']), plaqueta: String(o['plaqueta'] ?? '') },
      situacao: String(o['situacao']),
      observacao: t(o['observacao']),
      versao: n(o['versao']),
    };
  }

  private readonly SQL_OBRA = `SELECT o.*, g.codigo AS gcod, g.descricao AS gdesc, b.plaqueta
      FROM ${T_OBRA} o JOIN grupo_bem g ON g.id = o.grupo_bem_id LEFT JOIN ${T_BEM} b ON b.id = o.bem_patrimonial_id
     WHERE o.estabelecimento_id = ? AND o.excluido_em IS NULL`;

  obras(c: ContextoPatrimonio, situacao: string | null): Promise<ObraLida[]> {
    return this.ler(c, async (l, est) => {
      const ls = await l.consultar(
        `${this.SQL_OBRA} AND (? IS NULL OR o.situacao = ?) ORDER BY o.numero DESC LIMIT ${TETO}`,
        [est, situacao, situacao],
        { teto: TETO },
      );
      return ls.map((o) => this.obraDe(o));
    });
  }

  obra(c: ContextoPatrimonio, id: number): Promise<ObraLida> {
    return this.ler(c, async (l, est) => {
      const o = await l.uma(`${this.SQL_OBRA} AND o.id = ?`, [est, id]);
      if (!o) throw naoEncontrado('Obra');
      const ap = await l.consultar(
        `SELECT id, sequencia, data_apropriacao, titulo_pagar_id, nota_entrada_id, conta_contabil_id, descricao, valor
           FROM ${T_APROPRIACAO} WHERE imobilizado_andamento_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
        [id],
        { teto: 10_000 },
      );
      return {
        ...this.obraDe(o),
        apropriacoes: ap.map((a) => ({
          id: n(a['id']),
          sequencia: n(a['sequencia']),
          data: dia(a['data_apropriacao']) ?? '',
          titulo: nn(a['titulo_pagar_id']),
          nota: nn(a['nota_entrada_id']),
          conta: n(a['conta_contabil_id']),
          descricao: t(a['descricao']),
          valorCent: cent(a['valor']),
        })),
      };
    });
  }

  private apoliceDe(a: Record<string, unknown>, hoje: string): ApoliceLida {
    const fim = dia(a['vigencia_fim']) ?? '';
    return {
      id: n(a['id']),
      numero: String(a['numero_apolice']),
      tipo: String(a['tipo_seguro']),
      seguradora: { id: n(a['seguradora_empresa_fornecedora_id']), nome: String(a['snome'] ?? '') },
      corretorNome: t(a['corretor_nome']),
      corretorTelefone: t(a['corretor_telefone']),
      corretorEmail: t(a['corretor_email']),
      cobertura: t(a['cobertura']),
      inicio: dia(a['vigencia_inicio']) ?? '',
      fim,
      premioCent: cent(a['valor_premio']),
      franquiaCent: a['valor_franquia'] == null ? null : cent(a['valor_franquia']),
      totalSeguradoCent: cent(a['valor_segurado_total']),
      anterior: nn(a['apolice_anterior_id']),
      situacao: String(a['situacao']),
      situacaoVista: situacaoDaApolice({ situacao: String(a['situacao']), fim }, hoje),
      bensCobertos: n(a['nbens']),
      versao: n(a['versao']),
    };
  }

  private readonly SQL_APOLICE = `SELECT a.*, f.razao_social AS snome,
      (SELECT COUNT(*) FROM ${T_SEGURADO} s WHERE s.apolice_seguro_id = a.id AND s.ativo = TRUE AND s.excluido_em IS NULL) AS nbens
      FROM ${T_APOLICE} a JOIN empresa_fornecedora f ON f.id = a.seguradora_empresa_fornecedora_id
     WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL`;

  apolices(c: ContextoPatrimonio, hoje = hojeLocal()): Promise<ApoliceLida[]> {
    return this.ler(c, async (l, est) => {
      const ls = await l.consultar(
        `${this.SQL_APOLICE} ORDER BY a.vigencia_fim DESC, a.id DESC LIMIT ${TETO}`,
        [est],
        {
          teto: TETO,
        },
      );
      return ls.map((a) => this.apoliceDe(a, hoje));
    });
  }

  apolice(c: ContextoPatrimonio, id: number, hoje = hojeLocal()): Promise<ApoliceLida> {
    return this.ler(c, async (l, est) => {
      const a = await l.uma(`${this.SQL_APOLICE} AND a.id = ?`, [est, id]);
      if (!a) throw naoEncontrado('Apólice');
      const bs = await l.consultar(
        `SELECT s.id, s.bem_patrimonial_id, b.plaqueta, b.descricao, s.valor_segurado, s.valor_indenizado, s.vigencia_inicio,
                s.vigencia_fim, s.ativo, b.valor_aquisicao,
                (SELECT COALESCE(SUM(g.valor), 0) FROM ${T_AGREGACAO} g WHERE g.bem_patrimonial_id = b.id AND g.agrega_valor = TRUE
                    AND g.data_desagregacao IS NULL AND g.excluido_em IS NULL) AS ag,
                (SELECT COALESCE(SUM(d.valor_cota), 0) FROM cota_depreciacao d WHERE d.bem_patrimonial_id = b.id
                    AND d.base = 'societaria' AND d.excluido_em IS NULL) AS ac
           FROM ${T_SEGURADO} s JOIN ${T_BEM} b ON b.id = s.bem_patrimonial_id
          WHERE s.apolice_seguro_id = ? AND s.excluido_em IS NULL ORDER BY s.ativo DESC, b.plaqueta`,
        [id],
        { teto: 20_000 },
      );
      return {
        ...this.apoliceDe(a, hoje),
        bens: bs.map((s) => {
          const contabil = cent(s['valor_aquisicao']) + cent(s['ag']) - cent(s['ac']);
          return {
            id: n(s['id']),
            bem: n(s['bem_patrimonial_id']),
            plaqueta: String(s['plaqueta']),
            descricao: String(s['descricao']),
            valorSeguradoCent: cent(s['valor_segurado']),
            valorIndenizadoCent: cent(s['valor_indenizado']),
            inicio: dia(s['vigencia_inicio']) ?? '',
            fim: dia(s['vigencia_fim']),
            ativo: b(s['ativo']),
            valorContabilCent: contabil,
            cobertura: cobertura(cent(s['valor_segurado']), contabil),
          };
        }),
      };
    });
  }

  // Gravações

  agregar(c: ContextoPatrimonio, e: EntradaAgregacao, trilha: RegistroTrilhaTela, hoje = hojeLocal()) {
    return this.gravar(c, opAgregar, { ...e, hoje, dados: trilha.dadosDepois }, trilha);
  }
  retirarAgregacao(
    c: ContextoPatrimonio,
    e: { id: number; versao: number; data: string; motivo: string },
    trilha: RegistroTrilhaTela,
    hoje = hojeLocal(),
  ) {
    return this.gravar(c, opDesagregar, { ...e, hoje, dados: trilha.dadosDepois }, trilha);
  }
  abrirObra(c: ContextoPatrimonio, e: EntradaObra, trilha: RegistroTrilhaTela, hoje = hojeLocal()) {
    return this.gravar(c, opAbrirObra, { ...e, hoje, dados: trilha.dadosDepois }, trilha);
  }
  apropriar(c: ContextoPatrimonio, e: EntradaApropriacao, trilha: RegistroTrilhaTela, hoje = hojeLocal()) {
    return this.gravar(c, opApropriar, { ...e, hoje, dados: trilha.dadosDepois }, trilha);
  }
  ativar(c: ContextoPatrimonio, e: EntradaAtivacao, trilha: RegistroTrilhaTela, hoje = hojeLocal()) {
    return this.gravar(c, opAtivar, { ...e, hoje, dados: trilha.dadosDepois }, trilha);
  }
  cancelarObra(
    c: ContextoPatrimonio,
    e: { obra: number; versao: number; motivo: string },
    trilha: RegistroTrilhaTela,
  ) {
    return this.gravar(c, opCancelarObra, { ...e, dados: trilha.dadosDepois }, trilha);
  }
  incluirApolice(c: ContextoPatrimonio, e: EntradaApolice, trilha: RegistroTrilhaTela) {
    return this.gravar(c, opIncluirApolice, { ...e, dados: trilha.dadosDepois }, trilha);
  }
  segurarBem(
    c: ContextoPatrimonio,
    e: { apolice: number; versao: number; bem: number; valorSeguradoCent: number; inicio: string },
    trilha: RegistroTrilhaTela,
    hoje = hojeLocal(),
  ) {
    return this.gravar(c, opSegurar, { ...e, hoje, dados: trilha.dadosDepois }, trilha);
  }
  retirarBem(
    c: ContextoPatrimonio,
    e: { id: number; data: string; motivo: string },
    trilha: RegistroTrilhaTela,
  ) {
    return this.gravar(c, opRetirar, { ...e, dados: trilha.dadosDepois }, trilha);
  }
  cancelarApolice(
    c: ContextoPatrimonio,
    e: { id: number; versao: number; motivo: string },
    trilha: RegistroTrilhaTela,
    hoje = hojeLocal(),
  ) {
    return this.gravar(c, opCancelarApolice, { ...e, hoje, dados: trilha.dadosDepois }, trilha);
  }
}
