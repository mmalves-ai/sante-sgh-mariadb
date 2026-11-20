// Retificação sobre a cópia (ficha do M26, regra 4), em transação desfeita: o resultado digitado e liberado pelo
// executor, uma leitura no prontuário, a retificação com o motivo: a liberação ainda não vista fica substituída
// (situação 2), o resultado corrigido como o legado grava, o gatilho inclui a nova liberação, e no novo as duas versões
// (a liberada e a retificada, com o motivo e quem já tinha visto) e a leitura anterior avisada. Só contagens.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AmbienteSadt, ambienteSadt, MassaSadt, PODE_ESCREVER } from './copia.spec-util.js';

const num = (v: unknown) => Number(v ?? 0);

describe.skipIf(!PODE_ESCREVER)('retificação na cópia (transação desfeita)', () => {
  let a: AmbienteSadt;
  beforeAll(async () => {
    a = await ambienteSadt();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('versão anterior guardada, nova liberação do gatilho e quem já viu avisado', async () => {
    await a.nucleo.desfazendoNaCopia(
      { rede: a.nucleo.rede, hospital: a.cod, traceId: 'int-m26-retificar' },
      async (e) => {
        const m = new MassaSadt(a, e);
        const resp = await m.profissional(['2212', '2234', '225335']);
        const ex = await m.lancar('E', resp);
        await m.digitar(ex.id, resp, 4.5);
        await m.liberar(ex.id, resp);
        const antes = await m.porta.liberacaoVigente(m.c, ex.id);
        expect(antes).not.toBeNull();
        // Quem viu no prontuário (a leitura da versão liberada).
        await m.porta.gravarSgh(
          m.c,
          {
            rede: m.c.rede,
            hospital: m.c.hospital,
            usuario: resp.login,
            evento: 'sadt.exames.lidos',
            recurso: 'sadt.resultado.ler',
            operacao: 'leitura (teste)',
            tabelaAlvo: 'SGH_SADT_RESULT_LEITURA',
            idAlvo: String(ex.id),
            chaveNaturalAlvo: null,
            resultado: 'sucesso',
            estacao: 'teste',
            correlacao: `int-m26-leitura-${ex.id}`,
            idPaciente: ex.paciente,
          },
          (g) => g.registrarLeitura({ idSilanexa: ex.id, origem: 'pep', usuario: 'SGH.LEITOR' }),
        );
        // A digitação não muda o liberado (regra 4).
        await expect(
          m.executar(
            'sadt.registrarResultado',
            {
              exame: await m.lido(ex.id),
              elementos: [{ elemento: 0, numerico: 9, alfa: null, absoluta: null }],
            },
            resp.login,
          ),
        ).rejects.toMatchObject({ problema: { codigo: 'resultado-liberado' } });
        const r = await m.executar(
          'sadt.retificarResultado',
          {
            exame: await m.lido(ex.id),
            motivo: 'Correção de digitação (teste sintético)',
            elementos: [{ elemento: 0, numerico: 5.1, alfa: null, absoluta: null }],
            responsavel: resp.vinculo,
          },
          resp.login,
        );
        expect(num(r.resultado['substituidas'])).toBe(1);
        const [s] = await e.consultar('SELECT SITUACAO S FROM SILIBERACAOEXAME WHERE ID = ?', [antes!.id], {
          teto: 1,
        });
        expect(num(s?.['S'])).toBe(2);
        const nova = await m.porta.liberacaoVigente(m.c, ex.id);
        expect(nova!.id).toBeGreaterThan(antes!.id);
        const conf = await m.porta.conferencia(m.c, ex.id);
        expect(conf?.valores[0]?.numero).toBe(5.1);
        expect(conf?.versoes.map((v) => v.versao)).toEqual([1, 2]);
        expect(conf?.versoes[1]).toMatchObject({
          motivo: 'Correção de digitação (teste sintético)',
          viramAntes: 1,
        });
        const [l] = await e.consultar(
          'SELECT COUNT(*) N FROM SGH_SADT_RESULT_LEITURA WHERE HOSPITAL = ? AND ID_SILANEXA = ? AND AVISADO_EM IS NOT NULL',
          [a.cod, ex.id],
          { teto: 1 },
        );
        expect(num(l?.['N'])).toBe(1);
      },
    );
  });
});
