// A mesma bateria do CRUD genérico em memória e no MariaDB real (cliente f22_o1), sobre os domínios da matriz de
// priorização (dimensao_priorizacao_gut e grau_priorizacao_gut: referência por FK e pontuação com CHECK). Massa
// sintética própria do lote (códigos F22O103*), limpa no afterAll. A referência a outro estabelecimento usa
// aparelho_radioterapia → setor_funcional (as duas com estabelecimento_id). SGH_NUCLEO_SEM_BANCO=1 pula a parte do banco.
import { randomUUID } from 'node:crypto';
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { problemaDaGravacao } from './dominios.controller.js';
import { type DominioDeclarado, valoresParaBanco } from './dominios-catalogo.js';
import {
  type ContextoDominio,
  type FonteDominios,
  FonteDominiosPropria,
  fonteDominiosMemoria,
} from './dominios-fonte.js';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o1';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const H = 'f22o103d';
const OUTRO = 'f22o103e';
const LOGIN = 'f22o103.crud';

let nucleo: NucleoProprio | null = null;
let idUsuario = 0;

const ctx = (): ContextoDominio => ({
  hospital: H,
  usuarioId: null,
  login: LOGIN,
  correlacao: 'teste-f22-0103-crud',
  chaveIdempotencia: `f22o103-${randomUUID()}`,
});

async function limpar(): Promise<void> {
  await nucleo!.escrever({ cliente: CLIENTE, correlacao: 'limpeza-f22-0103' }, async (e) => {
    await e.executar("DELETE FROM aparelho_radioterapia WHERE codigo LIKE 'F22O103%'");
    await e.executar("DELETE FROM setor_funcional WHERE codigo LIKE 'F22O103%'");
    await e.executar("DELETE FROM grau_priorizacao_gut WHERE codigo LIKE 'F22O103%'");
    await e.executar("DELETE FROM dimensao_priorizacao_gut WHERE codigo LIKE 'F22O103%'");
    if (idUsuario) {
      await e.executar('DELETE FROM idempotencia_operacao WHERE usuario_id = ?', [idUsuario]);
    }
    // A trilha só dos estabelecimentos sintéticos (H e OUTRO): a cadeia por hash de qualquer outro fica intacta.
    await limparTrilhaDaMassa(e, { codigos: [H, OUTRO] });
  });
}

beforeAll(async () => {
  if (SEM_BANCO) return;
  nucleo = new NucleoProprio();
  expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
  await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-f22-0103' }, async (e) => {
    const agora = new Date();
    for (const codigo of [H, OUTRO])
      if (!(await e.uma('SELECT id FROM estabelecimento WHERE codigo = ?', [codigo])))
        await e.inserir(
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [
            codigo,
            `Hospital sintético do CRUD ${codigo}`,
            `Hospital sintético do CRUD ${codigo} (fictício)`,
            agora,
          ],
        );
    const u = await e.uma<{ id: number }>('SELECT id FROM usuario WHERE login = ?', [LOGIN]);
    idUsuario = u
      ? Number(u.id)
      : await e.inserir(
          "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, 'Conta de serviço sintética', 'servico', ?)",
          [LOGIN, agora],
        );
  });
  await limpar();
  await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-f22-0103' }, (e) =>
    e.inserir(
      "INSERT INTO dimensao_priorizacao_gut (codigo, descricao, criado_em) VALUES ('F22O103G', 'Gravidade sintética', ?)",
      [new Date()],
    ),
  );
});

afterAll(async () => {
  if (!nucleo) return;
  await limpar();
  await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-f22-0103' }, async (e) => {
    await e.executar('DELETE FROM usuario WHERE login = ?', [LOGIN]);
    await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', [H, OUTRO]);
  });
});

const fabricas: [string, () => FonteDominios][] = [
  ['memória', () => fonteDominiosMemoria()],
  ...(SEM_BANCO
    ? []
    : ([['banco', () => new FonteDominiosPropria(nucleo!, CLIENTE)]] as [string, () => FonteDominios][])),
];

