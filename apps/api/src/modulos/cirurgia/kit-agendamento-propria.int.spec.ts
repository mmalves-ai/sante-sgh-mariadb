// Contrato de efeito do kit padrão no agendamento cirúrgico (F3.6, 05-SUP linha 13) contra o MariaDB real (cliente de
// teste). Massa SINTÉTICA: estabelecimento com o código do teste, dois procedimentos cirúrgicos fictícios, dois kits
// fictícios (um padrão de cada procedimento) e um agendamento fictício; usuário, paciente, cirurgião, caráter e
// produtos do estoque são ids já existentes do cliente de teste (só os ids são lidos).
// Prova o que fica no banco: a sugestão (kit padrão por procedimento, com a composição); aplicar grava uma linha de
// natureza "kit" por kit e procedimento, com a quantidade do vínculo e a sequência, na trilha; aplicar de novo não
// repete; duas aplicações simultâneas deixam uma linha só por kit; escolha fora do padrão e lista fechada (422) sem
// escrita; retirar marca a exclusão sem apagar e o kit volta à sugestão como fora da lista e reentra noutra linha;
// a linha de OPME ou de material avulso não sai pela retirada do kit (422, sem escrita); a sessão de outro
// estabelecimento (que existe) não enxerga o agendamento: sugestão, aplicar e retirar dão 404 do agendamento, sem escrita.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaKitAgendamentoPropria } from './kit-agendamento-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'c1056ka';

interface Massa {
  usuario: number;
  agendamento: number;
  procAg1: number;
  procAg2: number;
  kit1: number;
  kit2: number;
  kitOutro: number;
  /** Segundo agendamento, com uma linha de OPME (implante) e uma de material avulso, fora do kit. */
  agendamento2: number;
  opme: number;
  avulso: number;
}

const P2 = `${P}b`;

