// 02-AGE linha 53, contrato de efeito: o pedido de vaga nasce no prontuário pelo médico e segue até a marcação.
// Prova no MariaDB: `lista_espera` com solicitante_profissional_id (o profissional vinculado ao usuário), a
// especialidade, o primeiro item da agenda como alvo, o prazo limite e a prioridade; `lista_espera_item` um por
// procedimento pedido (item da agenda ou procedimento faturável, sequência, quantidade, 'aguardando');
// `lista_espera_historico` evento 'entrada' com o solicitante; a leitura por paciente com os itens; o pedido na fila
// da agenda (porta.espera, com quem pediu e os itens) e a oferta de vaga ('ofertado', evento 'oferta'); a marcação
// (itens 'marcado' com a marcação, evento 'marcacao' com a contagem) e o cancelamento (itens 'cancelado'). Recusas sem gravar: usuário sem vínculo
// com profissional, prazo no passado e item inexistente. O pedido que vem da regulação (solicitacao_regulacao_id)
// tem prova em adt/regulacao-entrada-propria.int.spec.ts. Massa SINTÉTICA própria (estabelecimento c116v, logins
// teste.c116v.*), limpa antes e depois. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PedidosVagaPropria } from './pedido-vaga.js';
import type { ContextoGravacao } from './porta.js';
import { instanteDe, PortaAgendaPropria } from './porta-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o1';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST = 'c116v';
const MEDICO = 'teste.c116v.medico';
const SEM_VINCULO = 'teste.c116v.recepcao';
const AGORA = instanteDe('America/Sao_Paulo', '2030-03-11', '09:00');
const recusada = (codigo: string) => ({ problema: expect.objectContaining({ codigo }) });

let chave = 0;
const ctxG = (login = MEDICO) => ({
  hospital: EST,
  login,
  correlacao: `teste-c116v-${++chave}`,
  chaveIdempotencia: `c116v-${randomUUID()}`,
});
const ctxPorta = (): ContextoGravacao => ({
  rede: 'teste',
  hospital: EST,
  login: MEDICO,
  correlacao: `teste-c116v-${++chave}`,
  chaveIdempotencia: `c116v-${randomUUID()}`,
});

