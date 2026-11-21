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
    return {
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
    const invs = `SELECT id FROM inventario_estoque WHERE local_estoque_id IN (${locais})`;
    await e.executar(`DELETE FROM inventario_estoque_item WHERE inventario_estoque_id IN (${invs})`, [like]);
    await e.executar(`DELETE FROM inventario_estoque_contagem WHERE inventario_estoque_id IN (${invs})`, [
      like,
    ]);
    await e.executar(`DELETE FROM inventario_estoque WHERE local_estoque_id IN (${locais})`, [like]);
    await e.executar(`DELETE FROM saldo_estoque WHERE local_estoque_id IN (${locais})`, [like]);
    await e.executar(`DELETE FROM saldo_lote WHERE local_estoque_id IN (${locais})`, [like]);
    await e.executar('DELETE FROM lote_insumo WHERE numero_lote LIKE ?', [like]);
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
