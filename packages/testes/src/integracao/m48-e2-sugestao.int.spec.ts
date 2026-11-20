// M48, etapa 2 (correção da revisão, D-SUG-PORFORA-48.2; ficha, campos 4 e 10), sobre a cópia, transação DESFEITA, sob
// a trava: a dose marcada como não administrada POR FORA do Sante (o outro sistema simulado da massa altera a linha da
// PRCHKGERAL direto, sem o gravador do Sante) vira a sugestão `naoAdministrada:<horário>` do profissional do login;
// quando o Sante tem o registro próprio da checagem daquele horário (SGH_PEP_CHECAGEM_EXT), ela não se repete. O
// ROLLBACK conferido pelos horários não administrados e pela SGH_PEP_CHECAGEM_EXT. Só contagens e códigos saem.
import { sugestoesDoUsuario } from '@sgh/dominio-qualidade';
import { candidatosASugestaoSgh, registrarChecagemNoNovo } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { doseNaoAdministradaPorFora } from '../massa/checagem-outro-sistema.js';
import { type Ambiente, ctx, num, PODE_ESCREVER, prepararAmbiente } from './escrita.spec-util.js';

/** O instante local (sem fuso) de `dias` atrás, como a API passa a janela da sugestão. */
function localAtras(dias: number): string {
  const d = new Date(Date.now() - dias * 86_400_000);
  const z = (x: number) => String(x).padStart(2, '0');
  return `${String(d.getFullYear())}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
}

describe.skipIf(!PODE_ESCREVER)(
  'M48.2: sugestão da dose não administrada por fora (transação desfeita)',
  () => {
    let a: Ambiente;
    const retrato = () =>
      a.nucleo.lerSomente(ctx(a), async (l) => {
        const [k] = await l.consultar("SELECT COUNT(*) N FROM PRCHKGERAL WHERE SITUACAO_CHECAGEM = 'N'", [], {
          teto: 1,
        });
        const [x] = await l.consultar('SELECT COUNT(*) N FROM SGH_PEP_CHECAGEM_EXT', [], { teto: 1 });
        return [num(k?.['N']), num(x?.['N'])];
      });
    let antes: number[] = [];
    beforeAll(async () => {
      a = await prepararAmbiente();
      antes = await retrato();
    }, 300_000);
    afterAll(async () => {
      await a?.nucleo.encerrar();
    });

    it('o horário marcado por fora vira sugestão; com o registro do Sante no horário, não se repete', async () => {
      const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
        const { horario, login } = await doseNaoAdministradaPorFora(e);
        const desde = localAtras(7);
        const t0 = performance.now();
        const c1 = await candidatosASugestaoSgh(e, a.cod, login, desde);
        const ms = Math.round(performance.now() - t0);
        const origens = sugestoesDoUsuario(c1, () => false).map((s) => s.origem);
        // O Sante registra a checagem desse mesmo horário: a leitura por fora deixa de trazê-lo.
        await registrarChecagemNoNovo(
          e,
          { hospital: a.cod, usuarioLegado: login, idempotencyKey: `int-m48-2-porfora-${String(horario)}` },
          {
            prescricao: 999_999_401,
            atendimento: 999_999_402,
            paciente: 999_999_403,
            cbo: 1,
            marcacoes: [
              {
                horario,
                item: 999_999_404,
                situacaoLida: 'P',
                situacao: 'N',
                quantidade: 0,
                justificativa: null,
                papel: 'principal',
              },
            ],
            sgh: {
              horaReal: localAtras(0).slice(0, 16),
              pulseiraLida: false,
              motivoSemPulseira: null,
              gtin: null,
              lote: null,
              validade: null,
              conferente: null,
              dispositivo: null,
              origemOffline: false,
              avisos: [],
              motivo: 'recusa',
              observacao: null,
            },
            glicemia: null,
          },
        );
        const c2 = await candidatosASugestaoSgh(e, a.cod, login, desde);
        return {
          sugerida: origens.includes(`naoAdministrada:${String(horario)}`),
          comAtendimento: c1.horarios.find((h) => h.id === horario)?.atendimento !== undefined,
          repetida: c2.horarios.some((h) => h.id === horario),
          ms,
        };
      });
      console.log(
        `[m48.2] por fora: sugerida=${String(r.sugerida)} repetida=${String(r.repetida)} ${String(r.ms)} ms`,
      );
      expect(r.sugerida, 'a dose marcada por fora vira sugestão').toBe(true);
      expect(r.comAtendimento).toBe(true);
      expect(r.repetida, 'com o registro do Sante, não se repete').toBe(false);
      expect(r.ms).toBeLessThan(500);
    }, 600_000);

    it('o ROLLBACK devolve tudo (horários não administrados e SGH_PEP_CHECAGEM_EXT iguais)', async () => {
      expect(await retrato()).toEqual(antes);
    });
  },
);
