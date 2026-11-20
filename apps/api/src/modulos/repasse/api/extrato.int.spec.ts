// Regra 12 do M33 sobre a cópia (só leitura): o extrato do médico é só do próprio. O vínculo do usuário com o cadastro
// de profissional (o login ligado pelo papel Operador de sistema ativo; revisão da D-PROF-39) dá os códigos de prestador; os lançamentos e os RPAs lidos são só
// desses códigos; o usuário sem vínculo recebe a lista vazia. Só contagens e códigos (nada de nome ou documento).
import { condicaoLoginDoProfissional, loginDoProfissionalSql } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AmbienteM27, ambienteM27, NA_COPIA } from '../../acesso/aplicacao/copia.spec-util.js';
import { portaRepasseNaTransacao } from '../porta-legado.js';

describe.skipIf(!NA_COPIA)('extrato do médico (cópia, só leitura)', () => {
  let a: AmbienteM27;
  beforeAll(async () => {
    a = await ambienteM27();
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('só os lançamentos e os RPAs do próprio médico; sem vínculo, nada', async () => {
    const r = await a.nucleo.lerSomente({ ...a.c, traceId: 'int-m33-extrato' }, async (l) => {
      // Um usuário com vínculo a um profissional que tem lançamento de repasse (só em memória).
      const [u] = await l.consultar(
        `SELECT FIRST 1 ${loginDoProfissionalSql('p')} L FROM TBPROFIS p JOIN TBCBOPRO b ON b.ID_TBPROFIS = p.ID
          WHERE ${loginDoProfissionalSql('p')} IS NOT NULL AND EXISTS (SELECT 1 FROM RPLANEVE e WHERE e.TIPO = 'M' AND e.COD_PRESTADOR = b.COD
            AND e.DATA >= '2025-01-01')`,
        [],
        { teto: 1, tempoMaximoMs: 120_000 },
      );
      const login = String(u?.['L'] ?? '').trim();
      const [s] = await l.consultar(
        `SELECT FIRST 1 u.NOME FROM TBUSERS u WHERE NOT EXISTS (SELECT 1 FROM TBPROFIS p WHERE ${condicaoLoginDoProfissional('p').replace(/\?/g, 'u.NOME')})`,
        [],
        { teto: 1 },
      );
      const semVinculo = String(s?.['NOME'] ?? '').trim();
      const porta = portaRepasseNaTransacao(l as never, a.executor);
      const meus = await porta.prestadoresDoUsuario(a.c, login);
      const ls = await porta.lancamentosDosPrestadores(a.c, meus, '2025-01-01');
      const rpas = await porta.rpasDosPrestadores(a.c, meus, '2025-01-01');
      const nenhum = await porta.prestadoresDoUsuario(a.c, semVinculo);
      return {
        comLogin: login !== '',
        prestadores: meus.length,
        lancamentos: ls.length,
        soDoMedico:
          ls.every((x) => meus.includes(x.prestador)) && rpas.every((x) => meus.includes(x.prestador)),
        semVinculo: nenhum.length,
        vazioSemVinculo: (await porta.lancamentosDosPrestadores(a.c, nenhum, '2025-01-01')).length,
      };
    });
    expect(r.comLogin).toBe(true);
    expect(r.prestadores).toBeGreaterThan(0);
    expect(r.lancamentos).toBeGreaterThan(0);
    expect(r.soDoMedico).toBe(true);
    expect(r.semVinculo).toBe(0);
    expect(r.vazioSemVinculo).toBe(0);
  }, 900_000);

  it('extrato por competência, regras por procedimento e profissional, a busca do médico e o RPA emitido relido', async () => {
    const r = await a.nucleo.lerSomente({ ...a.c, traceId: 'int-m33-leituras' }, async (l) => {
      const porta = portaRepasseNaTransacao(l as never, a.executor);
      // Um RPA de médico com o registro ligado (só IDs em memória).
      const [p] = await l.consultar(
        `SELECT FIRST 1 p.ID_RPRPA, p.COD_PRESTADOR, v.ID_TBCBOPRO,
                (SELECT COUNT(*) FROM RPLANRPA x WHERE x.ID_RPRPA = p.ID_RPRPA) N
           FROM RPRPA p JOIN RPRPA_TBCBOPRO v ON v.ID_RPRPA = p.ID_RPRPA WHERE p.TIPO = 'M' ORDER BY p.ID_RPRPA DESC`,
        [],
        { teto: 1, tempoMaximoMs: 120_000 },
      );
      const id = Number(p?.['ID_RPRPA']);
      const cod = Number(p?.['COD_PRESTADOR']);
      const d = await porta.rpaDetalhe(a.c, id);
      const busca = await porta.buscarPrestadores(a.c, String(cod));
      // O extrato de uma competência só traz datas dela.
      const ls = await porta.lancamentosDosPrestadores(a.c, [cod], '2025-06-01', '2025-06-30');
      // Uma regra com faixa de procedimento e médico: o filtro a encontra, e tudo o que volta obedece ao filtro.
      const [g] = await l.consultar(
        `SELECT FIRST 1 r.ID, r.CONV, r.COD, r.PROCTO_INI, r.DATA FROM TBREPGER r
          WHERE r.PROCTO_INI > 0 AND r.COD > 0 AND r.CONV > 0 ORDER BY r.ID DESC`,
        [],
        { teto: 1, tempoMaximoMs: 120_000 },
      );
      const t0 = Date.now();
      const regras = await porta.regras(a.c, {
        convenio: Number(g?.['CONV']),
        data: '2099-12-31',
        depoisDe: 0,
        procedimento: Number(g?.['PROCTO_INI']),
        profissional: Number(g?.['COD']),
        teto: 501,
      });
      const ms = Date.now() - t0;
      return {
        rpaRelido: d?.rpa.id === id && d.lancamentos.length === Number(p?.['N']),
        contribuinte: d?.contribuinte !== null && d?.contribuinte?.conselho.startsWith(String(cod)),
        documentoMascarado:
          d?.contribuinte?.documento === '' || /^\*{2,3}\./.test(d?.contribuinte?.documento ?? ''),
        buscaDevolveRegistro: busca.length > 0 && busca.every((b) => b.prestador === cod && b.registro > 0),
        soDaCompetencia: ls.every((x) => (x.data ?? '') >= '2025-06-01' && (x.data ?? '') <= '2025-06-30'),
        achouRegra: regras.some((x) => x.id === Number(g?.['ID'])),
        filtroRespeitado: regras.every(
          (x) =>
            (x.prestador === null || x.prestador === Number(g?.['COD'])) &&
            (x.procedimentoInicial === null ||
              (x.procedimentoInicial <= Number(g?.['PROCTO_INI']) &&
                (x.procedimentoFinal ?? x.procedimentoInicial) >= Number(g?.['PROCTO_INI']))),
        ),
        ms,
      };
    });
    expect(r.rpaRelido).toBe(true);
    expect(r.contribuinte).toBe(true);
    expect(r.documentoMascarado).toBe(true);
    expect(r.buscaDevolveRegistro).toBe(true);
    expect(r.soDaCompetencia).toBe(true);
    expect(r.achouRegra).toBe(true);
    expect(r.filtroRespeitado).toBe(true);
    console.info(`[M33] regras filtradas por procedimento e profissional: ${r.ms} ms`);
  }, 900_000);
});
