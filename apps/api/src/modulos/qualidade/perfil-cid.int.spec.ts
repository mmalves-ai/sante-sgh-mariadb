// Contrato da hierarquia da CID-10 e do perfil epidemiológico por capítulo (F7, 09-AREA linha 83) contra o MariaDB do
// cliente de teste. Massa SINTÉTICA: a da enfermagem (estabelecimentos, paciente, atendimentos e profissional) com
// diagnósticos do atendimento acrescentados aqui, num mês fixo (março de 2026). A hierarquia é a carregada da fonte
// oficial (capitulo_cid10 e agrupamento_cid10). Prova o que o banco devolve: a hierarquia inteira, a localização de um
// código, e o perfil do período só com o confirmado ativo do estabelecimento (o suspeito quando pedido, o principal
// quando filtrado), sem o descartado, o inativado, o de fora do período e o do outro estabelecimento. Só leitura: a
// rota não grava (a contagem das tabelas fica igual).
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  contextoDe,
  limparMassa,
  type MassaEnfermagem,
  montarMassa,
  SEM_BANCO,
} from '../enfermagem/massa-enfermagem.spec-util.js';
import { PortaPerfilCidPropria } from './porta-perfil-cid-propria.js';

const MARCA = 'PCID17';
const PERIODO = { desde: '2026-03-01', ate: '2026-03-31' };

