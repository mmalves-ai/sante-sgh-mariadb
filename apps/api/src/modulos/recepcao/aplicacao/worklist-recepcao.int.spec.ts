// A fila da recepção sobre a cópia (só leitura; ficha do M27, seção 4): as guias aguardando autorização do último dia
// de movimento da cópia (o dia de hoje não tem movimento na cópia), com o teto de 300 e o tempo (meta: p95 < 1 s); as
// senhas pela prioridade legal na ordem do domínio. Só contagens.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { senhasDoDia } from '@sgh/legado';
import { ordenarSenhasDaWorklist } from '@sgh/dominio-recepcao';
import {
  type AmbienteM27,
  ambienteM27,
  NA_COPIA,
  percentil,
} from '../../acesso/aplicacao/copia.spec-util.js';
import { portaGuiasLegado } from './worklist-recepcao.js';

describe.skipIf(!NA_COPIA)('fila da recepção na cópia (só leitura)', () => {
  let a: AmbienteM27;
  beforeAll(async () => {
    a = await ambienteM27();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('guias aguardando autorização do último dia de movimento, com teto e tempo', async () => {
    const dia = await a.nucleo.lerSomente({ ...a.c, traceId: 'int-m27-rec' }, async (l) => {
      const [x] = await l.consultar(
        'SELECT CAST(MAX(DT_ATE) AS VARCHAR(10)) D FROM RECADATE WHERE DT_ATE < CURRENT_DATE + 1',
        [],
        { teto: 1 },
      );
      return String(x?.['D'] ?? '');
    });
    const porta = portaGuiasLegado(a.nucleo);
    const tempos: number[] = [];
    let r = await porta.guias(a.c, dia);
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      r = await porta.guias(a.c, dia);
      tempos.push(performance.now() - t0);
    }
    expect(r.guias.length).toBeLessThanOrEqual(300);
    const ordem = r.guias.map((g) => g.abertoEm);
    expect([...ordem].sort()).toEqual(ordem);
    const n = r.guias.length;
    console.log(
      `[int-m27] guias aguardando autorização no último dia: ${n < 5 ? '<5' : n}; p95 ${Math.round(percentil(tempos, 95))} ms`,
    );
  });

  it('as senhas de um dia de movimento na ordem da prioridade legal', async () => {
    const senhas = await a.nucleo.lerSomente({ ...a.c, traceId: 'int-m27-rec' }, async (l) => {
      const [x] = await l.consultar(
        'SELECT CAST(MAX(DATA_SENHA) AS VARCHAR(10)) D FROM TBSENHAATEND WHERE DATA_SENHA < CURRENT_DATE + 1',
        [],
        { teto: 1 },
      );
      return senhasDoDia(l, a.cod, { dia: String(x?.['D'] ?? '') });
    });
    if (!senhas) return;
    const lista = ordenarSenhasDaWorklist(
      senhas.senhas.slice(0, 300).map((s) => ({
        id: s.id,
        senha: s.texto,
        prioridade: (['0', '1', '2'].includes(s.prioridade.trim()) ? s.prioridade.trim() : '2') as
          '0' | '1' | '2',
        grupo: s.grupo,
        grupoDescricao: '',
        emitidaEm: s.emitidaEm,
        esperaMinutos: 0,
        situacao: s.situacao,
        gerador: s.servico,
      })),
    );
    const pesos = lista.map((s) => Number(s.prioridade));
    expect([...pesos].sort((x, y) => x - y)).toEqual(pesos);
  });
});
