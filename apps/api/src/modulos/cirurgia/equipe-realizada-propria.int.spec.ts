// Contrato de efeito da equipe realizada do ato cirúrgico (F3.4, 04-CC linha 95) contra o MariaDB real (cliente de
// teste). Massa SINTÉTICA: estabelecimento com o código do teste, atendimento, ato com dois procedimentos e a equipe
// como lista de membros (troca de anestesista no meio do ato, 1º auxiliar diferente por procedimento, circulante),
// conta aberta com dois itens. Paciente, profissionais, sala, caráter, procedimentos, fonte, tipo de conta e item
// faturável são ids já existentes do cliente de teste (só os ids são lidos).
// Prova o que fica no banco: a leitura da equipe (membro a membro, minutos e percentual); levar à conta grava
// conta_hospitalar_item_participante por procedimento (na vaga do anestesista entra quem ficou mais tempo, o outro
// volta em foraDaVaga; o circulante não entra; o auxiliar só no item do seu procedimento), com a trilha; levar de
// novo não repete; a leitura só oferece procedimento ou honorário vivo de conta editável; item de outra internação,
// procedimento de outro ato e item que não recebe equipe (taxa, estornado) (422) sem escrita; a sessão de outro
// estabelecimento não enxerga o ato (404).
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaEquipeRealizadaPropria } from './equipe-realizada-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'c2001eq';
const P2 = `${P}b`;

type Ids = Record<string, number>;
const n = (v: unknown) => Number(v);

