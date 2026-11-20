// Painel de leitos e censo sobre a cópia (ficha do M16, regras 1, 3, 4, 5 e seção 10). Só leitura: ocupado = o leito
// marca a internação, conferido com as internações em aberto (diferença = aviso); a trajetória pelos trechos; os
// valores de controle da cópia de referência (dados até 05-06/07/2026); 0 leitura sequencial nas tabelas grandes
// no caminho da tela; consulta cancelada pelo driver. Saída só com contagens.
import { montarPainel, MotorInternacao, relogioDeParede } from '@sgh/dominio-internacao';
import { ErroTempoEsgotado, lerLeiturasPainel, lerMovimentoInternacao } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { codigos, criarNucleo, num } from './escrita.spec-util.js';

const nucleo = codigos.length > 0 ? criarNucleo() : null;
const cod = codigos[0] ?? '';
const ctx = () => ({ rede: nucleo!.rede, hospital: cod, traceId: 'int-m16' });

describe.skipIf(!nucleo)('painel de leitos e censo na cópia', () => {
  beforeAll(async () => {
    await nucleo!.verificarSchema(cod);
  });
  afterAll(async () => {
    await nucleo?.encerrar();
  });

  it('regra 1: ocupados = leitos que marcam internação, conferidos com as internações em aberto', async () => {
    const t0 = performance.now();
    const l = await nucleo!.lerSomente(ctx(), (x) => lerLeiturasPainel(x));
    const ms = Math.round(performance.now() - t0);
    const p = montarPainel(l, {
      intensivas: [3, 7, 8, 9, 17],
      agora: relogioDeParede(Date.now()),
      lidoEm: new Date().toISOString(),
      dadosAte: new Date().toISOString(),
      destino: 'legado',
    });
    const marcados = l.leitos.filter((x) => x.reg > 0).length;
    expect(p.totais.ocupados).toBe(marcados);
    expect(p.totais.leitos).toBe(l.leitos.length);
    // Cópia de referência: 109 leitos, 61 ativos, 24 internados no fim da cópia.
    console.log(
      `[${cod}] painel em ${ms} ms: ${p.totais.leitos} leitos, ${p.totais.ativos} ativos, ${p.totais.ocupados} ocupados, ${l.abertas.length} internações em aberto, ${p.avisos.length} aviso(s) (${[...new Set(p.avisos.map((a) => a.tipo))].join(', ') || 'nenhum'})`,
    );
    expect(l.abertas.length).toBeGreaterThan(0);
    expect(p.avisos.filter((a) => a.tipo === 'internacao-sem-leito-ocupado').length).toBe(
      l.abertas.filter((a) => !l.leitos.some((x) => x.reg === a.reg)).length,
    );
  });

  it('valores de controle da cópia: internações por ano, caráter, clínica e motivo de alta (só contagens)', async () => {
    const mov = await nucleo!.lerSomente(ctx(), (x) => lerMovimentoInternacao(x));
    const porAno = new Map<number, number>();
    for (const i of mov.internacoes)
      porAno.set(i.entrada.getUTCFullYear(), (porAno.get(i.entrada.getUTCFullYear()) ?? 0) + 1);
    const conta = (f: (i: (typeof mov.internacoes)[number]) => boolean) => mov.internacoes.filter(f).length;
    const controle = {
      2020: porAno.get(2020),
      2021: porAno.get(2021),
      2022: porAno.get(2022),
      2023: porAno.get(2023),
      2024: porAno.get(2024),
      2025: porAno.get(2025),
      urgencia: conta((i) => i.carater === '2'),
      eletiva: conta((i) => i.carater === '1'),
      medica: conta((i) => i.clinica === 'M'),
      cirurgica: conta((i) => i.clinica === 'C'),
      melhorado: conta((i) => i.motivo === 12),
      obito41: conta((i) => i.motivo === 41),
      evasao: conta((i) => i.motivo === 16),
      transferencia: conta((i) => i.motivo === 31),
      domiciliar: conta((i) => i.motivo === 32),
      encerramento: conta((i) => i.motivo === 51),
      emAberto: conta((i) => i.alta === null),
      transferencias: mov.transferencias.length,
      trechos: mov.trechos.length,
    };
    console.log(`[${cod}] controle: ${JSON.stringify(controle)}`);
    // Na cópia de referência de 05-06/07/2026 (ficha, seção 10); numa cópia mais nova valem as consultas de controle.
    if (mov.dadosAte.toISOString().startsWith('2026-07-0')) {
      expect(controle).toMatchObject({
        2020: 1260,
        2021: 1055,
        2022: 1202,
        2023: 1526,
        2024: 1597,
        2025: 1573,
        urgencia: 5070,
        eletiva: 4090,
        medica: 4888,
        cirurgica: 4268,
        melhorado: 8150,
        obito41: 401,
        evasao: 324,
        transferencia: 122,
        domiciliar: 83,
        encerramento: 48,
        emAberto: 24,
        transferencias: 7099,
        trechos: 16263,
      });
    }
  });

  it('regras 3 e 4: a terapia intensiva pela trajetória × a posição atual (que subconta)', async () => {
    const mov = await nucleo!.lerSomente(ctx(), (x) => lerMovimentoInternacao(x));
    const m = new MotorInternacao(mov, {
      horaFechamento: 24,
      intensivas: [3, 7, 8, 9, 17],
      agora: relogioDeParede(Date.now()),
    });
    const [b] = m.basesMensais('2025-01', '2025-12').reduce(
      (acc, x) => {
        acc[0]!.uti += x.grandezas.pacientesDiaIntensiva;
        acc[0]!.total += x.grandezas.pacientesDia;
        return acc;
      },
      [{ uti: 0, total: 0 }],
    );
    // Pela posição atual: os dias de toda internação contados na acomodação final.
    const tipoAtual = new Map(mov.unidades.map((u) => [`${u.bloco}/${u.acomodacao}`, u.tipo ?? 0]));
    let utiPosicao = 0;
    for (const i of mov.internacoes) {
      if (!i.alta || i.alta.getUTCFullYear() !== 2025) continue;
      if ([3, 7, 8, 9, 17].includes(tipoAtual.get(`${i.bloco}/${i.acomodacao}`) ?? 0))
        utiPosicao += Math.max(0, (i.alta.getTime() - i.entrada.getTime()) / 86_400_000);
    }
    console.log(
      `[${cod}] 2025: paciente-dia ${b!.total}, em terapia intensiva pela trajetória ${b!.uti}, pela posição atual ~${Math.round(utiPosicao)}; marcas ${JSON.stringify(m.marcas)}`,
    );
    expect(b!.uti).toBeGreaterThan(utiPosicao);
  });

  it('consulta cancelada pelo driver ao passar do tempo (e a conexão segue boa)', async () => {
    await expect(
      nucleo!.lerSomente(ctx(), (l) =>
        l.consultar(
          `SELECT c.ANOPRO, SUM(i.VALOR_C) S FROM FCCTAEXT c JOIN FCLANEXT i ON i.ID_FCCTAEXT = c.ID GROUP BY 1`,
          [],
          { teto: 100, tempoMaximoMs: 50 },
        ),
      ),
    ).rejects.toBeInstanceOf(ErroTempoEsgotado);
    const [x] = await nucleo!.lerSomente(ctx(), (l) =>
      l.consultar('SELECT 1 N FROM RDB$DATABASE', [], { teto: 1 }),
    );
    expect(num(x?.['N'])).toBe(1);
  });

  it('caminho do painel: 0 leitura sequencial nas tabelas grandes (cadastro do paciente, convênios)', async () => {
    const seq = await nucleo!.lerSomente(ctx(), async (l) => {
      await lerLeiturasPainel(l);
      const r = await l.consultar(
        `SELECT TRIM(TS.MON$TABLE_NAME) T, RS.MON$RECORD_SEQ_READS S
           FROM MON$TRANSACTIONS TR
           JOIN MON$TABLE_STATS TS ON TS.MON$STAT_ID = TR.MON$STAT_ID AND TS.MON$STAT_GROUP = 2
           JOIN MON$RECORD_STATS RS ON RS.MON$STAT_ID = TS.MON$RECORD_STAT_ID
          WHERE TR.MON$TRANSACTION_ID = CURRENT_TRANSACTION AND TS.MON$TABLE_NAME IN ('RICADPAC', 'RICTRLOC')`,
        [],
        { teto: 10 },
      );
      return Object.fromEntries(r.map((x) => [String(x['T']), num(x['S'])]));
    });
    console.log(`[${cod}] sequenciais no painel: ${JSON.stringify(seq)}`);
    for (const [t, s] of Object.entries(seq)) expect(s, t).toBe(0);
  });
});
