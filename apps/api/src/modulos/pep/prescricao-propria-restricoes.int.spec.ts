// Contrato de efeito das restrições próprias do hospital no apoio à decisão da prescrição (03-PEP L108) contra o
// MariaDB real (cliente de teste f22_o4 por padrão). Massa SINTÉTICA própria (estabelecimento c2104, login
// teste.c2104.a, códigos C2104*), limpa antes e depois (a trilha pelo utilitário comum). Prova o que fica no banco: a
// faixa de ajuste renal, a restrição de posologia do estabelecimento e a configuração do alerta no setor, cada uma com
// a trilha; desligar grava ativo = false e sobe a versão (nada é apagado); a regra do domínio, a versão velha e a
// configuração repetida no mesmo escopo recusam sem gravar; a leitura do motor resolve as linhas do princípio ativo
// para o item da prescrição e deixa de fora a desligada. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import {
  CadastroRestricoesPrescricaoPropria,
  lerRestricoesAlertas,
} from './prescricao-propria-restricoes.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST = 'c2104';
const LOGIN = 'teste.c2104.a';
const recusada = (codigo: string, status?: number) =>
  expect.objectContaining({ problema: expect.objectContaining({ codigo, ...(status ? { status } : {}) }) });

describe.skipIf(SEM_BANCO)('restrições da prescrição (banco próprio, MariaDB)', () => {
  let nucleo: NucleoProprio;
  let cad: CadastroRestricoesPrescricaoPropria;
  const ids = { est: 0, tipo: 0, item: 0, principio: 0, setor: 0, unidade: 0, cenario: 0, regra: 0 };

  const garantir = async (e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]) => {
    const l = await e.uma<{ id: number }>(sel, p);
    return l ? Number(l.id) : e.inserir(ins, pi);
  };
  const limpar = async (e: Escritor) => {
    await e.executar(
      `DELETE FROM configuracao_alerta_prescricao WHERE regra_alerta_id IN
         (SELECT id FROM (SELECT id FROM regra_alerta WHERE codigo LIKE 'C2104%') x)`,
      [],
    );
    await e.executar(`DELETE FROM restricao_posologia WHERE mensagem LIKE 'C2104 %'`, []);
    await e.executar(`DELETE FROM ajuste_dose_renal WHERE orientacao LIKE 'C2104 %'`, []);
    await limparTrilhaDaMassa(e, { codigos: [EST] });
  };
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'leitura-c2104' }, (l) =>
      l.consultar(sql, p),
    ) as Promise<T[]>;
  const um = async (sql: string, p: unknown[] = []) => (await ler(sql, p))[0] ?? null;
  const contar = async (sql: string, p: unknown[] = []) => Number((await um(sql, p))!['n']);
  const ctx = () => ({
    hospital: EST,
    login: LOGIN,
    correlacao: 'teste-c2104',
    chaveIdempotencia: `c2104-${randomUUID()}`,
  });
  const trilhas = () =>
    contar('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ?', [ids.est]);

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    cad = new CadastroRestricoesPrescricaoPropria(nucleo, CLIENTE);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-c2104' }, async (e) => {
      const agora = new Date();
      ids.est = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [EST],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [EST, `Hospital sintético ${EST}`, `Hospital sintético ${EST} (fictício)`, agora],
      );
      await limpar(e);
      await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        [LOGIN],
        'INSERT INTO usuario (login, nome, cpf, criado_em) VALUES (?, ?, ?, ?)',
        [LOGIN, `Conta sintética ${LOGIN}`, '21042104201', agora],
      );
      ids.tipo = await garantir(
        e,
        'SELECT id FROM tipo_item_prescricao WHERE codigo = ?',
        ['C2104MED'],
        "INSERT INTO tipo_item_prescricao (codigo, descricao, categoria, criado_em) VALUES ('C2104MED', 'Medicamento sintético c2104', 'medicamento', ?)",
        [agora],
      );
      ids.principio = await garantir(
        e,
        'SELECT id FROM principio_ativo WHERE codigo_dcb = ?',
        ['C2104PA'],
        "INSERT INTO principio_ativo (codigo_dcb, descricao, versao_fonte, criado_em) VALUES ('C2104PA', 'Princípio sintético c2104', 'teste', ?)",
        [agora],
      );
      ids.item = await garantir(
        e,
        'SELECT id FROM item_prescritivel WHERE codigo = ?',
        ['C2104IA'],
        'INSERT INTO item_prescritivel (codigo, descricao, tipo_item_prescricao_id, principio_ativo_id, criado_em) VALUES (?, ?, ?, ?, ?)',
        ['C2104IA', 'Item sintético C2104IA', ids.tipo, ids.principio, agora],
      );
      ids.setor = await garantir(
        e,
        'SELECT id FROM setor_funcional WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, 'C2104UTI'],
        "INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, 'C2104UTI', 'Setor sintético c2104', 'assistencial', ?)",
        [ids.est, agora],
      );
      ids.unidade = await garantir(
        e,
        'SELECT id FROM unidade_medida WHERE codigo = ?',
        ['C2104MG'],
        "INSERT INTO unidade_medida (codigo, descricao, sigla, criado_em) VALUES ('C2104MG', 'Miligrama sintético', 'mgc', ?)",
        [agora],
      );
      ids.cenario = await garantir(
        e,
        'SELECT id FROM cenario_alerta WHERE codigo = ?',
        ['c2104-renal'],
        "INSERT INTO cenario_alerta (codigo, descricao, verificador, criado_em) VALUES ('c2104-renal', 'Cenário sintético c2104', 'sintetico', ?)",
        [agora],
      );
      ids.regra = await garantir(
        e,
        'SELECT id FROM regra_alerta WHERE codigo = ?',
        ['C2104REGRA'],
        `INSERT INTO regra_alerta (codigo, nome, cenario_alerta_id, mensagem, vigencia_inicio, estabelecimento_id, criado_em)
         VALUES ('C2104REGRA', 'Regra sintética c2104', ?, 'Mensagem sintética', '2026-01-01', ?, ?)`,
        [ids.cenario, ids.est, agora],
      );
    });
  });

  afterAll(async () => {
    await nucleo?.escrever({ cliente: CLIENTE, correlacao: 'limpeza-c2104' }, limpar);
    await nucleo?.encerrar?.();
  });

  it('ajuste renal por faixa: grava com a trilha; desligar sobe a versão e fica no banco', async () => {
    const antes = await trilhas();
    const g = await cad.gravarAjusteRenal(ctx(), {
      principio: ids.principio,
      criterio: 'depuracao_creatinina',
      faixaMinima: 10,
      faixaMaxima: 30,
      ajuste: 'reduzir_dose',
      doseMaxima: 500,
      unidade: ids.unidade,
      comportamento: 'exigir_justificativa',
      orientacao: 'C2104 reduzir à metade',
    });
    const linha = await um('SELECT * FROM ajuste_dose_renal WHERE id = ?', [g.id]);
    expect(linha).toMatchObject({ criterio: 'depuracao_creatinina', ajuste: 'reduzir_dose', versao: 1 });
    expect(Number(linha!['principio_ativo_id'])).toBe(ids.principio);
    expect(await trilhas()).toBe(antes + 1);
    const d = await cad.gravarAjusteRenal(ctx(), {
      id: g.id,
      versao: 1,
      principio: ids.principio,
      criterio: 'depuracao_creatinina',
      faixaMinima: 10,
      faixaMaxima: 30,
      ajuste: 'reduzir_dose',
      doseMaxima: 500,
      unidade: ids.unidade,
      comportamento: 'exigir_justificativa',
      orientacao: 'C2104 reduzir à metade',
      ativo: false,
    });
    expect(d.versao).toBe(2);
    expect(
      await contar('SELECT COUNT(*) AS n FROM ajuste_dose_renal WHERE id = ? AND NOT ativo', [g.id]),
    ).toBe(1);
    // versão velha e regra do domínio recusam sem gravar
    await expect(
      cad.gravarAjusteRenal(ctx(), {
        id: g.id,
        versao: 1,
        principio: ids.principio,
        criterio: 'depuracao_creatinina',
        faixaMaxima: 30,
        ajuste: 'evitar',
        orientacao: 'C2104 reduzir à metade',
      }),
    ).rejects.toMatchObject({ problema: expect.objectContaining({ status: 409 }) });
    await expect(
      cad.gravarAjusteRenal(ctx(), {
        principio: ids.principio,
        criterio: 'depuracao_creatinina',
        faixaMinima: 40,
        faixaMaxima: 30,
        ajuste: 'reduzir_dose',
        doseMaxima: 1,
        unidade: ids.unidade,
        orientacao: 'C2104 invertida',
      }),
    ).rejects.toEqual(recusada('faixa-invertida', 422));
    expect(await contar("SELECT COUNT(*) AS n FROM ajuste_dose_renal WHERE orientacao LIKE 'C2104 %'")).toBe(
      1,
    );
  });

  it('restrição de posologia e configuração por setor; a leitura do motor resolve o princípio para o item', async () => {
    const antes = await trilhas();
    await cad.gravarAjusteRenal(ctx(), {
      item: ids.item,
      criterio: 'taxa_filtracao_glomerular',
      faixaMaxima: 15,
      ajuste: 'evitar',
      comportamento: 'bloquear',
      orientacao: 'C2104 evitar abaixo de 15',
    });
    const r = await cad.gravarRestricao(ctx(), {
      principio: ids.principio,
      setor: ids.setor,
      idadeMaximaDias: 365,
      tipo: 'dose_maxima',
      doseMaxima: 50,
      unidade: ids.unidade,
      acao: 'bloquear',
      mensagem: 'C2104 limite neonatal',
    });
    const lr = await um('SELECT * FROM restricao_posologia WHERE id = ?', [r.id]);
    expect(Number(lr!['estabelecimento_id'])).toBe(ids.est);
    expect(lr).toMatchObject({ tipo_restricao: 'dose_maxima', acao: 'bloquear' });
    await expect(
      cad.gravarRestricao(ctx(), {
        principio: ids.principio,
        tipo: 'via_proibida',
        mensagem: 'C2104 sem via',
      }),
    ).rejects.toEqual(recusada('via-obrigatoria', 422));
    const c = await cad.gravarConfiguracao(ctx(), {
      regra: ids.regra,
      setor: ids.setor,
      comportamento: 'bloqueio',
    });
    expect(
      await um('SELECT comportamento, setor_funcional_id FROM configuracao_alerta_prescricao WHERE id = ?', [
        c.id,
      ]),
    ).toMatchObject({ comportamento: 'bloqueio' });
    await expect(
      cad.gravarConfiguracao(ctx(), { regra: ids.regra, setor: ids.setor, comportamento: 'aviso' }),
    ).rejects.toEqual(recusada('configuracao-repetida', 409));
    expect(await trilhas()).toBe(antes + 3);

    const lido = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'leitura-c2104' }, (l) =>
      lerRestricoesAlertas(l, ids.est, 0, null, [{ produto: ids.item, principios: [ids.principio] }]),
    );
    // A faixa do princípio desligada no teste anterior fica de fora; a do item vale.
    expect(lido.ajustesRenais.map((x) => x.ajuste)).toEqual(['evitar']);
    expect(lido.ajustesRenais[0]!.produtos).toEqual([ids.item]);
    expect(lido.posologia).toHaveLength(1);
    expect(lido.posologia[0]).toMatchObject({ produtos: [ids.item], setor: ids.setor, doseMaxima: 50 });
    expect(lido.configuracoes.find((x) => x.id === c.id)).toMatchObject({
      tipo: 'c2104-renal',
      setor: ids.setor,
      comportamento: 'bloqueio',
      ativo: true,
    });
    const tela = await cad.cadastro({ hospital: EST, login: LOGIN });
    expect(tela.restricoes.some((x) => x.id === r.id)).toBe(true);
    expect(tela.apoio.setores.some((s) => s.id === ids.setor)).toBe(true);
  });
});
