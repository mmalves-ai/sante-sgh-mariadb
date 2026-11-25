// Contrato de efeito do cadastro editável do catálogo da prescrição (03-PEP L106, C1-115) contra o MariaDB real
// (cliente de teste f22_o4 por padrão). Massa SINTÉTICA própria (estabelecimento c1115, login teste.c1115.a, códigos
// C1115*), limpa antes e depois (a trilha pelo utilitário comum). Prova o que fica no banco: a frequência com os dias
// e a lista de setores (o setor tirado fica marcado excluído, não apagado), a condição "se necessário" com o disparo
// pelo sinal vital, o item não padronizado com código NP, vias e justificativa (tirar de uso só marca), e os
// complementos do item (frequência aceita, regra no setor, sinônimo com sequência, par conflitante) com a retirada que
// marca e a reinclusão que reaproveita a linha; cada gravação com a trilha; as recusas sem gravar nada.
// SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { CadastroCatalogoPrescricaoPropria } from './prescricao-propria-cadastro.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST = 'c1115';
const LOGIN = 'teste.c1115.a';
const recusada = (codigo: string, status?: number) => ({
  problema: expect.objectContaining({ codigo, ...(status ? { status } : {}) }),
});

describe.skipIf(SEM_BANCO)('cadastro editável do catálogo da prescrição (banco próprio, MariaDB)', () => {
  let nucleo: NucleoProprio;
  let cad: CadastroCatalogoPrescricaoPropria;
  const ids = {
    est: 0,
    setorA: 0,
    setorB: 0,
    tipo: 0,
    unidade: 0,
    viaA: 0,
    viaB: 0,
    param: 0,
    itemA: 0,
    itemB: 0,
  };

  const garantir = async (e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]) => {
    const l = await e.uma<{ id: number }>(sel, p);
    return l ? Number(l.id) : e.inserir(ins, pi);
  };
  const limpar = async (e: Escritor) => {
    const itens = `SELECT id FROM item_prescritivel WHERE codigo LIKE 'C1115%' OR descricao LIKE 'C1115 %'`;
    for (const t of ['item_prescritivel_frequencia', 'item_prescritivel_sinonimo', 'item_prescritivel_via'])
      await e.executar(`DELETE FROM ${t} WHERE item_prescritivel_id IN (SELECT id FROM (${itens}) x)`, []);
    await e.executar(
      `DELETE FROM item_prescritivel_conflito WHERE item_prescritivel_id IN (SELECT id FROM (${itens}) x)
          OR conflitante_item_prescritivel_id IN (SELECT id FROM (${itens}) y)`,
      [],
    );
    await e.executar('DELETE FROM item_prescritivel_setor WHERE estabelecimento_id = ?', [ids.est]);
    await e.executar(
      "DELETE FROM item_prescritivel WHERE descricao LIKE 'C1115 %' AND codigo LIKE 'NP-%'",
      [],
    );
    await e.executar(
      `DELETE s FROM frequencia_administracao_setor s JOIN frequencia_administracao f
          ON f.id = s.frequencia_administracao_id WHERE f.codigo LIKE 'C1115%'`,
      [],
    );
    await e.executar("DELETE FROM frequencia_administracao WHERE codigo LIKE 'C1115%'", []);
    await e.executar("DELETE FROM condicao_se_necessario WHERE codigo LIKE 'C1115%'", []);
    await limparTrilhaDaMassa(e, { codigos: [EST] });
  };
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'leitura-c1115' }, (l) =>
      l.consultar(sql, p),
    ) as Promise<T[]>;
  const um = async (sql: string, p: unknown[] = []) => (await ler(sql, p))[0] ?? null;
  const ctx = () => ({
    hospital: EST,
    login: LOGIN,
    correlacao: 'teste-c1115',
    chaveIdempotencia: `c1115-${randomUUID()}`,
  });
  const leitura = { hospital: EST, login: LOGIN };
  const trilhas = async () =>
    Number(
      (await um('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ?', [ids.est]))!['n'],
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    cad = new CadastroCatalogoPrescricaoPropria(nucleo, CLIENTE);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-c1115' }, async (e) => {
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
        [LOGIN, `Conta sintética ${LOGIN}`, '11511511501', agora],
      );
      const setor = (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM setor_funcional WHERE estabelecimento_id = ? AND codigo = ?',
          [ids.est, codigo],
          "INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, ?, 'assistencial', ?)",
          [ids.est, codigo, `Setor sintético ${codigo}`, agora],
        );
      ids.setorA = await setor('C1115SA');
      ids.setorB = await setor('C1115SB');
      ids.tipo = await garantir(
        e,
        'SELECT id FROM tipo_item_prescricao WHERE codigo = ?',
        ['C1115MED'],
        "INSERT INTO tipo_item_prescricao (codigo, descricao, categoria, criado_em) VALUES ('C1115MED', 'Medicamento sintético c1115', 'medicamento', ?)",
        [agora],
      );
      ids.unidade = await garantir(
        e,
        'SELECT id FROM unidade_prescricao WHERE codigo = ?',
        ['C1115MG'],
        `INSERT INTO unidade_prescricao (codigo, descricao, sigla, criado_em) VALUES ('C1115MG', 'Miligrama sintético', 'mgc', ?)`,
        [agora],
      );
      const via = (codigo: string, sigla: string) =>
        garantir(
          e,
          'SELECT id FROM via_de_uso WHERE codigo = ?',
          [codigo],
          'INSERT INTO via_de_uso (codigo, descricao, sigla, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `Via sintética ${codigo}`, sigla, agora],
        );
      ids.viaA = await via('C1115VA', 'c1a');
      ids.viaB = await via('C1115VB', 'c1b');
      ids.param = await garantir(
        e,
        'SELECT id FROM parametro_vital WHERE codigo = ?',
        ['C1115TAX'],
        "INSERT INTO parametro_vital (codigo, descricao, criado_em) VALUES ('C1115TAX', 'Temperatura sintética', ?)",
        [agora],
      );
      const item = (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM item_prescritivel WHERE codigo = ?',
          [codigo],
          'INSERT INTO item_prescritivel (codigo, descricao, tipo_item_prescricao_id, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `Item sintético ${codigo}`, ids.tipo, agora],
        );
      ids.itemA = await item('C1115IA');
      ids.itemB = await item('C1115IB');
    });
  });

  afterAll(async () => {
    await nucleo?.escrever({ cliente: CLIENTE, correlacao: 'limpeza-c1115' }, limpar);
    await nucleo?.encerrar?.();
  });

  it('frequência: grava tipo, dias e setores; a alteração marca o setor tirado sem apagar', async () => {
    const antes = await trilhas();
    const r = await cad.gravarFrequencia(ctx(), {
      codigo: 'c1115 6/6h',
      descricao: 'C1115 de 6 em 6 horas',
      descricaoResumida: '6/6h',
      tipo: 'intervalo',
      intervaloMinutos: 360,
      horarioFixo: true,
      escopoSetor: 'somente_listados',
      setores: [ids.setorA, ids.setorB],
    });
    const f = await um('SELECT * FROM frequencia_administracao WHERE id = ?', [r.id]);
    expect(f).toMatchObject({
      codigo: 'C1115_6/6H',
      tipo: 'intervalo',
      intervalo_minutos: 360,
      escopo_setor: 'somente_listados',
    });
    expect(Number(f!['horario_fixo'])).toBe(1);
    expect(f!['criado_por']).not.toBeNull();
    expect(
      await ler(
        'SELECT setor_funcional_id FROM frequencia_administracao_setor WHERE frequencia_administracao_id = ? AND excluido_em IS NULL',
        [r.id],
      ),
    ).toHaveLength(2);

    const r2 = await cad.gravarFrequencia(ctx(), {
      id: r.id,
      versao: 1,
      codigo: 'C1115_6/6H',
      descricao: 'C1115 de 6 em 6 horas',
      descricaoResumida: '6/6h',
      tipo: 'intervalo',
      intervaloMinutos: 360,
      escopoSetor: 'somente_listados',
      setores: [ids.setorA],
    });
    expect(r2).toEqual({ id: r.id, versao: 2 });
    const ss = await ler<{ s: number; excluido_em: unknown; excluido_por: unknown }>(
      'SELECT setor_funcional_id AS s, excluido_em, excluido_por FROM frequencia_administracao_setor WHERE frequencia_administracao_id = ? ORDER BY setor_funcional_id',
      [r.id],
    );
    expect(ss).toHaveLength(2);
    const tirado = ss.find((x) => Number(x.s) === ids.setorB)!;
    expect(tirado.excluido_em).not.toBeNull();
    expect(tirado.excluido_por).not.toBeNull();
    const lida = (await cad.frequencias(leitura)).find((x) => x.id === r.id)!;
    expect(lida.setores).toEqual([ids.setorA]);
    expect(lida.dias).toHaveLength(7);
    expect(await trilhas()).toBeGreaterThanOrEqual(antes + 2);

    await expect(
      cad.gravarFrequencia(ctx(), { codigo: 'c1115_6/6h', descricao: 'Repetida', tipo: 'continuo' }),
    ).rejects.toMatchObject(recusada('codigo-repetido', 409));
    await expect(
      cad.gravarFrequencia(ctx(), { codigo: 'C1115X', descricao: 'Sem dias', tipo: 'dias_semana' }),
    ).rejects.toMatchObject(recusada('dias-obrigatorios', 422));
    await expect(
      cad.gravarFrequencia(ctx(), {
        id: r.id,
        versao: 1,
        codigo: 'C1115_6/6H',
        descricao: 'Velha',
        tipo: 'continuo',
      }),
    ).rejects.toMatchObject(recusada('conflito-versao'));
    expect(await ler("SELECT id FROM frequencia_administracao WHERE codigo LIKE 'C1115%'")).toHaveLength(1);
  });

  it('frequência por dias da semana grava só os dias marcados', async () => {
    const r = await cad.gravarFrequencia(ctx(), {
      codigo: 'C1115SEG',
      descricao: 'C1115 segunda e quinta',
      tipo: 'dias_semana',
      dias: ['segunda', 'quinta'],
    });
    const f = await um('SELECT domingo, segunda, terca, quinta FROM frequencia_administracao WHERE id = ?', [
      r.id,
    ]);
    expect([f!['domingo'], f!['segunda'], f!['terca'], f!['quinta']].map(Number)).toEqual([0, 1, 0, 1]);
  });

  it('condição se necessário: disparo pelo sinal vital com parâmetro e limiar; tirar de uso só marca', async () => {
    await expect(
      cad.gravarCondicao(ctx(), {
        codigo: 'C1115FEB',
        descricao: 'Febre',
        parametroVital: ids.param,
        limiar: null,
      }),
    ).rejects.toMatchObject(recusada('disparo-incompleto', 422));
    const r = await cad.gravarCondicao(ctx(), {
      codigo: 'c1115feb',
      descricao: 'C1115 febre',
      parametroVital: ids.param,
      limiar: 37.8,
    });
    expect(
      await um('SELECT codigo, parametro_vital_id, limiar, ativo FROM condicao_se_necessario WHERE id = ?', [
        r.id,
      ]),
    ).toMatchObject({
      codigo: 'C1115FEB',
      parametro_vital_id: ids.param,
    });
    const r2 = await cad.gravarCondicao(ctx(), {
      id: r.id,
      versao: 1,
      codigo: 'C1115FEB',
      descricao: 'C1115 febre',
      parametroVital: ids.param,
      limiar: 37.8,
      ativo: false,
    });
    expect(r2.versao).toBe(2);
    const lida = (await cad.condicoes(leitura)).find((x) => x.id === r.id)!;
    expect(lida).toMatchObject({ ativo: false, limiar: 37.8, parametro: 'Temperatura sintética' });
  });

  it('item não padronizado: código NP, vias, justificativa; tirar de uso não apaga', async () => {
    await expect(
      cad.incluirNaoPadronizado(ctx(), {
        descricao: 'C1115 sem via',
        tipoItem: ids.tipo,
        unidade: ids.unidade,
        vias: [],
        justificativa: 'curta',
      }),
    ).rejects.toMatchObject(recusada('via-obrigatoria', 422));
    const r = await cad.incluirNaoPadronizado(ctx(), {
      descricao: 'C1115 colírio trazido de casa',
      tipoItem: ids.tipo,
      unidade: ids.unidade,
      vias: [ids.viaA, ids.viaB],
      justificativa: 'Paciente em uso domiciliar contínuo',
    });
    const i = await um(
      'SELECT codigo, padronizado, ativo, observacao, via_de_uso_id FROM item_prescritivel WHERE id = ?',
      [r.id],
    );
    expect(String(i!['codigo'])).toMatch(/^NP-\d{6}$/);
    expect(Number(i!['padronizado'])).toBe(0);
    expect(i!['via_de_uso_id']).toBe(ids.viaA);
    expect(i!['observacao']).toBe('Paciente em uso domiciliar contínuo');
    expect(
      await ler('SELECT id FROM item_prescritivel_via WHERE item_prescritivel_id = ?', [r.id]),
    ).toHaveLength(2);
    const s = await cad.situacaoNaoPadronizado(ctx(), r.id, { versao: 1, ativo: false });
    expect(s.versao).toBe(2);
    expect(Number((await um('SELECT ativo FROM item_prescritivel WHERE id = ?', [r.id]))!['ativo'])).toBe(0);
    await expect(
      cad.situacaoNaoPadronizado(ctx(), ids.itemA, { versao: 1, ativo: false }),
    ).rejects.toMatchObject(recusada('registro-inexistente', 404));
  });

  it('complementos do item: frequência, setor, sinônimo e conflito; retirar marca e reincluir reaproveita', async () => {
    const f = await cad.gravarFrequencia(ctx(), {
      codigo: 'C1115AGORA',
      descricao: 'C1115 agora',
      tipo: 'agora',
      limiteHoras: 1,
    });
    const cf = await cad.incluirComplemento(ctx(), ids.itemA, {
      tipo: 'frequencia',
      frequencia: f.id,
      usoFrequente: true,
    });
    await expect(
      cad.incluirComplemento(ctx(), ids.itemA, { tipo: 'frequencia', frequencia: f.id }),
    ).rejects.toMatchObject(recusada('frequencia-repetida', 409));
    await cad.retirarComplemento(ctx(), ids.itemA, { tipo: 'frequencia', id: cf.id, versao: 1 });
    const fr = await um('SELECT excluido_em, excluido_por FROM item_prescritivel_frequencia WHERE id = ?', [
      cf.id,
    ]);
    expect(fr!['excluido_em']).not.toBeNull();
    const de_novo = await cad.incluirComplemento(ctx(), ids.itemA, { tipo: 'frequencia', frequencia: f.id });
    expect(de_novo).toEqual({ id: cf.id, versao: 3 });

    await expect(
      cad.incluirComplemento(ctx(), ids.itemA, { tipo: 'setor', setor: ids.setorA, bloqueado: true }),
    ).rejects.toMatchObject(recusada('bloqueio-sem-motivo', 422));
    const rs = await cad.incluirComplemento(ctx(), ids.itemA, {
      tipo: 'setor',
      setor: ids.setorA,
      usoRestrito: true,
      via: ids.viaA,
      frequencia: f.id,
      quantidadePadrao: 2,
    });
    expect(
      await um(
        'SELECT estabelecimento_id, uso_restrito, quantidade_padrao FROM item_prescritivel_setor WHERE id = ?',
        [rs.id],
      ),
    ).toMatchObject({
      estabelecimento_id: ids.est,
    });

    const s1 = await cad.incluirComplemento(ctx(), ids.itemA, {
      tipo: 'sinonimo',
      termo: '  Colírio   azul ',
    });
    const s2 = await cad.incluirComplemento(ctx(), ids.itemA, {
      tipo: 'sinonimo',
      termo: 'gota',
      origemTermo: 'abreviatura',
    });
    await expect(
      cad.incluirComplemento(ctx(), ids.itemA, { tipo: 'sinonimo', termo: 'COLIRIO AZUL' }),
    ).rejects.toMatchObject(recusada('termo-repetido', 409));
    const sins = await ler<{ id: number; sequencia: number; termo: string }>(
      'SELECT id, sequencia, termo FROM item_prescritivel_sinonimo WHERE item_prescritivel_id = ? ORDER BY sequencia',
      [ids.itemA],
    );
    expect(sins.map((x) => [Number(x.id), Number(x.sequencia), x.termo])).toEqual([
      [s1.id, 1, 'Colírio azul'],
      [s2.id, 2, 'gota'],
    ]);

    await expect(
      cad.incluirComplemento(ctx(), ids.itemA, {
        tipo: 'conflito',
        conflitante: ids.itemB,
        gravidade: 'impeditivo',
      }),
    ).rejects.toMatchObject(recusada('motivo-obrigatorio', 422));
    const c = await cad.incluirComplemento(ctx(), ids.itemA, {
      tipo: 'conflito',
      conflitante: ids.itemB,
      gravidade: 'alerta',
      motivo: 'Duplicidade terapêutica',
    });
    await expect(
      cad.incluirComplemento(ctx(), ids.itemB, {
        tipo: 'conflito',
        conflitante: ids.itemA,
        gravidade: 'alerta',
      }),
    ).rejects.toMatchObject(recusada('conflito-repetido', 409));

    const lido = await cad.complementos(leitura, ids.itemB);
    expect(lido.conflitos).toEqual([
      expect.objectContaining({ id: c.id, conflitante: ids.itemA, gravidade: 'alerta' }),
    ]);
    const a = await cad.complementos(leitura, ids.itemA);
    expect(a.frequencias).toHaveLength(1);
    expect(a.setores).toEqual([
      expect.objectContaining({ id: rs.id, usoRestrito: true, quantidadePadrao: 2 }),
    ]);
    expect(a.sinonimos.map((x) => x.termo)).toEqual(['Colírio azul', 'gota']);

    await cad.retirarComplemento(ctx(), ids.itemA, { tipo: 'setor', id: rs.id, versao: 1 });
    expect(
      Number((await um('SELECT ativo FROM item_prescritivel_setor WHERE id = ?', [rs.id]))!['ativo']),
    ).toBe(0);
    await cad.retirarComplemento(ctx(), ids.itemB, { tipo: 'conflito', id: c.id, versao: 1 });
    expect(
      (await um('SELECT excluido_em FROM item_prescritivel_conflito WHERE id = ?', [c.id]))!['excluido_em'],
    ).not.toBeNull();
    expect((await cad.complementos(leitura, ids.itemA)).setores).toEqual([]);
    await expect(
      cad.retirarComplemento(ctx(), ids.itemB, { tipo: 'sinonimo', id: s1.id, versao: 1 }),
    ).rejects.toMatchObject(recusada('registro-inexistente', 404));
  });
});
