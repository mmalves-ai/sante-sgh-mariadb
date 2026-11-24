// Mapa de trabalho da bancada no MariaDB real (cliente f22_o2; massa SINTÉTICA), F3.5, 05-SADT linha 8. Contrato de
// efeito: o exame vai para a bancada do modelo de mapa; reter grava o lote aberto do dia da bancada (numerado pela
// sequência) e o item "retido" com o motivo, com a trilha; o mapa mostra o retido com o motivo, fora do lote; soltar
// devolve o item a "pendente" sem apagar nada; reter de novo reaproveita o item do lote; motivo curto, exame de outro
// estabelecimento e soltar o que não está retido são recusados.
import { distribuirPorBancada } from '@sgh/dominio-sadt';
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lerBancadasDoMapa, ServicoMapaTrabalho } from './mapa-trabalho-propria.js';
import {
  CLIENTE,
  contexto,
  limparMassaSadt,
  type MassaSadt,
  montarMassaSadt,
  SEM_BANCO,
} from './copia.spec-util.js';

const codigoDe = (e: unknown) => (e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e));

describe.skipIf(SEM_BANCO)('mapa de trabalho: bancada do exame e retenção (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let servico: ServicoMapaTrabalho;
  let m: MassaSadt | null = null;
  let bancada = 0;
  let modelo = 0;
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-s35map' }, (l) => l.uma(sql, p));

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassaSadt(nucleo, 'S5M');
    servico = new ServicoMapaTrabalho(nucleo);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-s35map' }, async (e) => {
      const agora = new Date();
      bancada = await e.inserir(
        'INSERT INTO bancada_analitica (codigo, descricao, setor_diagnostico_id, criado_em) VALUES (?, ?, ?, ?)',
        [`T${m!.marca}`.slice(0, 30), `Bancada ${m!.marca}`, m!.setorLab, agora],
      );
      modelo = await e.inserir(
        `INSERT INTO modelo_mapa_bancada (sigla, descricao, setor_diagnostico_id, bancada_analitica_id, limite_exames, criado_em)
         VALUES (?, 'Modelo de teste', ?, ?, 10, ?)`,
        [`M${m!.marca}`.slice(0, 40), m!.setorLab, bancada, agora],
      );
      await e.inserir(
        'INSERT INTO modelo_mapa_bancada_exame (modelo_mapa_bancada_id, sequencia, exame_id, criado_em) VALUES (?, 1, ?, ?)',
        [modelo, m!.exameLab, agora],
      );
    });
  }, 60_000);

  afterAll(async () => {
    if (m)
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-s35map' }, async (e) => {
        const ests = [m!.base.est, m!.base.outroEst];
        await e.executar(
          `DELETE gi FROM grupo_trabalho_bancada_item gi JOIN grupo_trabalho_bancada g ON g.id = gi.grupo_trabalho_bancada_id
            WHERE g.estabelecimento_id IN (?, ?)`,
          ests,
        );
        await e.executar('DELETE FROM grupo_trabalho_bancada WHERE estabelecimento_id IN (?, ?)', ests);
        await e.executar(
          "DELETE FROM sequencia_negocio WHERE tipo = 'grupo_trabalho_bancada' AND estabelecimento_id IN (?, ?)",
          ests,
        );
        await e.executar('DELETE FROM modelo_mapa_bancada_exame WHERE modelo_mapa_bancada_id = ?', [modelo]);
        await e.executar('DELETE FROM modelo_mapa_bancada WHERE id = ?', [modelo]);
        await e.executar('DELETE FROM bancada_analitica WHERE id = ?', [bancada]);
      });
    await limparMassaSadt(nucleo, m);
    await nucleo.encerrar();
  });

  it('distribui pela bancada do modelo, retém com motivo no lote do dia, mostra o retido e devolve à fila', async () => {
    const c = contexto(m!);
    const item = { id: m!.itemLab, exame: { id: m!.exameLab }, urgente: false };
    const lerMapa = () =>
      nucleo
        .lerSomente({ cliente: CLIENTE, correlacao: 't-s35map' }, (l) =>
          lerBancadasDoMapa(l, m!.base.est, [item]),
        )
        .then((x) => distribuirPorBancada([item], x.bancadas, x.retencoes));

    let mapa = await lerMapa();
    expect(mapa).toHaveLength(1);
    expect(mapa[0]).toMatchObject({
      codigo: bancada,
      nome: `Bancada ${m!.marca}`,
      limite: 10,
      lotes: 1,
      retidos: [],
    });

    expect(
      codigoDe(await servico.reter(c, { exame: m!.itemLab, motivo: 'abc' }).catch((e: unknown) => e)),
    ).toMatch(/entrada|motivo|too_small|String/i);
    expect(
      codigoDe(
        await servico
          .reter(contexto(m!, m!.base.outroEst), { exame: m!.itemLab, motivo: 'Controle fora' })
          .catch((e: unknown) => e),
      ),
    ).toBe('exame-inexistente');
    expect(codigoDe(await servico.soltar(c, { exame: m!.itemLab }).catch((e: unknown) => e))).toBe(
      'nao-retido',
    );

    const r = await servico.reter(c, { exame: m!.itemLab, motivo: 'Controle de qualidade fora' });
    expect(r).toMatchObject({ exame: m!.itemLab, situacao: 'retido' });
    expect(r.lote).toMatch(/^LT-\d+$/);
    const lote = await um(
      'SELECT g.id, g.numero, g.bancada_analitica_id, g.situacao, g.modelo_mapa_bancada_id FROM grupo_trabalho_bancada g JOIN grupo_trabalho_bancada_item gi ON gi.grupo_trabalho_bancada_id = g.id WHERE gi.id = ?',
      [r.id],
    );
    expect(lote).toMatchObject({ numero: r.lote, situacao: 'aberto' });
    expect(Number(lote!['bancada_analitica_id'])).toBe(bancada);
    expect(Number(lote!['modelo_mapa_bancada_id'])).toBe(modelo);
    expect(
      await um('SELECT situacao, motivo, sequencia FROM grupo_trabalho_bancada_item WHERE id = ?', [r.id]),
    ).toMatchObject({
      situacao: 'retido',
      motivo: 'Controle de qualidade fora',
    });
    expect(
      Number(
        (
          await um(
            "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'grupo_trabalho_bancada_item' AND entidade_id = ?",
            [r.id],
          )
        )?.['n'],
      ),
    ).toBeGreaterThanOrEqual(1);
    expect(
      codigoDe(
        await servico.reter(c, { exame: m!.itemLab, motivo: 'Outra vez retido' }).catch((e: unknown) => e),
      ),
    ).toBe('ja-retido');

    mapa = await lerMapa();
    expect(mapa[0]).toMatchObject({
      lotes: 0,
      retidos: [{ exame: m!.itemLab, motivo: 'Controle de qualidade fora' }],
    });

    const s = await servico.soltar(c, { exame: m!.itemLab });
    expect(s).toMatchObject({ id: r.id, situacao: 'pendente', lote: r.lote });
    expect(
      await um('SELECT situacao, motivo, versao FROM grupo_trabalho_bancada_item WHERE id = ?', [r.id]),
    ).toMatchObject({
      situacao: 'pendente',
      motivo: 'Controle de qualidade fora',
      versao: 2,
    });
    expect((await lerMapa())[0]).toMatchObject({ lotes: 1, retidos: [] });

    const r2 = await servico.reter(c, { exame: m!.itemLab, motivo: 'Reagente vencido' });
    expect(r2).toMatchObject({ id: r.id, lote: r.lote, situacao: 'retido' });
    expect(
      Number(
        (
          await um('SELECT COUNT(*) AS n FROM grupo_trabalho_bancada WHERE estabelecimento_id = ?', [
            m!.base.est,
          ])
        )?.['n'],
      ),
    ).toBe(1);
  });
});