async function limpar(e: Escritor): Promise<void> {
  const est = 'SELECT id FROM estabelecimento WHERE codigo IN (?, ?)';
  const contas = `SELECT id FROM conta_hospitalar WHERE estabelecimento_id IN (${est})`;
  const itens = `SELECT id FROM conta_hospitalar_item WHERE conta_hospitalar_id IN (${contas})`;
  await e.executar(
    `DELETE FROM conta_hospitalar_item_participante WHERE conta_hospitalar_item_id IN (${itens})`,
    [P, P2],
  );
  await e.executar(`DELETE FROM conta_hospitalar_item_memoria WHERE conta_hospitalar_item_id IN (${itens})`, [
    P,
    P2,
  ]);
  await e.executar(`DELETE FROM conta_hospitalar_item WHERE conta_hospitalar_id IN (${contas})`, [P, P2]);
  await e.executar(`DELETE FROM conta_hospitalar WHERE estabelecimento_id IN (${est})`, [P, P2]);
  const atos = `SELECT id FROM ato_cirurgico WHERE estabelecimento_id IN (${est})`;
  await e.executar(`DELETE FROM participante_cirurgia WHERE ato_cirurgico_id IN (${atos})`, [P, P2]);
  await e.executar(`DELETE FROM ato_cirurgico_procedimento WHERE ato_cirurgico_id IN (${atos})`, [P, P2]);
  await e.executar(`DELETE FROM ato_cirurgico WHERE estabelecimento_id IN (${est})`, [P, P2]);
  await e.executar(`DELETE FROM atendimento WHERE estabelecimento_id IN (${est})`, [P, P2]);
  await e.executar('DELETE FROM funcao_equipe_cobranca WHERE codigo LIKE ?', [`${P}%`]);
  await e.executar('DELETE FROM procedimento_cirurgico WHERE codigo IN (?, ?)', [`${P}-PC1`, `${P}-PC2`]);
  await e.executar('DELETE FROM item_faturavel WHERE codigo IN (?, ?)', [P, `${P}-T`]);
  await e.executar('DELETE FROM grupo_faturamento WHERE codigo = ?', [P]);
  await e.executar('DELETE FROM tipo_conta WHERE codigo = ?', [P]);
  await limparTrilhaDaMassa(e, { codigos: [P, P2] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', [P, P2]);
}

describe.skipIf(SEM_BANCO)('PortaEquipeRealizadaPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaEquipeRealizadaPropria;
  const m: Ids = {};
  const ctx = (hospital = P) => ({ cliente: CLIENTE, hospital, usuario: m['usuario']!, correlacao: P });
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<
      Record<string, unknown>[]
    >;
  const equipeDoItem = (item: number) =>
    ler(
      `SELECT p.profissional_id AS prof, f.tipo_funcao AS tipo, p.percentual_cobranca AS perc, p.criado_por
         FROM conta_hospitalar_item_participante p JOIN funcao_equipe_cobranca f ON f.id = p.funcao_equipe_cobranca_id
        WHERE p.conta_hospitalar_item_id = ? AND p.excluido_em IS NULL ORDER BY p.sequencia`,
      [item],
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const um = async (sql: string) => {
        const r = await e.uma(sql);
        const v = r ? Object.values(r)[0] : null;
        if (v === null || v === undefined) throw new Error(`O cliente de teste não tem: ${sql}`);
        return n(v);
      };
      m['usuario'] = await um('SELECT MIN(id) FROM usuario WHERE excluido_em IS NULL');
      m['paciente'] = await um('SELECT MIN(id) FROM paciente');
      const profs = await e.consultar(
        'SELECT id FROM profissional WHERE excluido_em IS NULL ORDER BY id LIMIT 5',
      );
      if (profs.length < 5) throw new Error('O cliente de teste precisa de cinco profissionais.');
      ['cir', 'anA', 'anB', 'aux0', 'aux1'].forEach((k, i) => (m[k] = n(profs[i]!['id'])));
      m['circ'] = m['aux0']!;
      const procCir = (s: string) =>
        e.inserir('INSERT INTO procedimento_cirurgico (codigo, descricao, criado_em) VALUES (?, ?, ?)', [
          `${P}-${s}`,
          `PROCEDIMENTO SINTETICO ${s}`,
          agora,
        ]);
      const procs = [{ id: await procCir('PC1') }, { id: await procCir('PC2') }];
      const at = await e.uma(
        'SELECT categoria_atendimento_id AS c, carater_atendimento_tiss_id AS t, fonte_pagadora_id AS f FROM atendimento LIMIT 1',
      );
      if (!at) throw new Error('O cliente de teste precisa de um atendimento.');
      m['tipoConta'] = await e.inserir(
        "INSERT INTO tipo_conta (codigo, descricao, natureza, criado_em) VALUES (?, ?, 'internacao', ?)",
        [P, `TIPO DE CONTA SINTETICO ${P}`, agora],
      );
      const grupo = await e.inserir(
        "INSERT INTO grupo_faturamento (codigo, descricao, tipo_grupo, criado_em) VALUES (?, ?, 'sadt', ?)",
        [P, `GRUPO SINTETICO ${P}`, agora],
      );
      m['itemFat'] = await e.inserir(
        "INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, criado_em) VALUES (?, ?, 'procedimento', ?, ?)",
        [P, `HONORARIO SINTETICO ${P}`, grupo, agora],
      );
      m['itemFatTaxa'] = await e.inserir(
        "INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, criado_em) VALUES (?, ?, 'taxa', ?, ?)",
        [`${P}-T`, `TAXA SINTETICA ${P}`, grupo, agora],
      );
      m['sala'] = await um('SELECT MIN(id) FROM sala_cirurgica');
      m['carater'] = await um('SELECT MIN(id) FROM carater_cirurgia');
      const funcao = (codigo: string) =>
        um(`SELECT id FROM funcao_equipe_cirurgica WHERE codigo = '${codigo}'`);
      const fCir = await funcao('cirurgiao');
      const fAn = await funcao('anestesista');
      const fAux = await funcao('auxiliar1');
      const fCirc = await funcao('circulante');
      // Funções de cobrança: as que faltarem no cliente de teste entram como sintéticas (com percentual).
      for (const [tipo, ordem, perc] of [
        ['cirurgiao', null, 100],
        ['auxiliar', 1, 30],
        ['anestesista', null, 30],
      ] as const) {
        const ja = await e.uma(
          `SELECT id FROM funcao_equipe_cobranca WHERE ativo = TRUE AND tipo_funcao = ? AND (? IS NULL OR ordem_auxiliar = ?)`,
          [tipo, ordem, ordem],
        );
        if (!ja)
          await e.inserir(
            `INSERT INTO funcao_equipe_cobranca (codigo, descricao, tipo_funcao, ordem_auxiliar, percentual_cobranca, criado_em)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [`${P}-${tipo}`, `FUNCAO SINTETICA ${P}`, tipo, ordem, perc, agora],
          );
      }
      const estab = (codigo: string) =>
        e.inserir(
          `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
           VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
          [codigo, `Hospital sintético ${codigo}`, `Hospital sintético ${codigo} (fictício)`, agora],
        );
      m['est'] = await estab(P);
      await estab(P2);
      const atendimento = (numero: string) =>
        e.inserir(
          `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
             carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, situacao, entrada_em, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'aberto', '2026-01-20 08:00:00', ?)`,
          [m['est'], numero, m['paciente'], at['c'], at['t'], at['f'], m['cir'], agora],
        );
      m['atend'] = await atendimento(`${P}-A1`);
      m['atendOutro'] = await atendimento(`${P}-A2`);
      const ato = (numero: string) =>
        e.inserir(
          `INSERT INTO ato_cirurgico (estabelecimento_id, numero, atendimento_id, paciente_id, sala_cirurgica_id,
             carater_cirurgia_id, entrada_sala_em, inicio_cirurgia_em, fim_cirurgia_em, saida_sala_em, situacao, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, '2026-01-21 08:00:00', '2026-01-21 08:15:00', '2026-01-21 10:45:00',
                   '2026-01-21 11:00:00', 'realizado', ?)`,
          [m['est'], numero, m['atend'], m['paciente'], m['sala'], m['carater'], agora],
        );
      m['ato'] = await ato(`${P}-1`);
      m['atoOutro'] = await ato(`${P}-2`);
      const proc = (a: number, seq: number, pc: unknown) =>
        e.inserir(
          'INSERT INTO ato_cirurgico_procedimento (ato_cirurgico_id, sequencia, procedimento_cirurgico_id, principal, criado_em) VALUES (?, ?, ?, ?, ?)',
          [a, seq, pc, seq === 1, agora],
        );
      m['proc0'] = await proc(m['ato']!, 1, procs[0]!['id']);
      m['proc1'] = await proc(m['ato']!, 2, procs[1]!['id']);
      m['procOutro'] = await proc(m['atoOutro']!, 1, procs[0]!['id']);
      // Equipe: cirurgião o ato todo; anestesista A até 08:40 e B depois (troca); 1º auxiliar diferente por
      // procedimento; circulante (sem honorário).
      let seq = 0;
      const membro = (
        prof: number,
        f: number,
        procId: number,
        entrada: string | null,
        saida: string | null,
        perc: number | null,
      ) =>
        e.inserir(
          `INSERT INTO participante_cirurgia (ato_cirurgico_id, sequencia, profissional_id, funcao_equipe_cirurgica_id,
             ato_cirurgico_procedimento_id, principal, entrada_em, saida_em, percentual_participacao, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [m['ato'], ++seq, prof, f, procId, seq === 1, entrada, saida, perc, agora],
        );
      for (const p of [m['proc0']!, m['proc1']!]) {
        await membro(m['cir']!, fCir, p, null, null, 100);
        await membro(m['anA']!, fAn, p, null, '2026-01-21 08:40:00', 40);
        await membro(m['anB']!, fAn, p, '2026-01-21 08:40:00', null, 40);
        await membro(m['circ']!, fCirc, p, null, null, null);
      }
      await membro(m['aux0']!, fAux, m['proc0']!, null, '2026-01-21 09:30:00', 30);
      await membro(m['aux1']!, fAux, m['proc1']!, '2026-01-21 09:30:00', null, 30);
      const conta = (numero: string, atend: number) =>
        e.inserir(
          `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
             tipo_conta_id, natureza, competencia, inicio_em, situacao, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, 'internacao', '2026-01-01', '2026-01-20 08:00:00', 'aberta', ?)`,
          [m['est'], numero, atend, m['paciente'], at['f'], m['tipoConta'], agora],
        );
      m['conta'] = await conta(`${P}-C1`, m['atend']!);
      m['contaOutra'] = await conta(`${P}-C2`, m['atendOutro']!);
      const item = (c: number, s: number, fat = m['itemFat'], situacao = 'lancado') =>
        e.inserir(
          `INSERT INTO conta_hospitalar_item (conta_hospitalar_id, sequencia, item_faturavel_id, realizado_em, quantidade,
             valor_unitario, valor_honorario, valor_custo_operacional, valor_total, situacao, criado_em)
           VALUES (?, ?, ?, '2026-01-21 10:00:00', 1, 1000, 800, 200, 1000, ?, ?)`,
          [c, s, fat, situacao, agora],
        );
      m['item0'] = await item(m['conta']!, 1);
      m['item1'] = await item(m['conta']!, 2);
      // Itens da mesma conta que não recebem equipe: a taxa (tipo) e o procedimento estornado.
      m['itemTaxa'] = await item(m['conta']!, 3, m['itemFatTaxa']);
      m['itemEstornado'] = await item(m['conta']!, 4, m['itemFat'], 'estornado');
      m['itemOutro'] = await item(m['contaOutra']!, 1);
    });
    porta = new PortaEquipeRealizadaPropria(nucleo, CLIENTE);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, (e) => limpar(e));
    await nucleo.encerrar();
  });

  it('lê a equipe membro a membro, com os minutos e o percentual', async () => {
    const r = await porta.equipe(ctx(), m['ato']!);
    expect(r.procedimentos.map((p) => p.id)).toEqual([m['proc0'], m['proc1']]);
    expect(r.membros).toHaveLength(10);
    const resumo = r.membros
      .filter((x) => x.procedimentoAto === m['proc0'])
      .map((x) => [x.funcao, x.profissional, x.minutos, x.percentual]);
    expect(resumo).toEqual([
      ['cirurgiao', m['cir'], 180, 100],
      ['anestesista', m['anA'], 40, 40],
      ['anestesista', m['anB'], 140, 40],
      ['circulante', m['circ'], 180, null],
      ['auxiliar1', m['aux0'], 90, 30],
    ]);
    expect(r.membros[0]).toMatchObject({ principal: true });
    // Só os itens que recebem equipe: a taxa e o estornado da mesma conta ficam de fora; a situação vem junto.
    expect(r.itensConta.map((i) => [i.id, i.situacao])).toEqual([
      [m['item0'], 'lancado'],
      [m['item1'], 'lancado'],
    ]);
    expect(r.itensContaCortados).toBe(false);
  });

  it('leva a equipe aos itens: troca na vaga, auxiliar por procedimento, sem circulante; sem repetir', async () => {
    const r = await porta.levarParaConta(ctx(), m['ato']!, {
      itens: [
        { procedimento: m['proc0'], item: m['item0'] },
        { procedimento: m['proc1'], item: m['item1'] },
      ],
    });
    expect(r.itens.map((i) => i.incluidos)).toEqual([3, 3]);
    expect(r.itens[0]!.foraDaVaga.map((f) => f.profissional)).toEqual([m['anA']]);
    // A ordem no item é a do faturamento (cirurgião primeiro; os demais pela ordem de apresentação da função de
    // cobrança do cliente, regra de calcularEquipeItem com teste próprio): aqui confere o cirurgião e o conjunto.
    const emOrdem = (l: Record<string, unknown>[]) => [
      [n(l[0]!['prof']), l[0]!['tipo']],
      ...l
        .slice(1)
        .map((x) => [n(x['prof']), x['tipo']])
        .sort((a, b) => String(a[1]).localeCompare(String(b[1]))),
    ];
    const e0 = await equipeDoItem(m['item0']!);
    expect(emOrdem(e0)).toEqual([
      [m['cir'], 'cirurgiao'],
      [m['anB'], 'anestesista'],
      [m['aux0'], 'auxiliar'],
    ]);
    expect(e0.every((x) => n(x['criado_por']) === m['usuario'])).toBe(true);
    const e1 = await equipeDoItem(m['item1']!);
    expect(emOrdem(e1)).toEqual([
      [m['cir'], 'cirurgiao'],
      [m['anB'], 'anestesista'],
      [m['aux1'], 'auxiliar'],
    ]);
    expect(
      await ler("SELECT id FROM trilha_auditoria WHERE entidade = 'ato_cirurgico' AND entidade_id = ?", [
        m['ato'],
      ]),
    ).not.toHaveLength(0);
    const deNovo = await porta.levarParaConta(ctx(), m['ato']!, {
      itens: [{ procedimento: m['proc0'], item: m['item0'] }],
    });
    expect(deNovo.itens[0]!.incluidos).toBe(0);
    expect(await equipeDoItem(m['item0']!)).toHaveLength(3);
  });

  it('recusa item de outra internação e procedimento de outro ato, sem escrita; outro estabelecimento é 404', async () => {
    await expect(
      porta.levarParaConta(ctx(), m['ato']!, { itens: [{ procedimento: m['proc0'], item: m['itemOutro'] }] }),
    ).rejects.toMatchObject({ problema: { status: 422, codigo: 'item-de-outra-internacao' } });
    await expect(
      porta.levarParaConta(ctx(), m['ato']!, { itens: [{ procedimento: m['procOutro'], item: m['item0'] }] }),
    ).rejects.toMatchObject({ problema: { status: 422, codigo: 'procedimento-de-outro-ato' } });
    expect(await equipeDoItem(m['itemOutro']!)).toHaveLength(0);
    // Item que não recebe equipe (taxa; procedimento estornado): 422 item-sem-equipe, nada gravado.
    for (const item of [m['itemTaxa'], m['itemEstornado']])
      await expect(
        porta.levarParaConta(ctx(), m['ato']!, {
          itens: [
            { procedimento: m['proc1'], item: m['item1'] },
            { procedimento: m['proc0'], item },
          ],
        }),
      ).rejects.toMatchObject({ problema: { status: 422, codigo: 'item-sem-equipe' } });
    expect(await equipeDoItem(m['itemTaxa']!)).toHaveLength(0);
    expect(await equipeDoItem(m['itemEstornado']!)).toHaveLength(0);
    await expect(porta.equipe(ctx(P2), m['ato']!)).rejects.toMatchObject({ problema: { status: 404 } });
    await expect(
      porta.levarParaConta(ctx(P2), m['ato']!, { itens: [{ procedimento: m['proc0'], item: m['item0'] }] }),
    ).rejects.toMatchObject({ problema: { status: 404 } });
  });
});
