// Contrato de efeito do ciclo do resultado no MariaDB real (cliente f22_o2; massa SINTÉTICA), F3.5, 05-SADT linha 10:
// digitar grava o resultado e o analito com a faixa vigente congelada (mudar a faixa depois não muda o resultado) e
// marca o crítico; liberar só o digitado e só por profissional habilitado (conselho ativo e CBO do laboratório), que
// fica gravado como quem liberou; o liberado não volta à digitação; retificar exige motivo e mudança, guarda a versão
// anterior inteira em resultado_exame_versao e sobe o número da versão, sem apagar o analito. Tudo com trilha.
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ServicoResultadoSadt } from './resultado-propria.js';
import {
  CLIENTE,
  contexto,
  limparMassaSadt,
  type MassaSadt,
  montarMassaSadt,
  SEM_BANCO,
} from './copia.spec-util.js';

const codigoDe = (e: unknown) => (e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e));
const COR = { cliente: CLIENTE, correlacao: 't-s35res' };

describe.skipIf(SEM_BANCO)('resultado: digitar, liberar e retificar (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let servico: ServicoResultadoSadt;
  let m: MassaSadt | null = null;
  let faixa = 0;
  let inscricao = 0;
  const um = (sql: string, p: unknown[]) => nucleo.lerSomente(COR, (l) => l.uma(sql, p));

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassaSadt(nucleo, 'S5R');
    servico = new ServicoResultadoSadt(nucleo);
    const mm = m;
    await nucleo.escrever(COR, async (e) => {
      const ea = await e.uma('SELECT id FROM exame_analito WHERE exame_id = ? AND analito_id = ?', [
        mm.exameLab,
        mm.analito,
      ]);
      faixa = await e.inserir(
        `INSERT INTO faixa_referencia (exame_analito_id, referencia_minima, referencia_maxima, critico_minimo, critico_maximo,
           absurdo_minimo, absurdo_maximo, referencia_texto, vigencia_inicio, criado_em)
         VALUES (?, 10, 20, 5, 30, 0, 100, '10 a 20', '2020-01-01', ?)`,
        [ea!['id'], new Date()],
      );
      await e.executar("UPDATE exame_item SET situacao = 'em_analise' WHERE id = ?", [mm.itemLab]);
    });
  });

  afterAll(async () => {
    if (m)
      await nucleo.escrever(COR, async (e) => {
        const itens = [m!.itemLab];
        await e.executar(
          'DELETE v FROM resultado_exame_versao v JOIN resultado_exame r ON r.id = v.resultado_exame_id WHERE r.exame_item_id IN (?)',
          itens,
        );
        await e.executar(
          'DELETE o FROM resultado_observacao o JOIN resultado_exame r ON r.id = o.resultado_exame_id WHERE r.exame_item_id IN (?)',
          itens,
        );
        await e.executar(
          'DELETE a FROM resultado_analito a JOIN resultado_exame r ON r.id = a.resultado_exame_id WHERE r.exame_item_id IN (?)',
          itens,
        );
        if (faixa) await e.executar('DELETE FROM faixa_referencia WHERE id = ?', [faixa]);
        if (inscricao) await e.executar('DELETE FROM inscricao_conselho WHERE id = ?', [inscricao]);
      });
    await limparMassaSadt(nucleo, m);
    await nucleo.encerrar();
  });

  it('digita com a faixa congelada, libera pelo habilitado e retifica guardando a versão anterior', async () => {
    const c = contexto(m!);
    const item = m!.itemLab;
    const an = m!.analito;
    const tenta = (p: Promise<unknown>) => p.then(() => 'ok').catch(codigoDe);

    expect(await tenta(servico.liberar(c, item, {}))).toBe('nao-digitado');
    expect(await tenta(servico.registrar(c, item, { valores: [{ analito: an + 999_999, numero: 1 }] }))).toBe(
      'analito-fora-do-exame',
    );
    expect(await tenta(servico.registrar(c, item, { valores: [{ analito: an, numero: 500 }] }))).toBe(
      'valor-absurdo',
    );
    expect(
      await tenta(
        servico.registrar(contexto(m!, m!.base.outroEst), item, { valores: [{ analito: an, numero: 4 }] }),
      ),
    ).toBe('exame-inexistente');

    const r = await servico.registrar(c, item, {
      valores: [{ analito: an, numero: 4 }],
      observacao: 'Amostra lipêmica',
    });
    expect(r).toMatchObject({ situacao: 'digitado', critico: true, anormal: true, numeroVersao: 1 });
    const ra = () =>
      um(
        `SELECT COUNT(*) OVER () AS q, id, valor_numerico, faixa_referencia_id, referencia_minimo, referencia_maximo,
                interpretacao, critico, justificativa_alteracao FROM resultado_analito WHERE resultado_exame_id = ?`,
        [r.resultado],
      );
    expect(await ra()).toMatchObject({ interpretacao: 'critico_baixo' });
    expect(Number((await ra())!['faixa_referencia_id'])).toBe(faixa);
    expect(await um('SELECT situacao FROM exame_item WHERE id = ?', [item])).toMatchObject({
      situacao: 'resultado_digitado',
    });
    expect(
      Number(
        (await um('SELECT COUNT(*) AS q FROM resultado_observacao WHERE resultado_exame_id = ?', [
          r.resultado,
        ]))!['q'],
      ),
    ).toBe(1);

    // A faixa muda depois: o resultado guarda a faixa do momento da digitação.
    await nucleo.escrever(COR, (e) =>
      e.executar('UPDATE faixa_referencia SET referencia_minima = 1 WHERE id = ?', [faixa]),
    );
    expect(Number((await ra())!['referencia_minimo'])).toBe(10);

    // Sem inscrição no conselho com CBO do laboratório, não libera.
    expect(await tenta(servico.liberar(c, item, {}))).toBe('nao-habilitado');
    await nucleo.escrever(COR, async (e) => {
      const cbo = await e.uma(
        "SELECT id FROM ocupacao_cbo WHERE codigo_cbo LIKE '2212%' ORDER BY id LIMIT 1",
        [],
      );
      const cc = await e.uma('SELECT id FROM conselho_classe ORDER BY id LIMIT 1', []);
      const uf = await e.uma('SELECT id FROM unidade_federativa ORDER BY id LIMIT 1', []);
      const seq = await e.uma(
        'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM inscricao_conselho WHERE profissional_id = ?',
        [m!.base.profissional],
      );
      inscricao = await e.inserir(
        `INSERT INTO inscricao_conselho (profissional_id, sequencia, conselho_classe_id, unidade_federativa_id,
           numero_inscricao, ocupacao_cbo_id, principal, situacao, criado_em) VALUES (?, ?, ?, ?, ?, ?, TRUE, 'ativa', ?)`,
        [
          m!.base.profissional,
          seq!['s'],
          cc!['id'],
          uf!['id'],
          `${m!.marca}9`.slice(0, 20),
          cbo!['id'],
          new Date(),
        ],
      );
    });
    const lib = await servico.liberar(c, item, {});
    expect(lib).toMatchObject({ situacao: 'liberado', numeroVersao: 1 });
    const re = await um(
      'SELECT liberado_por_profissional_id, liberado_em FROM resultado_exame WHERE id = ?',
      [r.resultado],
    );
    expect(Number(re!['liberado_por_profissional_id'])).toBe(m!.base.profissional);
    expect(re!['liberado_em']).not.toBeNull();
    expect(await um('SELECT situacao FROM exame_item WHERE id = ?', [item])).toMatchObject({
      situacao: 'liberado',
    });

    // O liberado não volta à digitação; a retificação exige mudança.
    expect(await tenta(servico.registrar(c, item, { valores: [{ analito: an, numero: 15 }] }))).toBe(
      'ja-liberado',
    );
    expect(
      await tenta(
        servico.retificar(c, item, { valores: [{ analito: an, numero: 4 }], motivo: 'Erro de transcrição' }),
      ),
    ).toBe('sem-mudanca');

    const ret = await servico.retificar(c, item, {
      valores: [{ analito: an, numero: 15 }],
      motivo: 'Erro de transcrição do valor',
    });
    expect(ret).toMatchObject({ situacao: 'retificado', numeroVersao: 2, critico: false, anormal: false });
    const v = await um(
      'SELECT COUNT(*) OVER () AS q, numero_versao, operacao, motivo, dados, liberado_em_original FROM resultado_exame_versao WHERE resultado_exame_id = ?',
      [r.resultado],
    );
    expect(v).toMatchObject({
      numero_versao: 1,
      operacao: 'alteracao',
      motivo: 'Erro de transcrição do valor',
    });
    expect(Number(v!['q'])).toBe(1);
    expect(v!['liberado_em_original']).not.toBeNull();
    const dados = typeof v!['dados'] === 'string' ? JSON.parse(v!['dados'] as string) : v!['dados'];
    expect(dados.analitos[0]).toMatchObject({ analito: an, numero: 4, interpretacao: 'critico_baixo' });
    const depois = await ra();
    expect(Number(depois!['q'])).toBe(1);
    expect(Number(depois!['valor_numerico'])).toBe(15);
    expect(depois!['justificativa_alteracao']).toBe('Erro de transcrição do valor');
    // A retificação usa a faixa vigente agora (mínimo 1).
    expect(Number(depois!['referencia_minimo'])).toBe(1);
    expect(
      Number(
        (await um(
          "SELECT COUNT(*) AS q FROM trilha_auditoria WHERE entidade = 'resultado_exame' AND entidade_id = ?",
          [r.resultado],
        ))!['q'],
      ),
    ).toBeGreaterThanOrEqual(3);
  });
});
