// 02-AGE linha 48, contrato de efeito: a lista de espera usa o grupo de prioridade legal da senha e da marcação.
// Na inclusão, o grupo sai da regra do domínio (`prioridadeNaMarcacao`: informado, cadastro do paciente, idade) e
// fica em lista_espera.grupo_prioridade_legal_id, com o histórico de entrada; o grupo inválido é recusado sem gravar;
// a fila sai na ordem urgência clínica → peso do grupo legal → antiguidade, pela regra do domínio que a rota usa
// (ordenarFilaEspera e posicoesNaFilaEspera, com a posição dentro da fila da vaga). O grupo é reavaliado na data da
// leitura (aniversário de 60 anos, vigência do cadastro vencida, grupo desativado), e a oferta recusa a vaga
// incompatível e exige motivo para passar alguém à frente. Massa SINTÉTICA própria (estabelecimento f324e, grupos
// f324e-*, desativados na limpeza), limpa antes e depois. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { ordenarFilaEspera, posicoesNaFilaEspera } from '@sgh/dominio-agenda';
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
const AMANHA = instanteDe('America/Sao_Paulo', '2030-03-12', '09:00');
type Fila = Awaited<ReturnType<PortaAgendaPropria['espera']>>;
/** A ordem e a posição pela regra do domínio, como a rota GET /espera monta. */
const naRegra = (f: Fila) => {
  const regra = f.map((x) => ({ ...x, pesoPrioridadeLegal: x.prioridadeLegal?.peso ?? null }));
  return { ids: ordenarFilaEspera(regra).map((x) => x.id), pos: posicoesNaFilaEspera(regra) };
};

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
  let portaAmanha: PortaAgendaPropria;
  const ids = { est: 0, a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, g: 0, g1: 0, g3: 0, ag97: 0, ag95: 0 };
  const ped = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, g: 0, h: 0 };

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
    if (ids.b)
      await e.executar('DELETE FROM paciente_prioridade_legal WHERE paciente_id IN (?, ?)', [ids.b, ids.f]);
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
      await garantir(
        e,
        "SELECT id FROM especialidade_medica WHERE codigo = '96'",
        [],
        "INSERT INTO especialidade_medica (codigo, descricao, tipo, criado_em) VALUES ('96', 'ESPECIALIDADE SINTETICA F324E', 'medica', ?)",
        [agora],
      );
      const paciente = async (letra: string, prontuario: number, nascimento: string | null = null) => {
        const nome = `PACIENTE SINTETICO F324E ${letra}`;
        const pf = await garantir(
          e,
          'SELECT id FROM pessoa_fisica WHERE nome = ?',
          [nome],
          'INSERT INTO pessoa_fisica (nome, data_nascimento, criado_em) VALUES (?, ?, ?)',
          [nome, nascimento, agora],
        );
        await e.executar('UPDATE pessoa_fisica SET data_nascimento = ? WHERE id = ?', [nascimento, pf]);
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
      ids.e = await paciente('E', 9324005, '1970-03-12'); // 59 anos em 11/03/2030, 60 no dia seguinte
      ids.f = await paciente('F', 9324006);
      ids.g = await paciente('G', 9324007);
      const grupo = (codigo: string, peso: number, idade: number | null = null) =>
        garantir(
          e,
          'SELECT id FROM grupo_prioridade_legal WHERE codigo = ?',
          [codigo],
          'INSERT INTO grupo_prioridade_legal (codigo, descricao, peso, idade_minima, criado_em) VALUES (?, ?, ?, ?, ?)',
          [codigo, `Grupo sintético ${codigo}`, peso, idade, agora],
        );
      ids.g1 = await grupo('f324e-peso1', 1);
      ids.g3 = await grupo('f324e-peso3', 3);
      // Garante um grupo por idade (60) mesmo num cliente sem o cadastro padrão; peso alto para não passar à
      // frente do grupo real de idosos de outros testes.
      await grupo('f324e-idade60', 900, 60);
      await e.executar("UPDATE grupo_prioridade_legal SET ativo = TRUE WHERE codigo LIKE 'f324e-%'", []);
      const cat = await garantir(
        e,
        "SELECT id FROM categoria_agenda WHERE codigo = 'f324e'",
        [],
        "INSERT INTO categoria_agenda (codigo, descricao, natureza, criado_em) VALUES ('f324e', 'Consultas f324e', 'consulta', ?)",
        [agora],
      );
      // A agenda tem dono (ck_agenda_servico_dono): um profissional sintético.
      const pfProf = await garantir(
        e,
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        ['PROFISSIONAL SINTETICO F324E'],
        'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
        ['PROFISSIONAL SINTETICO F324E', agora],
      );
      const profissional = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pfProf],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pfProf, agora],
      );
      const agenda = (nome: string) =>
        garantir(
          e,
          'SELECT id FROM agenda_servico WHERE estabelecimento_id = ? AND nome = ?',
          [ids.est, nome],
          'INSERT INTO agenda_servico (estabelecimento_id, nome, categoria_agenda_id, profissional_id, duracao_horario_minutos, criado_em) VALUES (?, ?, ?, ?, 30, ?)',
          [ids.est, nome, cat, profissional, agora],
        );
      ids.ag97 = await agenda('AGENDA F324E 97');
      ids.ag95 = await agenda('AGENDA F324E SEM 97');
      await garantir(
        e,
        "SELECT x.id FROM agenda_especialidade x JOIN especialidade_medica em ON em.id = x.especialidade_medica_id WHERE x.agenda_servico_id = ? AND em.codigo = '97'",
        [ids.ag97],
        "INSERT INTO agenda_especialidade (agenda_servico_id, especialidade_medica_id, principal, criado_em) SELECT ?, id, TRUE, ? FROM especialidade_medica WHERE codigo = '97'",
        [ids.ag97, agora],
      );
      await limpar(e);
      await e.inserir(
        'INSERT INTO paciente_prioridade_legal (paciente_id, grupo_prioridade_legal_id, vigencia_inicio, vigencia_fim, criado_em) VALUES (?, ?, ?, ?, ?)',
        [ids.b, ids.g3, '2030-01-01', null, agora],
      );
      // Vigência que acaba no dia da inclusão (fim da gestação).
      await e.inserir(
        'INSERT INTO paciente_prioridade_legal (paciente_id, grupo_prioridade_legal_id, vigencia_inicio, vigencia_fim, criado_em) VALUES (?, ?, ?, ?, ?)',
        [ids.f, ids.g3, '2030-01-01', '2030-03-11', agora],
      );
    });
    porta = new PortaAgendaPropria(nucleo, CLIENTE, () => AGORA);
    portaAmanha = new PortaAgendaPropria(nucleo, CLIENTE, () => AMANHA);
  }, 120_000);

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-f324e' }, async (e) => {
      await limpar(e);
      // Os grupos sintéticos não ficam nas opções nem na regra dos outros testes do cliente.
      await e.executar("UPDATE grupo_prioridade_legal SET ativo = FALSE WHERE codigo LIKE 'f324e-%'", []);
    });
    await nucleo.encerrar();
  });

  it('grava o grupo do cadastro ou o informado, recusa o inválido sem gravar e ordena a fila pela urgência, pelo peso do grupo e pela antiguidade', async () => {
    const pedido = (
      paciente: number,
      prioridade: 'normal' | 'urgente',
      prioridadeLegal: number | null = null,
      especialidade = 97,
    ) =>
      porta.gravar(ctx(), (g) =>
        g.incluirEspera({
          paciente,
          agenda: null,
          especialidade,
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

    const a = (ped.a = await pedido(ids.a, 'normal')); // sem prioridade
    const b = (ped.b = await pedido(ids.b, 'normal')); // grupo do cadastro (peso 3)
    const c = (ped.c = await pedido(ids.c, 'normal', ids.g1)); // grupo informado (peso 1)
    const d = (ped.d = await pedido(ids.d, 'urgente')); // urgência clínica, sem grupo
    ped.e = await pedido(ids.e, 'normal'); // 59 anos hoje
    ped.f = await pedido(ids.f, 'normal'); // cadastro peso 3 que vence hoje
    ped.g = await pedido(ids.g, 'urgente', ids.g3); // urgência clínica com grupo legal
    ped.h = await pedido(ids.a, 'normal', null, 96); // outra fila (especialidade 96)
    expect(await contar()).toBe(8);

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
      [ped.e, 'normal', null],
      [ped.f, 'preferencial', ids.g3],
      [ped.g, 'urgente', ids.g3],
      [ped.h, 'normal', null],
    ]);
    const hist = await ler<{ lista_espera_id: number; evento: string; dados: unknown }>(
      `SELECT h.lista_espera_id, h.evento, h.dados FROM lista_espera_historico h
         JOIN lista_espera l ON l.id = h.lista_espera_id WHERE l.estabelecimento_id = ? ORDER BY h.id`,
      [ids.est],
    );
    expect(hist.map((h) => h.evento)).toEqual(Array(8).fill('entrada'));
    const dadosB = hist.find((h) => Number(h.lista_espera_id) === b)?.dados;
    expect(typeof dadosB === 'string' ? JSON.parse(dadosB) : dadosB).toEqual({
      prioridade: 'preferencial',
      grupoPrioridadeLegal: ids.g3,
      informada: null,
    });

    // A ordem e a posição saem da regra do domínio (a mesma da rota), com a posição dentro da fila da vaga.
    const fila = await porta.espera(ctx(), { situacoes: ['aguardando'] });
    const r = naRegra(fila);
    expect(r.ids).toEqual([ped.g, d, c, b, ped.f, a, ped.e, ped.h]);
    expect([ped.g, d, c, b, ped.f, a, ped.e].map((x) => r.pos.get(x))).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(r.pos.get(ped.h)).toBe(1);
    expect(fila.find((x) => x.id === b)?.prioridadeLegal).toEqual({
      id: ids.g3,
      descricao: 'Grupo sintético f324e-peso3',
      peso: 3,
    });
  });

  it('reavalia o grupo na data da leitura: aniversário de 60 anos, vigência vencida e grupo desativado', async () => {
    const f1 = await portaAmanha.espera(ctx(), { situacoes: ['aguardando'] });
    const item = (id: number) => f1.find((x) => x.id === id);
    expect(item(ped.e)?.prioridadeLegal).not.toBeNull();
    expect(item(ped.e)?.prioridade).toBe('preferencial');
    expect(item(ped.f)?.prioridadeLegal).toBeNull();
    expect(item(ped.f)?.prioridade).toBe('normal');
    const r = naRegra(f1);
    expect(r.ids.indexOf(ped.e)).toBeLessThan(r.ids.indexOf(ped.a));
    expect(r.ids.indexOf(ped.f)).toBeGreaterThan(r.ids.indexOf(ped.a));
    // O que ficou gravado na inclusão não muda (retrato no pedido e no histórico).
    const gravado = await ler<{ grupo_prioridade_legal_id: number | null }>(
      'SELECT grupo_prioridade_legal_id FROM lista_espera WHERE id = ?',
      [ped.f],
    );
    expect(Number(gravado[0]?.grupo_prioridade_legal_id)).toBe(ids.g3);

    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'f324e-inativo' }, (e) =>
      e.executar('UPDATE grupo_prioridade_legal SET ativo = FALSE WHERE id = ?', [ids.g1]),
    );
    try {
      const f2 = await portaAmanha.espera(ctx(), { situacoes: ['aguardando'] });
      expect(f2.find((x) => x.id === ped.c)?.prioridadeLegal).toBeNull();
      expect(naRegra(f2).ids.indexOf(ped.c)).toBeGreaterThan(naRegra(f2).ids.indexOf(ped.b));
    } finally {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 'f324e-reativo' }, (e) =>
        e.executar('UPDATE grupo_prioridade_legal SET ativo = TRUE WHERE id = ?', [ids.g1]),
      );
    }
  });

  it('a oferta recusa a vaga incompatível e exige motivo para passar alguém à frente na mesma fila', async () => {
    const ofertar = (id: number, agenda: number, motivo: string | null = null) =>
      porta.gravar(ctx(), (g) => g.ofertarEspera({ id, agenda, data: '2030-03-20', hora: '10:00', motivo }));
    const ofertas = async () =>
      (
        await ler<{ lista_espera_id: number; dados: unknown }>(
          `SELECT h.lista_espera_id, h.dados FROM lista_espera_historico h
             JOIN lista_espera l ON l.id = h.lista_espera_id WHERE l.estabelecimento_id = ? AND h.evento = 'oferta'
            ORDER BY h.id`,
          [ids.est],
        )
      ).map((h) => ({
        id: Number(h.lista_espera_id),
        dados: (typeof h.dados === 'string' ? JSON.parse(h.dados) : h.dados) as Record<string, unknown>,
      }));

    await expect(ofertar(ped.b, ids.ag95, 'qualquer')).rejects.toMatchObject({
      problema: expect.objectContaining({ codigo: 'vaga-incompativel' }),
    });
    await expect(ofertar(ped.b, ids.ag97)).rejects.toMatchObject({
      problema: expect.objectContaining({ codigo: 'oferta-fora-da-ordem' }),
    });
    expect(await ofertas()).toEqual([]);

    await ofertar(ped.g, ids.ag97); // primeiro da fila: sem motivo
    await ofertar(ped.b, ids.ag97, 'Paciente só pode neste horário'); // d e c à frente
    const o = await ofertas();
    expect(o.map((x) => x.id)).toEqual([ped.g, ped.b]);
    expect(o[0]?.dados['foraDaOrdem']).toBeUndefined();
    expect(o[1]?.dados['foraDaOrdem']).toEqual({ aFrente: 2, motivo: 'Paciente só pode neste horário' });
    const sit = await ler<{ id: number; situacao: string }>(
      'SELECT id, situacao FROM lista_espera WHERE id IN (?, ?)',
      [ped.g, ped.b],
    );
    expect(sit.map((x) => x.situacao)).toEqual(['ofertado', 'ofertado']);
  });
});
