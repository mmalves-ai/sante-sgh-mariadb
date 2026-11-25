// Contrato de efeito da soroteca (F8, 05-SADT linha 9) no MariaDB real (cliente f22_o2; massa SINTÉTICA). Prova o que
// fica no banco: o cadastro do equipamento e do rack (recusa da faixa de temperatura invertida sem gravar), a regra de
// descarte de maior prioridade dando o prazo da guarda, a guarda na primeira posição livre com o movimento de entrada e
// o responsável, a recusa da posição ocupada e da amostra já guardada, a retirada provisória com motivo e a devolução à
// mesma posição, o expurgo recusado fora do prazo e com motivo errado (sem mudar nada) e o expurgo das vencidas que só
// marca o descarte (a guarda continua no banco, com o movimento), a trilha de cada gravação, a desativação que não
// apaga e a recusa de desativar equipamento com amostra guardada. Saída só com contagens.
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ServicoSoroteca } from './soroteca-propria.js';
import {
  CLIENTE,
  contexto,
  limparMassaSadt,
  type MassaSadt,
  montarMassaSadt,
  SEM_BANCO,
} from './copia.spec-util.js';

const codigoDe = (e: unknown) => (e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e));

describe.skipIf(SEM_BANCO)('soroteca (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let s: ServicoSoroteca;
  let m: MassaSadt | null = null;
  const ids = { amostra1: 0, amostra2: 0, reteste: 0, vencido: 0, transf: 0, codigo1: '', codigo2: '' };
  const ctx = () => ({ cliente: CLIENTE, correlacao: 't-c1067' });
  const um = (sql: string, p: unknown[]) => nucleo.lerSomente(ctx(), (l) => l.uma(sql, p));
  const contar = async (sql: string, p: unknown[]) => Number((await um(sql, p))?.['n'] ?? 0);
  let seq = 0;
  const chave = () => ({ ...contexto(m!), chaveIdempotencia: `c1067-${m!.marca}-${seq++}` });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassaSadt(nucleo, 'SRT');
    s = new ServicoSoroteca(nucleo);
    await nucleo.escrever(ctx(), async (e) => {
      const agora = new Date();
      const material = Number(
        (await e.uma("SELECT id FROM material_biologico WHERE codigo = 'SANGUE-T'", []))?.['id'] ??
          (await e.uma('SELECT id FROM material_biologico ORDER BY id LIMIT 1', []))?.['id'],
      );
      const amostra = async (cod: string, item: number) => {
        const a = await e.inserir(
          `INSERT INTO amostra_biologica (estabelecimento_id, codigo_barras, requisicao_exame_id, material_biologico_id, situacao, coletada_em, criado_em)
           VALUES (?, ?, ?, ?, 'recebida', ?, ?)`,
          [m!.base.est, cod, m!.requisicao, material, agora, agora],
        );
        await e.inserir(
          'INSERT INTO amostra_biologica_exame (amostra_biologica_id, exame_item_id, criado_em) VALUES (?, ?, ?)',
          [a, item, agora],
        );
        return a;
      };
      ids.codigo1 = `${m!.marca}S1`;
      ids.codigo2 = `${m!.marca}S2`;
      ids.amostra1 = await amostra(ids.codigo1, m!.itemLab);
      ids.amostra2 = await amostra(ids.codigo2, m!.itemLab2);
      const motivo = (cod: string, fin: string, definitiva: boolean) =>
        e.inserir(
          `INSERT INTO motivo_retirada_amostra (codigo, descricao, finalidade, definitiva, ativo, criado_em)
           VALUES (?, ?, ?, ?, TRUE, ?)`,
          [`${m!.marca}${cod}`, `MOTIVO ${cod} SINTETICO`, fin, definitiva, agora],
        );
      ids.reteste = await motivo('R', 'reteste', false);
      ids.vencido = await motivo('V', 'prazo_vencido', true);
      ids.transf = await motivo('T', 'transferencia', true);
    });
  }, 60_000);

  afterAll(async () => {
    if (m) {
      const est = m.base.est;
      await nucleo.escrever(ctx(), async (e) => {
        const x = (sql: string, p: unknown[]) => e.executar(sql, p);
        await x(
          'DELETE mv FROM movimento_guarda_amostra mv JOIN guarda_amostra g ON g.id = mv.guarda_amostra_id WHERE g.estabelecimento_id = ?',
          [est],
        );
        await x('DELETE FROM guarda_amostra WHERE estabelecimento_id = ?', [est]);
        await x('DELETE FROM suporte_guarda_amostra WHERE estabelecimento_id = ?', [est]);
        await x('DELETE FROM equipamento_guarda_amostra WHERE estabelecimento_id = ?', [est]);
        await x('DELETE FROM regra_descarte_amostra WHERE estabelecimento_id = ?', [est]);
        // Os eventos da amostra (guarda e descarte) citam o motivo: saem antes dele (a massa apaga o resto).
        await x(
          'DELETE ev FROM amostra_biologica_evento ev JOIN amostra_biologica a ON a.id = ev.amostra_biologica_id WHERE a.estabelecimento_id = ?',
          [est],
        );
        await x('DELETE FROM motivo_retirada_amostra WHERE id IN (?, ?, ?)', [
          ids.reteste,
          ids.vencido,
          ids.transf,
        ]);
      });
    }
    await limparMassaSadt(nucleo, m);
    await nucleo.encerrar();
  }, 60_000);

  it('cadastra, guarda na posição livre com o prazo da regra, retira, devolve, expurga só o vencido e não apaga', async () => {
    const est = m!.base.est;
    // Cadastro: a regra do domínio recusa antes de gravar.
    expect(
      codigoDe(
        await s
          .incluirEquipamento(chave(), {
            codigo: `${m!.marca}G`,
            descricao: 'GELADEIRA SINTETICA',
            tipo: 'geladeira',
            temperaturaMinima: 8,
            temperaturaMaxima: 2,
          })
          .catch((x: unknown) => x),
      ),
    ).toBe('temperatura-invertida');
    expect(
      await contar('SELECT COUNT(*) AS n FROM equipamento_guarda_amostra WHERE estabelecimento_id = ?', [
        est,
      ]),
    ).toBe(0);
    const equip = (
      await s.incluirEquipamento(chave(), {
        codigo: `${m!.marca}G`,
        descricao: 'GELADEIRA SINTETICA',
        tipo: 'geladeira',
        temperaturaMinima: 2,
        temperaturaMaxima: 8,
      })
    ).id;
    const rack = (
      await s.incluirSuporte(chave(), {
        equipamento: equip,
        codigo: `${m!.marca}R`,
        descricao: 'RACK SINTETICO',
        quantidadeLinhas: 2,
        quantidadeColunas: 2,
        prateleira: 3,
      })
    ).id;
    const geral = (await s.incluirRegra(chave(), { descricao: 'GERAL', abrangencia: 'geral', diasGuarda: 7 }))
      .id;
    await s.incluirRegra(chave(), {
      descricao: 'DO EXAME',
      abrangencia: 'exame',
      exame: m!.exameLab,
      diasGuarda: 30,
      prioridade: 1,
    });
    expect(
      codigoDe(
        await s
          .incluirRegra(chave(), { descricao: 'SEM EXAME', abrangencia: 'exame', diasGuarda: 3 })
          .catch((x: unknown) => x),
      ),
    ).toBe('regra-sem-exame');

    // Guarda sem posição: a primeira livre do rack, com o prazo da regra do exame (30 dias, a de maior prioridade).
    const leitura = await s.amostra(contexto(m!), ids.codigo1);
    expect(leitura.prazo.dias).toBe(30);
    const g1 = (await s.guardar(chave(), { codigo: ids.codigo1, equipamento: equip, suporte: rack })).id;
    const painel = await s.painel(contexto(m!));
    const linha1 = await um(
      `SELECT situacao, linha, coluna, prateleira, DATE_FORMAT(descarte_previsto_em, '%Y-%m-%d') AS d
         FROM guarda_amostra WHERE id = ?`,
      [g1],
    );
    expect(linha1).toMatchObject({ situacao: 'guardada', prateleira: 3 });
    expect([Number(linha1?.['linha']), Number(linha1?.['coluna'])]).toEqual([1, 1]);
    const esperado = new Date(`${painel.hoje}T00:00:00Z`);
    esperado.setUTCDate(esperado.getUTCDate() + 30);
    expect(linha1?.['d']).toBe(esperado.toISOString().slice(0, 10));
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM movimento_guarda_amostra WHERE guarda_amostra_id = ? AND tipo_movimento = 'entrada' AND usuario_id = ?",
        [g1, m!.base.usuario],
      ),
    ).toBe(1);
    expect(painel.suportes.find((x) => x.id === rack)?.sugerida).toEqual({ linha: 1, coluna: 2 });
    // A amostra passa a armazenada no rastreio, com o evento, na mesma transação da guarda.
    expect(await um('SELECT situacao FROM amostra_biologica WHERE id = ?', [ids.amostra1])).toMatchObject({
      situacao: 'armazenada',
    });
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM amostra_biologica_evento WHERE amostra_biologica_id = ? AND evento = 'armazenada'",
        [ids.amostra1],
      ),
    ).toBe(1);

    // Recusas sem gravar: a mesma amostra de novo e a posição ocupada.
    expect(
      codigoDe(
        await s
          .guardar(chave(), { codigo: ids.codigo1, equipamento: equip, suporte: rack })
          .catch((x: unknown) => x),
      ),
    ).toBe('amostra-ja-guardada');
    expect(
      codigoDe(
        await s
          .guardar(chave(), { codigo: ids.codigo2, equipamento: equip, suporte: rack, linha: 1, coluna: 1 })
          .catch((x: unknown) => x),
      ),
    ).toBe('posicao-ocupada');
    expect(await contar('SELECT COUNT(*) AS n FROM guarda_amostra WHERE estabelecimento_id = ?', [est])).toBe(
      1,
    );
    const g2 = (await s.guardar(chave(), { codigo: ids.codigo2, equipamento: equip, suporte: rack })).id;
    const linha2 = await um('SELECT linha, coluna FROM guarda_amostra WHERE id = ?', [g2]);
    expect([Number(linha2?.['linha']), Number(linha2?.['coluna'])]).toEqual([1, 2]);

    // Regra pelo resultado: o resultado digitado depois da guarda muda o prazo vigente (sem regravar a guarda).
    await s.incluirRegra(chave(), {
      descricao: 'RESULTADO ALTO',
      abrangencia: 'resultado',
      exame: m!.exameLab,
      comparador: 'maior',
      valorTexto: '100',
      diasGuarda: 365,
      prioridade: 9,
    });
    const antes = (await s.painel(contexto(m!))).guardas.find((g) => g.id === g2);
    expect(antes?.descartePrevistoEm).toBe(linha1?.['d']);
    await nucleo.escrever(ctx(), async (e) => {
      const agora = new Date();
      const re = await e.inserir(
        `INSERT INTO resultado_exame (exame_item_id, paciente_id, setor_diagnostico_id, resultado_em, situacao, criado_em)
         VALUES (?, ?, ?, ?, 'digitado', ?)`,
        [m!.itemLab2, m!.base.paciente, m!.setorLab, agora, agora],
      );
      await e.inserir(
        'INSERT INTO resultado_analito (resultado_exame_id, sequencia, analito_id, valor_numerico, criado_em) VALUES (?, 1, ?, 150, ?)',
        [re, m!.analito, agora],
      );
    });
    const depois = (await s.painel(contexto(m!))).guardas.find((g) => g.id === g2);
    const ano = new Date(`${painel.hoje}T00:00:00Z`);
    ano.setUTCDate(ano.getUTCDate() + 365);
    expect(depois?.descartePrevistoEm).toBe(ano.toISOString().slice(0, 10));
    expect(depois?.descarteGravadoEm).toBe(linha1?.['d']);
    expect((await s.amostra(contexto(m!), ids.codigo2)).guardas[0]?.descartePrevistoEm).toBe(
      ano.toISOString().slice(0, 10),
    );

    // Motivo de descarte não serve para retirar: só o expurgo descarta.
    expect(codigoDe(await s.retirar(chave(), g1, { motivo: ids.vencido }).catch((x: unknown) => x))).toBe(
      'retirada-para-descarte',
    );
    expect(await um('SELECT situacao FROM guarda_amostra WHERE id = ?', [g1])).toMatchObject({
      situacao: 'guardada',
    });

    // Retirada provisória (reteste) e devolução à mesma posição.
    await s.retirar(chave(), g1, { motivo: ids.reteste, observacao: 'RETESTE' });
    expect(
      await um('SELECT situacao, motivo_retirada_amostra_id AS m FROM guarda_amostra WHERE id = ?', [g1]),
    ).toMatchObject({
      situacao: 'retirada',
    });
    await s.devolver(chave(), g1, {});
    const volta = await um('SELECT situacao, linha, coluna, retirado_em FROM guarda_amostra WHERE id = ?', [
      g1,
    ]);
    expect(volta?.['situacao']).toBe('guardada');
    expect([Number(volta?.['linha']), Number(volta?.['coluna'])]).toEqual([1, 1]);
    expect(volta?.['retirado_em']).toBeNull();

    // Expurgo: fora do prazo e com motivo de reteste são recusados sem mudar nada.
    expect(
      codigoDe(await s.expurgar(chave(), { guardas: [g1], motivo: ids.vencido }).catch((x: unknown) => x)),
    ).toBe('expurgo-fora-do-prazo');
    expect(
      codigoDe(await s.expurgar(chave(), { guardas: [g1], motivo: ids.reteste }).catch((x: unknown) => x)),
    ).toBe('motivo-expurgo');
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM guarda_amostra WHERE estabelecimento_id = ? AND situacao = 'guardada'",
        [est],
      ),
    ).toBe(2);
    // g1 foi guardada há 31 dias (massa): o prazo vigente da regra do exame (30 dias) venceu ontem; a lista de
    // vencidas e o expurgo só levam ela (g2 tem o prazo de 365 dias da regra pelo resultado).
    await nucleo.escrever(ctx(), (e) =>
      e.executar(
        'UPDATE guarda_amostra SET guardado_em = DATE_SUB(guardado_em, INTERVAL 31 DAY) WHERE id = ?',
        [g1],
      ),
    );
    expect((await s.painel(contexto(m!))).vencidas.map((v) => v.id)).toEqual([g1]);
    const r = await s.expurgar(chave(), { guardas: [g1], motivo: ids.vencido, observacao: 'PRAZO' });
    expect(r.descartadas).toBe(1);
    const desc = await um(
      'SELECT situacao, descartado_em IS NOT NULL AS marcado, motivo_retirada_amostra_id AS m FROM guarda_amostra WHERE id = ?',
      [g1],
    );
    expect(desc).toMatchObject({ situacao: 'descartada' });
    expect(Number(desc?.['marcado'])).toBe(1);
    expect(Number(desc?.['m'])).toBe(ids.vencido);
    // A amostra sai do rastreio como descartada, com o evento, e não volta à soroteca com prazo novo.
    expect(await um('SELECT situacao FROM amostra_biologica WHERE id = ?', [ids.amostra1])).toMatchObject({
      situacao: 'descartada',
    });
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM amostra_biologica_evento WHERE amostra_biologica_id = ? AND evento = 'descartada' AND motivo_retirada_amostra_id = ?",
        [ids.amostra1, ids.vencido],
      ),
    ).toBe(1);
    expect(
      codigoDe(
        await s
          .guardar(chave(), { codigo: ids.codigo1, equipamento: equip, suporte: rack })
          .catch((x: unknown) => x),
      ),
    ).toBe('amostra-descartada');
    expect(
      await contar('SELECT COUNT(*) AS n FROM guarda_amostra WHERE amostra_biologica_id = ?', [ids.amostra1]),
    ).toBe(1);
    expect(
      await contar('SELECT COUNT(*) AS n FROM movimento_guarda_amostra WHERE guarda_amostra_id = ?', [g1]),
    ).toBe(4);
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM movimento_guarda_amostra WHERE guarda_amostra_id = ? AND tipo_movimento = 'descarte' AND motivo_retirada_amostra_id = ?",
        [g1, ids.vencido],
      ),
    ).toBe(1);
    // O histórico pela etiqueta: guarda descartada, quatro movimentos; a outra amostra do paciente aparece.
    const hist = await s.amostra(contexto(m!), ids.codigo1);
    expect(hist.guardas.map((g) => g.situacao)).toEqual(['descartada']);
    expect(hist.movimentos.map((x) => x.tipo)).toHaveLength(4);
    expect(hist.doPaciente.map((g) => g.id)).toEqual([g2]);

    // Retirada definitiva (transferência): encerra a guarda (sai das ativas, fica no histórico) e a amostra pode
    // voltar à soroteca numa guarda nova.
    await s.retirar(chave(), g2, { motivo: ids.transf });
    const semG2 = await s.painel(contexto(m!));
    expect(semG2.guardas.map((g) => g.id)).not.toContain(g2);
    expect((await s.amostra(contexto(m!), ids.codigo2)).guardas.map((g) => [g.id, g.situacao])).toEqual([
      [g2, 'retirada'],
    ]);
    expect(codigoDe(await s.devolver(chave(), g2, {}).catch((x: unknown) => x))).toBe('retirada-definitiva');
    const g3 = (await s.guardar(chave(), { codigo: ids.codigo2, equipamento: equip, suporte: rack })).id;
    expect(g3).not.toBe(g2);
    expect((await s.painel(contexto(m!))).guardas.map((g) => g.id)).toContain(g3);

    // Trilha de cada gravação na mesma transação.
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'guarda_amostra' AND entidade_id = ?",
        [g1],
      ),
    ).toBeGreaterThanOrEqual(4);

    // Desativar: equipamento com amostra guardada é recusado; a regra sai de uso sem apagar.
    expect(codigoDe(await s.desativar(chave(), 'equipamento', equip).catch((x: unknown) => x))).toBe(
      'com-amostras',
    );
    await s.desativar(chave(), 'regra', geral);
    expect(await um('SELECT ativo FROM regra_descarte_amostra WHERE id = ?', [geral])).toMatchObject({
      ativo: 0,
    });
  }, 90_000);
});
