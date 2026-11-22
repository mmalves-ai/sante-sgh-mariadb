// A mesma bateria da fonte de configuração em memória e no MariaDB real (cliente f22_o1, banco cliente_f22_o1, criado
// por `python3 -I tools/db/criar_cliente.py f22_o1 "Teste F2.2 onda 1"`). Massa sintética própria do lote (códigos
// f22o103*), montada no beforeAll e limpa no afterAll; nenhum dado real. SGH_NUCLEO_SEM_BANCO=1 pula a parte do banco.
// As chaves de liberação no banco dependem das tabelas pedidas ao integrador (liberacao_chave, liberacao_lote,
// recurso_prerequisito): sem elas, esses casos ficam pulados (aviso no relatório do lote).
import { randomUUID } from 'node:crypto';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { type FonteConfiguracao, fonteConfiguracaoMemoria, type TrilhaConfig } from './configuracao-fonte.js';
import { FonteConfiguracaoPropria } from './configuracao-propria.js';
import { falhaDaConfiguracao } from './falha-configuracao.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o1';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const H = 'f22o103a';
const OUTRO = 'f22o103b';
const LOGIN = 'f22o103.servico';
const PARAM = 'f22o103.limite';
const MODULO = 'f22o103';

const trilha = (chaveIdempotencia: string = `f22o103-${randomUUID()}`): TrilhaConfig => ({
  rede: 'rede-teste',
  hospital: H,
  usuario: LOGIN,
  evento: 'config.parametro.definido',
  recurso: 'config.parametro',
  operacao: 'config.definirParametro',
  chaveNaturalAlvo: null,
  resultado: 'sucesso',
  estacao: 'TESTE:127.0.0.1',
  correlacao: 'teste-f22-0103',
  chaveIdempotencia,
});

const nova = (valor: string, alvo = H) => ({
  chave: PARAM,
  nivel: 'estabelecimento' as const,
  alvo,
  valor,
  vigenteDesde: '',
  vigenteAte: null,
  justificativa: 'Teste do contrato de efeito',
  autor: LOGIN,
});

/** A falha como a API a devolve: status e código. */
async function falha(p: Promise<unknown>): Promise<{ status: number; codigo: unknown }> {
  try {
    await p;
  } catch (e) {
    const x = falhaDaConfiguracao(e, 'teste', 'não gravado');
    return { status: x.getStatus(), codigo: x.extras['codigo'] };
  }
  throw new Error('era para recusar');
}

let nucleo: NucleoProprio | null = null;
let tabelasLiberacao = false;
let idUsuario = 0;

async function preparar(): Promise<void> {
  nucleo = new NucleoProprio();
  expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
  await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-f22-0103' }, async (e) => {
    const agora = new Date();
    for (const codigo of [H, OUTRO])
      if (!(await e.uma('SELECT id FROM estabelecimento WHERE codigo = ?', [codigo])))
        await e.inserir(
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `Hospital sintético ${codigo}`, `Hospital sintético ${codigo} (fictício)`, agora],
        );
    const u = await e.uma<{ id: number }>('SELECT id FROM usuario WHERE login = ?', [LOGIN]);
    idUsuario = u
      ? Number(u.id)
      : await e.inserir(
          "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, 'Conta de serviço sintética', 'servico', ?)",
          [LOGIN, agora],
        );
    let m = await e.uma<{ id: number }>('SELECT id FROM modulo_sistema WHERE codigo = ?', [MODULO]);
    const modulo = m
      ? Number(m.id)
      : await e.inserir('INSERT INTO modulo_sistema (codigo, descricao, criado_em) VALUES (?, ?, ?)', [
          MODULO,
          'Módulo sintético do lote 01-03',
          agora,
        ]);
    m = await e.uma('SELECT id FROM parametro_definicao WHERE chave = ?', [PARAM]);
    if (!m)
      await e.inserir(
        `INSERT INTO parametro_definicao (chave, modulo_sistema_id, descricao, tipo, valor_padrao, permite_rede,
           permite_estabelecimento, criado_em) VALUES (?, ?, 'Limite sintético', 'inteiro', '10', TRUE, TRUE, ?)`,
        [PARAM, modulo, agora],
      );
    const t = await e.uma<{ n: number }>(
      `SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN ('liberacao_chave', 'liberacao_lote', 'recurso_prerequisito')`,
    );
    tabelasLiberacao = Number(t?.n) === 3;
  });
  await limparValores();
}

