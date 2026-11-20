// Regra 6 do M45 (etapa 3; ficha, seção 8: `balanco-origem-checagem`): o ganho endovenoso do balanço vem da checagem,
// sem redigitar, e uma vez só, mesmo com a checagem reenviada sem rede. Pela HTTP, com as portas em memória (dados
// sintéticos): a técnica checa o soro sem rede na beira do leito, o tablet reenvia o mesmo lote na sincronização, e o balanço
// mostra um ganho só; o fechamento parcial grava o ganho da checagem uma vez e ele não volta como pendente.
import type { BalancoDoPaciente } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AppEnfermagem,
  checagemPadrao,
  criarAppEnfermagem,
  horariosDaUti,
} from '../enfermagem.spec-util.js';

let a: AppEnfermagem;
beforeAll(async () => {
  a = await criarAppEnfermagem();
});
afterAll(async () => {
  await a.fechar();
});

const AT = 25_102;

describe('regra 6: o ganho do balanço vem da checagem, uma vez só', () => {
  it('a checagem sem rede reenviada no mesmo lote: um ganho só; o fechamento grava uma vez', async () => {
    const tec = await a.entrar('SINT.TECNICO.ENF');
    const t = await horariosDaUti(a, tec);
    const soro = t.horarios.find((x) => x.descricao.startsWith('SORO FISIOLOGICO') && x.situacao === 'P')!;
    expect(soro).toBeDefined();
    // A checagem feita sem rede no tablet: o lote é enviado quando a rede volta, a resposta se perde e o tablet
    // reenvia o mesmo lote (os mesmos atos, cada um com a chave dele).
    const lote = {
      dispositivo: 'tablet-balanco',
      atos: [
        {
          tipo: 'checagem',
          chave: 'ato-tablet-soro-balanco-01',
          horario: soro.id,
          checagem: { ...checagemPadrao(25002, 25202), horaReal: '2026-10-22T12:40' },
        },
      ],
    };
    const r1 = (await a.post(tec, '/enfermagem/sincronizar', lote)).json();
    expect(r1.resultados[0]).toMatchObject({ ok: true });
    const r2 = (await a.post(tec, '/enfermagem/sincronizar', lote)).json();
    expect(r2.resultados[0]).toMatchObject({ ok: true, codigo: 'repetido' });

    const enf = await a.entrar('SINT.ENF.PLANTAO');
    const ler = async () => (await a.get(enf, `/enfermagem/balanco/${AT}`)).json() as BalancoDoPaciente;
    const b = await ler();
    const doSoro = b.pendentes.filter((p) => p.origem === 'checagem' && p.referencia === soro.id);
    expect(doSoro).toEqual([
      expect.objectContaining({
        sentido: 'ganho',
        grupo: 4,
        via: 'EV',
        volumeMl: 500,
        horaReal: '2026-10-22T12:40',
      }),
    ]);
    expect(b.calculo.ganhosMl).toBe(500);

    const f = await a.post(enf, `/enfermagem/balanco/${AT}/fechamentos`, {
      tipo: 'parcial',
      inicio: b.janela.inicio,
      ate: b.calculo.ate,
      pesoKg: null,
      impressaoVista: b.calculo.impressao,
    });
    expect(f.statusCode, f.body).toBe(201);
    const depois = await ler();
    expect(depois.pendentes.filter((p) => p.referencia === soro.id)).toEqual([]);
    expect(depois.lancamentos.filter((l) => l.origem === 'checagem' && l.horario === soro.id)).toHaveLength(
      1,
    );
    expect(depois.calculo.ganhosMl).toBe(500);
    // O ganho é da checagem: nada foi digitado no balanço.
    expect(depois.lancamentos.filter((l) => l.origem === 'manual')).toHaveLength(0);
  });
});
