// Etapa 5 do M55 (contratualização SUS) sobre a cópia, sempre em transação desfeita e sob a trava:
//   - as leituras (ficha, seção 4): os 11 domínios CM* inteiros, onde estão; a SIGTAP pelo prefixo; a produção SUS do
//     faturamento SUS (M51) e das contas SUS de uma competência, agregadas no banco, com os tempos;
//   - as gravações só em SGH_SUS_* (contrato com o gestor, meta quantitativa e qualitativa, apuração do período), relidas
//     na mesma transação, a versão vencida recusada e o ROLLBACK conferido pelas contagens antes e depois.
// Saída só com contagens, códigos e tempos (dados sintéticos; a produção é agregada, sem dado de pessoa).
import {
  alterarContratoSusSgh,
  apuracoesSus,
  contratoSus,
  contratosSus,
  dominiosContratualizacao,
  ErroOperacao,
  incluirContratoSusSgh,
  incluirMetaSusSgh,
  metasSus,
  producaoContasSus,
  producaoFaturamentoSus,
  registrarApuracaoSusSgh,
  relogioContratualizacao,
  sigtapComPrefixo,
} from '@sgh/legado';
import { esquemaContratoSus, esquemaMetaSus } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Ambiente, contar, ctx, PODE_ESCREVER, prepararAmbiente } from './escrita.spec-util.js';

type Escritor = Parameters<Parameters<Ambiente['nucleo']['desfazendoNaCopia']>[1]>[0];

describe.skipIf(!PODE_ESCREVER)('M55 etapa 5 na cópia (transação desfeita)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  const retrato = () =>
    a.nucleo.lerSomente(ctx(a), async (l) => ({
      contrato: await contar(l, 'SELECT COUNT(*) N FROM SGH_SUS_CONTRATO'),
      meta: await contar(l, 'SELECT COUNT(*) N FROM SGH_SUS_META'),
      apuracao: await contar(l, 'SELECT COUNT(*) N FROM SGH_SUS_META_APURACAO'),
    }));

  it('as leituras: domínios onde estão, SIGTAP pelo prefixo e a produção agregada (só contagens e tempos)', async () => {
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const t: Record<string, number> = {};
      const medir = async <T>(nome: string, fn: () => Promise<T>) => {
        const i = performance.now();
        const v = await fn();
        t[nome] = Math.round(performance.now() - i);
        return v;
      };
      const rel = await relogioContratualizacao(l);
      const dom = await medir('dominios', () => dominiosContratualizacao(l));
      const sigtap = await medir('sigtap', () => sigtapComPrefixo(l, '0301'));
      const fat = await medir('faturamentoSus', () =>
        producaoFaturamentoSus(l, a.cod, '202501', rel.competencia),
      );
      const contas = await medir('contasSus', () => producaoContasSus(l, rel.competencia, [1]));
      const contratos = await medir('contratos', () => contratosSus(l, a.cod));
      return {
        t,
        dominios: Object.fromEntries(Object.entries(dom).map(([k, v]) => [k, v.length])),
        sigtap,
        faturamento: fat.length,
        contas: contas.length,
        contratos: contratos.itens.length,
      };
    });
    console.log(JSON.stringify(r));
    expect(r.dominios).toEqual({
      CMPERIODO: 16,
      CMTPINDICADOR: 8,
      CMTIPOCOMPLEXIDADESP: 7,
      CMTPITEMINDIC: 7,
      CMREDEASSIST: 6,
      CMESCORE: 4,
      CMTPAFERICAO: 4,
      CMTPCONTRATO: 3,
      CMTPDADOS: 3,
      CMTPORCAMENTO: 2,
      CMINCENTIVO: 1,
    });
    expect(r.sigtap).toBe(true);
    expect(r.faturamento).toBeGreaterThanOrEqual(0);
    expect(r.contas).toBeGreaterThanOrEqual(0);
    expect(r.t['dominios']).toBeLessThan(2_000);
    expect(r.t['contasSus']).toBeLessThan(60_000);
  });

  it('as gravações só em SGH_SUS_*: contrato, metas e apuração relidos; versão vencida recusada; ROLLBACK', async () => {
    const antes = await retrato();
    const sufixo = Date.now().toString(36);
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e: Escritor) => {
      const entrada = esquemaContratoSus.parse({
        chave: `int-m555-c-${sufixo}`,
        numero: `SINT-${sufixo}`,
        esfera: 3,
        gestor: 'Secretaria sintética de saúde',
        objeto: 'Contrato sintético de teste de integração',
        inicio: '2026-01-01',
        fim: '2026-12-31',
        cnes: '0000001',
        habilitacao: 'Habilitação sintética',
        valorPreMensalCentavos: 1_000_000,
        valorPosMensalCentavos: 250_000,
        incentivos: [{ nome: 'Incentivo sintético', valorMensalCentavos: 10_000, inicio: '2026-01-01' }],
      });
      const { chave } = entrada;
      const c = await incluirContratoSusSgh(e, { hospital: a.cod, entrada, usuario: 'SGH.TESTE', chave });
      const meta = (tipo: 'quantitativa' | 'qualitativa', n: number) => {
        const m = esquemaMetaSus.parse({
          chave: `int-m555-m${n}-${sufixo}`,
          tipo,
          descricao: `Meta sintética ${n}`,
          periodicidade: 10,
          inicio: '202601',
          ...(tipo === 'quantitativa'
            ? { nivelSigtap: 'subgrupo', codigoSigtap: '0301', modalidade: 'ambulatorial', valorMeta: 100 }
            : { indicador: 2, formato: 6, sentido: 'maior', unidade: '%', afericao: 1, valorMeta: 85 }),
        });
        return incluirMetaSusSgh(e, {
          hospital: a.cod,
          entrada: m,
          usuario: 'SGH.TESTE',
          contrato: c.id,
          chave: m.chave,
        });
      };
      const m1 = await meta('quantitativa', 1);
      await meta('qualitativa', 2);
      await registrarApuracaoSusSgh(e, {
        hospital: a.cod,
        usuario: 'SGH.TESTE',
        chave: `int-m555-a-${sufixo}`,
        meta: m1.id,
        competencia: '202603',
        inicioPeriodo: '202601',
        metaPeriodo: 300,
        realizado: 270,
        cumprimentoPct: 90,
        escore: 3,
        origem: 'contas-sus',
        observacao: null,
      });
      const relido = await contratoSus(e, a.cod, c.id, { travar: true });
      const metas = await metasSus(e, a.cod, c.id);
      const ap = await apuracoesSus(
        e,
        a.cod,
        metas.map((x) => x.id),
      );
      let vencida = 'gravou';
      try {
        await alterarContratoSusSgh(e, {
          hospital: a.cod,
          entrada,
          usuario: 'SGH.TESTE',
          id: c.id,
          versaoVista: 9,
        });
      } catch (x) {
        vencida = x instanceof ErroOperacao ? (x.problema.codigo ?? 'erro') : 'outro';
      }
      return {
        incentivos: relido?.incentivos.length,
        pos: relido?.valorPosMensalCentavos,
        metas: metas.map((x) => x.tipo),
        apuracoes: ap.map((x) => [x.competencia, x.escore]),
        vencida,
      };
    });
    console.log(JSON.stringify(r));
    expect(r).toEqual({
      incentivos: 1,
      pos: 250_000,
      metas: ['qualitativa', 'quantitativa'],
      apuracoes: [['202603', 3]],
      vencida: 'versao-desatualizada',
    });
    expect(await retrato()).toEqual(antes);
  });
});