describe.skipIf(SEM_BANCO)('hierarquia da CID-10 e perfil por capítulo (porta própria, MariaDB)', () => {
  const nucleo = new NucleoProprio();
  let m: MassaEnfermagem | null = null;
  let porta: PortaPerfilCidPropria;
  const ctx = (est = m!.est) =>
    contextoDe(m!, est) as unknown as Parameters<PortaPerfilCidPropria['perfil']>[0];
  const apagarDiagnosticos = () =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 't-pcid' }, async (e) => {
      await e.executar('DELETE FROM diagnostico_atendimento WHERE estabelecimento_id IN (?, ?)', [
        m!.est,
        m!.outroEst,
      ]);
    });
  const contagens = () =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-pcid' }, async (l) => {
      const r = await l.uma<{ d: number; c: number; a: number }>(
        `SELECT (SELECT COUNT(*) FROM diagnostico_atendimento WHERE estabelecimento_id IN (?, ?)) AS d,
                (SELECT COUNT(*) FROM capitulo_cid10) AS c, (SELECT COUNT(*) FROM agrupamento_cid10) AS a`,
        [m!.est, m!.outroEst],
      );
      return { d: Number(r!.d), c: Number(r!.c), a: Number(r!.a) };
    });

  beforeAll(async () => {
    m = await montarMassa(nucleo, MARCA, false);
    porta = new PortaPerfilCidPropria(nucleo);
    await apagarDiagnosticos();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-pcid' }, async (e) => {
      const termo = async (cod: string) => {
        const r = await e.uma<{ id: number }>(
          `SELECT t.id FROM termo_terminologia t JOIN terminologia g ON g.id = t.terminologia_id
            WHERE g.codigo = 'cid10' AND t.codigo_termo = ? LIMIT 1`,
          [cod],
        );
        if (!r) throw new Error(`CID-10 sem o termo ${cod} no cliente de teste`);
        return Number(r.id);
      };
      const diag = (
        cod: number,
        o: {
          est?: number;
          atend?: number;
          tipo?: string;
          certeza?: string;
          em?: string;
          inativo?: boolean;
        } = {},
      ) =>
        e.inserir(
          `INSERT INTO diagnostico_atendimento (estabelecimento_id, atendimento_id, paciente_id, cid_termo_terminologia_id,
             tipo, certeza, diagnosticado_em, profissional_id, situacao, inativado_em, inativado_por_profissional_id,
             justificativa_inativacao, criado_em, versao)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), 1)`,
          [
            o.est ?? m!.est,
            o.atend ?? m!.atendimento,
            m!.paciente,
            cod,
            o.tipo ?? 'secundario',
            o.certeza ?? 'confirmado',
            o.em ?? '2026-03-10 10:00:00',
            m!.profissional,
            o.inativo ? 'inativado' : 'ativo',
            o.inativo ? '2026-03-11 10:00:00' : null,
            o.inativo ? m!.profissional : null,
            o.inativo ? 'Registro sintético corrigido' : null,
          ],
        );
      const [iam, has, tb, hiv] = [
        await termo('I219'),
        await termo('I10'),
        await termo('A150'),
        await termo('B20'),
      ];
      await diag(iam, { tipo: 'principal' }); // conta
      await diag(has, { em: '2026-03-31 23:59:00' }); // conta (último minuto do período)
      await diag(tb, { certeza: 'suspeito' }); // só com suspeitos
      await diag(hiv, { certeza: 'descartado' }); // nunca
      await diag(iam, { inativo: true }); // nunca
      await diag(has, { em: '2026-04-01 00:00:00' }); // fora do período
      await diag(iam, { est: m!.outroEst, atend: m!.atendimentoOutro, tipo: 'principal' }); // outro estabelecimento
    });
  }, 120_000);

  afterAll(async () => {
    if (!m) return;
    await apagarDiagnosticos();
    await limparMassa(nucleo, m);
  }, 120_000);

  it('a hierarquia vigente traz os capítulos, grupos e subgrupos carregados da fonte oficial', async () => {
    const h = await porta.hierarquia(ctx());
    const banco = await contagens();
    expect(h.capitulos).toHaveLength(banco.c);
    expect(h.agrupamentos).toHaveLength(banco.a);
    expect(h.capitulos.map((c) => c.numero)).toEqual(
      [...h.capitulos.map((c) => c.numero)].sort((a, b) => a - b),
    );
    const ix = h.capitulos.find((c) => c.codigo === 'IX')!;
    expect([ix.numero, ix.inicial, ix.final]).toEqual([9, 'I00', 'I99']);
    const sub = h.agrupamentos.filter((a) => a.nivel === 'subgrupo');
    expect(sub.length).toBeGreaterThan(0);
    // todo subgrupo aponta para um agrupamento do mesmo capítulo que o contém
    for (const s of sub) {
      const pai = h.agrupamentos.find((a) => a.codigo === s.pai)!;
      expect(pai.capitulo).toBe(s.capitulo);
      expect(pai.inicial <= s.inicial && s.final <= pai.final).toBe(true);
    }
  });

  it('localiza o código no capítulo e nos agrupamentos, com a descrição do termo', async () => {
    const l = (await porta.localizar(ctx(), 'I219'))!;
    expect(l.capitulo.codigo).toBe('IX');
    expect(l.categoria).toBe('I21');
    expect(l.agrupamentos[0]!.codigo).toBe('I20-I25');
    expect(l.agrupamentos[0]!.nivel).toBe('grupo');
    expect(l.descricao).toBeTruthy();
    // D49 fica entre os capítulos II (C00-D48) e III (D50-D89): fora da hierarquia
    expect(await porta.localizar(ctx(), 'D49')).toBeNull();
  });

  it('o perfil do período soma só o confirmado ativo do estabelecimento, por capítulo e grupo', async () => {
    const p = await porta.perfil(ctx(), { ...PERIODO, apenasPrincipal: false, incluirSuspeitos: false });
    expect([p.total, p.semCapitulo, p.atendimentos, p.pacientes]).toEqual([2, 0, 1, 1]);
    expect(p.capitulos.map((c) => [c.codigo, c.diagnosticos, c.percentual])).toEqual([['IX', 2, 100]]);
    const grupos = p.capitulos[0]!.filhos;
    expect(grupos.map((g) => [g.codigo, g.diagnosticos])).toEqual([
      ['I10-I15', 1],
      ['I20-I25', 1],
    ]);
    expect(grupos.every((g) => g.nivel === 'grupo')).toBe(true);
  });

  it('o suspeito entra quando pedido; o filtro do principal deixa só o principal', async () => {
    const s = await porta.perfil(ctx(), { ...PERIODO, apenasPrincipal: false, incluirSuspeitos: true });
    expect(s.total).toBe(3);
    expect(s.capitulos.map((c) => [c.codigo, c.diagnosticos])).toEqual([
      ['I', 1],
      ['IX', 2],
    ]);
    expect(s.capitulos[0]!.filhos.map((g) => g.codigo)).toEqual(['A15-A19']);
    const pr = await porta.perfil(ctx(), { ...PERIODO, apenasPrincipal: true, incluirSuspeitos: true });
    expect(pr.total).toBe(1);
    expect(pr.capitulos[0]!.filhos.map((g) => g.codigo)).toEqual(['I20-I25']);
  });

  it('a leitura fica no estabelecimento da sessão e não grava nada', async () => {
    const antes = await contagens();
    const outro = await porta.perfil(ctx(m!.outroEst), {
      ...PERIODO,
      apenasPrincipal: false,
      incluirSuspeitos: true,
    });
    expect([outro.total, outro.capitulos[0]!.codigo]).toEqual([1, 'IX']);
    const abril = await porta.perfil(ctx(), {
      desde: '2026-04-01',
      ate: '2026-04-30',
      apenasPrincipal: false,
      incluirSuspeitos: false,
    });
    expect(abril.total).toBe(1);
    expect(await contagens()).toEqual(antes);
  });
});
