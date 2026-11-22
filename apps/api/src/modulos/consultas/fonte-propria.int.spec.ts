// Integração da fonte PRÓPRIA das consultas contra o MariaDB real (cliente f22_o2 da onda 2), na consulta
// "suprimentos.capela" (tabela capela_manipulacao do modelo): a declaração lida do banco (id como chave, filtro nas
// colunas indexadas, sem a coluna do estabelecimento), a página por chave, a contagem, o registro, a exportação, o
// filtro fora do índice recusado, o escopo do M06 e o estabelecimento da sessão (o excluído e o de outro
// estabelecimento nunca saem). Também o estabelecimento pela tabela-pai ("suprimentos.capelaGrupos": o grupo da capela
// de outro estabelecimento não sai; o cancelamento do atendimento e a troca da internação filtram pelo pai) e o filtro
// fixo da tabela compartilhada (cada lista da contratualização só mostra a sua).
// Só leitura: a massa SINTÉTICA é montada e limpa pelo teste.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { consultaPublica } from '@sgh/contratos';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErroConsulta, ErroEscopo } from './declaracao.js';
import type { CtxConsulta } from './fonte.js';
import { FonteConsultasPropria } from './fonte-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const PUBLICO = consultaPublica('suprimentos', 'capela')!;

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