async function limpar(e: Escritor): Promise<void> {
  const est = 'SELECT id FROM estabelecimento WHERE codigo = ?';
  const ag = `SELECT id FROM agendamento_cirurgico WHERE estabelecimento_id = (${est})`;
  await e.executar(`DELETE FROM agendamento_cirurgico_material WHERE agendamento_cirurgico_id IN (${ag})`, [
    P,
  ]);
  await e.executar(
    `DELETE FROM agendamento_cirurgico_procedimento WHERE agendamento_cirurgico_id IN (${ag})`,
    [P],
  );
  await e.executar(`DELETE FROM agendamento_cirurgico WHERE estabelecimento_id = (${est})`, [P]);
  await e.executar(
    `DELETE kp FROM kit_material_procedimento kp JOIN kit_material k ON k.id = kp.kit_material_id
      WHERE k.estabelecimento_id = (${est})`,
    [P],
  );
  await e.executar(
    `DELETE ki FROM kit_material_item ki JOIN kit_material k ON k.id = ki.kit_material_id
      WHERE k.estabelecimento_id = (${est})`,
    [P],
  );
  await e.executar(`DELETE FROM kit_material WHERE estabelecimento_id = (${est})`, [P]);
  await e.executar('DELETE FROM procedimento_cirurgico WHERE codigo IN (?, ?)', [`${P}-PC1`, `${P}-PC2`]);
  await limparTrilhaDaMassa(e, { codigos: [P, P2] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', [P, P2]);
}

describe.skipIf(SEM_BANCO)('PortaKitAgendamentoPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaKitAgendamentoPropria;
  let m: Massa;
  const ctx = () => ({ cliente: CLIENTE, hospital: P, usuario: m.usuario, correlacao: P });
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<
      Record<string, unknown>[]
    >;
  const linhas = () =>
    ler(
      `SELECT id, sequencia, natureza, kit_material_id AS kit, agendamento_cirurgico_procedimento_id AS proc,
              quantidade_solicitada AS qtd, criado_por, excluido_em, excluido_por, versao
         FROM agendamento_cirurgico_material WHERE agendamento_cirurgico_id = ? ORDER BY sequencia`,
      [m.agendamento],
    );
  const situacao = (s: string) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: P }, (e) =>
      e.executar('UPDATE agendamento_cirurgico SET situacao = ?, cancelado_em = NOW(3) WHERE id = ?', [
        s,
        m.agendamento,
      ]),
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const usuario = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const g = async (sql: string, args: unknown[], ins: string, iargs: unknown[]) =>
        Number((await e.uma(sql, args))?.['id'] ?? (await e.inserir(ins, iargs)));
      const pf = await g(
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        [`PACIENTE SINTETICO ${P}`],
        'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
        [`PACIENTE SINTETICO ${P}`, agora],
      );
      const paciente = {
        id: await g(
          'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
          [pf],
          "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, 931056, 'ativo', ?)",
          [pf, agora],
        ),
      };
      const cirurgiao = await e.uma('SELECT MIN(id) AS id FROM profissional WHERE excluido_em IS NULL');
      const carater = {
        id: await g(
          'SELECT id FROM carater_cirurgia WHERE codigo = ?',
          [`${P}-ELE`],
          'INSERT INTO carater_cirurgia (codigo, descricao, criado_em) VALUES (?, ?, ?)',
          [`${P}-ELE`, `CARATER SINTETICO ${P}`, agora],
        ),
      };
      const ins = await e.consultar(
        'SELECT id, estoque_unidade_medida_id AS u FROM insumo WHERE excluido_em IS NULL AND estoque_unidade_medida_id IS NOT NULL ORDER BY id LIMIT 2',
      );
      if (!usuario?.['id'] || !cirurgiao?.['id'] || ins.length < 2)
        throw new Error('O cliente de teste precisa de usuário, profissional e dois produtos do estoque.');
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      // Segundo estabelecimento, que existe: a sessão dele não enxerga o agendamento do primeiro.
      await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P2, `Hospital sintético ${P2}`, `Hospital sintético ${P2} (fictício)`, agora],
      );
      const proc = (s: string) =>
        e.inserir('INSERT INTO procedimento_cirurgico (codigo, descricao, criado_em) VALUES (?, ?, ?)', [
          `${P}-${s}`,
          `PROCEDIMENTO SINTETICO ${s}`,
          agora,
        ]);
      const pc1 = await proc('PC1');
      const pc2 = await proc('PC2');
      const kit = (s: string) =>
        e.inserir(
          "INSERT INTO kit_material (estabelecimento_id, codigo, nome, tipo, ativo, criado_em) VALUES (?, ?, ?, 'cirurgia', TRUE, ?)",
          [est, `${P}-${s}`, `KIT SINTETICO ${s}`, agora],
        );
      const kit1 = await kit('K1');
      const kit2 = await kit('K2');
      const kitOutro = await kit('K3');
      for (const [k, i] of [
        [kit1, 0],
        [kit1, 1],
        [kit2, 0],
        [kitOutro, 1],
      ] as const)
        await e.executar(
          `INSERT INTO kit_material_item (kit_material_id, sequencia, insumo_id, unidade_medida_id, quantidade, criado_em)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [k, i + 1, ins[i]!['id'], ins[i]!['u'], i + 2, agora],
        );
      const vinc = (k: number, pc: number, qtd: number, padrao: boolean) =>
        e.executar(
          'INSERT INTO kit_material_procedimento (kit_material_id, procedimento_cirurgico_id, quantidade_kits, padrao, criado_em) VALUES (?, ?, ?, ?, ?)',
          [k, pc, qtd, padrao, agora],
        );
      await vinc(kit1, pc1, 2, true);
      await vinc(kit2, pc2, 1, true);
      await vinc(kitOutro, pc1, 1, false);
      const novoAgendamento = (n: number) =>
        e.inserir(
          `INSERT INTO agendamento_cirurgico (estabelecimento_id, numero, paciente_id, cirurgiao_profissional_id,
                                              carater_cirurgia_id, tipo_cobertura, solicitado_em, situacao, criado_em)
           VALUES (?, ?, ?, ?, ?, 'particular', ?, 'solicitado', ?)`,
          [est, `${P}-${n}`, paciente['id'], cirurgiao['id'], carater['id'], agora, agora],
        );
      const agendamento = await novoAgendamento(1);
      const agendamento2 = await novoAgendamento(2);
      const linhaFora = (seq: number, natureza: string, implante: boolean, i: number) =>
        e.inserir(
          `INSERT INTO agendamento_cirurgico_material (agendamento_cirurgico_id, sequencia, natureza, insumo_id,
                                                      unidade_medida_id, quantidade_solicitada, implante_permanente,
                                                      criado_em)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
          [agendamento2, seq, natureza, ins[i]!['id'], ins[i]!['u'], implante, agora],
        );
      const opme = await linhaFora(1, 'opme', true, 0);
      const avulso = await linhaFora(2, 'material', false, 1);
      const procAg = (pc: number, seq: number) =>
        e.inserir(
          `INSERT INTO agendamento_cirurgico_procedimento (agendamento_cirurgico_id, sequencia, procedimento_cirurgico_id,
                                                          principal, criado_em) VALUES (?, ?, ?, ?, ?)`,
          [agendamento, seq, pc, seq === 1, agora],
        );
      return {
        usuario: Number(usuario['id']),
        agendamento,
        procAg1: await procAg(pc1, 1),
        procAg2: await procAg(pc2, 2),
        kit1,
        kit2,
        kitOutro,
        agendamento2,
        opme,
        avulso,
      };
    });
    porta = new PortaKitAgendamentoPropria(nucleo, CLIENTE);
  }, 60_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar?.();
    }
  });

  it('sugere o kit padrão de cada procedimento com a composição (o kit que não é padrão fica de fora)', async () => {
    const s = await porta.sugestao(ctx(), m.agendamento);
    expect(s.aberta).toBe(true);
    expect(s.materiais).toEqual([]);
    expect(s.sugeridos.map((k) => [k.procedimentoAgendamento, k.kit, k.quantidadeKits, k.jaNaLista])).toEqual(
      [
        [m.procAg1, m.kit1, 2, false],
        [m.procAg2, m.kit2, 1, false],
      ],
    );
    expect(s.sugeridos[0]!.itens.map((i) => i.quantidade)).toEqual([2, 3]);
    expect(s.sugeridos[0]!.principal).toBe(true);
  });

  it('recusa a escolha fora do padrão (422) sem escrever', async () => {
    await expect(
      porta.aplicar(ctx(), m.agendamento, {
        kits: [{ kit: m.kitOutro, procedimentoAgendamento: m.procAg1 }],
      }),
    ).rejects.toMatchObject({ problema: { status: 422, codigo: 'regra-violada' } });
    expect(await linhas()).toEqual([]);
  });

  it('aplica o escolhido, depois todos sem repetir, com a trilha da gravação', async () => {
    const r1 = await porta.aplicar(ctx(), m.agendamento, {
      kits: [{ kit: m.kit1, procedimentoAgendamento: m.procAg1 }],
    });
    expect(r1).toMatchObject({ incluidos: 1, jaNaLista: 0 });
    const r2 = await porta.aplicar(ctx(), m.agendamento, {});
    expect(r2).toMatchObject({ incluidos: 1, jaNaLista: 1 });
    const r3 = await porta.aplicar(ctx(), m.agendamento, {});
    expect(r3).toMatchObject({ incluidos: 0, jaNaLista: 2 });
    const ls = await linhas();
    expect(
      ls.map((l) => [
        Number(l['sequencia']),
        l['natureza'],
        Number(l['kit']),
        Number(l['proc']),
        Number(l['qtd']),
      ]),
    ).toEqual([
      [1, 'kit', m.kit1, m.procAg1, 2],
      [2, 'kit', m.kit2, m.procAg2, 1],
    ]);
    expect(ls.every((l) => Number(l['criado_por']) === m.usuario && l['excluido_em'] === null)).toBe(true);
    const trilha = await ler(
      `SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'agendamento_cirurgico_material' AND entidade_id IN (?, ?)`,
      [ls[0]!['id'], ls[1]!['id']],
    );
    expect(Number(trilha[0]!['n'])).toBeGreaterThanOrEqual(2);
    const s = await porta.sugestao(ctx(), m.agendamento);
    expect(s.sugeridos.every((k) => k.jaNaLista)).toBe(true);
    expect(s.materiais.map((x) => x.nome)).toEqual([`KIT SINTETICO K1`, `KIT SINTETICO K2`]);
  });

  it('retira com a marca de exclusão (nada apagado) e o kit reentra noutra linha', async () => {
    const [l1] = await linhas();
    await expect(
      porta.retirar(ctx(), m.agendamento, Number(l1!['id']), { versao: Number(l1!['versao']) + 5 }),
    ).rejects.toMatchObject({ problema: { status: 409 } });
    await porta.retirar(ctx(), m.agendamento, Number(l1!['id']), { versao: Number(l1!['versao']) });
    const depois = await linhas();
    expect(depois).toHaveLength(2);
    expect(depois[0]!['excluido_em']).not.toBeNull();
    expect(Number(depois[0]!['excluido_por'])).toBe(m.usuario);
    const s = await porta.sugestao(ctx(), m.agendamento);
    expect(s.materiais.map((x) => x.kit)).toEqual([m.kit2]);
    expect(s.sugeridos.find((k) => k.kit === m.kit1)!.jaNaLista).toBe(false);
    expect(await porta.aplicar(ctx(), m.agendamento, {})).toMatchObject({ incluidos: 1 });
    const fim = await linhas();
    expect(fim.map((l) => [Number(l['sequencia']), Number(l['kit']), l['excluido_em'] === null])).toEqual([
      [1, m.kit1, false],
      [2, m.kit2, true],
      [3, m.kit1, true],
    ]);
  });

  it('duas aplicações simultâneas deixam uma linha só por kit', async () => {
    for (const l of (await linhas()).filter((x) => x['excluido_em'] === null))
      await porta.retirar(ctx(), m.agendamento, Number(l['id']), { versao: Number(l['versao']) });
    const rs = await Promise.allSettled([
      porta.aplicar(ctx(), m.agendamento, {}),
      porta.aplicar(ctx(), m.agendamento, {}),
    ]);
    for (const r of rs)
      if (r.status === 'rejected')
        expect(r.reason).toMatchObject({ problema: { codigo: 'gravacao-concorrente' } });
    const vivas = (await linhas()).filter((x) => x['excluido_em'] === null).map((x) => Number(x['kit']));
    expect(vivas.sort()).toEqual([m.kit1, m.kit2].sort());
  });

  it('com a cirurgia cancelada a lista fecha: aplicar e retirar recusados (422) sem escrever', async () => {
    await situacao('cancelado');
    const antes = await linhas();
    await expect(porta.aplicar(ctx(), m.agendamento, {})).rejects.toMatchObject({
      problema: { status: 422 },
    });
    const viva = antes.find((x) => x['excluido_em'] === null)!;
    await expect(
      porta.retirar(ctx(), m.agendamento, Number(viva['id']), { versao: Number(viva['versao']) }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    expect(await linhas()).toEqual(antes);
    expect((await porta.sugestao(ctx(), m.agendamento)).aberta).toBe(false);
  });

  it('a linha de OPME e a de material avulso não saem pela retirada do kit (422, sem escrita)', async () => {
    const lerAg2 = () =>
      ler(
        `SELECT id, natureza, excluido_em, excluido_por, versao FROM agendamento_cirurgico_material
          WHERE agendamento_cirurgico_id = ? ORDER BY sequencia`,
        [m.agendamento2],
      );
    const antes = await lerAg2();
    expect(antes.map((l) => l['natureza'])).toEqual(['opme', 'material']);
    for (const l of antes)
      await expect(
        porta.retirar(ctx(), m.agendamento2, Number(l['id']), { versao: Number(l['versao']) }),
      ).rejects.toMatchObject({ problema: { status: 422, codigo: 'regra-violada', campos: ['natureza'] } });
    expect(await lerAg2()).toEqual(antes);
    expect(antes.every((l) => l['excluido_em'] === null)).toBe(true);
    const s = await porta.sugestao(ctx(), m.agendamento2);
    expect(s.materiais.map((x) => [x.id, x.natureza, x.retiravel])).toEqual([
      [m.opme, 'opme', false],
      [m.avulso, 'material', false],
    ]);
    expect(
      (await porta.sugestao(ctx(), m.agendamento)).materiais.every(
        (x) => x.natureza === 'kit' && x.retiravel,
      ),
    ).toBe(true);
  });

  it('a sessão de outro estabelecimento (que existe) não enxerga o agendamento: 404 do agendamento, sem escrita', async () => {
    const outro = { ...ctx(), hospital: P2 };
    const doAgendamento = { problema: { status: 404, title: 'Agendamento cirúrgico não encontrado' } };
    const antes = await linhas();
    const trilha = () =>
      ler(
        `SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'agendamento_cirurgico_material'
            AND entidade_id IN (SELECT id FROM agendamento_cirurgico_material WHERE agendamento_cirurgico_id = ?)`,
        [m.agendamento],
      );
    const trilhaAntes = await trilha();
    await expect(porta.sugestao(outro, m.agendamento)).rejects.toMatchObject(doAgendamento);
    await expect(porta.aplicar(outro, m.agendamento, {})).rejects.toMatchObject(doAgendamento);
    const viva = antes.find((x) => x['excluido_em'] === null)!;
    await expect(
      porta.retirar(outro, m.agendamento, Number(viva['id']), { versao: Number(viva['versao']) }),
    ).rejects.toMatchObject(doAgendamento);
    expect(await linhas()).toEqual(antes);
    expect(await trilha()).toEqual(trilhaAntes);
  });
});
