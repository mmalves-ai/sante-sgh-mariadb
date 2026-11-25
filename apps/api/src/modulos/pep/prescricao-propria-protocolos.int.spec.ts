// Contrato de efeito do cadastro editável de protocolos de prescrição, kits e receitas padrão (03-PEP L107) contra o
// MariaDB real (cliente de teste f22_o4 por padrão). Massa SINTÉTICA própria (estabelecimento c2097, login
// teste.c2097.a, códigos C2097*), limpa antes e depois (a trilha pelo utilitário comum). Prova o que fica no banco:
// o protocolo com os itens (o item que sai fica ativo = false, a sequência reaproveitada volta a valer na mesma
// linha), o kit de solução com o diluente (o item que sai fica com excluido_em/excluido_por), a receita padrão geral e a
// da especialidade com os itens; a pessoal sem profissional na conta, o código repetido, a versão velha e a regra do
// domínio recusam sem gravar; cada gravação com a trilha. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { CadastroProtocolosPrescricaoPropria } from './prescricao-propria-protocolos.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST = 'c2097';
const LOGIN = 'teste.c2097.a';
const recusada = (codigo: string, status?: number) => ({
  problema: expect.objectContaining({ codigo, ...(status ? { status } : {}) }),
});

describe.skipIf(SEM_BANCO)('cadastro de protocolos, kits e receitas padrão (banco próprio, MariaDB)', () => {
  let nucleo: NucleoProprio;
  let cad: CadastroProtocolosPrescricaoPropria;
  const ids = { est: 0, tipo: 0, unidade: 0, itemA: 0, itemB: 0, itemC: 0, esp: 0 };

  const garantir = async (e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]) => {
    const l = await e.uma<{ id: number }>(sel, p);
    return l ? Number(l.id) : e.inserir(ins, pi);
  };
  const limpar = async (e: Escritor) => {
    await e.executar(
      `DELETE FROM protocolo_prescricao_item WHERE protocolo_prescricao_id IN
         (SELECT id FROM (SELECT id FROM protocolo_prescricao WHERE codigo LIKE 'C2097%') x)`,
      [],
    );
    await e.executar("DELETE FROM protocolo_prescricao WHERE codigo LIKE 'C2097%'", []);
    await e.executar(
      `DELETE FROM kit_prescricao_item WHERE kit_prescricao_id IN
         (SELECT id FROM (SELECT id FROM kit_prescricao WHERE codigo LIKE 'C2097%') x)`,
      [],
    );
    await e.executar("DELETE FROM kit_prescricao WHERE codigo LIKE 'C2097%'", []);
    await e.executar(
      `DELETE FROM modelo_receita_item WHERE modelo_receita_id IN
         (SELECT id FROM (SELECT id FROM modelo_receita WHERE nome LIKE 'C2097 %') x)`,
      [],
    );
    await e.executar("DELETE FROM modelo_receita WHERE nome LIKE 'C2097 %'", []);
    await limparTrilhaDaMassa(e, { codigos: [EST] });
  };
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'leitura-c2097' }, (l) =>
      l.consultar(sql, p),
    ) as Promise<T[]>;
  const um = async (sql: string, p: unknown[] = []) => (await ler(sql, p))[0] ?? null;
  const contar = async (sql: string, p: unknown[] = []) => Number((await um(sql, p))!['n']);
  const ctx = () => ({
    hospital: EST,
    login: LOGIN,
    correlacao: 'teste-c2097',
    chaveIdempotencia: `c2097-${randomUUID()}`,
  });
  const leitura = { hospital: EST, login: LOGIN };
  const trilhas = () =>
    contar('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ?', [ids.est]);

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    cad = new CadastroProtocolosPrescricaoPropria(nucleo, CLIENTE);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-c2097' }, async (e) => {
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
        [LOGIN, `Conta sintética ${LOGIN}`, '20972097201', agora],
      );
      ids.tipo = await garantir(
        e,
        'SELECT id FROM tipo_item_prescricao WHERE codigo = ?',
        ['C2097MED'],
        "INSERT INTO tipo_item_prescricao (codigo, descricao, categoria, criado_em) VALUES ('C2097MED', 'Medicamento sintético c2097', 'medicamento', ?)",
        [agora],
      );
      ids.unidade = await garantir(
        e,
        'SELECT id FROM unidade_prescricao WHERE codigo = ?',
        ['C2097ML'],
        "INSERT INTO unidade_prescricao (codigo, descricao, sigla, criado_em) VALUES ('C2097ML', 'Mililitro sintético', 'mlc', ?)",
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
      ids.itemA = await item('C2097IA');
      ids.itemB = await item('C2097IB');
      ids.itemC = await item('C2097IC');
      ids.esp = await garantir(
        e,
        'SELECT id FROM especialidade_medica WHERE codigo = ?',
        ['C2097ESP'],
        "INSERT INTO especialidade_medica (codigo, descricao, criado_em) VALUES ('C2097ESP', 'Especialidade sintética c2097', ?)",
        [agora],
      );
    });
  });

  afterAll(async () => {
    await nucleo?.escrever({ cliente: CLIENTE, correlacao: 'limpeza-c2097' }, limpar);
    await nucleo?.encerrar?.();
  });

  it('protocolo: grava cabeçalho e itens; o item que sai fica inativo e a sequência volta a valer na mesma linha', async () => {
    const antes = await trilhas();
    const base = {
      codigo: 'c2097 po',
      nome: 'C2097 Pós-operatório',
      idadeMin: 18,
      pesoMin: 40,
      pesoMax: 150,
      vigenciaInicio: '2026-01-01',
      itens: [
        { sequencia: 1, tipoItem: 'medicamento', item: ids.itemA, dose: 1, unidade: ids.unidade },
        { sequencia: 2, tipoItem: 'cuidado', descricao: 'Cabeceira elevada a 30 graus' },
      ],
    };
    const r = await cad.gravarProtocolo(ctx(), base);
    expect(r.versao).toBe(1);
    const p = await um('SELECT * FROM protocolo_prescricao WHERE id = ?', [r.id]);
    expect(p).toMatchObject({
      codigo: 'C2097 PO',
      estabelecimento_id: ids.est,
      tipo: 'protocolo',
      idade_minima_anos: 18,
      sexo: 'todos',
    });
    expect(
      await ler(
        'SELECT sequencia, tipo_item, item_prescritivel_id, ativo FROM protocolo_prescricao_item WHERE protocolo_prescricao_id = ? ORDER BY sequencia',
        [r.id],
      ),
    ).toEqual([
      expect.objectContaining({ sequencia: 1, tipo_item: 'medicamento', item_prescritivel_id: ids.itemA }),
      expect.objectContaining({ sequencia: 2, tipo_item: 'cuidado', item_prescritivel_id: null }),
    ]);
    // Altera: tira o 2, inclui o 3.
    const r2 = await cad.gravarProtocolo(ctx(), {
      ...base,
      id: r.id,
      versao: 1,
      itens: [base.itens[0], { sequencia: 3, tipoItem: 'medicamento', item: ids.itemB, dose: 2 }],
    });
    expect(r2.versao).toBe(2);
    const itens = await ler<{ id: number; sequencia: number; ativo: number }>(
      'SELECT id, sequencia, ativo FROM protocolo_prescricao_item WHERE protocolo_prescricao_id = ? ORDER BY sequencia',
      [r.id],
    );
    expect(itens.map((i) => [i.sequencia, Number(i.ativo)])).toEqual([
      [1, 1],
      [2, 0],
      [3, 1],
    ]);
    // O 2 volta: mesma linha, ativo de novo.
    await cad.gravarProtocolo(ctx(), { ...base, id: r.id, versao: 2 });
    const depois = await ler<{ id: number; sequencia: number; ativo: number }>(
      'SELECT id, sequencia, ativo FROM protocolo_prescricao_item WHERE protocolo_prescricao_id = ? ORDER BY sequencia',
      [r.id],
    );
    expect(depois).toHaveLength(3);
    expect(depois[1]).toMatchObject({ id: itens[1]!.id });
    expect(depois.map((i) => Number(i.ativo))).toEqual([1, 1, 0]);
    const lidos = (await cad.protocolos(leitura)).find((x) => x.id === r.id)!;
    expect(lidos.itens.map((i) => i['sequencia'])).toEqual([1, 2]);
    expect(await trilhas()).toBe(antes + 3);
  });

  it('protocolo: código repetido (409), versão velha, item inexistente e regra do domínio recusam sem gravar', async () => {
    const antes = await contar("SELECT COUNT(*) AS n FROM protocolo_prescricao WHERE codigo LIKE 'C2097%'");
    const p = {
      codigo: 'C2097 PO',
      nome: 'C2097 outro',
      itens: [{ sequencia: 1, tipoItem: 'cuidado', descricao: 'x' }],
    };
    await expect(cad.gravarProtocolo(ctx(), p)).rejects.toMatchObject(recusada('codigo-repetido', 409));
    await expect(
      cad.gravarProtocolo(ctx(), { ...p, codigo: 'C2097 B', idadeMin: 60, idadeMax: 10 }),
    ).rejects.toMatchObject(recusada('idade-invertida', 422));
    await expect(
      cad.gravarProtocolo(ctx(), {
        ...p,
        codigo: 'C2097 C',
        itens: [{ sequencia: 1, tipoItem: 'medicamento', descricao: 'Dipirona por texto' }],
      }),
    ).rejects.toMatchObject(recusada('item-do-catalogo', 422));
    await expect(
      cad.gravarProtocolo(ctx(), {
        ...p,
        codigo: 'C2097 D',
        itens: [{ sequencia: 1, tipoItem: 'medicamento', item: 999_999_999 }],
      }),
    ).rejects.toMatchObject(recusada('registro-inexistente', 404));
    const existente = await um("SELECT id FROM protocolo_prescricao WHERE codigo = 'C2097 PO'");
    await expect(
      cad.gravarProtocolo(ctx(), { ...p, codigo: 'C2097 PO', id: Number(existente!['id']), versao: 1 }),
    ).rejects.toMatchObject({ problema: expect.objectContaining({ status: 409 }) });
    expect(await contar("SELECT COUNT(*) AS n FROM protocolo_prescricao WHERE codigo LIKE 'C2097%'")).toBe(
      antes,
    );
  });

  it('kit de solução: grava com o diluente; o item que sai fica excluído com autor e hora; sem diluente recusa', async () => {
    const base = {
      codigo: 'C2097 K1',
      nome: 'C2097 Kit de solução',
      tipoKit: 'solucao',
      velocidade: 21,
      unidadeInfusao: null,
      itens: [
        { sequencia: 1, item: ids.itemA, papel: 'principal', quantidade: 1, unidade: ids.unidade },
        { sequencia: 2, item: ids.itemC, papel: 'diluente', quantidade: 100, unidade: ids.unidade },
        { sequencia: 3, item: ids.itemB, papel: 'componente', quantidade: 2, unidade: ids.unidade },
      ],
    };
    await expect(cad.gravarKit(ctx(), base)).rejects.toMatchObject(recusada('velocidade-sem-unidade', 422));
    await expect(
      cad.gravarKit(ctx(), { ...base, velocidade: null, itens: [base.itens[0], base.itens[2]] }),
    ).rejects.toMatchObject(recusada('solucao-sem-diluente', 422));
    expect(await contar("SELECT COUNT(*) AS n FROM kit_prescricao WHERE codigo LIKE 'C2097%'")).toBe(0);
    const r = await cad.gravarKit(ctx(), { ...base, velocidade: null });
    expect(await um('SELECT tipo_kit, ativo FROM kit_prescricao WHERE id = ?', [r.id])).toMatchObject({
      tipo_kit: 'solucao',
    });
    await cad.gravarKit(ctx(), {
      ...base,
      velocidade: null,
      id: r.id,
      versao: 1,
      itens: base.itens.slice(0, 2),
    });
    const its = await ler<{ sequencia: number; excluido_em: unknown; excluido_por: unknown }>(
      'SELECT sequencia, excluido_em, excluido_por FROM kit_prescricao_item WHERE kit_prescricao_id = ? ORDER BY sequencia',
      [r.id],
    );
    expect(its).toHaveLength(3);
    expect(its[2]!.excluido_em).not.toBeNull();
    expect(Number(its[2]!.excluido_por)).toBeGreaterThan(0);
    expect(its[0]!.excluido_em).toBeNull();
    const k = (await cad.kits(leitura)).find((x) => x.id === r.id)!;
    expect(k.itens.map((i) => i.papel)).toEqual(['principal', 'diluente']);
  });

  it('receita padrão: geral livre e da especialidade estruturada; a pessoal exige o profissional da conta', async () => {
    const g = await cad.gravarReceita(ctx(), {
      nome: 'C2097 Orientações gerais',
      abrangencia: 'geral',
      formato: 'livre',
      texto: 'Repouso relativo e hidratação.',
      vigenciaInicio: '2026-01-01',
      itens: [],
    });
    const e = await cad
      .gravarReceita(ctx(), {
        nome: 'C2097 Alta de pneumonia',
        abrangencia: 'especialidade',
        especialidade: ids.esp,
        formato: 'estruturada',
        vigenciaInicio: '2026-01-01',
        vigenciaFim: '2026-12-31',
        itens: [
          {
            sequencia: 1,
            item: ids.itemA,
            dose: 500,
            unidade: ids.unidade,
            quantidade: 21,
            duracao: 7,
            unidadeDuracao: null,
          },
        ],
      })
      .catch((x: unknown) => x);
    expect(e).toMatchObject(recusada('duracao-sem-unidade', 422));
    const e2 = await cad.gravarReceita(ctx(), {
      nome: 'C2097 Alta de pneumonia',
      abrangencia: 'especialidade',
      especialidade: ids.esp,
      formato: 'estruturada',
      vigenciaInicio: '2026-01-01',
      itens: [
        {
          sequencia: 1,
          item: ids.itemA,
          dose: 500,
          unidade: ids.unidade,
          quantidade: 21,
          posologia: '1 cp de 8/8 h',
        },
        { sequencia: 2, descricaoLivre: 'Inalação com soro fisiológico' },
      ],
    });
    expect(
      await um(
        'SELECT abrangencia, profissional_id, especialidade_medica_id, formato FROM modelo_receita WHERE id = ?',
        [g.id],
      ),
    ).toMatchObject({
      abrangencia: 'geral',
      profissional_id: null,
      formato: 'livre',
    });
    expect(
      await um('SELECT abrangencia, especialidade_medica_id FROM modelo_receita WHERE id = ?', [e2.id]),
    ).toMatchObject({
      abrangencia: 'especialidade',
      especialidade_medica_id: ids.esp,
    });
    expect(
      await contar('SELECT COUNT(*) AS n FROM modelo_receita_item WHERE modelo_receita_id = ? AND ativo', [
        e2.id,
      ]),
    ).toBe(2);
    await expect(
      cad.gravarReceita(ctx(), {
        nome: 'C2097 Pessoal',
        abrangencia: 'profissional',
        formato: 'livre',
        texto: 'x',
        vigenciaInicio: '2026-01-01',
        itens: [],
      }),
    ).rejects.toMatchObject(recusada('abrangencia-sem-dono', 422));
    const rs = (await cad.receitas(leitura)).filter((r) => r.nome.startsWith('C2097'));
    expect(rs.map((r) => r.nome).sort()).toEqual(['C2097 Alta de pneumonia', 'C2097 Orientações gerais']);
    expect(await contar("SELECT COUNT(*) AS n FROM modelo_receita WHERE nome = 'C2097 Pessoal'")).toBe(0);
  });
});
