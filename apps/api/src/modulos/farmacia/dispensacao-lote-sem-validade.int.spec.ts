// Lote migrado sem validade na dispensação ao paciente (recusas da carga, fase 2, decisão D1) no gravador da farmácia
// pela porta própria contra o MariaDB real (cliente de teste da massa de suprimentos, SGH_CLIENTE_TESTE; massa
// SINTÉTICA "F22L0314", nenhuma pessoa real): a dispensação ambulatorial do antimicrobiano com o lote de origem
// 'migracao' e validade nula é recusada com `lote-sem-validade` (nunca "vencido" nem "validade diferente"), sem
// dispensação, receita nem baixa de saldo. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  contexto,
  inserirMinimo,
  limparMassa,
  type MassaSuprimentos,
  montarMassa,
  SEM_BANCO,
} from '../suprimentos/massa-propria.spec-util.js';
import { PortaFarmaciaPropria } from './porta-propria.js';

const NOME = 'SINTETICO RLSVF';

describe.skipIf(SEM_BANCO)('lote sem validade na dispensação da farmácia (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let m: MassaSuprimentos;
  let porta: PortaFarmaciaPropria;
  const ids: Record<string, number> = {};
  const ctxE = { cliente: CLIENTE, correlacao: 't-rlsvf' };
  const ler = <T extends Record<string, unknown>>(sql: string, p: unknown[]) =>
    nucleo.lerSomente(ctxE, (l) => l.consultar<T>(sql, p));
  const limparProprio = () =>
    nucleo.escrever(ctxE, async (e) => {
      for (const sql of [
        `DELETE FROM profissional WHERE pessoa_fisica_id IN (SELECT id FROM pessoa_fisica WHERE nome LIKE '%${NOME}')`,
        `DELETE FROM paciente WHERE pessoa_fisica_id IN (SELECT id FROM pessoa_fisica WHERE nome LIKE '%${NOME}')`,
        `DELETE FROM pessoa_fisica WHERE nome LIKE '%${NOME}'`,
      ])
        await e.executar(sql, []);
    });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    await limparProprio();
    m = await montarMassa(nucleo);
    porta = new PortaFarmaciaPropria(nucleo);
    await nucleo.escrever(ctxE, async (e) => {
      const x = (t: string, v: Record<string, unknown>) => inserirMinimo(e, t, v, m.marca);
      ids.item = await x('insumo', {
        codigo: `${m.marca}RLAX`,
        nome: 'ANTIMICROBIANO SINTETICO RLSVF',
        tipo: 'medicamento',
        grupo_insumo_id: m.grupo,
        estoque_unidade_medida_id: m.unidade,
        situacao: 'ativo',
        controla_lote: true,
        controla_validade: true,
        antimicrobiano: true,
      });
      ids.lote = await x('lote_insumo', {
        estabelecimento_id: m.estA,
        insumo_id: ids.item,
        numero_lote: `${m.marca}SVF`,
        validade: null,
        situacao: 'liberado',
        origem: 'migracao',
      });
      await x('saldo_lote', {
        estabelecimento_id: m.estA,
        local_estoque_id: m.localA,
        lote_insumo_id: ids.lote,
        quantidade: 5,
        competencia: '2026-11-01',
      });
      const pessoa = (nome: string) => x('pessoa_fisica', { nome: `${nome} ${NOME}` });
      ids.paciente = await x('paciente', {
        pessoa_fisica_id: await pessoa('PACIENTE'),
        numero_prontuario: 927_000_000 + (Date.now() % 900_000),
      });
      ids.medico = await x('profissional', {
        pessoa_fisica_id: await pessoa('MEDICO'),
        tipo: 'corpo_clinico',
      });
    });
  }, 120_000);

  afterAll(async () => {
    if (!nucleo) return;
    await limparMassa(nucleo, m);
    await limparProprio();
    await nucleo.encerrar();
  });

  it('dispensação ambulatorial: o lote sem validade é recusado com "lote sem validade"; nada gravado', async () => {
    const ctx = contexto(m, m.estA, 't-rlsvf');
    const hoje = (await porta.relogio(ctx)).hoje;
    const falha = await porta
      .gravarSgh(ctx, null, (g) =>
        g.dispensarAmbulatorial({
          paciente: ids.paciente!,
          item: ids.item!,
          lote: `${m.marca}SVF`,
          validade: '2027-12-31',
          quantidade: 1,
          receitaNumero: 'RX-RLSVF-1',
          receitaData: hoje,
          prescritor: ids.medico!,
          autor: 'rlsvf.farma',
          hoje,
        }),
      )
      .then(
        () => null,
        (e: { problema?: Record<string, unknown> }) => e.problema ?? {},
      );
    expect(falha).toMatchObject({ codigo: 'lote-sem-validade', campos: ['lote'] });
    expect(String(falha?.['detail'])).toMatch(/sem validade \(não informada na origem\)/);
    expect(String(falha?.['detail'])).not.toMatch(/vencid/i);
    const [d] = await ler<{ n: unknown }>('SELECT COUNT(*) AS n FROM dispensacao WHERE paciente_id = ?', [
      ids.paciente,
    ]);
    expect(Number(d?.n)).toBe(0);
    const [s] = await ler<{ q: unknown }>('SELECT quantidade AS q FROM saldo_lote WHERE lote_insumo_id = ?', [
      ids.lote,
    ]);
    expect(Number(s?.q)).toBe(5);
  });
});