async function limparValores(): Promise<void> {
  await nucleo!.escrever({ cliente: CLIENTE, correlacao: 'limpeza-f22-0103' }, async (e) => {
    const est = (
      await e.consultar<{ id: number }>('SELECT id FROM estabelecimento WHERE codigo IN (?, ?)', [H, OUTRO])
    ).map((x) => Number(x.id));
    await e.executar(
      `DELETE h FROM parametro_valor_historico h JOIN parametro_valor v ON v.id = h.parametro_valor_id
        JOIN parametro_definicao d ON d.id = v.parametro_definicao_id WHERE d.chave = ?`,
      [PARAM],
    );
    await e.executar(
      'DELETE v FROM parametro_valor v JOIN parametro_definicao d ON d.id = v.parametro_definicao_id WHERE d.chave = ?',
      [PARAM],
    );
    if (tabelasLiberacao && est.length) {
      const m = est.map(() => '?').join(', ');
      await e.executar(`DELETE FROM liberacao_chave WHERE estabelecimento_id IN (${m})`, est);
      await e.executar(`DELETE FROM liberacao_lote WHERE estabelecimento_id IN (${m})`, est);
      await e.executar(`DELETE FROM recurso_prerequisito WHERE estabelecimento_id IN (${m})`, est);
      await e.executar(
        `DELETE FROM sequencia_negocio WHERE tipo = 'liberacao_lote' AND estabelecimento_id IN (${m})`,
        est,
      );
    }
    if (idUsuario) {
      await e.executar('DELETE FROM idempotencia_operacao WHERE usuario_id = ?', [idUsuario]);
      await e.executar('DELETE FROM trilha_auditoria WHERE usuario_id = ?', [idUsuario]);
    }
  });
}

const fabricas: [string, () => FonteConfiguracao][] = [
  ['memória', () => fonteConfiguracaoMemoria(new RegistradorTrilhaMemoria())],
  ...(SEM_BANCO
    ? []
    : ([['banco', () => new FonteConfiguracaoPropria(nucleo!, CLIENTE)]] as [
        string,
        () => FonteConfiguracao,
      ][])),
];

beforeAll(async () => {
  if (!SEM_BANCO) await preparar();
});

afterAll(async () => {
  if (!nucleo) return;
  await limparValores();
  await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-f22-0103' }, async (e) => {
    await e.executar('DELETE FROM parametro_definicao WHERE chave = ?', [PARAM]);
    await e.executar('DELETE FROM modulo_sistema WHERE codigo = ?', [MODULO]);
    await e.executar('DELETE FROM usuario WHERE login = ?', [LOGIN]);
    await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', [H, OUTRO]);
  });
});

