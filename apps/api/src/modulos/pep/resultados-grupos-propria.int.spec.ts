// Contrato de efeito dos grupos comparativos de resultados e do filtro salvo (F3.3, linha 03-PEP L128) contra o
// MariaDB real (cliente de teste). Massa SINTÉTICA: estabelecimento, exames, analitos, pedidos e resultados com o
// prefixo do teste (chaves desligadas só no preparo); usuário, paciente e profissional são ids já existentes do
// cliente de teste (só lidos). Prova o que fica no banco: o grupo e os itens em ordem (reordenar, tirar item, versão
// velha recusada, analito de outro exame recusado), o filtro do usuário com um só padrão e a remoção dele, e o
// comparativo (recorte por atendimento e por período, faixa, crítico, tendência, preliminar e pedidos pendentes).
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaGruposResultadoPropria } from './resultados-grupos-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'l128gr';
const DIA = 86_400_000;

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  const req = `(SELECT id FROM requisicao_exame WHERE estabelecimento_id IN ${est})`;
  const item = `(SELECT id FROM exame_item WHERE requisicao_exame_id IN ${req})`;
  await e.executar(
    `DELETE FROM resultado_analito WHERE resultado_exame_id IN (SELECT id FROM resultado_exame WHERE exame_item_id IN ${item})`,
    [P],
  );
  await e.executar(`DELETE FROM resultado_exame WHERE exame_item_id IN ${item}`, [P]);
  await e.executar(`DELETE FROM exame_item WHERE requisicao_exame_id IN ${req}`, [P]);
  await e.executar(`DELETE FROM requisicao_exame WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(
    "DELETE FROM painel_resultado_grupo_exame WHERE painel_resultado_grupo_id IN (SELECT id FROM painel_resultado_grupo WHERE nome LIKE 'l128 %')",
  );
  await e.executar("DELETE FROM painel_resultado_grupo WHERE nome LIKE 'l128 %'");
  await e.executar("DELETE FROM filtro_resultado_usuario WHERE nome LIKE 'l128 %'");
  await e.executar('DELETE FROM exame_analito WHERE exame_id IN (SELECT id FROM exame WHERE codigo LIKE ?)', [
    `${P}%`,
  ]);
  await e.executar('DELETE FROM exame WHERE codigo LIKE ?', [`${P}%`]);
  await e.executar('DELETE FROM analito WHERE codigo LIKE ?', [`${P}%`]);
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

interface Massa {
  est: number;
  usuario: number;
  paciente: number;
  exA: number;
  exB: number;
  eaCreat: number;
  eaPot: number;
  eaUreia: number;
  anCreat: number;
  anPot: number;
}

describe.skipIf(SEM_BANCO)('PortaGruposResultadoPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaGruposResultadoPropria;
  let m: Massa;
  const agora = new Date();
  const ctx = () => ({
    cliente: CLIENTE,
    estabelecimento: m.est,
    usuario: m.usuario,
    correlacao: P,
    rede: 'rede-teste',
    hospital: P,
  });
  const ler = <T>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;
  const erro = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return (e as { problema?: { status?: number; codigo?: string } }).problema ?? {};
    }
    throw new Error('Era para recusar.');
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const usuario = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const paciente = await e.uma('SELECT MIN(id) AS id FROM paciente WHERE excluido_em IS NULL');
      const prof = await e.uma('SELECT MIN(id) AS id FROM profissional WHERE excluido_em IS NULL');
      if (!usuario?.['id'] || !paciente?.['id'] || !prof?.['id'])
        throw new Error('O cliente de teste precisa de usuário, paciente e profissional.');
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      const exame = (sufixo: string, nome: string) =>
        e.inserir(
          "INSERT INTO exame (codigo, sigla, nome, tipo_servico, criado_em) VALUES (?, ?, ?, 'laboratorio', ?)",
          [`${P}${sufixo}`, `${P}${sufixo}`, `${P} ${nome}`, agora],
        );
      const analito = (sufixo: string, nome: string) =>
        e.inserir('INSERT INTO analito (codigo, nome, criado_em) VALUES (?, ?, ?)', [
          `${P}${sufixo}`,
          nome,
          agora,
        ]);
      const liga = (ex: number, an: number, ordem: number) =>
        e.inserir('INSERT INTO exame_analito (exame_id, analito_id, ordem, criado_em) VALUES (?, ?, ?, ?)', [
          ex,
          an,
          ordem,
          agora,
        ]);
      const exA = await exame('A', 'Função renal sintética');
      const exB = await exame('B', 'Eletrólitos sintéticos');
      const anCreat = await analito('c', 'Creatinina sintética');
      const anUreia = await analito('u', 'Ureia sintética');
      const anPot = await analito('k', 'Potássio sintético');
      const eaCreat = await liga(exA, anCreat, 1);
      const eaUreia = await liga(exA, anUreia, 2);
      const eaPot = await liga(exB, anPot, 1);
      const pac = Number(paciente['id']);
      let n = 0;
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      try {
        /** Pedido + item + resultado (+ valores); `situacao` nulo deixa o pedido sem resultado (pendente). */
        const resultado = async (
          ex: number,
          atend: number,
          quando: Date,
          situacao: 'liberado' | 'conferido' | null,
          valores: { analito: number; valor: number; min?: number; max?: number; critMax?: number }[],
        ) => {
          const rq = await e.inserir(
            `INSERT INTO requisicao_exame (estabelecimento_id, numero, paciente_id, atendimento_id, setor_diagnostico_id,
               solicitante_profissional_id, fonte_pagadora_id, solicitado_em, criado_em)
             VALUES (?, ?, ?, ?, 1, ?, 1, ?, ?)`,
            [est, `${P}-${++n}`, pac, atend, prof['id'], quando, agora],
          );
          const it = await e.inserir(
            'INSERT INTO exame_item (requisicao_exame_id, sequencia, exame_id, criado_em) VALUES (?, 1, ?, ?)',
            [rq, ex, agora],
          );
          if (!situacao) return;
          const re = await e.inserir(
            `INSERT INTO resultado_exame (exame_item_id, paciente_id, setor_diagnostico_id, resultado_em, situacao,
               liberado_em, autoliberado, criado_em) VALUES (?, ?, 1, ?, ?, ?, TRUE, ?)`,
            [it, pac, quando, situacao, situacao === 'liberado' ? quando : null, agora],
          );
          for (const [i, v] of valores.entries())
            await e.inserir(
              `INSERT INTO resultado_analito (resultado_exame_id, sequencia, analito_id, valor_numerico,
                 referencia_minimo, referencia_maximo, critico_maximo, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [re, i + 1, v.analito, v.valor, v.min ?? null, v.max ?? null, v.critMax ?? null, agora],
            );
        };
        const h = (dias: number) => new Date(agora.getTime() - dias * DIA);
        // Atendimento 9128001 (atual): duas coletas da função renal, um potássio crítico, um conferido e um pendente.
        await resultado(exA, 9128001, h(2), 'liberado', [
          { analito: anCreat, valor: 1, min: 0.6, max: 1.2 },
          { analito: anUreia, valor: 30, min: 15, max: 45 },
        ]);
        await resultado(exA, 9128001, h(1), 'liberado', [
          { analito: anCreat, valor: 1.8, min: 0.6, max: 1.2 },
          { analito: anUreia, valor: 31, min: 15, max: 45 },
        ]);
        await resultado(exB, 9128001, h(1), 'liberado', [
          { analito: anPot, valor: 7, min: 3.5, max: 5, critMax: 6.5 },
        ]);
        await resultado(exB, 9128001, h(0.5), 'conferido', [
          { analito: anPot, valor: 5.9, min: 3.5, max: 5 },
        ]);
        await resultado(exB, 9128001, h(0.2), null, []);
        // Atendimento antigo (9128002), há 60 dias.
        await resultado(exA, 9128002, h(60), 'liberado', [
          { analito: anCreat, valor: 0.9, min: 0.6, max: 1.2 },
        ]);
      } finally {
        await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      }
      return {
        est,
        usuario: Number(usuario['id']),
        paciente: pac,
        exA,
        exB,
        eaCreat,
        eaPot,
        eaUreia,
        anCreat,
        anPot,
      };
    });
    porta = new PortaGruposResultadoPropria(nucleo, CLIENTE);
  }, 120_000);

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
    await nucleo.encerrar();
  }, 120_000);

  let grupo = 0;

  it('grupo: itens em ordem, reordenar, tirar item, versão velha e analito de outro exame recusados', async () => {
    const base = { nome: 'l128 Renal e potássio', tipoExame: 'laboratorio' };
    ({ id: grupo } = await porta.gravarGrupo(ctx(), {
      ...base,
      itens: [
        { exame: m.exA, exameAnalito: null, rotulo: null },
        { exame: m.exB, exameAnalito: m.eaPot, rotulo: 'K' },
      ],
    }));
    const itens = () =>
      ler<Record<string, unknown>>(
        `SELECT exame_id, exame_analito_id, sequencia, rotulo FROM painel_resultado_grupo_exame
          WHERE painel_resultado_grupo_id = ? ORDER BY sequencia`,
        [grupo],
      );
    const [g] = await ler<Record<string, unknown>>(
      'SELECT tipo_exame, ativo, versao, criado_por FROM painel_resultado_grupo WHERE id = ?',
      [grupo],
    );
    expect(g).toMatchObject({ tipo_exame: 'laboratorio', versao: 1 });
    expect(Number(g!['criado_por'])).toBe(m.usuario);
    expect((await itens()).map((i) => [Number(i['exame_id']), Number(i['sequencia'])])).toEqual([
      [m.exA, 1],
      [m.exB, 2],
    ]);

    // Reordena (o potássio primeiro) com a versão lida.
    await porta.gravarGrupo(ctx(), {
      ...base,
      id: grupo,
      versao: 1,
      itens: [
        { exame: m.exB, exameAnalito: m.eaPot, rotulo: 'K' },
        { exame: m.exA, exameAnalito: null, rotulo: null },
      ],
    });
    expect((await itens()).map((i) => Number(i['exame_id']))).toEqual([m.exB, m.exA]);
    expect((await itens())[0]!['rotulo']).toBe('K');

    expect(
      (await erro(porta.gravarGrupo(ctx(), { ...base, id: grupo, versao: 1, itens: [{ exame: m.exA }] })))
        .codigo,
    ).toBe('conflito-versao');
    expect(
      (
        await erro(
          porta.gravarGrupo(ctx(), {
            ...base,
            nome: 'l128 X',
            itens: [{ exame: m.exA, exameAnalito: m.eaPot }],
          }),
        )
      ).codigo,
    ).toBe('analito-de-outro-exame');
    expect(
      (
        await erro(
          porta.gravarGrupo(ctx(), {
            ...base,
            nome: 'l128 Y',
            itens: [{ exame: m.exA }, { exame: m.exA, exameAnalito: m.eaCreat }],
          }),
        )
      ).codigo,
    ).toBe('item-redundante');
    expect(
      await ler('SELECT id FROM painel_resultado_grupo WHERE nome IN (?, ?)', ['l128 X', 'l128 Y']),
    ).toEqual([]);

    // Tira o potássio do grupo e volta com ele: a ordem da chave única não colide.
    await porta.gravarGrupo(ctx(), { ...base, id: grupo, versao: 2, itens: [{ exame: m.exA }] });
    expect((await itens()).map((i) => Number(i['exame_id']))).toEqual([m.exA]);
    await porta.gravarGrupo(ctx(), {
      ...base,
      id: grupo,
      versao: 3,
      itens: [{ exame: m.exA }, { exame: m.exB, exameAnalito: m.eaPot, rotulo: 'K' }],
    });
    expect((await itens()).map((i) => Number(i['sequencia']))).toEqual([1, 2]);
    const lidos = await porta.grupos(ctx());
    expect(lidos.find((x) => x.id === grupo)?.itens.map((i) => i.nomeAnalito)).toEqual([
      null,
      'Potássio sintético',
    ]);
  });

  it('filtro: só do usuário, um padrão por vez, critérios gravados e remoção', async () => {
    const f1 = await porta.gravarFiltro(ctx(), {
      nome: 'l128 UTI',
      padrao: true,
      grupos: [grupo],
      periodoDias: 7,
    });
    const f2 = await porta.gravarFiltro(ctx(), {
      nome: 'l128 Tudo',
      padrao: true,
      escopo: 'todos',
      grupos: [grupo],
      exames: [m.exB],
      somenteLiberados: false,
      incluirPendentes: true,
    });
    const linhas = await ler<Record<string, unknown>>(
      `SELECT id, usuario_id, padrao, escopo_atendimento, criterios FROM filtro_resultado_usuario
        WHERE nome LIKE 'l128 %' ORDER BY id`,
    );
    expect(linhas.map((l) => [Number(l['id']), Number(l['padrao'])])).toEqual([
      [f1.id, 0],
      [f2.id, 1],
    ]);
    expect(linhas.every((l) => Number(l['usuario_id']) === m.usuario)).toBe(true);
    const crit = linhas[1]!['criterios'];
    expect(typeof crit === 'string' ? JSON.parse(crit) : crit).toEqual({ grupos: [grupo], exames: [m.exB] });
    expect((await erro(porta.gravarFiltro(ctx(), { nome: 'l128 UTI', grupos: [grupo] }))).codigo).toBe(
      'nome-repetido',
    );
    expect((await erro(porta.gravarFiltro(ctx(), { nome: 'l128 vazio' }))).codigo).toBe('filtro-vazio');
    // Outro usuário não enxerga nem remove o filtro.
    expect(
      (await erro(porta.excluirFiltro({ ...ctx(), usuario: m.usuario + 999_999 }, f1.id, 1))).codigo,
    ).toBe('nao-encontrado');
    await porta.excluirFiltro(ctx(), f1.id, 2);
    expect(await ler('SELECT id FROM filtro_resultado_usuario WHERE id = ?', [f1.id])).toEqual([]);
  });

  it('comparativo: atendimento, período, faixa, crítico, tendência, preliminar e pendentes', async () => {
    const doAtd = await porta.comparativo(ctx(), m.paciente, { grupo, atendimento: 9128001 });
    expect(doAtd.linhas.map((l) => l.rotulo)).toEqual(['Creatinina sintética', 'Ureia sintética', 'K']);
    const creat = doAtd.linhas[0]!;
    expect(creat.celulas.map((c) => c.situacao)).toEqual(['normal', 'acima']);
    expect(creat.tendencia).toBe('subindo');
    expect(creat.variacao).toBe(80);
    expect(doAtd.linhas[2]!.celulas.map((c) => c.situacao)).toEqual(['critico']);
    expect(doAtd.criticos).toBe(1);
    expect(doAtd.foraDaFaixa).toBe(1);
    expect(doAtd.pendentes).toEqual([]);

    // Sem atendimento e sem período: entra a coleta antiga; com 30 dias, sai.
    const todos = await porta.comparativo(ctx(), m.paciente, { grupo });
    expect(todos.linhas[0]!.celulas).toHaveLength(3);
    const recorte = await porta.comparativo(ctx(), m.paciente, { grupo, dias: 30 });
    expect(recorte.linhas[0]!.celulas).toHaveLength(2);

    // O filtro padrão ("l128 Tudo"): além dos liberados (o conferido vem como preliminar) e os pedidos pendentes.
    const padrao = await porta.comparativo(ctx(), m.paciente, {});
    expect(padrao.filtroAplicado?.nome).toBe('l128 Tudo');
    const pot = padrao.linhas.find((l) => l.analito === m.anPot)!;
    expect(pot.celulas.map((c) => c.preliminar)).toEqual([false, true]);
    // Pendentes: o pedido sem resultado e o conferido ainda não liberado.
    expect(padrao.pendentes).toHaveLength(2);
  });
});
