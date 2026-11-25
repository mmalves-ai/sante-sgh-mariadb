// Contrato de efeito da reserva de equipamentos e hemocomponentes para a cirurgia (F8, 04-CC linha 103) contra o
// MariaDB real (cliente de teste). Massa SINTÉTICA: estabelecimento com o código do teste, um equipamento médico e um
// desativado fictícios, um hemocomponente fictício que exige prova cruzada, duas cirurgias fictícias que se cruzam no
// tempo (salas diferentes) e uma requisição transfusional fictícia do paciente; usuário, paciente, profissional,
// atendimento, centro de custo e tipo de transfusão são ids já existentes do cliente de teste (só os ids são lidos).
// Prova o que fica no banco: a leitura (período padrão = janela da cirurgia, opções); reservar o equipamento grava a
// linha "reservado" com o período da cirurgia, na trilha; o mesmo equipamento na cirurgia que se cruza é recusado
// (422) sem escrita, e passa depois de cancelada a primeira (que fica com a situação cancelada, sem apagar);
// equipamento desativado é recusado; o hemocomponente nasce "solicitada" com a prova cruzada "solicitada"; ligado ao
// item da requisição, fica "reservada" com as bolsas liberadas e a requisição passa a apontar a cirurgia; requisição
// de outro tipo é recusada; a sessão de outro estabelecimento recebe 404 sem escrita.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaReservaCirurgiaPropria } from './reserva-cirurgia-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'c1123rc';
const P2 = `${P}b`;

interface Massa {
  usuario: number;
  ag1: number;
  ag2: number;
  equipamento: number;
  desativado: number;
  hemo: number;
  hemoOutro: number;
  requisicao: number;
  item: number;
  itemOutro: number;
}

