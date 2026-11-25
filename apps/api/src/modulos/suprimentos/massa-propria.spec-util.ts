// Massa SINTÉTICA das portas próprias do estoque, do OPME e da manipulação (lote 03-14) no cliente de teste da onda 3
// (f22_o3): dois estabelecimentos (A e B), um usuário, locais, insumos, saldos, um mês fechado, capelas com grupo e a
// sequência do número do inventário. Nenhuma pessoa real. Os estabelecimentos e o usuário ficam entre execuções (a
// trilha aponta para eles); o resto sai no fim (limparMassa), inclusive numa execução anterior interrompida.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { type Escritor, garantirSequencia, type NucleoProprio } from '@sgh/nucleo';

export const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
export const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const PREFIXO = 'F22L0314';
const RAIZ = fileURLToPath(new URL('../../../../../', import.meta.url));

export interface MassaSuprimentos {
  readonly marca: string;
  readonly estA: number;
  readonly estB: number;
  readonly usuario: number;
  /** Segundo e terceiro usuários (a recontagem e a aprovação são de outra pessoa). */
  readonly usuario2: number;
  readonly usuario3: number;
  readonly insumoInativo: number;
  readonly lote: number;
  readonly centroCusto: number;
  readonly unidade: number;
  readonly grupo: number;
  readonly insumo: number;
  readonly insumoOpme: number;
  readonly localA: number;
  readonly localA2: number;
  readonly localB: number;
  readonly capelaA: number;
  readonly grupoManipulacao: number;
  /** Estoque (F2.4): fornecedores, lote com validade suspeita e o carrinho com um item. */
  readonly fornecedor: number;
  readonly fornecedor2: number;
  readonly loteSuspeito: number;
  readonly kit: number;
  readonly kitItem: number;
}

/** Os tipos de movimento do catálogo que a porta do estoque usa (código, natureza, sentido). */
const TIPOS_MOVIMENTO_SINTETICOS: readonly (readonly [string, string, string])[] = [
  ['saida_setor', 'consumo_setor', 'saida'],
  ['saida_paciente', 'consumo_paciente', 'saida'],
  ['saida_terceiro', 'saida', 'saida'],
  ['devolucao_interna', 'devolucao', 'entrada'],
  ['transferencia_saida', 'transferencia', 'saida'],
  ['transferencia_entrada', 'transferencia', 'entrada'],
  ['transferencia_envio', 'transferencia', 'saida'],
  ['entrada_nota', 'entrada', 'entrada'],
  ['acerto_entrada', 'inventario', 'entrada'],
  ['acerto_saida', 'inventario', 'saida'],
  ['estoque_inicial', 'entrada', 'entrada'],
];