describe.skipIf(SEM_BANCO)('fonte própria das consultas contra o MariaDB (cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let fonte: FonteConsultasPropria;
  let estA = 0;
  let estB = 0;
  let ids: number[] = [];
  let ctxA: CtxConsulta;
  let ctxB: CtxConsulta;

  async function limpar(): Promise<void> {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'f22-0203-limpa' }, async (e) => {
      await e.executar(
        "DELETE g FROM capela_manipulacao_grupo g JOIN capela_manipulacao c ON c.id = g.capela_manipulacao_id WHERE c.codigo LIKE 'F2203-%'",
        [],
      );
      await e.executar("DELETE FROM capela_manipulacao WHERE codigo LIKE 'F2203-%'", []);
      await e.executar("DELETE FROM grupo_manipulacao WHERE codigo LIKE 'F2203-%'", []);
      await e.executar("DELETE FROM dominio_contratualizacao_sus WHERE codigo LIKE 'F2203-%'", []);
    });
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'f22-0203-massa' }, async (e) => {
      const agora = new Date();
      const est = (codigo: string, cnes: string | null) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, codigo_cnes, criado_em) VALUES (?, ?, ?, ?, ?)',
          [codigo, `Hospital fictício ${codigo}`, `Hospital fictício ${codigo} (teste)`, cnes, agora],
        );
      estA = await est('f2203a', '9020301');
      estB = await est('f2203b', null);
      await garantir(
        e,
        'SELECT id FROM tipo_justificativa_exportacao WHERE codigo = ?',
        ['F2203'],
        "INSERT INTO tipo_justificativa_exportacao (codigo, descricao, criado_em) VALUES ('F2203', 'Auditoria interna (teste)', ?)",
        [agora],
      );
    });
    await limpar();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'f22-0203-massa' }, async (e) => {
      const agora = new Date();
      const capela = (est: number, codigo: string, excluida: boolean) =>
        e.inserir(
          `INSERT INTO capela_manipulacao (estabelecimento_id, codigo, nome, tipo, ultima_certificacao, criado_em, excluido_em)
           VALUES (?, ?, ?, 'isolador', '2026-03-10', ?, ?)`,
          [est, codigo, `Capela ${codigo}`, agora, excluida ? agora : null],
        );
      ids = [
        await capela(estA, 'F2203-1', false),
        await capela(estA, 'F2203-2', false),
        await capela(estA, 'F2203-3', true),
        await capela(estB, 'F2203-4', false),
      ];
      const grupo = await e.inserir(
        "INSERT INTO grupo_manipulacao (codigo, descricao, criado_em) VALUES ('F2203-G', 'Grupo de teste', ?)",
        [agora],
      );
      for (const c of [ids[0]!, ids[3]!])
        await e.executar(
          'INSERT INTO capela_manipulacao_grupo (capela_manipulacao_id, grupo_manipulacao_id, criado_em) VALUES (?, ?, ?)',
          [c, grupo, agora],
        );
      for (const [lista, codigo] of [
        ['periodicidade', 'F2203-P'],
        ['escore', 'F2203-E'],
      ])
        await e.executar(
          'INSERT INTO dominio_contratualizacao_sus (lista, codigo, descricao, criado_em) VALUES (?, ?, ?, ?)',
          [lista, codigo, `Item ${codigo}`, agora],
        );
    });
    fonte = new FonteConsultasPropria(nucleo, CLIENTE);
    ctxA = { rede: 'teste', hospital: 'f2203a', estabelecimento: estA, correlacao: 'f22-0203-consulta' };
    ctxB = { rede: 'teste', hospital: 'f2203b', correlacao: 'f22-0203-consulta' };
  });

  afterAll(async () => {
    if (nucleo) {
      await limpar();
      await nucleo.encerrar();
    }
  });

  it('a declaração sai do banco: id como chave, filtro no índice, sem estabelecimento nem auditoria técnica', async () => {
    const d = await fonte.declaracao(ctxA, PUBLICO);
    expect(d).not.toBeNull();
    expect(d?.tabela).toBe('capela_manipulacao');
    expect(d?.chave).toEqual(['id']);
    expect(d?.porEstabelecimento).toBe('obrigatorio');
    expect(d?.exclusaoLogica).toBe(true);
    const campos = d?.colunas.map((c) => c.campo) ?? [];
    expect(campos).toEqual(
      expect.arrayContaining(['id', 'codigo', 'nome', 'ultimaCertificacao', 'criadoEm']),
    );
    expect(campos).not.toContain('estabelecimentoId');
    expect(campos).not.toContain('versao');
    expect(d?.colunas.find((c) => c.campo === 'setorFuncionalId')?.filtro).toBe('igual');
    expect(d?.escopos).toMatchObject({ unidade: 'setor_funcional_id' });
    expect(d?.colunas.some((c) => c.mascarada)).toBe(false);
  });

  it('página por chave, contagem e exportação: só as do estabelecimento, sem as excluídas', async () => {
    const d = (await fonte.declaracao(ctxA, PUBLICO))!;
    const p1 = await fonte.pagina(ctxA, d, [], null, 1);
    expect(p1.linhas.map((l) => l['codigo'])).toEqual(['F2203-1']);
    expect(p1.linhas[0]?.['ultimaCertificacao']).toBe('2026-03-10');
    expect(p1.proxima).toEqual([ids[0]]);
    const p2 = await fonte.pagina(ctxA, d, [], p1.proxima, 1);
    expect(p2.linhas.map((l) => l['codigo'])).toEqual(['F2203-2']);
    expect(p2.proxima).toBeNull();
    expect(await fonte.contar(ctxA, d, [])).toEqual({ valor: 2, maisDe: false });
    expect((await fonte.exportar(ctxA, d, [])).map((l) => l['codigo'])).toEqual(['F2203-1', 'F2203-2']);
    const porId = await fonte.pagina(ctxA, d, [{ campo: 'id', modo: 'igual', igual: ids[1]! }], null, 10);
    expect(porId.linhas.map((l) => l['codigo'])).toEqual(['F2203-2']);
  });

  it('registro pela chave; o excluído e o de outro estabelecimento não abrem', async () => {
    const d = (await fonte.declaracao(ctxA, PUBLICO))!;
    expect((await fonte.registro(ctxA, d, [String(ids[0])]))?.['nome']).toBe('Capela F2203-1');
    expect(await fonte.registro(ctxA, d, [String(ids[2])])).toBeNull();
    expect(await fonte.registro(ctxA, d, [String(ids[3])])).toBeNull();
    expect((await fonte.registro(ctxB, d, [String(ids[3])]))?.['codigo']).toBe('F2203-4');
    expect(await fonte.registro(ctxA, d, ['x'])).toBeNull();
  });

  it('filtro fora do índice é recusado; o escopo restrito filtra pela coluna (e sem coluna falha fechado)', async () => {
    const d = (await fonte.declaracao(ctxA, PUBLICO))!;
    await expect(
      fonte.pagina(ctxA, d, [{ campo: 'nome', modo: 'igual', igual: 'x' }], null, 10),
    ).rejects.toBeInstanceOf(ErroConsulta);
    expect((await fonte.pagina({ ...ctxA, escopo: { unidade: [] } }, d, [], null, 10)).linhas).toEqual([]);
    expect((await fonte.pagina({ ...ctxA, escopo: { unidade: null } }, d, [], null, 10)).linhas).toHaveLength(
      2,
    );
    await expect(
      fonte.pagina({ ...ctxA, escopo: { convenio: ['1'] } }, d, [], null, 10),
    ).rejects.toBeInstanceOf(ErroEscopo);
  });

  it('as justificativas de exportação vêm do domínio do cliente; consulta sem tabela no modelo não tem declaração', async () => {
    const j = await fonte.justificativas(ctxA);
    expect(j.some((x) => x.descricao === 'Auditoria interna (teste)')).toBe(true);
    expect(await fonte.declaracao(ctxA, { ...PUBLICO, recurso: 'semTabelaNoModelo' })).toBeNull();
  });

  it('sem estabelecimento_id, o estabelecimento vem da tabela-pai: o de outro estabelecimento não sai', async () => {
    const d = (await fonte.declaracao(ctxA, consultaPublica('suprimentos', 'capelaGrupos')!))!;
    expect(d.porEstabelecimento).toBeNull();
    expect(d.estabelecimentoPorPai?.map((p) => [p.coluna, p.tabela])).toEqual([
      ['capela_manipulacao_id', 'capela_manipulacao'],
    ]);
    const capelas = (x: { linhas: readonly Record<string, unknown>[] }) =>
      x.linhas.map((l) => l['capelaManipulacaoId']).filter((v) => v === ids[0] || v === ids[3]);
    expect(capelas(await fonte.pagina(ctxA, d, [], null, 100))).toEqual([ids[0]]);
    expect(capelas(await fonte.pagina(ctxB, d, [], null, 100))).toEqual([ids[3]]);
    for (const [m, r, pai] of [
      ['auditoria', 'atendimentoExcluido', 'atendimento'],
      ['auditoria', 'cancelamentoAlta', 'internacao'],
      ['internacao', 'trocaClinica', 'internacao'],
      ['faturamento', 'procedimentoExtrasApac', 'conta_hospitalar'],
      ['suprimentos', 'historicoComprasItemFornecedorNf', 'nota_entrada'],
    ] as const) {
      const x = (await fonte.declaracao(ctxA, consultaPublica(m, r)!))!;
      expect(x.estabelecimentoPorPai?.map((p) => p.tabela)).toContain(pai);
      // O SQL com o EXISTS do pai roda (a massa não tem linhas dessas tabelas para o estabelecimento A).
      expect(await fonte.contar(ctxA, x, [])).toEqual({ valor: 0, maisDe: false });
    }
  });

  it('tabela sem caminho conhecido para o estabelecimento é recusada (falha fechada)', async () => {
    const d = (await fonte.declaracao(ctxA, consultaPublica('suprimentos', 'capelaGrupos')!))!;
    await expect(
      fonte.pagina(ctxA, { ...d, estabelecimentoPorPai: [], semCaminhoEstabelecimento: true }, [], null, 10),
    ).rejects.toBeInstanceOf(ErroEscopo);
  });

  it('tabela compartilhada: cada consulta só mostra a sua lista (filtro fixo)', async () => {
    const codigos = async (r: string) => {
      const d = (await fonte.declaracao(ctxA, consultaPublica('faturamento', r)!))!;
      expect(d.fixo).toBeDefined();
      return (await fonte.exportar(ctxA, d, []))
        .map((l) => String(l['codigo']))
        .filter((c) => c.startsWith('F2203-'));
    };
    expect(await codigos('periodicidade')).toEqual(['F2203-P']);
    expect(await codigos('escor')).toEqual(['F2203-E']);
    const troca = (await fonte.declaracao(ctxA, consultaPublica('internacao', 'trocaMedico')!))!;
    expect(troca.fixo).toMatchObject({ coluna: 'tipo_troca_internacao_id' });
    expect(await fonte.contar(ctxA, troca, [])).toEqual({ valor: 0, maisDe: false });
  });

  it('consulta de tabela compartilhada sem discriminador fica fora do índice', async () => {
    expect(await fonte.declaracao(ctxA, consultaPublica('pessoas', 'tipoAdmissao')!)).toBeNull();
    expect(
      await fonte.declaracao(ctxA, consultaPublica('auditoria', 'obrigatoriedadeCnsCadastroPaciente')!),
    ).toBeNull();
  });
});