describe.each(fabricas)('fonte de configuração (%s): parâmetros', (nome, criar) => {
  let fonte: FonteConfiguracao;
  let id1 = '';
  let id2 = '';

  beforeAll(async () => {
    fonte = criar();
    if (nome === 'banco') await limparValores();
  });

  it('define o valor e, na nova definição, fecha a versão anterior do mesmo nível e alvo', async () => {
    id1 = (await fonte.definirParametro({ rede: 'r', hospital: H, fechar: [], nova: nova('20') }, trilha()))
      .id;
    id2 = (
      await fonte.definirParametro({ rede: 'r', hospital: H, fechar: [id1], nova: nova('30') }, trilha())
    ).id;
    const v = (await fonte.valoresParametro('rede-teste', H)).filter((x) => x.chave === PARAM);
    const primeiro = v.find((x) => x.id === id1)!;
    const segundo = v.find((x) => x.id === id2)!;
    expect(primeiro.vigenteAte).not.toBeNull();
    expect(segundo).toMatchObject({ valor: '30', vigenteAte: null, nivel: 'estabelecimento', alvo: H });
    expect(segundo.justificativa).toBe('Teste do contrato de efeito');
  });

  it('recusa a definição concorrente (as vigentes relidas não são as do plano): 409 conflito-concorrente', async () => {
    const r = await falha(
      fonte.definirParametro({ rede: 'r', hospital: H, fechar: [], nova: nova('40') }, trilha()),
    );
    expect(r).toEqual({ status: 409, codigo: 'conflito-concorrente' });
    const vigentes = (await fonte.valoresParametro('r', H)).filter((x) => x.chave === PARAM && !x.vigenteAte);
    expect(vigentes.map((x) => x.id)).toEqual([id2]);
  });

  it('retira a sobreposição: a vigente fecha com o motivo e o nível volta a herdar', async () => {
    const r = await fonte.retirarParametro(
      {
        rede: 'r',
        hospital: H,
        chave: PARAM,
        nivel: 'estabelecimento',
        alvo: H,
        fechar: [id2],
        motivo: 'Volta ao valor da rede',
        por: LOGIN,
      },
      trilha(),
    );
    expect(r.fechadas).toEqual([id2]);
    const v = (await fonte.valoresParametro('r', H)).find((x) => x.id === id2)!;
    expect(v.vigenteAte).not.toBeNull();
    expect(v.retiradaMotivo).toBe('Volta ao valor da rede');
  });

  it('retirada sem vigente é recusada (409)', async () => {
    const r = await falha(
      fonte.retirarParametro(
        {
          rede: 'r',
          hospital: H,
          chave: PARAM,
          nivel: 'estabelecimento',
          alvo: H,
          fechar: [],
          motivo: 'x'.repeat(12),
          por: LOGIN,
        },
        trilha(),
      ),
    );
    expect(r.status).toBe(409);
  });
});

describe.each(fabricas)('fonte de configuração (%s): chaves de liberação', (nome, criar) => {
  let fonte: FonteConfiguracao;
  let lote = '';
  const pular = (ctx: { skip: () => void }) => {
    if (nome === 'banco' && !tabelasLiberacao) ctx.skip();
  };

  beforeAll(() => {
    fonte = criar();
  });

  it('liga a chave para o estabelecimento num lote; o lote lista as linhas', async (ctx) => {
    pular(ctx);
    const [r] = await fonte.aplicarLotes(
      'r',
      [
        {
          hospital: H,
          tipo: 'recurso',
          chave: 'f22o103.recurso',
          planejar: () => [{ escopo: 'hospital', valor: '*', ligada: true, antes: null }],
          justificativa: 'Ligar no estabelecimento sintético',
          autor: LOGIN,
        },
      ],
      trilha(),
    );
    lote = r!.lote;
    expect(r!.alteradas).toBe(1);
    const chaves = (await fonte.chaves('r', H)).filter((c) => c.chave === 'f22o103.recurso');
    expect(chaves).toHaveLength(1);
    expect(chaves[0]).toMatchObject({
      escopo: 'hospital',
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote,
    });
    expect(await fonte.lote('r', H, lote)).toHaveLength(1);
    expect(await fonte.chaves('r', OUTRO)).toEqual([]);
  });

  it('a recusa do plano volta como foi lançada e nada é gravado', async (ctx) => {
    pular(ctx);
    const recusa = new ErroProblema('recusa-de-negocio', 409, 'Falta pré-requisito', 'falta', {
      codigo: 'x',
    });
    await expect(
      fonte.aplicarLote(
        'r',
        {
          hospital: H,
          tipo: 'recurso',
          chave: 'f22o103.recurso',
          planejar: () => {
            throw recusa;
          },
          justificativa: 'Tentativa recusada',
          autor: LOGIN,
        },
        trilha(),
      ),
    ).rejects.toBe(recusa);
    const chaves = (await fonte.chaves('r', H)).filter((c) => c.chave === 'f22o103.recurso');
    expect(chaves[0]!.lote).toBe(lote);
  });

  it('chave com o nome de outra de outro tipo é recusada (409 chave-de-outro-tipo)', async (ctx) => {
    pular(ctx);
    const r = await falha(
      fonte.aplicarLote(
        'r',
        {
          hospital: H,
          tipo: 'operacao',
          chave: 'f22o103.recurso',
          planejar: () => [{ escopo: 'hospital', valor: '*', ligada: true, antes: null }],
          justificativa: 'Outro tipo',
          autor: LOGIN,
        },
        trilha(),
      ),
    );
    expect(r).toEqual({ status: 409, codigo: 'chave-de-outro-tipo' });
  });

  it('registra o pré-requisito do recurso (inclui e depois atualiza a mesma linha)', async (ctx) => {
    pular(ctx);
    const p = {
      hospital: H,
      recurso: 'f22o103.recurso',
      tipo: 'aprovacao' as const,
      situacao: 'pendente' as const,
      validade: null,
      evidencia: null,
      autor: LOGIN,
    };
    await fonte.gravarPrerequisito('r', p, trilha());
    await fonte.gravarPrerequisito(
      'r',
      { ...p, situacao: 'cumprido', validade: '2030-12-31', evidencia: 'ata 1' },
      trilha(),
    );
    const lidos = (await fonte.prerequisitos('r', H)).filter((x) => x.recurso === 'f22o103.recurso');
    expect(lidos).toHaveLength(1);
    expect(lidos[0]).toMatchObject({ situacao: 'cumprido', validade: '2030-12-31', evidencia: 'ata 1' });
  });
});

