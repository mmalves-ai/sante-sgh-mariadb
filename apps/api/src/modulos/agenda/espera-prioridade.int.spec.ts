// 02-AGE linha 48, contrato de efeito: a lista de espera usa o grupo de prioridade legal da senha e da marcação.
// Na inclusão, o grupo sai da regra do domínio (`prioridadeNaMarcacao`: informado, cadastro do paciente, idade) e
// fica em lista_espera.grupo_prioridade_legal_id, com o histórico de entrada; o grupo inválido é recusado sem gravar;
// a fila sai na ordem urgência clínica → peso do grupo legal → antiguidade. Massa SINTÉTICA própria (estabelecimento
// f324e, grupos f324e-*), limpa antes e depois. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import type { ContextoGravacao } from './porta.js';
import { instanteDe, PortaAgendaPropria } from './porta-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o1';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST = 'f324e';
const LOGIN = 'teste.f324e';
const AGORA = instanteDe('America/Sao_Paulo', '2030-03-11', '09:00');

let chave = 0;
const ctx = (): ContextoGravacao => ({
  rede: 'teste',
  hospital: EST,
  login: LOGIN,
  correlacao: `teste-f324e-${chave}`,
  chaveIdempotencia: `f324e-${randomUUID()}-${++chave}`,
});