/** CNPJ sintético válido (os dígitos verificadores calculados) a partir de 12 dígitos. */
export function cnpjSintetico(base: string): string {
  const b = base.replace(/\D/g, '').padStart(12, '0').slice(-12);
  const dv = (s: string) => {
    const pesos =
      s.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = [...s].reduce((t, d, i) => t + Number(d) * pesos[i]!, 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(b);
  return `${b}${d1}${dv(`${b}${d1}`)}`;
}

/** O cliente de teste da onda (criado só se faltar; o comando recusa cliente existente). */
export function garantirCliente(): void {
  const l = spawnSync('python3', ['-I', 'tools/db/criar_cliente.py', '--listar'], {
    cwd: RAIZ,
    encoding: 'utf-8',
  });
  if (new RegExp(`\\b${CLIENTE}\\b`).test(l.stdout ?? '')) return;
  const c = spawnSync('python3', ['-I', 'tools/db/criar_cliente.py', CLIENTE, 'Teste F2.2 onda 3'], {
    cwd: RAIZ,
    encoding: 'utf-8',
  });
  if (c.status !== 0) throw new Error(`criar_cliente ${CLIENTE} falhou (código ${String(c.status)}).`);
}

interface Coluna {
  c: string;
  t: string;
  nulo: string;
  padrao: unknown;
  tam: unknown;
  extra: string;
}

/**
 * Inclui a linha com os valores dados e preenche só as colunas obrigatórias sem padrão (texto com a marca, número 1,
 * data fixa, instante de agora); chave estrangeira obrigatória não informada é erro do teste.
 */
export async function inserirMinimo(
  e: Escritor,
  tabela: string,
  valores: Record<string, unknown>,
  marca: string,
): Promise<number> {
  const cols = await e.consultar<Coluna & Record<string, unknown>>(
    `SELECT COLUMN_NAME AS c, DATA_TYPE AS t, IS_NULLABLE AS nulo, COLUMN_DEFAULT AS padrao,
            CHARACTER_MAXIMUM_LENGTH AS tam, EXTRA AS extra
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tabela],
  );
  const v: Record<string, unknown> = { ...valores };
  for (const x of cols) {
    if (
      x.c in v ||
      x.nulo !== 'NO' ||
      (x.padrao !== null && x.padrao !== undefined) ||
      /auto_increment/i.test(x.extra)
    )
      continue;
    if (x.c.endsWith('_id')) throw new Error(`${tabela}.${x.c} é obrigatória: informe no teste.`);
    const t = x.t.toLowerCase();
    if (t.includes('char') || t.includes('text')) v[x.c] = `${marca}${tabela}`.slice(0, Number(x.tam ?? 30));
    else if (t === 'date') v[x.c] = '2026-01-01';
    else if (t.includes('datetime') || t.includes('timestamp')) v[x.c] = new Date();
    else if (t === 'json') v[x.c] = '{}';
    else v[x.c] = 1;
  }
  const nomes = Object.keys(v);
  return e.inserir(
    `INSERT INTO ${tabela} (${nomes.join(', ')}) VALUES (${nomes.map(() => '?').join(', ')})`,
    nomes.map((k) => v[k]),
  );
}

async function garantir(
  e: Escritor,
  sel: string,
  p: unknown[],
  criar: () => Promise<number>,
): Promise<number> {
  const l = await e.uma<{ id: unknown }>(sel, p);
  return l ? Number(l.id) : criar();
}

export async function montarMassa(nucleo: NucleoProprio): Promise<MassaSuprimentos> {
  garantirCliente();
  await limparMassa(nucleo, null);
  const marca = `${PREFIXO}${Date.now().toString(36).slice(-5).toUpperCase()}`;
  return nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-f22l0314' }, async (e) => {
    const est = (k: string) =>
      garantir(e, 'SELECT id FROM estabelecimento WHERE codigo = ?', [`${PREFIXO}${k}`], () =>
        inserirMinimo(
          e,
          'estabelecimento',
          { codigo: `${PREFIXO}${k}`, nome_fantasia: `Teste 03-14 ${k}`, razao_social: `Teste 03-14 ${k}` },
          marca,
        ),
      );
    const estA = await est('A');
    const estB = await est('B');
    const usuario = await garantir(e, 'SELECT id FROM usuario WHERE login = ?', [`${PREFIXO}.ESTOQUE`], () =>
      inserirMinimo(
        e,
        'usuario',
        { login: `${PREFIXO}.ESTOQUE`, nome: 'Estoquista sintético', dispensa_cpf: true },
        marca,
      ),
    );
    const outro = (k: string) =>
      garantir(e, 'SELECT id FROM usuario WHERE login = ?', [`${PREFIXO}.${k}`], () =>
        inserirMinimo(
          e,
          'usuario',
          { login: `${PREFIXO}.${k}`, nome: `Usuário sintético ${k}`, dispensa_cpf: true },
          marca,
        ),
      );
    const usuario2 = await outro('RECONTA');
    const usuario3 = await outro('SUPERVISOR');
    const unidade = await inserirMinimo(e, 'unidade_medida', {}, `${marca}U`);
    const grupo = await inserirMinimo(e, 'grupo_insumo', { natureza: 'material' }, `${marca}G`);
    const insumo = (cod: string, extra: Record<string, unknown>) =>
      inserirMinimo(
        e,
        'insumo',
        {
          codigo: `${marca}${cod}`,
          nome: `ITEM SINTETICO ${cod}`,
          tipo: 'material',
          grupo_insumo_id: grupo,
          estoque_unidade_medida_id: unidade,
          situacao: 'ativo',
          ...extra,
        },
        marca,
      );
    const i1 = await insumo('M', { controla_lote: true, controla_validade: true });
    const i2 = await insumo('O', { tipo: 'opme', opme: true, consignado: true });
    const i3 = await insumo('I', { situacao: 'inativo' });
    const classe = await inserirMinimo(
      e,
      'classificacao_centro_custo',
      { codigo: `${marca}CL`, descricao: 'PRODUTIVO', classe: 'produtivo' },
      marca,
    );
    const centroCusto = await inserirMinimo(
      e,
      'centro_custo',
      {
        estabelecimento_id: estA,
        codigo: `${marca}CC`,
        nome: 'CENTRO SINTETICO',
        analitico: true,
        ativo: true,
        classificacao_centro_custo_id: classe,
      },
      marca,
    );
    const local = (estab: number, cod: string, tipo: string, cc: number | null = null) =>
      inserirMinimo(
        e,
        'local_estoque',
        {
          estabelecimento_id: estab,
          codigo: `${marca}${cod}`,
          nome: `LOCAL ${cod}`,
          tipo,
          centro_custo_id: cc,
        },
        marca,
      );
    const localA = await local(estA, 'A1', 'almoxarifado', centroCusto);
    const localA2 = await local(estA, 'A2', 'farmacia_central');
    const localB = await local(estB, 'B1', 'almoxarifado');
    const saldo = (
      estab: number,
      loc: number,
      ins: number,
      q: number,
      custo: number,
      consig = 0,
      curva: string | null = null,
    ) =>
      inserirMinimo(
        e,
        'saldo_estoque',
        {
          estabelecimento_id: estab,
          local_estoque_id: loc,
          insumo_id: ins,
          quantidade: q,
          quantidade_consignada: consig,
          custo_medio: custo,
          curva_abc: curva,
        },
        marca,
      );
    await saldo(estA, localA, i1, 10, 2.5, 0, 'A');
    await saldo(estA, localA, i3, 3, 1);
    const lote = await inserirMinimo(
      e,
      'lote_insumo',
      {
        estabelecimento_id: estA,
        insumo_id: i1,
        numero_lote: `${marca}L1`,
        validade: '2027-03-31',
        situacao: 'liberado',
      },
      marca,
    );
    await inserirMinimo(
      e,
      'saldo_lote',
      {
        estabelecimento_id: estA,
        local_estoque_id: localA,
        lote_insumo_id: lote,
        quantidade: 10,
        competencia: '2026-11-01',
      },
      marca,
    );
    await saldo(estA, localA2, i1, 4, 2.5);
    await saldo(estA, localA2, i2, 0, 100, 2);
    await saldo(estB, localB, i1, 99, 7);
    await inserirMinimo(
      e,
      'fechamento_estoque',
      {
        estabelecimento_id: estA,
        competencia: '2026-09-01',
        situacao: 'fechado',
        fechado_em: new Date(),
        exportado_contabilidade: true,
      },
      marca,
    );
    const gm = await inserirMinimo(
      e,
      'grupo_manipulacao',
      { codigo: `${marca}GM`, descricao: 'GRUPO SINTETICO' },
      marca,
    );
    const capela = (estab: number, cod: string, situacao: string) =>
      inserirMinimo(
        e,
        'capela_manipulacao',
        { estabelecimento_id: estab, codigo: `${marca}${cod}`, nome: `CAPELA ${cod}`, situacao },
        marca,
      );
    const capelaA = await capela(estA, 'CA', 'em_uso');
    await capela(estA, 'CM', 'manutencao');
    await capela(estB, 'CB', 'disponivel');
    await inserirMinimo(
      e,
      'capela_manipulacao_grupo',
      { capela_manipulacao_id: capelaA, grupo_manipulacao_id: gm },
      marca,
    );
    await garantirSequencia(
      e,
      { tipo: 'inventario_estoque', estabelecimento: estA, prefixo: 'INV-' },
      { usuario: null, agora: new Date() },
    );
    for (const [codigo, natureza, sentido] of TIPOS_MOVIMENTO_SINTETICOS)
      await garantir(e, 'SELECT id FROM tipo_movimento_estoque WHERE codigo = ?', [codigo], () =>
        inserirMinimo(
          e,
          'tipo_movimento_estoque',
          { codigo, descricao: `Teste ${codigo}`, natureza, sentido },
          marca,
        ),
      );
    await garantir(e, "SELECT id FROM tipo_entrada_estoque WHERE codigo = 'compra'", [], () =>
      inserirMinimo(
        e,
        'tipo_entrada_estoque',
        { codigo: 'compra', descricao: 'Compra', natureza: 'compra' },
        marca,
      ),
    );
    await garantir(e, "SELECT id FROM motivo_ajuste_estoque WHERE codigo = 'inventario'", [], () =>
      inserirMinimo(e, 'motivo_ajuste_estoque', { codigo: 'inventario', descricao: 'Inventário' }, marca),
    );
    for (const tipo of ['documento_estoque', 'requisicao_material', 'nota_entrada'])
      await garantirSequencia(e, { tipo, estabelecimento: estA }, { usuario: null, agora: new Date() });
    const todas = {
      pode_requisitar: true,
      pode_atender: true,
      pode_receber_nota: true,
      pode_transferir: true,
      pode_devolver: true,
      pode_ajustar: true,
      pode_inventariar: true,
      pode_autorizar_pedido: true,
      pode_desbloquear_fechamento: true,
    };
    for (const loc of [localA, localA2])
      await inserirMinimo(
        e,
        'local_estoque_usuario',
        { local_estoque_id: loc, usuario_id: usuario, ...todas },
        marca,
      );
    // O supervisor aprova o pedido (alçada) no local A, sem as outras permissões.
    await inserirMinimo(
      e,
      'local_estoque_usuario',
      { local_estoque_id: localA, usuario_id: usuario3, pode_autorizar_pedido: true },
      marca,
    );
    const forn = (k: string, base: string) =>
      inserirMinimo(
        e,
        'empresa_fornecedora',
        {
          tipo_pessoa: 'juridica',
          cnpj: cnpjSintetico(base),
          razao_social: `${PREFIXO} FORNECEDOR ${k}`,
          situacao: 'ativo',
        },
        marca,
      );
    const semente = String(Date.now()).slice(-9);
    const fornecedor = await forn('A', `1${semente}01`);
    const fornecedor2 = await forn('B', `1${semente}02`);
    const loteSuspeito = await inserirMinimo(
      e,
      'lote_insumo',
      {
        estabelecimento_id: estA,
        insumo_id: i1,
        numero_lote: `${marca}LS`,
        validade: '1927-03-31',
        situacao: 'liberado',
      },
      marca,
    );
    const kit = await inserirMinimo(
      e,
      'kit_rastreavel',
      {
        estabelecimento_id: estA,
        codigo: `${marca}K`,
        nome: 'CARRINHO SINTETICO',
        local_estoque_id: localA2,
        situacao: 'disponivel',
      },
      marca,
    );
    const kitItem = await inserirMinimo(
      e,
      'kit_rastreavel_item',
      {
        kit_rastreavel_id: kit,
        sequencia: 1,
        insumo_id: i1,
        unidade_medida_id: unidade,
        quantidade_padrao: 2,
        saldo_atual: 1,
      },
      marca,
    );
    return {
      fornecedor,
      fornecedor2,
      loteSuspeito,
      kit,
      kitItem,
      marca,
      estA,
      estB,
      usuario,
      usuario2,
      usuario3,
      insumoInativo: i3,
      lote,
      centroCusto,
      unidade,
      grupo,
      insumo: i1,
      insumoOpme: i2,
      localA,
      localA2,
      localB,
      capelaA,
      grupoManipulacao: gm,
    };
  });
}

/** Apaga a massa do lote (a desta execução e a de execuções anteriores interrompidas), na ordem das chaves. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- a massa é limpa pelo cliente inteiro
export async function limparMassa(nucleo: NucleoProprio, _m: MassaSuprimentos | null): Promise<void> {
  const like = `${PREFIXO}%`;
  await nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-f22l0314-limpa' }, async (e) => {
    const locais = `SELECT id FROM local_estoque WHERE codigo LIKE ?`;
    const ests = `SELECT id FROM estabelecimento WHERE codigo LIKE ?`;
    // Etiqueta de identificação (F3.6-3) da massa: aponta para lote, movimento e local; sai antes deles, com as doses.
    const etqs = `SELECT id FROM etiqueta_identificacao WHERE estabelecimento_id IN (${ests})`;
    for (const t of ['dose_dispensada', 'dose_unitarizada'])
      await e.executar(`DELETE FROM ${t} WHERE etiqueta_identificacao_id IN (${etqs})`, [like]);
    await e.executar(`DELETE FROM etiqueta_identificacao WHERE estabelecimento_id IN (${ests})`, [like]);
    // Estoque (F2.4): os movimentos e os documentos ligam-se em ciclo (item ↔ movimento): solta antes de apagar.
    await e.executar(
      `UPDATE documento_estoque_item SET movimento_estoque_id = NULL WHERE documento_estoque_id IN (SELECT id FROM documento_estoque WHERE estabelecimento_id IN (${ests}))`,
      [like],
    );
    await e.executar(
      `UPDATE movimento_estoque SET estorno_movimento_estoque_id = NULL WHERE estabelecimento_id IN (${ests})`,
      [like],
    );
    await e.executar(
      `DELETE FROM movimento_kit_rastreavel WHERE kit_rastreavel_id IN (SELECT id FROM kit_rastreavel WHERE estabelecimento_id IN (${ests}))`,
      [like],
    );
    await e.executar(
      `DELETE FROM movimento_lote WHERE movimento_estoque_id IN (SELECT id FROM movimento_estoque WHERE estabelecimento_id IN (${ests}))`,
      [like],
    );
    await e.executar(`DELETE FROM movimento_estoque WHERE estabelecimento_id IN (${ests})`, [like]);
    await e.executar(
      `UPDATE inventario_estoque SET documento_estoque_id = NULL WHERE estabelecimento_id IN (${ests})`,
      [like],
    );
    await e.executar(
      `DELETE FROM documento_estoque_item WHERE documento_estoque_id IN (SELECT id FROM documento_estoque WHERE estabelecimento_id IN (${ests}))`,
      [like],
    );
    await e.executar(`DELETE FROM documento_estoque WHERE estabelecimento_id IN (${ests})`, [like]);
    await e.executar(
      `DELETE FROM requisicao_material_item WHERE requisicao_material_id IN (SELECT id FROM requisicao_material WHERE estabelecimento_id IN (${ests}))`,
      [like],
    );
    await e.executar(`DELETE FROM requisicao_material WHERE estabelecimento_id IN (${ests})`, [like]);
    // C2-038: a conferência física e os impostos por item antes da nota (chaves estrangeiras).
    await e.executar(
      `DELETE FROM conferencia_recebimento_item WHERE conferencia_recebimento_id IN (SELECT id FROM conferencia_recebimento WHERE estabelecimento_id IN (${ests}))`,
      [like],
    );
    await e.executar(`DELETE FROM conferencia_recebimento WHERE estabelecimento_id IN (${ests})`, [like]);
    await e.executar(
      `DELETE FROM nota_entrada_imposto WHERE nota_entrada_item_id IN (SELECT ni.id FROM nota_entrada_item ni JOIN nota_entrada ne ON ne.id = ni.nota_entrada_id WHERE ne.estabelecimento_id IN (${ests}))`,
      [like],
    );
    await e.executar(
      `DELETE FROM nota_entrada_item WHERE nota_entrada_id IN (SELECT id FROM nota_entrada WHERE estabelecimento_id IN (${ests}))`,
      [like],
    );
    await e.executar(`DELETE FROM nota_entrada WHERE estabelecimento_id IN (${ests})`, [like]);
    const cots = `SELECT id FROM cotacao WHERE estabelecimento_id IN (${ests})`;
    await e.executar(
      `DELETE FROM cotacao_resposta_item WHERE cotacao_fornecedor_id IN (SELECT id FROM cotacao_fornecedor WHERE cotacao_id IN (${cots}))`,
      [like],
    );
    await e.executar(`DELETE FROM cotacao_fornecedor WHERE cotacao_id IN (${cots})`, [like]);
    // F3.6 (05-SUP linha 20): a gestão do pedido (cancelamentos, agenda de entregas e contatos) sai antes dos itens.
    const peds = `SELECT id FROM pedido_compra WHERE estabelecimento_id IN (${ests})`;
    await e.executar(
      `DELETE FROM cancelamento_pedido_compra_entrega WHERE cancelamento_pedido_compra_item_id IN (SELECT id FROM cancelamento_pedido_compra_item WHERE pedido_compra_id IN (${peds}))`,
      [like],
    );
    await e.executar(`DELETE FROM cancelamento_pedido_compra_item WHERE pedido_compra_id IN (${peds})`, [
      like,
    ]);
    await e.executar(
      `DELETE FROM pedido_compra_entrega WHERE pedido_compra_item_id IN (SELECT id FROM pedido_compra_item WHERE pedido_compra_id IN (${peds}))`,
      [like],
    );
    await e.executar(
      `DELETE FROM pedido_compra_acompanhamento WHERE pedido_compra_id IN (${peds}) ORDER BY id DESC`,
      [like],
    );
    await e.executar(
      `DELETE FROM pedido_compra_item WHERE pedido_compra_id IN (SELECT id FROM pedido_compra WHERE estabelecimento_id IN (${ests}))`,
      [like],
    );
    await e.executar(`DELETE FROM cotacao_item WHERE cotacao_id IN (${cots})`, [like]);
    await e.executar(`DELETE FROM pedido_compra WHERE estabelecimento_id IN (${ests})`, [like]);
    await e.executar(`DELETE FROM cotacao WHERE estabelecimento_id IN (${ests})`, [like]);
    await e.executar(
      `DELETE FROM saldo_estoque_mensal WHERE saldo_estoque_id IN (SELECT id FROM saldo_estoque WHERE estabelecimento_id IN (${ests}))`,
      [like],
    );
    await e.executar(`DELETE FROM parametro_reposicao WHERE estabelecimento_id IN (${ests})`, [like]);
    const kits = `SELECT id FROM kit_rastreavel WHERE estabelecimento_id IN (${ests})`;
    await e.executar(`DELETE FROM conferencia_kit_rastreavel WHERE kit_rastreavel_id IN (${kits})`, [like]);
    await e.executar(
      `DELETE FROM kit_rastreavel_lote WHERE kit_rastreavel_item_id IN (SELECT id FROM kit_rastreavel_item WHERE kit_rastreavel_id IN (${kits}))`,
      [like],
    );
    await e.executar(`DELETE FROM kit_rastreavel_item WHERE kit_rastreavel_id IN (${kits})`, [like]);
    await e.executar(`DELETE FROM kit_rastreavel WHERE estabelecimento_id IN (${ests})`, [like]);
    await e.executar(`DELETE FROM local_estoque_usuario WHERE local_estoque_id IN (${locais})`, [like]);
    await e.executar('DELETE FROM empresa_fornecedora WHERE razao_social LIKE ?', [like]);
    const invs = `SELECT id FROM inventario_estoque WHERE local_estoque_id IN (${locais})`;
    await e.executar(`DELETE FROM inventario_estoque_item WHERE inventario_estoque_id IN (${invs})`, [like]);
    await e.executar(`DELETE FROM inventario_estoque_contagem WHERE inventario_estoque_id IN (${invs})`, [
      like,
    ]);
    await e.executar(`DELETE FROM inventario_estoque WHERE local_estoque_id IN (${locais})`, [like]);
    await e.executar(`DELETE FROM saldo_estoque WHERE local_estoque_id IN (${locais})`, [like]);
    await e.executar(`DELETE FROM saldo_lote WHERE local_estoque_id IN (${locais})`, [like]);
    await e.executar(`DELETE FROM lote_insumo WHERE estabelecimento_id IN (${ests}) OR numero_lote LIKE ?`, [
      like,
      like,
    ]);
    await e.executar(
      `DELETE FROM capela_manipulacao_grupo WHERE capela_manipulacao_id IN (SELECT id FROM capela_manipulacao WHERE codigo LIKE ?)`,
      [like],
    );
    await e.executar('DELETE FROM capela_manipulacao WHERE codigo LIKE ?', [like]);
    await e.executar('DELETE FROM grupo_manipulacao WHERE codigo LIKE ?', [like]);
    await e.executar(
      `DELETE FROM fechamento_estoque WHERE estabelecimento_id IN (SELECT id FROM estabelecimento WHERE codigo LIKE ?)`,
      [like],
    );
    await e.executar('DELETE FROM local_estoque WHERE codigo LIKE ?', [like]);
    await e.executar('DELETE FROM centro_custo WHERE codigo LIKE ?', [like]);
    await e.executar('DELETE FROM classificacao_centro_custo WHERE codigo LIKE ?', [like]);
    // Código de barras do produto (F3.6-3, leitura da identificação): sai antes do produto.
    await e.executar(
      'DELETE FROM insumo_codigo_barras WHERE insumo_id IN (SELECT id FROM insumo WHERE codigo LIKE ?)',
      [like],
    );
    await e.executar('DELETE FROM insumo WHERE codigo LIKE ?', [like]);
    await e.executar('DELETE FROM grupo_insumo WHERE codigo LIKE ?', [like]);
    await e.executar('DELETE FROM unidade_medida WHERE codigo LIKE ?', [like]);
  });
}

/** O contexto da porta no estabelecimento dado (A por padrão). */
export function contexto(m: MassaSuprimentos, est: number = m.estA, correlacao = 'f22l0314') {
  return { cliente: CLIENTE, estabelecimento: est, usuario: m.usuario, correlacao: correlacao.slice(0, 64) };
}

/** O código do problema de uma recusa (ou "ok"). */
export async function codigoDe(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    const x = e as { problema?: { codigo?: unknown } };
    return x.problema?.codigo !== undefined ? String(x.problema.codigo) : String(e);
  }
}