describe.skipIf(SEM_BANCO)('fonte própria de configuração: contrato de efeito no banco', () => {
  let fonte: FonteConfiguracaoPropria;

  beforeAll(async () => {
    fonte = new FonteConfiguracaoPropria(nucleo!, CLIENTE);
    await limparValores();
  });

  it('a definição deixa o valor, o histórico, a trilha e a idempotência na mesma transação; a repetição não grava de novo', async () => {
    const chave = `f22o103-${randomUUID()}`;
    const { id } = await fonte.definirParametro(
      { rede: 'r', hospital: H, fechar: [], nova: nova('50') },
      trilha(chave),
    );
    const repetida = await fonte.definirParametro(
      { rede: 'r', hospital: H, fechar: [], nova: nova('50') },
      trilha(chave),
    );
    expect(repetida.id).toBe(id);
    const efeito = await nucleo!.lerSomente(
      { cliente: CLIENTE, correlacao: 'conferencia-f22-0103' },
      async (l) => ({
        valor: await l.uma(
          'SELECT nivel, valor, versao, vigencia_fim, criado_por, motivo FROM parametro_valor WHERE id = ?',
          [Number(id)],
        ),
        historico: await l.consultar(
          'SELECT operacao, valor_anterior, valor_novo, usuario_id FROM parametro_valor_historico WHERE parametro_valor_id = ?',
          [Number(id)],
        ),
        trilha: await l.consultar(
          "SELECT acao, entidade FROM trilha_auditoria WHERE entidade = 'parametro_valor' AND entidade_id = ?",
          [Number(id)],
        ),
        idempotencia: await l.consultar(
          "SELECT operacao FROM idempotencia_operacao WHERE operacao = 'config.parametro.definir' AND chave = ?",
          [chave],
        ),
      }),
    );
    expect(efeito.valor).toMatchObject({
      nivel: 'estabelecimento',
      valor: '50',
      versao: 1,
      vigencia_fim: null,
    });
    expect(Number(efeito.valor?.['criado_por'])).toBe(idUsuario);
    expect(efeito.historico).toHaveLength(1);
    expect(efeito.historico[0]).toMatchObject({
      operacao: 'inclusao',
      valor_novo: '50',
      valor_anterior: null,
    });
    expect(efeito.trilha).toHaveLength(1);
    expect(efeito.idempotencia).toHaveLength(1);
  });

  it('o fechamento sobe a versão da linha fechada (trava otimista) e o histórico guarda o valor anterior', async () => {
    const [vig] = (await fonte.valoresParametro('r', H)).filter((x) => x.chave === PARAM && !x.vigenteAte);
    const { id } = await fonte.definirParametro(
      { rede: 'r', hospital: H, fechar: [vig!.id], nova: nova('60') },
      trilha(),
    );
    const e = await nucleo!.lerSomente(
      { cliente: CLIENTE, correlacao: 'conferencia-f22-0103' },
      async (l) => ({
        fechada: await l.uma('SELECT versao, vigencia_fim FROM parametro_valor WHERE id = ?', [
          Number(vig!.id),
        ]),
        hist: await l.uma(
          'SELECT valor_anterior FROM parametro_valor_historico WHERE parametro_valor_id = ?',
          [Number(id)],
        ),
      }),
    );
    expect(e.fechada?.['versao']).toBe(2);
    expect(e.fechada?.['vigencia_fim']).not.toBeNull();
    expect(e.hist?.['valor_anterior']).toBe('50');
  });

  it('alvo de outro estabelecimento é recusado (409 alvo-inexistente) e nada é gravado', async () => {
    const antes = (await fonte.valoresParametro('r', H)).length;
    const r = await falha(
      fonte.definirParametro({ rede: 'r', hospital: H, fechar: [], nova: nova('70', OUTRO) }, trilha()),
    );
    expect(r).toEqual({ status: 409, codigo: 'alvo-inexistente' });
    expect((await fonte.valoresParametro('r', H)).length).toBe(antes);
    expect(await fonte.valoresParametro('r', OUTRO)).toEqual([]);
  });

  it('parâmetro fora do cadastro do cliente é recusado (409 parametro-nao-carregado)', async () => {
    const r = await falha(
      fonte.definirParametro(
        { rede: 'r', hospital: H, fechar: [], nova: { ...nova('1'), chave: 'f22o103.inexistente' } },
        trilha(),
      ),
    );
    expect(r).toEqual({ status: 409, codigo: 'parametro-nao-carregado' });
  });

  it('entrada inválida é recusada antes de gravar (400)', async () => {
    const r = await falha(
      fonte.definirParametro({ rede: 'r', hospital: H, fechar: ['abc'], nova: nova('1') }, trilha()),
    );
    expect(r.status).toBe(400);
  });

  it('a montagem confere as tabelas do modelo: sem as da liberação, recusa com os nomes que faltam', async () => {
    if (tabelasLiberacao)
      await expect(FonteConfiguracaoPropria.conferirModelo(nucleo!, CLIENTE)).resolves.toBeUndefined();
    else
      await expect(FonteConfiguracaoPropria.conferirModelo(nucleo!, CLIENTE)).rejects.toThrow(
        /liberacao_chave, liberacao_lote, recurso_prerequisito/,
      );
  });

  it('o lote deixa a chave, o lote numerado pela sequência, a versão e a trilha; o segundo lote sobe a versão', async (ctx) => {
    if (!tabelasLiberacao) ctx.skip();
    const pedido = (ligada: boolean) => ({
      hospital: H,
      tipo: 'operacao' as const,
      chave: 'f22o103.operacao',
      planejar: () => [{ escopo: 'hospital' as const, valor: '*', ligada, antes: ligada ? null : true }],
      justificativa: 'Contrato de efeito do lote',
      autor: LOGIN,
    });
    const [a] = await fonte.aplicarLotes('r', [pedido(true)], trilha());
    const [b] = await fonte.aplicarLotes('r', [pedido(false)], trilha());
    expect(Number(b!.lote)).toBe(Number(a!.lote) + 1);
    const e = await nucleo!.lerSomente(
      { cliente: CLIENTE, correlacao: 'conferencia-f22-0103' },
      async (l) => ({
        chave: await l.consultar(
          `SELECT c.ligada, c.ligada_antes, c.versao, l.numero FROM liberacao_chave c
           JOIN liberacao_lote l ON l.id = c.liberacao_lote_id
           JOIN estabelecimento s ON s.id = c.estabelecimento_id
          WHERE s.codigo = ? AND c.chave = 'f22o103.operacao'`,
          [H],
        ),
        lotes: await l.consultar(
          `SELECT l.numero, l.alteradas, l.justificativa FROM liberacao_lote l JOIN estabelecimento s ON s.id = l.estabelecimento_id
          WHERE s.codigo = ? AND l.chave = 'f22o103.operacao' ORDER BY l.numero`,
          [H],
        ),
        sequencia: await l.uma(
          `SELECT q.proximo_valor FROM sequencia_negocio q JOIN estabelecimento s ON s.id = q.estabelecimento_id
          WHERE s.codigo = ? AND q.tipo = 'liberacao_lote'`,
          [H],
        ),
        trilha: await l.consultar(
          "SELECT acao FROM trilha_auditoria WHERE entidade = 'liberacao_lote' AND usuario_id = ?",
          [idUsuario],
        ),
      }),
    );
    expect(e.chave).toHaveLength(1);
    expect(e.chave[0]).toMatchObject({ versao: 2 });
    expect(Boolean(e.chave[0]!['ligada'])).toBe(false);
    expect(Boolean(e.chave[0]!['ligada_antes'])).toBe(true);
    expect(Number(e.chave[0]!['numero'])).toBe(Number(b!.lote));
    expect(e.lotes.map((x) => Number(x['numero']))).toEqual([Number(a!.lote), Number(b!.lote)]);
    expect(e.lotes.every((x) => Number(x['alteradas']) === 1)).toBe(true);
    expect(Number(e.sequencia?.['proximo_valor'])).toBeGreaterThan(Number(b!.lote));
    expect(e.trilha.length).toBeGreaterThanOrEqual(2);
  });

  it('a recusa do plano não deixa lote, chave, trilha nem sequência consumida', async (ctx) => {
    if (!tabelasLiberacao) ctx.skip();
    const contar = () =>
      nucleo!.lerSomente({ cliente: CLIENTE, correlacao: 'conferencia-f22-0103' }, async (l) => ({
        lotes: Number(
          (await l.uma("SELECT COUNT(*) AS n FROM liberacao_lote WHERE chave = 'f22o103.recusa'"))?.['n'],
        ),
        chaves: Number(
          (await l.uma("SELECT COUNT(*) AS n FROM liberacao_chave WHERE chave = 'f22o103.recusa'"))?.['n'],
        ),
      }));
    const recusa = new ErroProblema('recusa-de-negocio', 409, 'Recusado', 'recusado', { codigo: 'x' });
    await expect(
      fonte.aplicarLote(
        'r',
        {
          hospital: H,
          tipo: 'recurso',
          chave: 'f22o103.recusa',
          planejar: () => {
            throw recusa;
          },
          justificativa: 'Recusa',
          autor: LOGIN,
        },
        trilha(),
      ),
    ).rejects.toBe(recusa);
    expect(await contar()).toEqual({ lotes: 0, chaves: 0 });
  });

  it('o pré-requisito incluído e depois atualizado fica numa linha com a versão 2', async (ctx) => {
    if (!tabelasLiberacao) ctx.skip();
    const p = {
      hospital: H,
      recurso: 'f22o103.prerequisito',
      tipo: 'contrato' as const,
      situacao: 'pendente' as const,
      validade: null,
      evidencia: null,
      autor: LOGIN,
    };
    await fonte.gravarPrerequisito('r', p, trilha());
    await fonte.gravarPrerequisito('r', { ...p, situacao: 'dispensado' }, trilha());
    const linhas = await nucleo!.lerSomente({ cliente: CLIENTE, correlacao: 'conferencia-f22-0103' }, (l) =>
      l.consultar("SELECT situacao, versao FROM recurso_prerequisito WHERE recurso = 'f22o103.prerequisito'"),
    );
    expect(linhas).toEqual([{ situacao: 'dispensado', versao: 2 }]);
  });

  it('o relógio é o do banco', async () => {
    const h = await fonte.relogio('r', H);
    expect(Math.abs(h.getTime() - Date.now())).toBeLessThan(60_000);
  });
});
