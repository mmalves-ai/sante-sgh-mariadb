// Contrato de efeito do registro do exame de hemodinâmica (F8, 04-CC linha 107) contra o MariaDB real (cliente de
// teste). Massa SINTÉTICA com o código "c2027hd": dois estabelecimentos fictícios, um paciente, dois profissionais, um
// atendimento, um setor de hemodinâmica e um de laboratório, um pedido com dois exames de hemodinâmica e um de
// laboratório (nenhuma pessoa real); usuário, categoria, caráter e fonte pagadora são ids já existentes do cliente.
// Prova o que fica no banco: a fila só com os exames do setor de hemodinâmica; o registro aberto com o paciente e o
// atendimento do pedido e o autor; um registro por exame (409); exame de outro setor (404) e equipe repetida (422)
// sem escrita; os achados gravados pela sequência, o achado mudado ou retirado com a marca de exclusão e o novo com a
// sequência seguinte (nada apagado); versão vencida (409) sem escrita; conclusão recusada sem os indicadores de dose
// (RDC 611/2022) e aceita com eles, com o exame pedido marcado como realizado pelo primeiro operador e o alerta de
// dose substancial; registro concluído não muda mais; o cancelamento com o motivo; o procedimento interrompido refeito
// com um novo registro do mesmo exame (o cancelado fica como histórico; um vigente por exame); o pedido recusado depois
// do início recusa salvar e concluir sem escrita (só o cancelamento passa); outro estabelecimento recebe 404.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { inserirMinimo } from '../suprimentos/massa-propria.spec-util.js';
import { PortaHemodinamicaPropria } from './hemodinamica-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5';
const P = 'c2027hd';
const P2 = `${P}b`;
const COD = (s: string) => `${P}${s}`.toUpperCase();

