// Contrato de efeito dos gases medicinais por tempo de uso (F3.4, 04-INT linha 82) contra o MariaDB real (cliente de
// teste). Massa SINTÉTICA: estabelecimento com o código do teste, dois gases (insumo e item faturável fictícios),
// atendimento e conta fictícios (chaves de catálogo desligadas só no preparo); usuário, paciente, fonte pagadora e tipo
// de conta são ids já existentes do cliente de teste (só lidos, nunca alterados).
// Prova o que fica no banco: o uso com início e fim e as horas apuradas, a troca de fluxo que encerra o anterior e o
// aponta, o cancelamento sem apagar, a regra com faixas e simultâneo, e o lançamento na conta (item com a quantidade da
// regra, memória com os passos, usos faturados apontando a conta, conta não calculada).
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaGasMedicinalPropria } from './gas-medicinal-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'f343gas';

interface Massa {
  est: number;
  usuario: number;
  atd: number;
  conta: number;
  o2: number;
  ar: number;
  fatO2: number;
  fatAr: number;
}

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  await e.executar(
    `DELETE m FROM conta_hospitalar_item_memoria m JOIN conta_hospitalar_item i ON i.id = m.conta_hospitalar_item_id
       JOIN conta_hospitalar c ON c.id = i.conta_hospitalar_id WHERE c.estabelecimento_id IN ${est}`,
    [P],
  );
  await e.executar(
    `DELETE i FROM conta_hospitalar_item i JOIN conta_hospitalar c ON c.id = i.conta_hospitalar_id
      WHERE c.estabelecimento_id IN ${est}`,
    [P],
  );
  await e.executar('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await e.executar(`DELETE FROM uso_gas_medicinal WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(
      `DELETE f FROM regra_cobranca_gas_faixa f JOIN regra_cobranca_gas r ON r.id = f.regra_cobranca_gas_id
        WHERE r.estabelecimento_id IN ${est}`,
      [P],
    );
    await e.executar(
      `DELETE s FROM regra_cobranca_gas_simultaneo s JOIN regra_cobranca_gas r ON r.id = s.regra_cobranca_gas_id
        WHERE r.estabelecimento_id IN ${est}`,
      [P],
    );
    await e.executar(`DELETE FROM regra_cobranca_gas WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM conta_hospitalar WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM atendimento WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar('DELETE FROM item_faturavel WHERE codigo LIKE ?', [`${P}-%`]);
    await e.executar('DELETE FROM insumo WHERE codigo LIKE ?', [`${P}-%`]);
    await e.executar('DELETE FROM grupo_faturamento WHERE codigo = ?', [`${P}-GF`]);
  } finally {
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

describe.skipIf(SEM_BANCO)('PortaGasMedicinalPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaGasMedicinalPropria;
  let m: Massa;
  const ctx = () => ({ cliente: CLIENTE, hospital: P, usuario: m.usuario, correlacao: P });
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;
  const antes = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const usuario = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const paciente = await e.uma('SELECT MIN(id) AS id FROM paciente WHERE excluido_em IS NULL');
      const fonte = await e.uma('SELECT MIN(id) AS id FROM fonte_pagadora');
      const tipoConta = await e.uma('SELECT MIN(id) AS id FROM tipo_conta');
      if (!usuario?.['id'] || !paciente?.['id'] || !fonte?.['id'] || !tipoConta?.['id'])
        throw new Error('O cliente de teste precisa de usuário, paciente, fonte pagadora e tipo de conta.');
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      const gf = await e.inserir(
        `INSERT INTO grupo_faturamento (codigo, descricao, tipo_grupo, criado_em) VALUES (?, 'GASES F343', 'gas', ?)`,
        [`${P}-GF`, agora],
      );
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      try {
        const gas = async (sufixo: string) => {
          const insumo = await e.inserir(
            `INSERT INTO insumo (codigo, nome, tipo, grupo_insumo_id, estoque_unidade_medida_id, criado_em)
             VALUES (?, ?, 'gas_medicinal', 1, 1, ?)`,
            [`${P}-${sufixo}`, `Gás sintético ${sufixo}`, agora],
          );
          const fat = await e.inserir(
            `INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, insumo_id, criado_em)
             VALUES (?, ?, 'gas', ?, ?, ?)`,
            [`${P}-F${sufixo}`.slice(0, 20), `GAS SINTETICO ${sufixo}`, gf, insumo, agora],
          );
          await e.executar('UPDATE insumo SET item_faturavel_id = ? WHERE id = ?', [fat, insumo]);
          return [insumo, fat] as const;
        };
        const [o2, fatO2] = await gas('O2');
        const [ar, fatAr] = await gas('AR');
        const atd = await e.inserir(
          `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
             carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em)
           VALUES (?, ?, ?, 1, 1, ?, 1, NOW(3) - INTERVAL 2 DAY, ?)`,
          [est, `${P}-1`, paciente['id'], fonte['id'], agora],
        );
        const conta = await e.inserir(
          `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
             tipo_conta_id, natureza, competencia, inicio_em, calculada, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, 'internacao', ?, NOW(3) - INTERVAL 2 DAY, TRUE, ?)`,
          [
            est,
            `${P}-C1`,
            atd,
            paciente['id'],
            fonte['id'],
            tipoConta['id'],
            `${agora.toISOString().slice(0, 7)}-01`,
            agora,
          ],
        );
        return { est, usuario: Number(usuario['id']), atd, conta, o2, ar, fatO2, fatAr };
      } finally {
        await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      }
    });
    porta = new PortaGasMedicinalPropria(nucleo, CLIENTE);
  }, 60_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar?.();
    }
  });

  it('uso: inicia, recusa o segundo aberto do mesmo gás, troca o fluxo encerrando o anterior, encerra com horas e cancela sem apagar', async () => {
    const a = await porta.iniciar(ctx(), {
      atendimento: m.atd,
      insumo: m.o2,
      fluxoLitrosMinuto: 2,
      inicio: antes(300),
    });
    await expect(
      porta.iniciar(ctx(), { atendimento: m.atd, insumo: m.o2, inicio: antes(290) }),
    ).rejects.toMatchObject({
      problema: { status: 422 },
    });
    const b = await porta.iniciar(ctx(), {
      atendimento: m.atd,
      insumo: m.o2,
      fluxoLitrosMinuto: 4,
      inicio: antes(240),
      usoAnterior: a.id,
    });
    const [ua] = await ler('SELECT situacao, horas_uso, versao FROM uso_gas_medicinal WHERE id = ?', [a.id]);
    expect([ua!['situacao'], Number(ua!['horas_uso']), Number(ua!['versao'])]).toEqual(['encerrado', 1, 2]);
    const [ub] = await ler(
      'SELECT uso_anterior_id, item_faturavel_id, registrado_por_usuario_id, situacao FROM uso_gas_medicinal WHERE id = ?',
      [b.id],
    );
    expect([
      Number(ub!['uso_anterior_id']),
      Number(ub!['item_faturavel_id']),
      Number(ub!['registrado_por_usuario_id']),
    ]).toEqual([a.id, m.fatO2, m.usuario]);
    await expect(porta.encerrar(ctx(), b.id, { fim: antes(300), versao: 1 })).rejects.toMatchObject({
      problema: { status: 422 },
    });
    expect((await porta.encerrar(ctx(), b.id, { fim: antes(120), versao: 1 })).horasUso).toBe(2);
    // Ar comprimido sobreposto ao oxigênio por 1 h; um terceiro uso lançado por engano é cancelado.
    const c = await porta.iniciar(ctx(), {
      atendimento: m.atd,
      insumo: m.ar,
      fluxoLitrosMinuto: 1,
      inicio: antes(180),
    });
    await porta.encerrar(ctx(), c.id, { fim: antes(120), versao: 1 });
    const d = await porta.iniciar(ctx(), { atendimento: m.atd, insumo: m.o2, inicio: antes(60) });
    await porta.cancelar(ctx(), d.id, { motivo: 'Registrado no paciente errado', versao: 1 });
    const [ud] = await ler('SELECT situacao, excluido_em FROM uso_gas_medicinal WHERE id = ?', [d.id]);
    expect([ud!['situacao'], ud!['excluido_em']]).toEqual(['cancelado', null]);
    expect((await porta.usos(ctx(), m.atd)).map((u) => u.situacao)).toEqual([
      'cancelado',
      'encerrado',
      'encerrado',
      'encerrado',
    ]);
  });

  it('lança na conta pela regra: sem regra recusa; com regra grava item, memória, usos faturados e conta não calculada', async () => {
    await expect(porta.lancarNaConta(ctx(), m.atd)).rejects.toMatchObject({ problema: { status: 422 } });
    const hoje = new Date().toISOString().slice(0, 10);
    await expect(
      porta.incluirRegra(ctx(), {
        gas: m.fatO2,
        unidade: 'fracao_hora',
        vigenciaInicio: '2020-01-01',
      }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    const regra = await porta.incluirRegra(ctx(), {
      gas: m.fatO2,
      unidade: 'hora',
      toleranciaMinutos: 0,
      vigenciaInicio: '2020-01-01',
      simultaneos: [{ gas: m.fatAr, tratamento: 'cobra_com_desconto', percentual: 50 }],
    });
    await expect(
      porta.incluirRegra(ctx(), { gas: m.fatO2, unidade: 'hora', vigenciaInicio: hoje }),
    ).rejects.toMatchObject({ problema: { status: 409 } });
    await porta.incluirRegra(ctx(), {
      gas: m.fatAr,
      unidade: 'minuto',
      vigenciaInicio: '2020-01-01',
      faixas: [
        { horasInicio: 0, horasFim: 2, quantidade: 1 },
        { horasInicio: 2, horasFim: null, quantidade: 3 },
      ],
    });
    const [rf] = await ler(
      'SELECT COUNT(*) AS n FROM regra_cobranca_gas_simultaneo WHERE regra_cobranca_gas_id = ?',
      [regra.id],
    );
    expect(Number(rf!['n'])).toBe(1);

    const r = await porta.lancarNaConta(ctx(), m.atd);
    expect(r.itens).toHaveLength(2);
    const itens = await ler(
      `SELECT item_faturavel_id, quantidade, valor_unitario, situacao, tipo_valorizacao FROM conta_hospitalar_item
        WHERE conta_hospitalar_id = ? ORDER BY item_faturavel_id`,
      [m.conta],
    );
    // O2: 3 h de uso, 1 h sobreposta ao ar com 50% => 2,5 h, por hora para cima => 3. Ar: 1 h na primeira faixa => 1.
    const porItem = new Map(itens.map((i) => [Number(i['item_faturavel_id']), Number(i['quantidade'])]));
    expect([porItem.get(m.fatO2), porItem.get(m.fatAr)]).toEqual([3, 1]);
    expect(itens.every((i) => i['situacao'] === 'lancado' && i['tipo_valorizacao'] === 'tabela')).toBe(true);
    const mem = await ler<{ dados: unknown }>(
      `SELECT m.dados FROM conta_hospitalar_item_memoria m JOIN conta_hospitalar_item i ON i.id = m.conta_hospitalar_item_id
        WHERE i.conta_hospitalar_id = ? AND m.operacao = 'inclusao'`,
      [m.conta],
    );
    expect(mem).toHaveLength(2);
    expect(JSON.stringify(mem[0]!.dados)).toContain('gas_tempo_uso');
    const usos = await ler(
      `SELECT situacao, faturado, conta_hospitalar_id FROM uso_gas_medicinal WHERE atendimento_id = ? AND situacao = 'encerrado'`,
      [m.atd],
    );
    expect(
      usos.every((u) => Number(u['faturado']) === 1 && Number(u['conta_hospitalar_id']) === m.conta),
    ).toBe(true);
    const [conta] = await ler('SELECT calculada FROM conta_hospitalar WHERE id = ?', [m.conta]);
    expect(Number(conta!['calculada'])).toBe(0);
    // Nada mais a lançar; o uso faturado não se cancela (acerto pela conta).
    await expect(porta.lancarNaConta(ctx(), m.atd)).rejects.toMatchObject({ problema: { status: 422 } });
  });
});