describe.skipIf(SEM_BANCO)('02-AGE 53: pedido de vaga do médico até a oferta (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let pedidos: PedidosVagaPropria;
  let porta: PortaAgendaPropria;
  const ids = { est: 0, medico: 0, prof: 0, paciente: 0, esp: 0, agenda: 0, item: 0, item2: 0, fat: 0 };
  let pedido = 0;
  let outro = 0;

  async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]) {
    const l = await e.uma<{ id: number }>(sel, p);
    return l ? Number(l.id) : e.inserir(ins, pi);
  }
  async function limpar(e: Escritor) {
    if (!ids.est) return;
    await e.executar(
      'DELETE i FROM lista_espera_item i JOIN lista_espera l ON l.id = i.lista_espera_id WHERE l.estabelecimento_id = ?',
      [ids.est],
    );
    await e.executar(
      'DELETE h FROM lista_espera_historico h JOIN lista_espera l ON l.id = h.lista_espera_id WHERE l.estabelecimento_id = ?',
      [ids.est],
    );
    await e.executar('DELETE FROM lista_espera WHERE estabelecimento_id = ?', [ids.est]);
    await e.executar('DELETE FROM marcacao_horario WHERE estabelecimento_id = ?', [ids.est]);
    await e.executar('DELETE FROM horario_agenda WHERE estabelecimento_id = ?', [ids.est]);
    await limparTrilhaDaMassa(e, { ids: [ids.est] });
  }
  const ler = <T>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-c116v-conferir' }, (l) =>
      l.consultar(sql, p),
    ) as Promise<T[]>;
  const contar = async () =>
    Number(
      (
        await ler<{ n: number }>('SELECT COUNT(*) AS n FROM lista_espera WHERE estabelecimento_id = ?', [
          ids.est,
        ])
      )[0]?.n ?? 0,
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-c116v' }, async (e) => {
      const agora = new Date();
      ids.est = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [EST],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [EST, 'Hospital sintético c116v', 'Hospital sintético c116v (fictício)', agora],
      );
      const usuario = (login: string, nome: string) =>
        garantir(
          e,
          'SELECT id FROM usuario WHERE login = ?',
          [login],
          'INSERT INTO usuario (login, nome, dispensa_cpf, criado_em) VALUES (?, ?, TRUE, ?)',
          [login, nome, agora],
        );
      ids.medico = await usuario(MEDICO, 'MEDICO SINTETICO C116V');
      await usuario(SEM_VINCULO, 'RECEPCAO SINTETICA C116V');
      const pessoa = (nome: string) =>
        garantir(
          e,
          'SELECT id FROM pessoa_fisica WHERE nome = ?',
          [nome],
          'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
          [nome, agora],
        );
      const pfProf = await pessoa('PROFISSIONAL SINTETICO C116V');
      ids.prof = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pfProf],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pfProf, agora],
      );
      await garantir(
        e,
        'SELECT id FROM usuario_vinculo_profissional WHERE usuario_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [ids.medico, ids.est],
        'INSERT INTO usuario_vinculo_profissional (usuario_id, estabelecimento_id, profissional_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?, ?)',
        [ids.medico, ids.est, ids.prof, '2030-01-01', agora],
      );
      const pfPac = await pessoa('PACIENTE SINTETICO C116V');
      ids.paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pfPac],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pfPac, 9116001, agora],
      );
      ids.esp = await garantir(
        e,
        "SELECT id FROM especialidade_medica WHERE codigo = '97'",
        [],
        "INSERT INTO especialidade_medica (codigo, descricao, tipo, criado_em) VALUES ('97', 'ESPECIALIDADE SINTETICA L0104', 'medica', ?)",
        [agora],
      );
      await e.executar('UPDATE especialidade_medica SET ativo = TRUE WHERE id = ?', [ids.esp]);
      const item = (codigo: string, descricao: string) =>
        garantir(
          e,
          'SELECT id FROM item_agendavel WHERE codigo = ?',
          [codigo],
          "INSERT INTO item_agendavel (codigo, descricao, tipo_item, duracao_minutos, criado_em) VALUES (?, ?, 'exame', 30, ?)",
          [codigo, descricao, agora],
        );
      ids.item = await item('C116V-ECO', 'EXAME SINTETICO C116V A');
      ids.item2 = await item('C116V-TE', 'EXAME SINTETICO C116V B');
      const fat = await e.uma<{ id: number }>(
        "SELECT id FROM item_faturavel WHERE situacao = 'ativo' AND excluido_em IS NULL ORDER BY id LIMIT 1",
        [],
      );
      ids.fat = fat ? Number(fat.id) : 0;
      const cat = await garantir(
        e,
        "SELECT id FROM categoria_agenda WHERE codigo = 'c116v'",
        [],
        "INSERT INTO categoria_agenda (codigo, descricao, natureza, criado_em) VALUES ('c116v', 'Consultas c116v', 'consulta', ?)",
        [agora],
      );
      ids.agenda = await garantir(
        e,
        'SELECT id FROM agenda_servico WHERE estabelecimento_id = ? AND nome = ?',
        [ids.est, 'AGENDA C116V'],
        'INSERT INTO agenda_servico (estabelecimento_id, nome, categoria_agenda_id, profissional_id, duracao_horario_minutos, criado_em) VALUES (?, ?, ?, ?, 30, ?)',
        [ids.est, 'AGENDA C116V', cat, ids.prof, agora],
      );
      await garantir(
        e,
        'SELECT id FROM agenda_especialidade WHERE agenda_servico_id = ? AND especialidade_medica_id = ?',
        [ids.agenda, ids.esp],
        'INSERT INTO agenda_especialidade (agenda_servico_id, especialidade_medica_id, principal, criado_em) VALUES (?, ?, TRUE, ?)',
        [ids.agenda, ids.esp, agora],
      );
      await limpar(e);
    });
    pedidos = new PedidosVagaPropria(nucleo, CLIENTE, () => AGORA);
    porta = new PortaAgendaPropria(nucleo, CLIENTE, () => AGORA);
  }, 120_000);

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-c116v' }, (e) => limpar(e));
    await nucleo.encerrar();
  });

  it('recusa sem gravar: usuário sem profissional, prazo no passado e item inexistente', async () => {
    const base = {
      paciente: ids.paciente,
      especialidade: ids.esp,
      itens: [{ itemAgendavel: ids.item, quantidade: 1 }],
    };
    await expect(pedidos.incluir(ctxG(SEM_VINCULO), base)).rejects.toMatchObject(
      recusada('pedido-vaga-invalido'),
    );
    await expect(pedidos.incluir(ctxG(), { ...base, prazoLimite: '2030-03-10' })).rejects.toMatchObject(
      recusada('pedido-vaga-invalido'),
    );
    await expect(
      pedidos.incluir(ctxG(), { ...base, itens: [{ itemAgendavel: 999_999_999, quantidade: 1 }] }),
    ).rejects.toMatchObject(recusada('item-inexistente'));
    expect(await contar()).toBe(0);
  });

  it('o médico pede a vaga no prontuário: lista_espera com o solicitante, os itens e o histórico de entrada', async () => {
    const itens = [
      { itemAgendavel: ids.item, quantidade: 1 },
      { itemAgendavel: ids.item2, quantidade: 2 },
      ...(ids.fat ? [{ itemFaturavel: ids.fat, quantidade: 1 }] : []),
    ];
    const r = await pedidos.incluir(ctxG(), {
      paciente: ids.paciente,
      especialidade: ids.esp,
      prioridade: 'urgente',
      prazoLimite: '2030-04-30',
      observacao: 'Investigar sopro',
      itens,
    });
    pedido = r.resultado.id;
    expect(r.resultado.itens).toBe(itens.length);
    const [le] = await ler<Record<string, unknown>>('SELECT * FROM lista_espera WHERE id = ?', [pedido]);
    expect(le).toMatchObject({
      estabelecimento_id: ids.est,
      paciente_id: ids.paciente,
      especialidade_medica_id: ids.esp,
      item_agendavel_id: ids.item,
      solicitante_profissional_id: ids.prof,
      solicitacao_regulacao_id: null,
      prioridade: 'urgente',
      situacao: 'aguardando',
      responsavel_usuario_id: ids.medico,
      observacao: 'Investigar sopro',
    });
    expect(
      String(
        le!['prazo_limite'] instanceof Date
          ? (le!['prazo_limite'] as Date).toISOString()
          : le!['prazo_limite'],
      ).slice(0, 10),
    ).toBe('2030-04-30');
    const its = await ler<Record<string, unknown>>(
      'SELECT sequencia, item_agendavel_id, item_faturavel_id, quantidade, situacao FROM lista_espera_item WHERE lista_espera_id = ? ORDER BY sequencia',
      [pedido],
    );
    expect(its.map((x) => [Number(x['sequencia']), Number(x['quantidade']), x['situacao']])).toEqual(
      itens.map((_, i) => [i + 1, i === 1 ? 2 : 1, 'aguardando']),
    );
    expect(Number(its[0]!['item_agendavel_id'])).toBe(ids.item);
    if (ids.fat) {
      expect(its[2]!['item_agendavel_id']).toBeNull();
      expect(Number(its[2]!['item_faturavel_id'])).toBe(ids.fat);
    }
    const hs = await ler<{ evento: string; dados: unknown }>(
      'SELECT evento, dados FROM lista_espera_historico WHERE lista_espera_id = ? ORDER BY id',
      [pedido],
    );
    expect(hs.map((h) => h.evento)).toEqual(['entrada']);
    const dados = (typeof hs[0]!.dados === 'string' ? JSON.parse(hs[0]!.dados) : hs[0]!.dados) as Record<
      string,
      unknown
    >;
    expect(dados).toMatchObject({ solicitante: ids.prof, itens: itens.length, prioridade: 'urgente' });

    // A mesma chave de idempotência não grava de novo.
    const c = ctxG();
    const corpo = { paciente: ids.paciente, especialidade: ids.esp, itens: [{ itemAgendavel: ids.item2 }] };
    const p1 = await pedidos.incluir(c, corpo);
    const p2 = await pedidos.incluir(c, corpo);
    outro = p1.resultado.id;
    expect(p2.repetida).toBe(true);
    expect(p2.resultado.id).toBe(p1.resultado.id);
    expect(await contar()).toBe(2);

    // A visão por paciente: o pedido com o solicitante e os itens; o médico pode pedir.
    const v = await pedidos.doPaciente({ hospital: EST, login: MEDICO }, ids.paciente);
    expect(v.solicitante).toEqual({ id: ids.prof, nome: 'PROFISSIONAL SINTETICO C116V' });
    const lido = v.pedidos.find((x) => x.id === pedido)!;
    expect(lido).toMatchObject({
      situacao: 'aguardando',
      prioridade: 'urgente',
      prazoLimite: '2030-04-30',
      solicitante: 'PROFISSIONAL SINTETICO C116V',
      regulacao: null,
    });
    expect(lido.itens.map((x) => x.descricao).slice(0, 2)).toEqual([
      'EXAME SINTETICO C116V A',
      'EXAME SINTETICO C116V B',
    ]);
    expect(v.itens.some((x) => x.id === ids.item)).toBe(true);
    const semVinculo = await pedidos.doPaciente({ hospital: EST, login: SEM_VINCULO }, ids.paciente);
    expect(semVinculo.solicitante).toBeNull();
  });

  it('o pedido entra na fila da agenda e recebe a oferta de vaga', async () => {
    expect(pedido).toBeGreaterThan(0);
    const fila = await porta.espera(ctxPorta(), { situacoes: ['aguardando'] });
    expect(fila.map((x) => x.id)).toContain(pedido);
    // Quem marca vê o pedido inteiro: quem pediu e cada procedimento pedido, não só o item principal.
    const naFila = fila.find((x) => x.id === pedido)!;
    expect(naFila.solicitante).toBe('PROFISSIONAL SINTETICO C116V');
    expect(naFila.regulacao).toBeNull();
    expect(
      naFila.itens!.map((x) => [x.sequencia, x.descricao, x.quantidade, x.situacao]).slice(0, 2),
    ).toEqual([
      [1, 'EXAME SINTETICO C116V A', 1, 'aguardando'],
      [2, 'EXAME SINTETICO C116V B', 2, 'aguardando'],
    ]);
    await porta.gravar(ctxPorta(), (g) =>
      g.ofertarEspera({ id: pedido, agenda: ids.agenda, data: '2030-03-20', hora: '10:00', motivo: null }),
    );
    const [le] = await ler<{ situacao: string }>('SELECT situacao FROM lista_espera WHERE id = ?', [pedido]);
    expect(le!.situacao).toBe('ofertado');
    const hs = await ler<{ evento: string }>(
      'SELECT evento FROM lista_espera_historico WHERE lista_espera_id = ? ORDER BY id',
      [pedido],
    );
    expect(hs.map((h) => h.evento)).toEqual(['entrada', 'oferta']);
    const v = await pedidos.doPaciente({ hospital: EST, login: MEDICO }, ids.paciente);
    expect(v.pedidos.find((x) => x.id === pedido)!.situacao).toBe('ofertado');
  });

  it('a marcação leva os itens a marcado com a marcação; o cancelamento cancela os itens (mesma transação, histórico)', async () => {
    expect(pedido).toBeGreaterThan(0);
    expect(outro).toBeGreaterThan(0);
    // A marcação da vaga ofertada (a fila marca e encerra o pedido como atendido com a marcação).
    const marcacao = await nucleo.escrever({ cliente: CLIENTE, correlacao: 'marcacao-c116v' }, async (e) => {
      const um = async (sql: string) => Number((await e.uma<{ id: number }>(sql, []))!.id);
      const horario = await e.inserir(
        `INSERT INTO horario_agenda (estabelecimento_id, agenda_servico_id, data_referencia, inicio_em, fim_em, situacao, criado_em)
         VALUES (?, ?, '2030-03-20', '2030-03-20 13:00:00', '2030-03-20 13:30:00', 'ocupado', ?)`,
        [ids.est, ids.agenda, new Date()],
      );
      return e.inserir(
        `INSERT INTO marcacao_horario (estabelecimento_id, numero, horario_agenda_id, tipo_marcacao_id, situacao_marcacao_id,
           canal_marcacao_id, fonte_pagadora_id, duracao_minutos, marcado_em, responsavel_usuario_id, paciente_id, criado_em)
         VALUES (?, 'C116V-1', ?, ?, ?, ?, ?, 30, ?, ?, ?, ?)`,
        [
          ids.est,
          horario,
          await um('SELECT id FROM tipo_marcacao ORDER BY id LIMIT 1'),
          await um('SELECT id FROM situacao_marcacao ORDER BY id LIMIT 1'),
          await um('SELECT id FROM canal_marcacao ORDER BY id LIMIT 1'),
          await um('SELECT id FROM fonte_pagadora ORDER BY id LIMIT 1'),
          new Date(),
          ids.medico,
          ids.paciente,
          new Date(),
        ],
      );
    });
    await porta.gravar(ctxPorta(), (g) => g.encerrarEspera({ id: pedido, situacao: 'atendido', marcacao }));
    const [le] = await ler<{ situacao: string; marcacao_horario_id: number }>(
      'SELECT situacao, marcacao_horario_id FROM lista_espera WHERE id = ?',
      [pedido],
    );
    expect(le).toMatchObject({ situacao: 'atendido', marcacao_horario_id: marcacao });
    const its = await ler<{ situacao: string; marcacao_horario_id: number | null; versao: number }>(
      'SELECT situacao, marcacao_horario_id, versao FROM lista_espera_item WHERE lista_espera_id = ? ORDER BY sequencia',
      [pedido],
    );
    expect(its.length).toBeGreaterThanOrEqual(2);
    for (const i of its) {
      expect(i.situacao).toBe('marcado');
      expect(Number(i.marcacao_horario_id)).toBe(marcacao);
      expect(Number(i.versao)).toBe(2);
    }
    const hs = await ler<{ evento: string; dados: unknown }>(
      'SELECT evento, dados FROM lista_espera_historico WHERE lista_espera_id = ? ORDER BY id',
      [pedido],
    );
    expect(hs.map((h) => h.evento)).toEqual(['entrada', 'oferta', 'marcacao']);
    const d = hs[2]!.dados;
    expect((typeof d === 'string' ? JSON.parse(d) : d) as Record<string, unknown>).toMatchObject({
      marcacao,
      itens: its.length,
    });

    // O outro pedido sai da fila cancelado: o item é cancelado, sem marcação; nada se apaga.
    await porta.gravar(ctxPorta(), (g) =>
      g.encerrarEspera({ id: outro, situacao: 'cancelado', marcacao: null }),
    );
    const cs = await ler<{ situacao: string; marcacao_horario_id: number | null; excluido_em: unknown }>(
      'SELECT situacao, marcacao_horario_id, excluido_em FROM lista_espera_item WHERE lista_espera_id = ?',
      [outro],
    );
    expect(cs).toEqual([{ situacao: 'cancelado', marcacao_horario_id: null, excluido_em: null }]);

    // A aba do prontuário mostra cada procedimento como ficou.
    const v = await pedidos.doPaciente({ hospital: EST, login: MEDICO }, ids.paciente);
    const marcado = v.pedidos.find((x) => x.id === pedido)!;
    expect(marcado.situacao).toBe('atendido');
    expect(marcado.itens.every((x) => x.situacao === 'marcado' && x.marcacao === marcacao)).toBe(true);
    expect(v.pedidos.find((x) => x.id === outro)!.itens.map((x) => x.situacao)).toEqual(['cancelado']);
  });
});
