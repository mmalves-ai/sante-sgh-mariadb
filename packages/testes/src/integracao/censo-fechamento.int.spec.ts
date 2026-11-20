// internacao.fecharCenso sobre a cópia (ficha do M16, seção 10): o censo de um dia fechado uma só vez com dois
// processos — enquanto o primeiro segura a transação, o segundo desiste (trava/UNIQUE do dia); prova pós-escrita;
// só SGH_ (o escritor SGH_ do núcleo recusa tabela do legado). Tudo desfeito (ROLLBACK). Só contagens.
import { MotorInternacao, relogioDeParede, dataDoDia } from '@sgh/dominio-internacao';
import { fecharCenso, lerMovimentoInternacao, somenteSgh } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Ambiente, ctx, num, PODE_ESCREVER, prepararAmbiente } from './escrita.spec-util.js';

describe.skipIf(!PODE_ESCREVER)('fechamento do censo na cópia', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente({ FB_LOCK_TIMEOUT_S: '2' });
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('dois processos: o segundo desiste; nada fica depois do ROLLBACK', async () => {
    const mov = await a.nucleo.lerSomente(ctx(a), (l) => lerMovimentoInternacao(l));
    const m = new MotorInternacao(mov, {
      horaFechamento: 24,
      intensivas: [3, 7, 8, 9, 17],
      agora: relogioDeParede(Date.now()),
    });
    const dia = dataDoDia(Math.min(m.ultimoMovimento, m.diaAtual - 1));
    const censo = {
      hospital: a.cod,
      data: dia,
      horaFechamento: 24,
      versaoCalculo: 1,
      linhas: m.censoDoDia(dia),
    };
    let liberar!: () => void;
    const segura = new Promise<void>((ok) => (liberar = ok));
    let primeiro!: (v: unknown) => void;
    const gravou = new Promise((ok) => (primeiro = ok));
    const p1 = a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const r = await fecharCenso(somenteSgh(e), censo);
      primeiro(r);
      await segura;
      return r;
    });
    const r1 = await gravou;
    const segundo = await a.nucleo
      .desfazendoNaCopia(ctx(a), (e) => fecharCenso(somenteSgh(e), censo))
      .then(() => 'gravou')
      .catch((x: unknown) => (x instanceof Error ? x.name : 'erro'));
    liberar();
    await p1;
    console.log(`[${a.cod}] ${dia}: primeiro ${JSON.stringify(r1)}; segundo: ${segundo}`);
    expect(segundo).not.toBe('gravou');
    const [n] = await a.nucleo.lerSomente(ctx(a), (l) =>
      l.consultar(
        'SELECT COUNT(*) N FROM SGH_INT_CENSO_DIA WHERE HOSPITAL = ? AND DATA_CENSO = ?',
        [a.cod, new Date(`${dia}T00:00:00.000Z`)],
        { teto: 1 },
      ),
    );
    expect(num(n?.['N'])).toBe(0);
  });

  it('o escritor SGH_ recusa a tabela do legado antes do banco', async () => {
    await expect(
      a.nucleo.desfazendoNaCopia(ctx(a), (e) =>
        somenteSgh(e).executar('UPDATE RILEITOS SET RAMAL = RAMAL WHERE ID = -1'),
      ),
    ).rejects.toThrow(/SGH_/);
  });
});