describe.each(fabricas)('CRUD genérico (%s)', (_nome, criar) => {
  let fonte: FonteDominios;
  let grau: DominioDeclarado;
  let dimensao: DominioDeclarado;
  let idDimensao = 0;
  let rotuloDimensao = '';

  beforeAll(async () => {
    fonte = criar();
    const cat = await fonte.catalogo();
    grau = cat.find((d) => d.tabela === 'grau_priorizacao_gut')!;
    dimensao = cat.find((d) => d.tabela === 'dimensao_priorizacao_gut')!;
    expect(grau).toBeDefined();
    const opcoes = await fonte.opcoes(
      H,
      grau,
      grau.campos.find((c) => c.tipo === 'referencia')!,
    );
    expect(opcoes.length).toBeGreaterThan(0);
    idDimensao = Number(opcoes[0]!.valor);
    rotuloDimensao = opcoes[0]!.rotulo;
  });

  it('declara o domínio pelos metadados: módulo, recurso, campos, referência e booleano sem letra', () => {
    expect(grau).toMatchObject({
      modulo: 'administracao',
      recurso: 'grauPriorizacaoGut',
      natureza: 'editavel',
    });
    const campos = Object.fromEntries(grau.campos.map((c) => [c.campo, c]));
    expect(campos['codigo']).toMatchObject({
      tipo: 'texto',
      obrigatorio: true,
      editavel: false,
      maxBytes: 30,
    });
    expect(campos['dimensaoPriorizacaoGutId']).toMatchObject({ tipo: 'referencia', obrigatorio: true });
    expect(campos['pontuacao']).toMatchObject({ tipo: 'inteiro', minimo: 0 });
    expect(campos['ativo']).toBeUndefined();
    expect(campos['versao']).toBeUndefined();
  });

  it('inclui, lê o item com a versão e altera com a versão lida', async () => {
    const valores = valoresParaBanco(
      grau,
      { codigo: 'F22O103A', descricao: 'Grau sintético', dimensaoPriorizacaoGutId: idDimensao, pontuacao: 3 },
      'incluir',
    );
    expect((await fonte.incluir(ctx(), grau, valores)).codigo).toBe('F22O103A');
    const i = await fonte.item(H, grau, 'F22O103A');
    expect(i).toMatchObject({ codigo: 'F22O103A', ativo: true, versao: '1' });
    expect(i!.valores).toMatchObject({
      descricao: 'Grau sintético',
      pontuacao: 3,
      dimensaoPriorizacaoGutId: idDimensao,
    });
    await fonte.alterar(ctx(), grau, 'F22O103A', 1, valoresParaBanco(grau, { pontuacao: 4 }, 'alterar'));
    expect(await fonte.item(H, grau, 'F22O103A')).toMatchObject({ versao: '2', valores: { pontuacao: 4 } });
  });

  it('versão velha é recusada (409 conflito de versão) e nada muda', async () => {
    let erro: unknown = null;
    await fonte
      .alterar(ctx(), grau, 'F22O103A', 1, valoresParaBanco(grau, { pontuacao: 5 }, 'alterar'))
      .catch((e: unknown) => (erro = e));
    expect(problemaDaGravacao(erro, grau).getStatus()).toBe(409);
    expect(await fonte.item(H, grau, 'F22O103A')).toMatchObject({ versao: '2', valores: { pontuacao: 4 } });
  });

  it('código repetido é recusado (409) e o campo desconhecido não chega à fonte (400)', async () => {
    let erro: unknown = null;
    await fonte
      .incluir(
        ctx(),
        grau,
        valoresParaBanco(
          grau,
          { codigo: 'F22O103A', descricao: 'Outro', dimensaoPriorizacaoGutId: idDimensao, pontuacao: 1 },
          'incluir',
        ),
      )
      .catch((e: unknown) => (erro = e));
    expect(problemaDaGravacao(erro, grau).getStatus()).toBe(409);
    expect(() => valoresParaBanco(grau, { coluna_qualquer: 'x' }, 'alterar')).toThrow();
  });

  it('o uso pelo domínio referenciado aparece; inativar e reativar mudam a situação e a versão', async () => {
    const dim = (await fonte.listar(H, dimensao, false)).itens.find(
      (x) => x.valores['descricao'] === rotuloDimensao,
    );
    const usos = await fonte.uso(H, dimensao, dim!.codigo);
    expect(usos.some((u) => u.usos)).toBe(true);
    await fonte.mudarSituacao(ctx(), grau, 'F22O103A', 2, false, 'Teste de inativação');
    expect((await fonte.listar(H, grau, false)).itens.some((x) => x.codigo === 'F22O103A')).toBe(false);
    expect((await fonte.listar(H, grau, true)).itens.find((x) => x.codigo === 'F22O103A')).toMatchObject({
      ativo: false,
      versao: '3',
    });
    await fonte.mudarSituacao(ctx(), grau, 'F22O103A', 3, true, 'Teste de reativação');
    expect(await fonte.item(H, grau, 'F22O103A')).toMatchObject({ ativo: true, versao: '4' });
  });
});