async function limpar(e: Escritor): Promise<void> {
  const ests = 'SELECT id FROM estabelecimento WHERE codigo IN (?, ?)';
  const regs = `SELECT id FROM registro_hemodinamica WHERE estabelecimento_id IN (${ests})`;
  const reqs = `SELECT id FROM requisicao_exame WHERE estabelecimento_id IN (${ests})`;
  await e.executar(`DELETE FROM registro_hemodinamica_achado WHERE registro_hemodinamica_id IN (${regs})`, [
    P,
    P2,
  ]);
  await e.executar(`DELETE FROM registro_hemodinamica WHERE estabelecimento_id IN (${ests})`, [P, P2]);
  await e.executar(`DELETE FROM exame_item WHERE requisicao_exame_id IN (${reqs})`, [P, P2]);
  await e.executar(`DELETE FROM requisicao_exame WHERE estabelecimento_id IN (${ests})`, [P, P2]);
  await e.executar('DELETE FROM exame WHERE codigo LIKE ?', [`${COD('')}%`]);
  await e.executar(`DELETE FROM setor_diagnostico WHERE estabelecimento_id IN (${ests})`, [P, P2]);
  await e.executar(`DELETE FROM atendimento WHERE estabelecimento_id IN (${ests})`, [P, P2]);
  const pf = 'SELECT id FROM pessoa_fisica WHERE nome LIKE ?';
  await e.executar(`DELETE FROM profissional WHERE pessoa_fisica_id IN (${pf})`, [`% ${COD('')}`]);
  await e.executar(`DELETE FROM paciente WHERE pessoa_fisica_id IN (${pf})`, [`% ${COD('')}`]);
  await e.executar('DELETE FROM pessoa_fisica WHERE nome LIKE ?', [`% ${COD('')}`]);
  await limparTrilhaDaMassa(e, { codigos: [P, P2] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', [P, P2]);
}

describe.skipIf(SEM_BANCO)('PortaHemodinamicaPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaHemodinamicaPropria;
  let m: {
    usuario: number;
    paciente: number;
    atendimento: number;
    op1: number;
    op2: number;
    itemA: number;
    itemB: number;
    itemLab: number;
  };
  const ctx = (hospital = P) => ({ cliente: CLIENTE, hospital, usuario: m.usuario, correlacao: P });
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<
      Record<string, unknown>[]
    >;
  const registroDe = async (item: number) =>
    (
      await ler(
        `SELECT id, situacao, paciente_id, atendimento_id, criado_por, versao, via_acesso, conclusao,
                kerma_referencia_mgy, primeiro_operador_profissional_id AS op1
           FROM registro_hemodinamica WHERE exame_item_id = ? ORDER BY id DESC`,
        [item],
      )
    )[0];
  const achados = (registro: number) =>
    ler(
      `SELECT id, sequencia, vaso, tipo_achado, grau_lesao_percentual AS grau, excluido_em IS NOT NULL AS excluido,
              excluido_por FROM registro_hemodinamica_achado WHERE registro_hemodinamica_id = ? ORDER BY sequencia`,
      [registro],
    );
  const base = () => ({
    inicioEm: '2030-03-10T13:00:00.000Z',
    viaAcesso: 'radial_direita',
    primeiroOperador: m.op1,
    segundoOperador: m.op2,
    introdutorFrench: 6,
    anestesia: 'local',
  });
  const DA = {
    vaso: 'Descendente anterior',
    segmento: 'proximal',
    tipo: 'estenose',
    grauPercentual: 80,
    fluxoTimi: 3,
    conduta: 'angioplastia',
    stentImplantado: true,
  };
  const CX = { vaso: 'Circunflexa', segmento: 'medio', tipo: 'estenose', grauPercentual: 40, fluxoTimi: 3 };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const um = async (sql: string) => Number((await e.uma(sql))?.['id'] ?? 0);
      const usuario = await um('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const categoria = await um('SELECT MIN(id) AS id FROM categoria_atendimento');
      const caraterTiss = await um('SELECT MIN(id) AS id FROM carater_atendimento_tiss');
      const fonte = await um('SELECT MIN(id) AS id FROM fonte_pagadora');
      if (!usuario || !categoria || !caraterTiss || !fonte)
        throw new Error('O cliente de teste precisa de usuário, categoria, caráter e fonte pagadora.');
      const novoEst = (codigo: string) =>
        e.inserir(
          `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
           VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
          [codigo, `Hospital sintético ${codigo}`, `Hospital sintético ${codigo} (fictício)`, agora],
        );
      const est = await novoEst(P);
      await novoEst(P2);
      const min = (t: string, v: Record<string, unknown>) => inserirMinimo(e, t, v, P);
      const pfPac = await min('pessoa_fisica', { nome: `PACIENTE SINTETICO ${COD('')}` });
      const paciente = await min('paciente', { pessoa_fisica_id: pfPac, situacao: 'ativo' });
      const prof = async (n: string) =>
        min('profissional', {
          pessoa_fisica_id: await min('pessoa_fisica', { nome: `OPERADOR ${n} SINTETICO ${COD('')}` }),
          tipo: 'corpo_clinico',
          situacao: 'ativo',
        });
      const op1 = await prof('UM');
      const op2 = await prof('DOIS');
      const atendimento = await min('atendimento', {
        estabelecimento_id: est,
        numero: `${P}-A`,
        paciente_id: paciente,
        categoria_atendimento_id: categoria,
        carater_atendimento_tiss_id: caraterTiss,
        fonte_pagadora_id: fonte,
        profissional_id: op1,
        entrada_em: new Date('2030-03-10T12:00:00.000Z'),
      });
      const setor = (codigo: string, tipo: string) =>
        e.inserir(
          `INSERT INTO setor_diagnostico (estabelecimento_id, codigo, nome, tipo, criado_em, versao)
           VALUES (?, ?, ?, ?, ?, 1)`,
          [est, `${P}${codigo}`, `SETOR SINTETICO ${codigo}`, tipo, agora],
        );
      const hemo = await setor('H', 'hemodinamica');
      const lab = await setor('L', 'laboratorio');
      const exame = (codigo: string, tipo: string, resultado: string) =>
        e.inserir(
          `INSERT INTO exame (codigo, sigla, nome, tipo_servico, tipo_resultado, ativo, criado_em, versao)
           VALUES (?, ?, ?, ?, ?, TRUE, ?, 1)`,
          [COD(codigo), COD(codigo).slice(-10), `EXAME SINTETICO ${codigo}`, tipo, resultado, agora],
        );
      const cate = await exame('CAT', 'metodo_grafico', 'laudo');
      const hemograma = await exame('HMG', 'laboratorio', 'numerico');
      const requisicao = await e.inserir(
        `INSERT INTO requisicao_exame (estabelecimento_id, numero, paciente_id, atendimento_id, setor_diagnostico_id,
           fonte_pagadora_id, solicitante_profissional_id, solicitado_em, criado_em, versao)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          est,
          `${P}-R1`,
          paciente,
          atendimento,
          hemo,
          fonte,
          op1,
          new Date('2030-03-10T12:30:00.000Z'),
          agora,
        ],
      );
      const item = (seq: number, ex: number, setorItem: number | null) =>
        e.inserir(
          `INSERT INTO exame_item (requisicao_exame_id, sequencia, exame_id, setor_diagnostico_id, situacao,
             criado_em, versao) VALUES (?, ?, ?, ?, 'solicitado', ?, 1)`,
          [requisicao, seq, ex, setorItem, agora],
        );
      return {
        usuario,
        paciente,
        atendimento,
        op1,
        op2,
        itemA: await item(1, cate, null),
        itemB: await item(2, cate, hemo),
        itemLab: await item(3, hemograma, lab),
      };
    });
    porta = new PortaHemodinamicaPropria(nucleo, CLIENTE);
  }, 120_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar?.();
    }
  }, 120_000);

  it('fila: só os exames do setor de hemodinâmica do período, ainda sem registro', async () => {
    const f = await porta.fila(ctx(), { de: '2030-03-10', ate: '2030-03-10' });
    expect(f.exames.map((x) => x.item)).toEqual([m.itemA, m.itemB]);
    expect(f.exames.every((x) => x.situacao === 'sem_registro')).toBe(true);
    expect((await porta.fila(ctx(), { de: '2030-03-11', ate: '2030-03-12' })).exames).toEqual([]);
  });

  it('iniciar: grava o registro com o paciente e o atendimento do pedido; um por exame; recusa sem escrita', async () => {
    await expect(porta.iniciar(ctx(), m.itemLab, base())).rejects.toMatchObject({
      problema: { status: 404 },
    });
    await expect(porta.iniciar(ctx(), m.itemA, { ...base(), segundoOperador: m.op1 })).rejects.toMatchObject({
      problema: { status: 422, campos: ['segundoOperador'] },
    });
    expect(await registroDe(m.itemA)).toBeUndefined();
    const r = await porta.iniciar(ctx(), m.itemA, base());
    const g = await registroDe(m.itemA);
    expect(g).toMatchObject({
      id: r.id,
      situacao: 'em_andamento',
      paciente_id: m.paciente,
      atendimento_id: m.atendimento,
      criado_por: m.usuario,
      versao: 1,
      via_acesso: 'radial_direita',
      op1: m.op1,
    });
    await expect(porta.iniciar(ctx(), m.itemA, base())).rejects.toMatchObject({ problema: { status: 409 } });
    await expect(porta.iniciar(ctx(P2), m.itemB, base())).rejects.toMatchObject({
      problema: { status: 404 },
    });
    await expect(porta.abrir(ctx(P2), m.itemA)).rejects.toMatchObject({ problema: { status: 404 } });
  });

  it('salvar: achados pela sequência; o mudado ou retirado fica no histórico; versão vencida não grava', async () => {
    const reg = Number((await registroDe(m.itemA))!['id']);
    const v2 = await porta.salvar(ctx(), reg, { ...base(), versao: 1, achados: [DA, CX] });
    expect(v2).toMatchObject({ versao: 2, achadosIncluidos: 2, achadosRetirados: 0 });
    const [a1, a2] = await achados(reg);
    expect([a1!['sequencia'], a2!['sequencia']]).toEqual([1, 2]);
    // DA sem mudança fica; CX corrigida (grau 40 → 60) vira linha nova; a Coronária direita entra.
    const v3 = await porta.salvar(ctx(), reg, {
      ...base(),
      versao: 2,
      contrasteNome: 'Contraste iodado sintético',
      contrasteVolumeMl: 140,
      achados: [
        { ...DA, id: Number(a1!['id']) },
        { ...CX, id: Number(a2!['id']), grauPercentual: 60 },
        { vaso: 'Coronária direita', tipo: 'normal' },
      ],
    });
    expect(v3).toMatchObject({ versao: 3, achadosIncluidos: 2, achadosRetirados: 1 });
    const todos = await achados(reg);
    expect(todos.map((x) => [x['sequencia'], x['vaso'], Number(x['excluido'])])).toEqual([
      [1, 'Descendente anterior', 0],
      [2, 'Circunflexa', 1],
      [3, 'Circunflexa', 0],
      [4, 'Coronária direita', 0],
    ]);
    expect(todos[1]!['excluido_por']).toBe(m.usuario);
    await expect(
      porta.salvar(ctx(), reg, { ...base(), versao: 2, conclusao: 'vencida', achados: [] }),
    ).rejects.toMatchObject({ problema: { status: 409 } });
    expect((await achados(reg)).filter((x) => !Number(x['excluido']))).toHaveLength(3);
    const aberto = await porta.abrir(ctx(), m.itemA);
    expect(aberto.achados).toHaveLength(3);
    expect(aberto.achadosCorrigidos).toBe(1);
    expect(aberto.registro).toMatchObject({ versao: 3, contrasteVolumeMl: 140 });
    expect(aberto.vasosComLesao).toBe(1);
  });

  it('concluir: sem a dose é recusado; com ela conclui, marca o exame como realizado e aponta a dose substancial', async () => {
    const reg = Number((await registroDe(m.itemA))!['id']);
    const atuais = (await achados(reg)).filter((x) => !Number(x['excluido']));
    const lista = [
      { ...DA, id: Number(atuais[0]!['id']) },
      { ...CX, id: Number(atuais[1]!['id']), grauPercentual: 60 },
      { vaso: 'Coronária direita', tipo: 'normal', id: Number(atuais[2]!['id']) },
    ];
    const completo = {
      ...base(),
      fimEm: '2030-03-10T14:10:00.000Z',
      hemostasia: 'pulseira_compressiva',
      conclusao: 'Lesão uniarterial na descendente anterior tratada com stent.',
      condutaIndicada: 'angioplastia',
      contrasteNome: 'Contraste iodado sintético',
      contrasteVolumeMl: 140,
      achados: lista,
    };
    await porta.salvar(ctx(), reg, { ...completo, versao: 3 });
    await expect(porta.concluir(ctx(), reg, { versao: 4 })).rejects.toMatchObject({
      problema: { status: 422, campos: ['tempoFluoroscopiaSegundos', 'kermaReferenciaMgy'] },
    });
    expect(await registroDe(m.itemA)).toMatchObject({ situacao: 'em_andamento', versao: 4 });
    await porta.salvar(ctx(), reg, {
      ...completo,
      versao: 4,
      tempoFluoroscopiaSegundos: 1500,
      kermaReferenciaMgy: 5200,
      produtoDoseAreaGycm2: 180,
    });
    const r = await porta.concluir(ctx(), reg, { versao: 5 });
    expect(r).toMatchObject({ versao: 6, alertas: ['dose-substancial'] });
    expect(await registroDe(m.itemA)).toMatchObject({ situacao: 'concluido', versao: 6 });
    const [item] = await ler(
      `SELECT realizado_em, realizado_por_usuario_id AS por, executante_profissional_id AS exec
         FROM exame_item WHERE id = ?`,
      [m.itemA],
    );
    expect(new Date(String(item!['realizado_em'])).toISOString()).toBe('2030-03-10T14:10:00.000Z');
    expect(item).toMatchObject({ por: m.usuario, exec: m.op1 });
    // Os achados não foram regravados (nenhum mudou): continuam 4 linhas, 3 vigentes.
    expect(await achados(reg)).toHaveLength(4);
    await expect(porta.salvar(ctx(), reg, { ...completo, versao: 6 })).rejects.toMatchObject({
      problema: { status: 422, codigo: 'registro-encerrado' },
    });
    await expect(porta.cancelar(ctx(), reg, { versao: 6, motivo: 'teste' })).rejects.toMatchObject({
      problema: { status: 422 },
    });
    const f = await porta.fila(ctx(), { de: '2030-03-10', ate: '2030-03-10' });
    expect(f.exames.find((x) => x.item === m.itemA)).toMatchObject({
      situacao: 'concluido',
      alertas: ['dose-substancial'],
      vasosComLesao: 1,
    });
  });

  it('cancelar: o procedimento interrompido fica cancelado com o motivo; nada é apagado', async () => {
    const r = await porta.iniciar(ctx(), m.itemB, { ...base(), viaAcesso: 'femoral_direita' });
    await porta.cancelar(ctx(), Number(r.id), { versao: 1, motivo: 'Instabilidade hemodinâmica na sala' });
    expect(await registroDe(m.itemB)).toMatchObject({
      situacao: 'cancelado',
      versao: 2,
      conclusao: 'Procedimento interrompido: Instabilidade hemodinâmica na sala',
    });
    const [item] = await ler('SELECT realizado_em FROM exame_item WHERE id = ?', [m.itemB]);
    expect(item!['realizado_em']).toBeNull();
  });

  it('refazer: o cancelado fica como histórico e o mesmo exame recebe um novo registro; um vigente por exame', async () => {
    const [cancelado] = await ler(
      `SELECT id FROM registro_hemodinamica WHERE exame_item_id = ? AND situacao = 'cancelado'`,
      [m.itemB],
    );
    const r = await porta.iniciar(ctx(), m.itemB, { ...base(), viaAcesso: 'radial_esquerda' });
    expect(Number(r.id)).not.toBe(Number(cancelado!['id']));
    const doItem = await ler(
      'SELECT id, situacao, via_acesso FROM registro_hemodinamica WHERE exame_item_id = ? ORDER BY id',
      [m.itemB],
    );
    expect(doItem.map((x) => [x['situacao'], x['via_acesso']])).toEqual([
      ['cancelado', 'femoral_direita'],
      ['em_andamento', 'radial_esquerda'],
    ]);
    await expect(porta.iniciar(ctx(), m.itemB, base())).rejects.toMatchObject({ problema: { status: 409 } });
    expect(await ler('SELECT id FROM registro_hemodinamica WHERE exame_item_id = ?', [m.itemB])).toHaveLength(
      2,
    );
    const aberto = await porta.abrir(ctx(), m.itemB);
    expect(aberto).toMatchObject({ registrosCancelados: 1, emExecucao: true, podeRefazer: false });
    expect(aberto.registro).toMatchObject({ id: Number(r.id), situacao: 'em_andamento' });
    const f = await porta.fila(ctx(), { de: '2030-03-10', ate: '2030-03-10' });
    expect(f.exames.find((x) => x.item === m.itemB)).toMatchObject({
      registro: Number(r.id),
      situacao: 'em_andamento',
    });
  });

  it('pedido recusado depois do início: salvar e concluir recusados sem escrita; só o cancelamento passa', async () => {
    const reg = Number((await registroDe(m.itemB))!['id']);
    const completo = {
      ...base(),
      fimEm: '2030-03-10T14:10:00.000Z',
      hemostasia: 'pulseira_compressiva',
      conclusao: 'Coronárias sem lesão.',
      condutaIndicada: 'tratamento_clinico',
      tempoFluoroscopiaSegundos: 300,
      kermaReferenciaMgy: 400,
      achados: [{ vaso: 'Coronária direita', tipo: 'normal' }],
    };
    await porta.salvar(ctx(), reg, { ...completo, versao: 1 });
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `recusa-${P}` }, (e) =>
      e.executar("UPDATE exame_item SET situacao = 'recusado', versao = versao + 1 WHERE id = ?", [m.itemB]),
    );
    await expect(
      porta.salvar(ctx(), reg, { ...completo, versao: 2, conclusao: 'depois da recusa' }),
    ).rejects.toMatchObject({ problema: { status: 422, campos: ['item'] } });
    await expect(porta.concluir(ctx(), reg, { versao: 2 })).rejects.toMatchObject({
      problema: { status: 422, campos: ['item'] },
    });
    expect(await registroDe(m.itemB)).toMatchObject({
      id: reg,
      situacao: 'em_andamento',
      versao: 2,
      conclusao: 'Coronárias sem lesão.',
    });
    expect(await achados(reg)).toHaveLength(1);
    const [item] = await ler(
      `SELECT realizado_em, realizado_por_usuario_id AS por, executante_profissional_id AS exec
         FROM exame_item WHERE id = ?`,
      [m.itemB],
    );
    expect(item).toMatchObject({ realizado_em: null, por: null, exec: null });
    await porta.cancelar(ctx(), reg, { versao: 2, motivo: 'Pedido recusado pelo convênio' });
    expect(await registroDe(m.itemB)).toMatchObject({ situacao: 'cancelado', versao: 3 });
    expect(await porta.abrir(ctx(), m.itemB)).toMatchObject({
      registrosCancelados: 2,
      emExecucao: false,
      podeRefazer: false,
    });
    await expect(porta.iniciar(ctx(), m.itemB, base())).rejects.toMatchObject({
      problema: { status: 422, campos: ['item'] },
    });
    expect(await ler('SELECT id FROM registro_hemodinamica WHERE exame_item_id = ?', [m.itemB])).toHaveLength(
      2,
    );
  });
});
