// Contrato de efeito da microbiologia estruturada (F7, 05-SADT linha 12) no MariaDB do cliente de teste. Massa
// SINTÉTICA: a do SADT (resultado do exame liberado) com germes, antimicrobianos, painel e pontos de corte criados aqui.
// Prova o que fica no banco: a cultura parcial com isolado e antibiograma interpretado pelo ponto de corte (CIM e halo),
// a cascata (restrito escondido até haver resistência de primeira linha), a multirresistência pelo painel, a cultura
// final que notifica a CCIH sozinha (sinal na fila de busca ativa, uma vez por isolado), a norma do painel (um ponto CLSI
// mais recente do mesmo par não vale num painel BrCAST), a versão lida obrigatória, a recusa de mudar a final sem
// retificação, a retificação que guarda a cultura anterior inteira (com o laudo emitido) e tira um teste por exclusão
// lógica, o laudo da cultura, a ligação do isolado ao caso de infecção e a recusa em outro estabelecimento.
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ServicoMicrobiologia } from './microbiologia-propria.js';
import {
  CLIENTE,
  contexto,
  limparMassaSadt,
  type MassaSadt,
  montarMassaSadt,
  SEM_BANCO,
} from './copia.spec-util.js';

const codigoDe = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e);
  }
};

describe.skipIf(SEM_BANCO)('microbiologia estruturada (MariaDB)', () => {
  const nucleo = new NucleoProprio();
  const s = new ServicoMicrobiologia(nucleo);
  let m: MassaSadt | null = null;
  const marca = `MB${Date.now().toString(36).slice(-6).toUpperCase()}`;
  const ids = {
    material: 0,
    germe: 0,
    am1: 0,
    am2: 0,
    am3: 0,
    painel: 0,
    sitio: 0,
    caso: 0,
    cultura: 0,
    isolado: 0,
  };
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-micro' }, (l) => l.uma(sql, p));
  const todos = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-micro' }, (l) => l.consultar(sql, p));

  beforeAll(async () => {
    m = await montarMassaSadt(nucleo, 'MB');
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-micro' }, async (e) => {
      const agora = new Date();
      ids.material = Number(
        (await e.uma<{ id: number }>("SELECT id FROM material_biologico WHERE codigo = 'SANGUE-T'", []))!.id,
      );
      ids.painel = await e.inserir(
        "INSERT INTO painel_antibiograma (codigo, descricao, metodo, norma_referencia, criado_em) VALUES (?, ?, 'concentracao_inibitoria', 'BrCAST', ?)",
        [marca, `PAINEL SINTETICO ${marca}`, agora],
      );
      ids.germe = await e.inserir(
        "INSERT INTO microrganismo (codigo, descricao, grupo, painel_antibiograma_id, criado_em) VALUES (?, ?, 'bacteria', ?, ?)",
        [marca, `GERME SINTETICO ${marca}`, ids.painel, agora],
      );
      const am = (k: number) =>
        e.inserir('INSERT INTO antimicrobiano (codigo, descricao, criado_em) VALUES (?, ?, ?)', [
          `${marca}-${k}`,
          `DROGA SINTETICA ${k}`,
          agora,
        ]);
      ids.am1 = await am(1);
      ids.am2 = await am(2);
      ids.am3 = await am(3);
      const item = (seq: number, a: number, restrita: boolean, mr: boolean) =>
        e.inserir(
          `INSERT INTO painel_antibiograma_item (painel_antibiograma_id, sequencia, antimicrobiano_id, liberacao_restrita,
             indica_multirresistencia, criado_em) VALUES (?, ?, ?, ?, ?, ?)`,
          [ids.painel, seq, a, restrita, mr, agora],
        );
      await item(1, ids.am1, false, false);
      await item(2, ids.am2, true, true);
      await item(3, ids.am3, false, false);
      const ponto = (
        a: number,
        metodo: string,
        s: number | null,
        r: number | null,
        hs: number | null,
        hr: number | null,
      ) =>
        e.inserir(
          `INSERT INTO ponto_corte_antimicrobiano (microrganismo_id, antimicrobiano_id, metodo, norma, versao_norma, sensivel_ate,
             resistente_acima, halo_sensivel_minimo_mm, halo_resistente_maximo_mm, vigencia_inicio, criado_em)
           VALUES (?, ?, ?, 'BrCAST', '2026', ?, ?, ?, ?, '2020-01-01', ?)`,
          [ids.germe, a, metodo, s, r, hs, hr, agora],
        );
      await ponto(ids.am1, 'concentracao_inibitoria', 1, 4, null, null);
      await ponto(ids.am2, 'concentracao_inibitoria', 0.5, 2, null, null);
      await ponto(ids.am3, 'disco_difusao', null, null, 20, 15);
      // Outra norma, mais recente, para o mesmo par: num painel BrCAST não pode valer (CIM 8 seria sensível aqui).
      await e.inserir(
        `INSERT INTO ponto_corte_antimicrobiano (microrganismo_id, antimicrobiano_id, metodo, norma, versao_norma, sensivel_ate,
           resistente_acima, vigencia_inicio, criado_em) VALUES (?, ?, 'concentracao_inibitoria', 'CLSI', '2026', 16, 32, '2025-01-01', ?)`,
        [ids.germe, ids.am1, agora],
      );
      ids.sitio = await e.inserir(
        "INSERT INTO sitio_infeccao (codigo, descricao, versao_criterio, criado_em) VALUES (?, 'SITIO SINTETICO', '2026', ?)",
        [marca, agora],
      );
      ids.caso = await e.inserir(
        `INSERT INTO caso_infeccao (estabelecimento_id, numero, paciente_id, atendimento_id, data_infeccao, natureza,
           origem_aquisicao, sitio_infeccao_id, situacao, criado_em) VALUES (?, ?, ?, ?, CURRENT_DATE, 'infeccao', 'hospitalar', ?, 'suspeito', ?)`,
        [m!.base.est, marca, m!.base.paciente, m!.base.atendimento, ids.sitio, agora],
      );
    });
  }, 120_000);

  afterAll(async () => {
    if (m)
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-micro' }, async (e) => {
        const x = (sql: string, p: unknown[]) => e.executar(sql, p);
        await x('DELETE FROM caso_infeccao_microrganismo WHERE caso_infeccao_id = ?', [ids.caso]);
        await x('DELETE FROM caso_infeccao WHERE id = ?', [ids.caso]);
        await x(
          "DELETE FROM sinal_vigilancia_iras WHERE fato_entidade = 'isolado_microbiano' AND resultado_exame_id = ?",
          [m!.resultado],
        );
        await x('DELETE FROM resultado_cultura_versao WHERE resultado_cultura_id = ?', [ids.cultura]);
        await x('DELETE FROM sitio_infeccao WHERE id = ?', [ids.sitio]);
        await x(
          'DELETE rs FROM resultado_sensibilidade rs JOIN isolado_microbiano im ON im.id = rs.isolado_microbiano_id WHERE im.resultado_cultura_id = ?',
          [ids.cultura],
        );
        await x('DELETE FROM isolado_microbiano WHERE resultado_cultura_id = ?', [ids.cultura]);
        await x('DELETE FROM resultado_cultura WHERE id = ?', [ids.cultura]);
        await x('DELETE FROM ponto_corte_antimicrobiano WHERE microrganismo_id = ?', [ids.germe]);
        await x('UPDATE microrganismo SET painel_antibiograma_id = NULL WHERE id = ?', [ids.germe]);
        await x('DELETE FROM painel_antibiograma_item WHERE painel_antibiograma_id = ?', [ids.painel]);
        await x('DELETE FROM painel_antibiograma WHERE id = ?', [ids.painel]);
        await x('DELETE FROM microrganismo WHERE id = ?', [ids.germe]);
        await x('DELETE FROM antimicrobiano WHERE codigo LIKE ?', [`${marca}-%`]);
      });
    await limparMassaSadt(nucleo, m);
    await nucleo.encerrar();
  }, 120_000);

  const isolado = (testes: unknown[], extra: Record<string, unknown> = {}) => ({
    sequencia: 1,
    microrganismo: ids.germe,
    contagemUfcMl: 100000,
    testes,
    ...extra,
  });

  it('grava a cultura parcial: interpretação pelo ponto de corte, cascata e o laudo', async () => {
    const r = await s.registrar(contexto(m!), m!.resultado, {
      material: ids.material,
      crescimento: 'com_crescimento',
      contagemColonias: '> 100.000 UFC/mL',
      isolados: [
        isolado([
          { antimicrobiano: ids.am1, metodo: 'cim', cim: 0.5 },
          { antimicrobiano: ids.am2, metodo: 'cim', cim: 0.25 },
          { antimicrobiano: ids.am3, metodo: 'disco_difusao', halo: 17 },
        ]),
      ],
    });
    ids.cultura = r.id;
    expect([r.situacao, r.isolados, r.testes, r.multirresistentes]).toEqual(['parcial', 1, 3, 0]);
    const ts = await todos(
      `SELECT rs.antimicrobiano_id, rs.interpretacao, rs.exibe_no_laudo, rs.ponto_corte_antimicrobiano_id IS NOT NULL AS com_ponto
         FROM resultado_sensibilidade rs JOIN isolado_microbiano im ON im.id = rs.isolado_microbiano_id
        WHERE im.resultado_cultura_id = ? AND rs.excluido_em IS NULL ORDER BY rs.sequencia`,
      [r.id],
    );
    expect(
      ts.map((t) => [
        Number(t['antimicrobiano_id']),
        t['interpretacao'],
        Number(t['exibe_no_laudo']),
        Number(t['com_ponto']),
      ]),
    ).toEqual([
      [ids.am1, 'sensivel', 1, 1],
      [ids.am2, 'sensivel', 0, 1],
      [ids.am3, 'sensivel_dose_dependente', 1, 1],
    ]);
    const c = await s.cultura(contexto(m!), m!.resultado);
    expect(c?.situacao).toBe('parcial');
    expect(c?.laudo).toContain('Resultado parcial.');
    expect(c?.laudo).not.toContain('DROGA SINTETICA 2');
    ids.isolado = c!.isolados[0]!.id;
  });

  it('o isolado da cultura parcial não vai ao caso de infecção', async () => {
    expect(await codigoDe(s.ligarAoCaso(contexto(m!), ids.isolado, { caso: ids.caso }))).toBe(
      'cultura-parcial',
    );
  });

  it('cultura final: resistência de primeira linha libera o restrito, marca multirresistente e notifica a CCIH', async () => {
    const antes = await um('SELECT versao FROM resultado_cultura WHERE id = ?', [ids.cultura]);
    expect(
      await codigoDe(
        s.registrar(contexto(m!), m!.resultado, {
          material: ids.material,
          crescimento: 'com_crescimento',
          final: true,
          isolados: [isolado([])],
        }),
      ),
    ).toBe('conclusao-obrigatoria');
    const final = {
      material: ids.material,
      crescimento: 'com_crescimento',
      final: true,
      conclusao: 'Crescimento de germe multirresistente',
      isolados: [
        isolado([
          { antimicrobiano: ids.am1, metodo: 'cim', cim: 8 },
          { antimicrobiano: ids.am2, metodo: 'cim', cim: 4 },
          { antimicrobiano: ids.am3, metodo: 'disco_difusao', halo: 12 },
        ]),
      ],
    };
    // Sem a versão lida, a segunda gravação é recusada (nada de sobrescrever a de outro usuário).
    expect(await codigoDe(s.registrar(contexto(m!), m!.resultado, final))).toBe('conflito-versao');
    expect(
      await codigoDe(
        s.registrar(contexto(m!), m!.resultado, { ...final, versao: Number(antes?.['versao']) + 7 }),
      ),
    ).toBe('conflito-versao');
    // Sem marcar a notificação: o multirresistente notifica a CCIH pela regra.
    const r = await s.registrar(contexto(m!), m!.resultado, { ...final, versao: Number(antes?.['versao']) });
    expect([r.id, r.situacao, r.multirresistentes, r.notificados]).toEqual([ids.cultura, 'final', 1, 1]);
    const sinal = await todos(
      "SELECT situacao, tipo_sinal, resultado_exame_id FROM sinal_vigilancia_iras WHERE fato_entidade = 'isolado_microbiano' AND fato_id = ?",
      [ids.isolado],
    );
    expect(sinal.map((x) => [x['situacao'], x['tipo_sinal'], Number(x['resultado_exame_id'])])).toEqual([
      ['pendente', 'cultura_positiva', m!.resultado],
    ]);
    const i = await um(
      'SELECT multirresistente, notificado_controle_infeccao_em IS NOT NULL AS notificado FROM isolado_microbiano WHERE id = ?',
      [ids.isolado],
    );
    expect([Number(i?.['multirresistente']), Number(i?.['notificado'])]).toEqual([1, 1]);
    const visiveis = await um(
      "SELECT COUNT(*) AS n FROM resultado_sensibilidade WHERE isolado_microbiano_id = ? AND exibe_no_laudo = TRUE AND interpretacao = 'resistente'",
      [ids.isolado],
    );
    expect(Number(visiveis?.['n'])).toBe(3);
    const cab = await um(
      'SELECT situacao, notifica_controle_infeccao, leitura_final_em IS NOT NULL AS lida FROM resultado_cultura WHERE id = ?',
      [ids.cultura],
    );
    expect([cab?.['situacao'], Number(cab?.['notifica_controle_infeccao']), Number(cab?.['lida'])]).toEqual([
      'final',
      0,
      1,
    ]);
    const c = await s.cultura(contexto(m!), m!.resultado);
    expect(c?.laudo).toContain('DROGA SINTETICA 2: Resistente');
    expect(c?.laudo).toContain('multirresistente');
  });

  it('a cultura final só muda por retificação com motivo; a anterior fica guardada inteira e o teste retirado, por exclusão lógica', async () => {
    const antes = await um('SELECT versao FROM resultado_cultura WHERE id = ?', [ids.cultura]);
    const corpo = {
      versao: Number(antes?.['versao']),
      material: ids.material,
      crescimento: 'com_crescimento',
      final: true,
      conclusao: 'Retificada',
      notificaControleInfeccao: true,
      motivoRetificacao: 'Leitura do halo revista',
      isolados: [
        isolado([
          { antimicrobiano: ids.am1, metodo: 'cim', cim: 8 },
          { antimicrobiano: ids.am2, metodo: 'cim', cim: 4 },
        ]),
      ],
    };
    expect(await codigoDe(s.registrar(contexto(m!), m!.resultado, corpo))).toBe('cultura-final');
    const r = await s.registrar(contexto(m!), m!.resultado, corpo, { retificacao: true });
    expect(r.situacao).toBe('retificado');
    const linhas = await todos(
      'SELECT antimicrobiano_id, excluido_em IS NOT NULL AS excluido FROM resultado_sensibilidade WHERE isolado_microbiano_id = ? ORDER BY antimicrobiano_id',
      [ids.isolado],
    );
    expect(linhas.length).toBe(3);
    expect(linhas.filter((x) => Number(x['excluido'])).map((x) => Number(x['antimicrobiano_id']))).toEqual([
      ids.am3,
    ]);
    const trilha = await um(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'resultado_cultura' AND entidade_id = ?",
      [ids.cultura],
    );
    expect(Number(trilha?.['n'])).toBeGreaterThanOrEqual(3);
    // A cultura final que vigorava continua legível: conclusão, interpretação do teste retirado e o laudo emitido.
    const vs = await s.versoes(contexto(m!), m!.resultado);
    expect(vs.map((v) => [v.versaoCultura, v.situacao, v.motivo])).toEqual([
      [Number(antes?.['versao']), 'final', 'Leitura do halo revista'],
    ]);
    const anterior = vs[0]!.conteudo as {
      conclusao: string;
      laudo: string;
      isolados: { testes: { antimicrobiano: number; interpretacao: string }[] }[];
    };
    expect(anterior.conclusao).toBe('Crescimento de germe multirresistente');
    expect(anterior.isolados[0]!.testes.find((t) => t.antimicrobiano === ids.am3)?.interpretacao).toBe(
      'resistente',
    );
    expect(anterior.laudo).toContain('DROGA SINTETICA 3: Resistente');
    const atual = await s.cultura(contexto(m!), m!.resultado);
    expect([atual?.conclusao, atual?.laudo.includes('DROGA SINTETICA 3')]).toEqual(['Retificada', false]);
    const motivo = await um(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'resultado_cultura' AND entidade_id = ? AND motivo = ?",
      [ids.cultura, 'Leitura do halo revista'],
    );
    expect(Number(motivo?.['n'])).toBeGreaterThanOrEqual(1);
    // O isolado já notificado não volta à fila na retificação.
    const sinais = await um(
      "SELECT COUNT(*) AS n FROM sinal_vigilancia_iras WHERE fato_entidade = 'isolado_microbiano' AND fato_id = ?",
      [ids.isolado],
    );
    expect(Number(sinais?.['n'])).toBe(1);
  });

  it('liga o isolado ao caso de infecção do paciente (uma vez) e recusa em outro estabelecimento', async () => {
    const r = await s.ligarAoCaso(contexto(m!), ids.isolado, { caso: ids.caso });
    const l = await um(
      'SELECT isolado_microbiano_id, resultado_cultura_id, multirresistente FROM caso_infeccao_microrganismo WHERE id = ?',
      [r.id],
    );
    expect([
      Number(l?.['isolado_microbiano_id']),
      Number(l?.['resultado_cultura_id']),
      Number(l?.['multirresistente']),
    ]).toEqual([ids.isolado, ids.cultura, 1]);
    expect(await codigoDe(s.ligarAoCaso(contexto(m!), ids.isolado, { caso: ids.caso }))).toBe('ja-ligado');
    const outro = contexto(m!, m!.base.outroEst);
    expect(await codigoDe(s.ligarAoCaso(outro, ids.isolado, { caso: ids.caso }))).toBe('nao-encontrado');
    expect(await codigoDe(s.cultura(outro, m!.resultado))).toBe('nao-encontrado');
  });
});