describe.skipIf(SEM_BANCO)('CRUD genérico no banco: contrato de efeito', () => {
  it('a inclusão deixa a linha com auditoria, a trilha e a idempotência; a restrição do banco vira recusa', async () => {
    const fonte = new FonteDominiosPropria(nucleo!, CLIENTE);
    const grau = (await fonte.catalogo()).find((d) => d.tabela === 'grau_priorizacao_gut')!;
    const idDim = Number(
      (
        await fonte.opcoes(
          H,
          grau,
          grau.campos.find((c) => c.tipo === 'referencia')!,
        )
      )[0]!.valor,
    );
    const c = ctx();
    await fonte.incluir(
      c,
      grau,
      valoresParaBanco(
        grau,
        { codigo: 'F22O103B', descricao: 'Efeito', dimensaoPriorizacaoGutId: idDim, pontuacao: 2 },
        'incluir',
      ),
    );
    const efeito = await nucleo!.lerSomente(
      { cliente: CLIENTE, correlacao: 'conferencia-f22-0103' },
      async (l) => {
        const linha = await l.uma<{ id: number }>(
          "SELECT id, ativo, versao, criado_por FROM grau_priorizacao_gut WHERE codigo = 'F22O103B'",
        );
        return {
          linha,
          trilha: await l.consultar(
            "SELECT acao FROM trilha_auditoria WHERE entidade = 'grau_priorizacao_gut' AND entidade_id = ?",
            [linha?.id],
          ),
          idem: await l.consultar(
            "SELECT 1 FROM idempotencia_operacao WHERE operacao = 'dominio.incluir' AND chave = ?",
            [c.chaveIdempotencia],
          ),
        };
      },
    );
    expect(efeito.linha).toMatchObject({ ativo: 1, versao: 1 });
    expect(Number(efeito.linha?.['criado_por' as 'id'])).toBe(idUsuario);
    expect(efeito.trilha).toHaveLength(1);
    expect(efeito.idem).toHaveLength(1);
    // A pontuação fora de 1 a 5 é recusada pelo CHECK do banco: recusa de negócio, sem nome de tabela.
    let erro: unknown = null;
    await fonte
      .alterar(ctx(), grau, 'F22O103B', 1, valoresParaBanco(grau, { pontuacao: 9 }, 'alterar'))
      .catch((e: unknown) => (erro = e));
    const p = problemaDaGravacao(erro, grau);
    expect([409, 422]).toContain(p.getStatus());
    expect(JSON.stringify(p.getResponse())).not.toContain('grau_priorizacao_gut');
  });

  it('a referência a linha de outro estabelecimento é recusada (409 referencia-inexistente) e nada é gravado', async () => {
    const fonte = new FonteDominiosPropria(nucleo!, CLIENTE);
    const aparelho = (await fonte.catalogo()).find((d) => d.tabela === 'aparelho_radioterapia')!;
    expect(aparelho.campos.find((c) => c.coluna === 'setor_funcional_id')?.tipo).toBe('referencia');
    const setores = await nucleo!.escrever(
      { cliente: CLIENTE, correlacao: 'preparo-f22-0103' },
      async (e) => {
        const id = async (codigo: string) =>
          Number(
            (await e.uma<{ id: number }>('SELECT id FROM estabelecimento WHERE codigo = ?', [codigo]))!.id,
          );
        const setor = async (est: number, codigo: string) =>
          e.inserir(
            "INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, ?, 'apoio_tecnico', ?)",
            [est, codigo, `Setor sintético ${codigo}`, new Date()],
          );
        return {
          meu: await setor(await id(H), 'F22O103S1'),
          outro: await setor(await id(OUTRO), 'F22O103S2'),
        };
      },
    );
    const valores = (setor: number, codigo: string) =>
      valoresParaBanco(
        aparelho,
        { codigo, descricao: 'Aparelho sintético', modalidade: 'outro', setorFuncionalId: setor },
        'incluir',
      );
    let erro: unknown = null;
    await fonte
      .incluir(ctx(), aparelho, valores(setores.outro, 'F22O103R2'))
      .catch((e: unknown) => (erro = e));
    const p = problemaDaGravacao(erro, aparelho);
    expect(p.getStatus()).toBe(409);
    expect(erro).toBeInstanceOf(ErroOperacao);
    expect((erro as ErroOperacao).problema).toMatchObject({
      codigo: 'referencia-inexistente',
      campos: ['setorFuncionalId'],
    });
    // O mesmo id inexistente dá a mesma resposta (o id de outro estabelecimento não se revela).
    erro = null;
    await fonte.incluir(ctx(), aparelho, valores(999_999_999, 'F22O103R3')).catch((e: unknown) => (erro = e));
    expect(problemaDaGravacao(erro, aparelho).getStatus()).toBe(409);
    expect((erro as ErroOperacao).problema.codigo).toBe('referencia-inexistente');
    // O setor do próprio estabelecimento é aceito.
    await fonte.incluir(ctx(), aparelho, valores(setores.meu, 'F22O103R1'));
    const n = await nucleo!.lerSomente({ cliente: CLIENTE, correlacao: 'conferencia-f22-0103' }, (l) =>
      l.consultar<{ codigo: string; setor_funcional_id: number }>(
        "SELECT codigo, setor_funcional_id FROM aparelho_radioterapia WHERE codigo LIKE 'F22O103%'",
      ),
    );
    expect(n.map((x) => [x.codigo, Number(x.setor_funcional_id)])).toEqual([['F22O103R1', setores.meu]]);
  });

  it('o índice lê os domínios do modelo pelos metadados (centenas), com os catálogos do sistema só em consulta', async () => {
    const cat = await new FonteDominiosPropria(nucleo!, CLIENTE).catalogo();
    expect(cat.length).toBeGreaterThan(300);
    expect(cat.find((d) => d.tabela === 'acao_sistema')).toMatchObject({
      natureza: 'sistema',
      acoes: ['ler', 'exportar'],
    });
  });
});
