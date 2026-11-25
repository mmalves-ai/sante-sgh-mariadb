// Contrato de efeito do consumo de gás por setor (C1-050, 05-SUP linha 30) contra o MariaDB real (cliente de teste).
// Massa SINTÉTICA: estabelecimento com o código do teste, dois setores, um gás (insumo fictício) e um atendimento
// fictício (chaves de catálogo desligadas só no preparo); usuário e paciente são ids já existentes do cliente de teste
// (só lidos, nunca alterados).
// Prova o que fica no banco: o consumo do setor SEM paciente (atendimento nulo) com o volume pelo fluxo × minutos ou
// medido, o encerramento com fim e volume, o cancelamento com o motivo sem apagar, as recusas (sem fluxo nem volume,
// setor de outro estabelecimento, encerrar o que não está em uso) sem gravar nada, a trilha da operação e a apuração
// por setor e período que soma o uso dos pacientes (gravado pela porta do uso por paciente) e o consumo do setor, com as
// parcelas impressas e o cancelado de fora.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaGasMedicinalPropria } from './gas-medicinal-propria.js';
import { PortaGasSetorPropria } from './gas-setor-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'c1050gas';

interface Massa {
  est: number;
  usuario: number;
  atd: number;
  o2: number;
  setorA: number;
  setorB: number;
}

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  await e.executar('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await e.executar(`DELETE FROM consumo_gas_medicinal WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM uso_gas_medicinal WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM atendimento WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM setor_funcional WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar('DELETE FROM insumo WHERE codigo LIKE ?', [`${P}-%`]);
  } finally {
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

// Dia civil de 3 dias atrás no fuso do estabelecimento (America/Sao_Paulo, UTC-3 sem horário de verão).
const DIA = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
const as = (hhmm: string) => new Date(`${DIA}T${hhmm}:00-03:00`).toISOString();

describe.skipIf(SEM_BANCO)('PortaGasSetorPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaGasSetorPropria;
  let usoPaciente: PortaGasMedicinalPropria;
  let m: Massa;
  const ctx = () => ({ cliente: CLIENTE, hospital: P, usuario: m.usuario, correlacao: P });
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;
  const contar = async () =>
    Number(
      (
        await ler('SELECT COUNT(*) AS n FROM consumo_gas_medicinal WHERE estabelecimento_id = ?', [m.est])
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
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      const setor = (cod: string, nome: string) =>
        e.inserir(
          `INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em)
           VALUES (?, ?, ?, 'assistencial', ?)`,
          [est, `${P}-${cod}`, nome, agora],
        );
      const setorA = await setor('A', 'Setor sintético A');
      const setorB = await setor('B', 'Setor sintético B');
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      try {
        const o2 = await e.inserir(
          `INSERT INTO insumo (codigo, nome, tipo, grupo_insumo_id, estoque_unidade_medida_id, criado_em)
           VALUES (?, 'Gás sintético O2', 'gas_medicinal', 1, 1, ?)`,
          [`${P}-O2`, agora],
        );
        const atd = await e.inserir(
          `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
             carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em)
           VALUES (?, ?, ?, 1, 1, ?, 1, NOW(3) - INTERVAL 5 DAY, ?)`,
          [est, `${P}-1`, paciente['id'], fonte['id'], agora],
        );
        return { est, usuario: Number(usuario['id']), atd, o2, setorA, setorB };
      } finally {
        await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      }
    });
    porta = new PortaGasSetorPropria(nucleo, CLIENTE);
    usoPaciente = new PortaGasMedicinalPropria(nucleo, CLIENTE);
  }, 60_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar?.();
    }
  });

  it('registra o consumo do setor sem paciente, encerra com o volume, cancela sem apagar e recusa sem gravar', async () => {
    // Recusas: sem fluxo nem volume (422), setor de outro estabelecimento (404) e gás que não existe (404).
    await expect(
      porta.registrar(ctx(), { setor: m.setorA, insumo: m.o2, inicio: as('09:00') }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    const [outro] = await ler('SELECT MIN(id) AS id FROM setor_funcional WHERE estabelecimento_id <> ?', [
      m.est,
    ]);
    if (outro?.['id'])
      await expect(
        porta.registrar(ctx(), {
          setor: Number(outro['id']),
          insumo: m.o2,
          fluxoLitrosMinuto: 2,
          inicio: as('09:00'),
        }),
      ).rejects.toMatchObject({ problema: { status: 404 } });
    expect(await contar()).toBe(0);

    // Encerrado na hora do registro: 30 min × 4 L/min = 120 L.
    const a = await porta.registrar(ctx(), {
      setor: m.setorA,
      insumo: m.o2,
      fluxoLitrosMinuto: 4,
      inicio: as('14:00'),
      fim: as('14:30'),
    });
    expect(a.quantidadeLitros).toBe(120);
    const [ga] = await ler(
      `SELECT atendimento_id, setor_funcional_id, situacao, quantidade, criado_por, versao
         FROM consumo_gas_medicinal WHERE id = ?`,
      [a.id],
    );
    expect([
      ga!['atendimento_id'],
      Number(ga!['setor_funcional_id']),
      ga!['situacao'],
      Number(ga!['quantidade']),
      Number(ga!['versao']),
    ]).toEqual([null, m.setorA, 'encerrado', 120, 1]);

    // Em uso; encerrado depois com o volume medido (300 L).
    const b = await porta.registrar(ctx(), {
      setor: m.setorA,
      insumo: m.o2,
      fluxoLitrosMinuto: 1,
      inicio: as('20:00'),
    });
    const [gb0] = await ler('SELECT situacao, quantidade, fim_em FROM consumo_gas_medicinal WHERE id = ?', [
      b.id,
    ]);
    expect([gb0!['situacao'], gb0!['quantidade'], gb0!['fim_em']]).toEqual(['em_uso', null, null]);
    await expect(porta.encerrar(ctx(), b.id, { fim: as('19:00'), versao: 1 })).rejects.toMatchObject({
      problema: { status: 422 },
    });
    const fb = await porta.encerrar(ctx(), b.id, { fim: as('21:00'), quantidadeLitros: 300, versao: 1 });
    expect(fb.quantidadeLitros).toBe(300);
    const [gb] = await ler('SELECT situacao, quantidade, versao FROM consumo_gas_medicinal WHERE id = ?', [
      b.id,
    ]);
    expect([gb!['situacao'], Number(gb!['quantidade']), Number(gb!['versao'])]).toEqual([
      'encerrado',
      300,
      2,
    ]);
    await expect(porta.encerrar(ctx(), b.id, { versao: 2 })).rejects.toMatchObject({
      problema: { status: 422 },
    });

    // Setor B: 15 min × 10 L/min = 150 L.
    await porta.registrar(ctx(), {
      setor: m.setorB,
      insumo: m.o2,
      fluxoLitrosMinuto: 10,
      inicio: as('09:00'),
      fim: as('09:15'),
    });

    // Lançado por engano: cancelado com o motivo, nunca apagado; o segundo cancelamento é recusado.
    const c = await porta.registrar(ctx(), {
      setor: m.setorA,
      insumo: m.o2,
      quantidadeLitros: 9999,
      inicio: as('16:00'),
      fim: as('17:00'),
    });
    await expect(porta.cancelar(ctx(), c.id, { motivo: 'abc', versao: 1 })).rejects.toBeTruthy();
    await porta.cancelar(ctx(), c.id, { motivo: 'Registrado no setor errado', versao: 1 });
    const [gc] = await ler(
      'SELECT situacao, observacao, excluido_em FROM consumo_gas_medicinal WHERE id = ?',
      [c.id],
    );
    expect([gc!['situacao'], gc!['observacao'], gc!['excluido_em']]).toEqual([
      'cancelado',
      'Cancelado: Registrado no setor errado',
      null,
    ]);
    await expect(
      porta.cancelar(ctx(), c.id, { motivo: 'Registrado no setor errado', versao: 2 }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    expect(await contar()).toBe(4);

    const [tr] = await ler(
      'SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? AND usuario_id = ?',
      [m.est, m.usuario],
    );
    expect(Number(tr!['n'])).toBeGreaterThanOrEqual(6);

    const lista = await porta.consumos(ctx(), { de: DIA, ate: DIA, setor: String(m.setorA) });
    expect(lista.map((x) => x.situacao).sort()).toEqual(['cancelado', 'encerrado', 'encerrado']);
  });

  it('apura por setor e período: pacientes + setor sem paciente, com as parcelas e sem o cancelado', async () => {
    // Uso de paciente no setor A pela porta do uso por paciente: 10:00 às 12:00 a 2 L/min = 240 L.
    const u = await usoPaciente.iniciar(ctx(), {
      atendimento: m.atd,
      insumo: m.o2,
      fluxoLitrosMinuto: 2,
      inicio: as('10:00'),
      setor: m.setorA,
    });
    await usoPaciente.encerrar(ctx(), u.id, { fim: as('12:00'), versao: 1 });

    const r = await porta.apurar(ctx(), { de: DIA, ate: DIA });
    const a = r.itens.find((x) => x.setor === m.setorA)!;
    const b = r.itens.find((x) => x.setor === m.setorB)!;
    expect(a.pacientes).toEqual({ registros: 1, horas: 2, litros: 240, semVolume: 0 });
    expect(a.setorSemPaciente).toEqual({ registros: 2, horas: 1.5, litros: 420, semVolume: 0 });
    expect(a.total).toEqual({ registros: 3, horas: 3.5, litros: 660, semVolume: 0 });
    expect(b.total).toEqual({ registros: 1, horas: 0.25, litros: 150, semVolume: 0 });

    // Só o setor B; e um período que não toca o dia não traz nada.
    const sb = await porta.apurar(ctx(), { de: DIA, ate: DIA, setor: String(m.setorB) });
    expect(sb.itens.map((x) => x.setor)).toEqual([m.setorB]);
    const antes = new Date(Date.parse(DIA) - 10 * 86_400_000).toISOString().slice(0, 10);
    const vazio = await porta.apurar(ctx(), { de: antes, ate: antes });
    expect(vazio.itens).toEqual([]);
    // Período invertido: entrada inválida (400), conferida antes de ler.
    await expect(porta.apurar(ctx(), { de: DIA, ate: antes })).rejects.toMatchObject({
      problema: { status: 400 },
    });
  });
});
