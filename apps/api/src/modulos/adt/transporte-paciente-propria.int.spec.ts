// Contrato de efeito do pedido de transporte do paciente (C1-066, 03-PEP linha 125) contra o MariaDB real (cliente de
// teste). Massa SINTÉTICA: dois estabelecimentos com o código do teste, setores, uma internação com a alta de
// transferência, meios de transporte (com e sem ambulância), posição, ambulância, destino externo e motivo de
// cancelamento fictícios (chaves de catálogo desligadas só no preparo); usuário e paciente são ids já existentes do
// cliente de teste (só lidos, nunca alterados).
// Prova o que fica em `solicitacao_transporte_paciente`: o pedido ligado à internação (paciente, atendimento, alta
// vigente, origem pelo setor atual, quem pediu), o ciclo agendar, saída e chegada com os tempos e a distância, o
// cancelamento com motivo antes da saída sem apagar, as recusas (pedido repetido, oxigênio sem ambulância, setor de
// outro estabelecimento, saída sem o veículo, cancelar depois da saída, chegada antes da saída, cancelar sem motivo)
// sem gravar nada, a trilha das operações e a fila por prioridade.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaTransportePacientePropria } from './transporte-paciente-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'c1066tr';
const P2 = 'c1066trx';

interface Massa {
  est: number;
  usuario: number;
  paciente: number;
  atd: number;
  internacao: number;
  alta: number;
  setorA: number;
  setorB: number;
  setorX: number;
  externo: number;
  meioAmb: number;
  meioProprio: number;
  posicao: number;
  ambulancia: number;
  motivo: number;
}

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo IN (?, ?))';
  await e.executar('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await e.executar(`DELETE FROM solicitacao_transporte_paciente WHERE estabelecimento_id IN ${est}`, [
      P,
      P2,
    ]);
    await e.executar(
      `DELETE FROM alta_hospitalar WHERE internacao_id IN (SELECT id FROM internacao WHERE estabelecimento_id IN ${est})`,
      [P, P2],
    );
    await e.executar(`DELETE FROM internacao WHERE estabelecimento_id IN ${est}`, [P, P2]);
    await e.executar(`DELETE FROM unidade_internacao WHERE estabelecimento_id IN ${est}`, [P, P2]);
    await e.executar(`DELETE FROM atendimento WHERE estabelecimento_id IN ${est}`, [P, P2]);
    await e.executar(`DELETE FROM ambulancia WHERE estabelecimento_id IN ${est}`, [P, P2]);
    await e.executar(`DELETE FROM setor_funcional WHERE estabelecimento_id IN ${est}`, [P, P2]);
    await e.executar('DELETE FROM meio_transporte WHERE codigo LIKE ?', [`${P}-%`]);
    await e.executar('DELETE FROM posicao_paciente_transporte WHERE codigo LIKE ?', [`${P}-%`]);
    await e.executar('DELETE FROM motivo_cancelamento_transporte WHERE codigo LIKE ?', [`${P}-%`]);
    await e.executar('DELETE FROM estabelecimento_externo WHERE nome LIKE ?', [`${P} %`]);
  } finally {
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }
  await limparTrilhaDaMassa(e, { codigos: [P, P2] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', [P, P2]);
}

const daqui = (min: number) => new Date(Date.now() + min * 60_000).toISOString();

describe.skipIf(SEM_BANCO)('PortaTransportePacientePropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaTransportePacientePropria;
  let m: Massa;
  const ctx = () => ({ cliente: CLIENTE, hospital: P, usuario: m.usuario, correlacao: P });
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;
  const linha = async (id: number) =>
    (await ler('SELECT * FROM solicitacao_transporte_paciente WHERE id = ?', [id]))[0]!;
  const contar = async () =>
    Number(
      (
        await ler('SELECT COUNT(*) AS n FROM solicitacao_transporte_paciente WHERE estabelecimento_id = ?', [
          m.est,
        ])
      )[0]!['n'],
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const usuario = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const paciente = await e.uma('SELECT MIN(id) AS id FROM paciente WHERE excluido_em IS NULL');
      const fonte = await e.uma('SELECT MIN(id) AS id FROM fonte_pagadora');
      if (!usuario?.['id'] || !paciente?.['id'] || !fonte?.['id'])
        throw new Error('O cliente de teste precisa de usuário, paciente e fonte pagadora.');
      const estab = (cod: string) =>
        e.inserir(
          `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
           VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
          [cod, `Hospital sintético ${cod}`, `Hospital sintético ${cod} (fictício)`, agora],
        );
      const est = await estab(P);
      const est2 = await estab(P2);
      const setor = (onde: number, cod: string) =>
        e.inserir(
          `INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em)
           VALUES (?, ?, ?, 'assistencial', ?)`,
          [onde, `${P}-${cod}`, `Setor sintético ${cod}`, agora],
        );
      const setorA = await setor(est, 'A');
      const setorB = await setor(est, 'B');
      const setorX = await setor(est2, 'X');
      const cadastro = (tabela: string, cod: string, extra = '', valor: unknown[] = []) =>
        e.inserir(
          `INSERT INTO ${tabela} (codigo, descricao${extra ? `, ${extra}` : ''}, criado_em)
           VALUES (?, ?${valor.map(() => ', ?').join('')}, ?)`,
          [`${P}-${cod}`, `Cadastro sintético ${cod}`, ...valor, agora],
        );
      const meioAmb = await cadastro('meio_transporte', 'AMB', 'exige_ambulancia', [true]);
      const meioProprio = await cadastro('meio_transporte', 'PROP', 'exige_ambulancia', [false]);
      const posicao = await cadastro('posicao_paciente_transporte', 'DEIT');
      const motivo = await cadastro('motivo_cancelamento_transporte', 'DESIST');
      const externo = await e.inserir('INSERT INTO estabelecimento_externo (nome, criado_em) VALUES (?, ?)', [
        `${P} Hospital de destino fictício`,
        agora,
      ]);
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      try {
        const ambulancia = await e.inserir(
          `INSERT INTO ambulancia (estabelecimento_id, categoria_ambulancia_id, placa, criado_em)
           VALUES (?, 1, 'SNT0A00', ?)`,
          [est, agora],
        );
        const atd = await e.inserir(
          `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
             carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em)
           VALUES (?, ?, ?, 1, 1, ?, 1, NOW(3) - INTERVAL 5 DAY, ?)`,
          [est, `${P}-1`, paciente['id'], fonte['id'], agora],
        );
        const unidade = await e.inserir(
          `INSERT INTO unidade_internacao (estabelecimento_id, unidade_assistencial_id, codigo, descricao, tipo,
             setor_funcional_id, criado_em) VALUES (?, ?, ?, 'Unidade sintética', 'enfermaria', ?, ?)`,
          [est, 4_100_000_000 + est, `${P}-U`, setorA, agora],
        );
        const internacao = await e.inserir(
          `INSERT INTO internacao (estabelecimento_id, numero, atendimento_id, paciente_id, data_hora_entrada,
             carater_admissao_id, modalidade_internacao_id, unidade_internacao_id, acomodacao_id,
             especialidade_medica_id, medico_assistente_profissional_id, fonte_pagadora_id, criado_em)
           VALUES (?, ?, ?, ?, NOW(3) - INTERVAL 5 DAY, 1, 1, ?, 1, 1, 1, ?, ?)`,
          [est, `${P}-1`, atd, paciente['id'], unidade, fonte['id'], agora],
        );
        const alta = await e.inserir(
          `INSERT INTO alta_hospitalar (internacao_id, alta_em, motivo_saida_hospitalar_id, desfecho_internacao_id,
             destino, destino_estabelecimento_externo_id, situacao, criado_em)
           VALUES (?, NOW(3), 1, 1, 'transferencia_externa', ?, 'prevista', ?)`,
          [internacao, externo, agora],
        );
        return {
          est,
          usuario: Number(usuario['id']),
          paciente: Number(paciente['id']),
          atd,
          internacao,
          alta,
          setorA,
          setorB,
          setorX,
          externo,
          meioAmb,
          meioProprio,
          posicao,
          ambulancia,
          motivo,
        };
      } finally {
        await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      }
    });
    porta = new PortaTransportePacientePropria(nucleo, CLIENTE);
  });

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar?.();
    }
  });

  it('pede o transporte da transferência pela internação, agenda, sai, chega e recusa sem gravar', async () => {
    const vista = await porta.internacao(ctx(), m.internacao);
    expect(vista).toMatchObject({
      paciente: m.paciente,
      atendimento: m.atd,
      setorAtual: m.setorA,
      alta: { id: m.alta, destino: 'transferencia_externa', destinoExterno: m.externo },
      tipoSugerido: 'transferencia_externa',
    });

    const pedido = {
      internacao: m.internacao,
      tipo: 'transferencia_externa',
      prioridade: 'urgente',
      meio: m.meioAmb,
      posicao: m.posicao,
      destinoExterno: m.externo,
      condicao: 'Estável, em oxigênio por cateter',
      requerOxigenio: true,
      requerMaca: true,
      acompanhanteNome: 'Acompanhante sintético',
      previsto: daqui(60),
    };
    const { id } = await porta.solicitar(ctx(), pedido);
    const t = await linha(id);
    expect(t).toMatchObject({
      estabelecimento_id: m.est,
      paciente_id: m.paciente,
      atendimento_id: m.atd,
      internacao_id: m.internacao,
      alta_hospitalar_id: m.alta,
      tipo: 'transferencia_externa',
      prioridade: 'urgente',
      meio_transporte_id: m.meioAmb,
      posicao_paciente_transporte_id: m.posicao,
      origem_setor_funcional_id: m.setorA,
      destino_estabelecimento_externo_id: m.externo,
      destino_setor_funcional_id: null,
      solicitante_usuario_id: m.usuario,
      situacao: 'solicitado',
      versao: 1,
    });
    expect(Number(t['requer_oxigenio'])).toBe(1);
    expect(Number(t['requer_maca'])).toBe(1);
    expect(t['solicitado_em']).toBeTruthy();

    // Recusas sem gravar: pedido repetido do mesmo tipo em aberto (422), oxigênio com meio sem ambulância (422),
    // setor de outro estabelecimento (404) e interno sem setor de destino (422).
    const antes = await contar();
    await expect(porta.solicitar(ctx(), pedido)).rejects.toMatchObject({ problema: { status: 422 } });
    const interno = {
      internacao: m.internacao,
      tipo: 'interno',
      destinoSetor: m.setorB,
      requerOxigenio: true,
      meio: m.meioProprio,
    };
    await expect(porta.solicitar(ctx(), interno)).rejects.toMatchObject({ problema: { status: 422 } });
    await expect(
      porta.solicitar(ctx(), { ...interno, meio: m.meioAmb, destinoSetor: m.setorX }),
    ).rejects.toMatchObject({ problema: { status: 404 } });
    await expect(
      porta.solicitar(ctx(), { internacao: m.internacao, tipo: 'interno', destinoDescricao: 'Raio X' }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    expect(await contar()).toBe(antes);

    // Agendar (previsão futura); a saída sem o veículo é recusada (o meio exige ambulância), com o veículo, vale.
    await porta.agendar(ctx(), id, { previsto: daqui(30), versao: 1 });
    expect(await linha(id)).toMatchObject({ situacao: 'agendado', versao: 2, ambulancia_id: null });
    await expect(porta.iniciar(ctx(), id, { versao: 2 })).rejects.toMatchObject({
      problema: { status: 422 },
    });
    const saida = new Date(Math.floor((Date.now() - 40 * 60_000) / 1000) * 1000);
    await porta.iniciar(ctx(), id, { saida: saida.toISOString(), ambulancia: m.ambulancia, versao: 2 });
    const andando = await linha(id);
    expect(andando).toMatchObject({ situacao: 'em_andamento', versao: 3, ambulancia_id: m.ambulancia });
    expect(new Date(String(andando['saida_em'])).getTime()).toBe(saida.getTime());

    // Depois da saída não se cancela; a chegada antes da saída é recusada; a chegada válida conclui.
    await expect(porta.cancelar(ctx(), id, { motivo: m.motivo, versao: 3 })).rejects.toMatchObject({
      problema: { status: 422 },
    });
    await expect(
      porta.concluir(ctx(), id, { chegada: new Date(saida.getTime() - 60_000).toISOString(), versao: 3 }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    await porta.concluir(ctx(), id, {
      chegada: new Date(saida.getTime() + 25 * 60_000).toISOString(),
      retorno: new Date(saida.getTime() + 38 * 60_000).toISOString(),
      distanciaKm: 18.4,
      versao: 3,
    });
    const fim = await linha(id);
    expect(fim).toMatchObject({ situacao: 'concluido', versao: 4 });
    expect(Number(fim['distancia_km'])).toBe(18.4);
    expect(fim['chegada_em']).toBeTruthy();
    expect(fim['retorno_em']).toBeTruthy();
  });

  it('cancela o pedido interno com motivo sem apagar; fila por prioridade e histórico da internação', async () => {
    const { id: rotina } = await porta.solicitar(ctx(), {
      internacao: m.internacao,
      tipo: 'interno',
      destinoSetor: m.setorB,
      previsto: daqui(120),
    });
    expect(await linha(rotina)).toMatchObject({
      tipo: 'interno',
      prioridade: 'rotina',
      origem_setor_funcional_id: m.setorA,
      destino_setor_funcional_id: m.setorB,
      situacao: 'solicitado',
    });
    const { id: emergencia } = await porta.solicitar(ctx(), {
      internacao: m.internacao,
      tipo: 'exame_externo',
      prioridade: 'emergencia',
      destinoDescricao: 'Clínica de imagem sintética',
      requerMonitorizacao: true,
      meio: m.meioAmb,
    });
    const fila = await porta.listar(ctx(), {});
    expect(fila.map((x) => x.id)).toEqual([emergencia, rotina]);
    expect(fila[0]).toMatchObject({ destinoNome: 'Clínica de imagem sintética', meioExigeAmbulancia: true });

    // Cancelar sem motivo é recusado; com motivo, fica cancelado, com o motivo e sem apagar.
    await expect(porta.cancelar(ctx(), rotina, { versao: 1 })).rejects.toMatchObject({
      problema: { status: 422 },
    });
    await porta.cancelar(ctx(), rotina, { motivo: m.motivo, observacao: 'Exame remarcado', versao: 1 });
    await porta.cancelar(ctx(), emergencia, { motivo: m.motivo, versao: 1 });
    expect(await linha(rotina)).toMatchObject({
      situacao: 'cancelado',
      motivo_cancelamento_transporte_id: m.motivo,
      observacao: 'Exame remarcado',
      excluido_em: null,
      versao: 2,
    });

    expect(await porta.listar(ctx(), {})).toEqual([]);
    const historico = await porta.listar(ctx(), { internacao: String(m.internacao) });
    expect(historico.map((x) => x.situacao).sort()).toEqual(['cancelado', 'cancelado', 'concluido']);
    expect(historico.find((x) => x.id === rotina)?.motivoCancelamento).toBe('Cadastro sintético DESIST');
    expect(await contar()).toBe(3);

    const [tr] = await ler(
      'SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? AND usuario_id = ?',
      [m.est, m.usuario],
    );
    // 3 pedidos + agendar, saída, chegada + 2 cancelamentos.
    expect(Number(tr!['n'])).toBeGreaterThanOrEqual(8);
  });
});