async function limpar(e: Escritor): Promise<void> {
  const est = 'SELECT id FROM estabelecimento WHERE codigo = ?';
  const ag = `SELECT id FROM agendamento_cirurgico WHERE estabelecimento_id = (${est})`;
  await e.executar(`DELETE FROM reserva_equipamento_cirurgia WHERE agendamento_cirurgico_id IN (${ag})`, [P]);
  await e.executar(`DELETE FROM reserva_hemocomponente_cirurgia WHERE agendamento_cirurgico_id IN (${ag})`, [
    P,
  ]);
  const rq = `SELECT id FROM requisicao_transfusao WHERE estabelecimento_id = (${est})`;
  await e.executar(`DELETE FROM requisicao_transfusao_item WHERE requisicao_transfusao_id IN (${rq})`, [P]);
  await e.executar(`DELETE FROM requisicao_transfusao WHERE estabelecimento_id = (${est})`, [P]);
  await e.executar(`DELETE FROM agendamento_cirurgico WHERE estabelecimento_id = (${est})`, [P]);
  await e.executar(`DELETE FROM equipamento_saude WHERE estabelecimento_id = (${est})`, [P]);
  await e.executar('DELETE FROM hemocomponente WHERE codigo IN (?, ?)', [`${P}-H1`, `${P}-H2`]);
  await e.executar('DELETE FROM carater_cirurgia WHERE codigo = ?', [`${P}-ELE`]);
  await limparTrilhaDaMassa(e, { codigos: [P, P2] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', [P, P2]);
}

describe.skipIf(SEM_BANCO)('PortaReservaCirurgiaPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaReservaCirurgiaPropria;
  let m: Massa;
  const ctx = (hospital = P) => ({ cliente: CLIENTE, hospital, usuario: m.usuario, correlacao: P });
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<
      Record<string, unknown>[]
    >;
  const equipamentos = () =>
    ler(
      `SELECT agendamento_cirurgico_id AS ag, sequencia, situacao, criado_por, versao,
              DATE_FORMAT(reserva_inicio, '%Y-%m-%d %H:%i') AS ini, DATE_FORMAT(reserva_fim, '%Y-%m-%d %H:%i') AS fim
         FROM reserva_equipamento_cirurgia r
        WHERE agendamento_cirurgico_id IN (?, ?) ORDER BY id`,
      [m.ag1, m.ag2],
    );
  const hemos = () =>
    ler(
      `SELECT sequencia, situacao, situacao_prova_cruzada AS prova, quantidade_solicitada AS qtd,
              quantidade_reservada AS reservada, requisicao_transfusao_item_id AS item, versao
         FROM reserva_hemocomponente_cirurgia WHERE agendamento_cirurgico_id = ? ORDER BY id`,
      [m.ag1],
    );
  const trilha = (entidade: 'reserva_equipamento_cirurgia' | 'reserva_hemocomponente_cirurgia') =>
    ler(
      `SELECT COUNT(*) AS n FROM trilha_auditoria t
        WHERE t.entidade = ? AND t.entidade_id IN (
          SELECT id FROM reserva_equipamento_cirurgia WHERE agendamento_cirurgico_id IN (?, ?)
          UNION SELECT id FROM reserva_hemocomponente_cirurgia WHERE agendamento_cirurgico_id IN (?, ?))`,
      [entidade, m.ag1, m.ag2, m.ag1, m.ag2],
    ).then((r) => Number(r[0]?.['n'] ?? 0));

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const um = async (sql: string) => Number((await e.uma(sql))?.['id'] ?? 0);
      const usuario = await um('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const profissional = await um('SELECT MIN(id) AS id FROM profissional WHERE excluido_em IS NULL');
      const centro = await um('SELECT MIN(id) AS id FROM centro_custo');
      const tipo = await um('SELECT MIN(id) AS id FROM tipo_transfusao');
      const at = await e.uma('SELECT id, paciente_id FROM atendimento ORDER BY id LIMIT 1');
      if (!usuario || !profissional || !centro || !tipo || !at)
        throw new Error(
          'O cliente de teste precisa de usuário, profissional, centro de custo, tipo e atendimento.',
        );
      const paciente = Number(at['paciente_id']);
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P2, `Hospital sintético ${P2}`, `Hospital sintético ${P2} (fictício)`, agora],
      );
      const carater = await e.inserir(
        'INSERT INTO carater_cirurgia (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        [`${P}-ELE`, `CARATER SINTETICO ${P}`, agora],
      );
      const equip = (s: string, situacao: string) =>
        e.inserir(
          `INSERT INTO equipamento_saude (estabelecimento_id, codigo, nome, tipo, criticidade, centro_custo_id,
                                          situacao, motivo_desativacao, criado_em)
           VALUES (?, ?, ?, 'medico', 'alta', ?, ?, ?, ?)`,
          [
            est,
            `${P}-${s}`,
            `ARCO SINTETICO ${s}`,
            centro,
            situacao,
            situacao === 'desativado' ? 'fictício' : null,
            agora,
          ],
        );
      const hemo = (s: string, sigla: string) =>
        e.inserir(
          `INSERT INTO hemocomponente (codigo, descricao, sigla, validade_dias, exige_prova_compatibilidade, faturavel,
                                       criado_em) VALUES (?, ?, ?, 35, TRUE, FALSE, ?)`,
          [`${P}-${s}`, `HEMOCOMPONENTE SINTETICO ${s}`, sigla, agora],
        );
      const agend = (n: number, inicio: string) =>
        e.inserir(
          `INSERT INTO agendamento_cirurgico (estabelecimento_id, numero, paciente_id, cirurgiao_profissional_id,
                                              carater_cirurgia_id, tipo_cobertura, solicitado_em, situacao,
                                              inicio_previsto_em, duracao_prevista_minutos, criado_em)
           VALUES (?, ?, ?, ?, ?, 'particular', ?, 'solicitado', ?, 120, ?)`,
          [est, `${P}-${n}`, paciente, profissional, carater, agora, inicio, agora],
        );
      const h1 = await hemo('H1', 'ZQ1');
      const h2 = await hemo('H2', 'ZQ2');
      const requisicao = await e.inserir(
        `INSERT INTO requisicao_transfusao (estabelecimento_id, numero, paciente_id, atendimento_id,
                                            solicitante_profissional_id, tipo_transfusao_id, indicacao,
                                            justificativa_urgencia, solicitado_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, 'INDICACAO SINTETICA DO TESTE', 'JUSTIFICATIVA SINTETICA', ?, ?)`,
        [est, `${P}-R1`, paciente, at['id'], profissional, tipo, agora, agora],
      );
      const item = (seq: number, h: number, atendida: number) =>
        e.inserir(
          `INSERT INTO requisicao_transfusao_item (requisicao_transfusao_id, sequencia, hemocomponente_id,
                                                   quantidade_bolsas, quantidade_atendida, situacao, criado_em)
           VALUES (?, ?, ?, 2, ?, ?, ?)`,
          [requisicao, seq, h, atendida, atendida ? 'parcial' : 'pendente', agora],
        );
      return {
        usuario,
        ag1: await agend(1, '2030-03-10 08:00:00'),
        ag2: await agend(2, '2030-03-10 09:00:00'),
        equipamento: await equip('E1', 'ativo'),
        desativado: await equip('E2', 'desativado'),
        hemo: h1,
        hemoOutro: h2,
        requisicao,
        item: await item(1, h1, 1),
        itemOutro: await item(2, h2, 0),
      };
    });
    porta = new PortaReservaCirurgiaPropria(nucleo, CLIENTE);
  }, 60_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar?.();
    }
  });

  it('lê o período padrão (janela da cirurgia) e as opções; a sessão de outro hospital recebe 404', async () => {
    const r = await porta.reservas(ctx(), m.ag1);
    expect(r.periodo).toEqual({ inicio: '2030-03-10 08:00', fim: '2030-03-10 10:00' });
    expect(r.aberta).toBe(true);
    expect(r.opcoes.equipamentos.map((x) => x.id)).toEqual([m.equipamento]);
    expect(r.opcoes.hemocomponentes.some((h) => h.id === m.hemo && h.exigeProva)).toBe(true);
    expect(r.opcoes.requisicoes.map((x) => x.item)).toEqual([m.item, m.itemOutro]);
    await expect(porta.reservas(ctx(P2), m.ag1)).rejects.toMatchObject({ problema: { status: 404 } });
    await expect(
      porta.reservarEquipamento(ctx(P2), m.ag1, { equipamento: m.equipamento }),
    ).rejects.toMatchObject({ problema: { status: 404 } });
    expect(await equipamentos()).toEqual([]);
  });

  it('reserva o equipamento no horário da cirurgia; o conflito com outra cirurgia é recusado até o cancelamento', async () => {
    await porta.reservarEquipamento(ctx(), m.ag1, { equipamento: m.equipamento });
    let linhas = await equipamentos();
    expect(linhas).toEqual([
      expect.objectContaining({
        ag: m.ag1,
        sequencia: 1,
        situacao: 'reservado',
        criado_por: m.usuario,
        ini: '2030-03-10 08:00',
        fim: '2030-03-10 10:00',
      }),
    ]);
    expect(await trilha('reserva_equipamento_cirurgia')).toBeGreaterThanOrEqual(1);

    // A cirurgia 2 (09:00 a 11:00, outra sala) cruza a primeira: recusada, sem escrita.
    await expect(
      porta.reservarEquipamento(ctx(), m.ag2, { equipamento: m.equipamento }),
    ).rejects.toMatchObject({
      problema: { status: 422, codigo: 'regra-violada' },
    });
    // Equipamento desativado também é recusado.
    await expect(
      porta.reservarEquipamento(ctx(), m.ag2, { equipamento: m.desativado }),
    ).rejects.toMatchObject({
      problema: { status: 422 },
    });
    // Período escolhido que encosta no fim da primeira passa.
    await porta.reservarEquipamento(ctx(), m.ag2, {
      equipamento: m.equipamento,
      inicio: '2030-03-10 10:00',
      fim: '2030-03-10 11:00',
    });
    expect((await equipamentos()).length).toBe(2);

    // Cancelada a primeira (nada apagado), a cirurgia 2 reserva o horário dela.
    const r = await porta.reservas(ctx(), m.ag1);
    await porta.cancelar(ctx(), m.ag1, 'equipamento', r.equipamentos[0]!.id, {
      versao: r.equipamentos[0]!.versao,
    });
    await porta.reservarEquipamento(ctx(), m.ag2, {
      equipamento: m.equipamento,
      inicio: '2030-03-10 09:00',
      fim: '2030-03-10 10:00',
    });
    linhas = await equipamentos();
    expect(linhas.map((l) => [l['ag'], l['situacao'], l['versao']])).toEqual([
      [m.ag1, 'cancelado', 2],
      [m.ag2, 'reservado', 1],
      [m.ag2, 'reservado', 1],
    ]);
    // Cancelar de novo a já cancelada: 422.
    await expect(
      porta.cancelar(ctx(), m.ag1, 'equipamento', r.equipamentos[0]!.id, { versao: 2 }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
  });

  it('pede o hemocomponente com prova cruzada e liga ao item da requisição (reservada, requisição na cirurgia)', async () => {
    await expect(
      porta.pedirHemocomponente(ctx(), m.ag1, { hemocomponente: m.hemo, quantidade: 0 }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    await porta.pedirHemocomponente(ctx(), m.ag1, {
      hemocomponente: m.hemo,
      quantidade: 2,
      observacao: 'reserva',
    });
    expect(await hemos()).toEqual([
      expect.objectContaining({
        sequencia: 1,
        situacao: 'solicitada',
        prova: 'solicitada',
        qtd: 2,
        item: null,
      }),
    ]);
    const r = await porta.reservas(ctx(), m.ag1);
    const h = r.hemocomponentes[0]!;
    // Item de outro tipo: recusado sem escrita.
    await expect(
      porta.ligarRequisicao(ctx(), m.ag1, h.id, { requisicaoItem: m.itemOutro, versao: h.versao }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    expect((await hemos())[0]).toMatchObject({ item: null, versao: 1 });

    await porta.ligarRequisicao(ctx(), m.ag1, h.id, { requisicaoItem: m.item, versao: h.versao });
    expect((await hemos())[0]).toMatchObject({
      situacao: 'reservada',
      reservada: 1,
      item: m.item,
      versao: 2,
    });
    const [q] = await ler('SELECT agendamento_cirurgico_id AS ag FROM requisicao_transfusao WHERE id = ?', [
      m.requisicao,
    ]);
    expect(q?.['ag']).toBe(m.ag1);
    const lido = (await porta.reservas(ctx(), m.ag1)).hemocomponentes[0]!;
    expect(lido).toMatchObject({ requisicaoNumero: `${P}-R1`, bolsasLiberadas: 1 });
    // A requisição agora é da cirurgia 1: não aparece como opção para a cirurgia 2.
    expect((await porta.reservas(ctx(), m.ag2)).opcoes.requisicoes).toEqual([]);

    await porta.cancelar(ctx(), m.ag1, 'hemocomponente', lido.id, { versao: lido.versao });
    expect((await hemos())[0]).toMatchObject({ situacao: 'cancelada', versao: 3 });
    expect(await trilha('reserva_hemocomponente_cirurgia')).toBeGreaterThanOrEqual(3);
  });
});