describe.skipIf(SEM_BANCO)('02-AGE 48: lista de espera pelo grupo de prioridade legal (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaAgendaPropria;
  const ids = { est: 0, a: 0, b: 0, c: 0, d: 0, g1: 0, g3: 0 };

  async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]) {
    const l = await e.uma<{ id: number }>(sel, p);
    return l ? Number(l.id) : e.inserir(ins, pi);
  }
  async function limpar(e: Escritor) {
    if (!ids.est) return;
    await e.executar(
      'DELETE h FROM lista_espera_historico h JOIN lista_espera l ON l.id = h.lista_espera_id WHERE l.estabelecimento_id = ?',
      [ids.est],
    );
    await e.executar('DELETE FROM lista_espera WHERE estabelecimento_id = ?', [ids.est]);
    if (ids.b) await e.executar('DELETE FROM paciente_prioridade_legal WHERE paciente_id = ?', [ids.b]);
    await limparTrilhaDaMassa(e, { ids: [ids.est] });
  }
  const ler = <T>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-f324e-conferir' }, (l) =>
      l.consultar(sql, p),
    ) as Promise<T[]>;

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-f324e' }, async (e) => {
      const agora = new Date();
      ids.est = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [EST],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [EST, 'Hospital sintético f324e', 'Hospital sintético f324e (fictício)', agora],
      );
      await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        [LOGIN],
        'INSERT INTO usuario (login, nome, dispensa_cpf, criado_em) VALUES (?, ?, TRUE, ?)',
        [LOGIN, 'USUARIO SINTETICO F324E', agora],
      );
      await garantir(
        e,
        "SELECT id FROM especialidade_medica WHERE codigo = '97'",
        [],
        "INSERT INTO especialidade_medica (codigo, descricao, tipo, criado_em) VALUES ('97', 'ESPECIALIDADE SINTETICA L0104', 'medica', ?)",
        [agora],
      );
      const paciente = async (letra: string, prontuario: number) => {
        const nome = `PACIENTE SINTETICO F324E ${letra}`;
        const pf = await garantir(
          e,
          'SELECT id FROM pessoa_fisica WHERE nome = ?',
          [nome],
          'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
          [nome, agora],
        );
        return garantir(
          e,
          'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
          [pf],
          'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
          [pf, prontuario, agora],
        );
      };
      ids.a = await paciente('A', 9324001);
      ids.b = await paciente('B', 9324002);
      ids.c = await paciente('C', 9324003);
      ids.d = await paciente('D', 9324004);
      const grupo = (codigo: string, peso: number) =>
        garantir(
          e,
          'SELECT id FROM grupo_prioridade_legal WHERE codigo = ?',
          [codigo],
          'INSERT INTO grupo_prioridade_legal (codigo, descricao, peso, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `Grupo sintético ${codigo}`, peso, agora],
        );
      ids.g1 = await grupo('f324e-peso1', 1);
      ids.g3 = await grupo('f324e-peso3', 3);
      await limpar(e);
      await e.inserir(
        'INSERT INTO paciente_prioridade_legal (paciente_id, grupo_prioridade_legal_id, vigencia_inicio, vigencia_fim, criado_em) VALUES (?, ?, ?, ?, ?)',
        [ids.b, ids.g3, '2030-01-01', null, agora],
      );
    });
    porta = new PortaAgendaPropria(nucleo, CLIENTE, () => AGORA);
  }, 120_000);

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-f324e' }, (e) => limpar(e));
    await nucleo.encerrar();
  });

  it('grava o grupo do cadastro ou o informado, recusa o inválido sem gravar e ordena a fila pela urgência, pelo peso do grupo e pela antiguidade', async () => {
    const pedido = (
      paciente: number,
      prioridade: 'normal' | 'urgente',
      prioridadeLegal: number | null = null,
    ) =>
      porta.gravar(ctx(), (g) =>
        g.incluirEspera({
          paciente,
          agenda: null,
          especialidade: 97,
          prioridade,
          prioridadeLegal,
          observacao: null,
        }),
      );
    const contar = async () =>
      Number(
        (
          await ler<{ n: number }>('SELECT COUNT(*) AS n FROM lista_espera WHERE estabelecimento_id = ?', [
            ids.est,
          ])
        )[0]?.n ?? 0,
      );

    // Grupo informado inexistente: recusado, nada gravado (nem o pedido nem o histórico).
    await expect(pedido(ids.c, 'normal', 999_999_999)).rejects.toMatchObject({
      problema: expect.objectContaining({ codigo: 'prioridade-invalida' }),
    });
    expect(await contar()).toBe(0);

    const a = await pedido(ids.a, 'normal'); // sem prioridade
    const b = await pedido(ids.b, 'normal'); // grupo do cadastro (peso 3)
    const c = await pedido(ids.c, 'normal', ids.g1); // grupo informado (peso 1)
    const d = await pedido(ids.d, 'urgente'); // urgência clínica, sem grupo
    expect(await contar()).toBe(4);

    const linhas = await ler<{ id: number; prioridade: string; grupo_prioridade_legal_id: number | null }>(
      'SELECT id, prioridade, grupo_prioridade_legal_id FROM lista_espera WHERE estabelecimento_id = ? ORDER BY id',
      [ids.est],
    );
    expect(
      linhas.map((x) => [
        Number(x.id),
        x.prioridade,
        x.grupo_prioridade_legal_id && Number(x.grupo_prioridade_legal_id),
      ]),
    ).toEqual([
      [a, 'normal', null],
      [b, 'preferencial', ids.g3],
      [c, 'preferencial', ids.g1],
      [d, 'urgente', null],
    ]);
    const hist = await ler<{ lista_espera_id: number; evento: string; dados: unknown }>(
      `SELECT h.lista_espera_id, h.evento, h.dados FROM lista_espera_historico h
         JOIN lista_espera l ON l.id = h.lista_espera_id WHERE l.estabelecimento_id = ? ORDER BY h.id`,
      [ids.est],
    );
    expect(hist.map((h) => h.evento)).toEqual(['entrada', 'entrada', 'entrada', 'entrada']);
    const dadosB = hist.find((h) => Number(h.lista_espera_id) === b)?.dados;
    expect(typeof dadosB === 'string' ? JSON.parse(dadosB) : dadosB).toEqual({
      prioridade: 'preferencial',
      grupoPrioridadeLegal: ids.g3,
    });

    // A leitura devolve o grupo e já vem na ordem da regra (fila-espera.ts).
    const fila = await porta.espera(ctx(), { situacoes: ['aguardando'] });
    expect(fila.map((x) => x.id)).toEqual([d, c, b, a]);
    expect(fila.find((x) => x.id === b)?.prioridadeLegal).toEqual({
      id: ids.g3,
      descricao: 'Grupo sintético f324e-peso3',
      peso: 3,
    });
  });
});
