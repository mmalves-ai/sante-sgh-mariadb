// Regra 6 do M24: cada alerta é regra versionada (aviso, justificar, bloqueio); vale a versão vigente; desligada não
// aparece; a decisão guarda a versão.
import { describe, expect, it } from 'vitest';
import { contexto, item, produto } from './fabrica.spec-util.js';
import { avaliarAlertas, impede, REGRAS_PADRAO, regraVigente } from './motor.js';
import type { RegraAlerta } from './tipos.js';

const alto = produto({ produto: 9, altoAlerta: true });

describe('regras versionadas', () => {
  it('a versão vigente de maior número vale; a futura ainda não', () => {
    const v2: RegraAlerta = {
      ...REGRAS_PADRAO.find((r) => r.tipo === 'alto-alerta')!,
      versao: 2,
      nivel: 'justificar',
      vigenteDesde: '2026-10-01',
    };
    const v3: RegraAlerta = { ...v2, versao: 3, nivel: 'bloqueio', vigenteDesde: '2027-01-01' };
    const regras = [...REGRAS_PADRAO, v2, v3];
    expect(regraVigente(regras, 'alto-alerta', '2026-10-21')?.versao).toBe(2);
    expect(regraVigente(regras, 'alto-alerta', '2027-01-02')?.versao).toBe(3);
    expect(regraVigente([], 'alto-alerta', '2026-10-21')).toBeNull();
    const a = avaliarAlertas({
      itens: [item('i', [{ produto: alto }])],
      ctx: contexto({ regras }),
      foraDaCategoria: [],
      dietas: [],
      decisoes: new Map(),
    });
    const x = a.find((y) => y.tipo === 'alto-alerta');
    expect(x).toMatchObject({ nivel: 'justificar', versaoRegra: 2, regra: 'alto-alerta' });
  });
  it('regra desligada não gera alerta', () => {
    const regras = REGRAS_PADRAO.map((r) => (r.tipo === 'alto-alerta' ? { ...r, ativa: false } : r));
    const a = avaliarAlertas({
      itens: [item('i', [{ produto: alto }])],
      ctx: contexto({ regras }),
      foraDaCategoria: [],
      dietas: [],
      decisoes: new Map(),
    });
    expect(a.some((x) => x.tipo === 'alto-alerta')).toBe(false);
  });
  it('bloqueio total impede mesmo com justificativa; aviso não impede', () => {
    const viaErrada = produto({ produto: 5, viasPermitidas: ['EV'] });
    const a = avaliarAlertas({
      itens: [item('i', [{ produto: viaErrada }], { via: 'VO' })],
      ctx: contexto(),
      foraDaCategoria: [],
      dietas: [],
      decisoes: new Map([
        ['i', [{ alerta: 'via-forma:5:VO', decisao: 'mantido', justificativa: 'tenho certeza absoluta' }]],
      ]),
    });
    expect(impede(a)).toEqual({ impede: true, motivo: 'alerta-bloqueio' });
    const aviso = avaliarAlertas({
      itens: [item('i', [{ produto: alto }])],
      ctx: contexto(),
      foraDaCategoria: [],
      dietas: [],
      decisoes: new Map(),
    });
    expect(impede(aviso).impede).toBe(false);
  });
  it('categoria, se necessário sem motivo e dieta de outro profissional', () => {
    const p = produto({ produto: 1 });
    const a = avaliarAlertas({
      itens: [item('m', [{ produto: p }], { aCriterio: true }), item('d', [], { tipo: 'dieta-oral' })],
      ctx: contexto({ dietaDeOutro: { autor: 'outro profissional', prescricao: 70, item: 71 } }),
      foraDaCategoria: ['m'],
      dietas: ['d'],
      decisoes: new Map(),
    });
    expect(a.map((x) => x.tipo).sort()).toEqual(['categoria', 'dieta-de-outro', 'se-necessario']);
    expect(impede(a).impede).toBe(true);
    // Regra 10: nada é suspenso sozinho; a dieta anterior aparece com a prescrição e pede a justificativa.
    const d = a.find((x) => x.tipo === 'dieta-de-outro');
    expect(d).toMatchObject({ nivel: 'justificar', referencia: { prescricao: 70, item: 71 } });
    expect(d?.detalhe).toContain('suspenda a anterior');
    expect(d?.detalhe).not.toContain('substituída');
    const justificado = avaliarAlertas({
      itens: [item('d', [], { tipo: 'dieta-oral' })],
      ctx: contexto({ dietaDeOutro: { autor: 'outro profissional' } }),
      foraDaCategoria: [],
      dietas: ['d'],
      decisoes: new Map([
        ['d', [{ alerta: 'dieta-de-outro', decisao: 'mantido', justificativa: 'Combinado com a nutrição.' }]],
      ]),
    });
    expect(impede(justificado).impede).toBe(false);
  });
  it('sem a base de interações, um aviso informativo e nenhum alerta de interação', () => {
    const p = produto({ produto: 1, principiosAtivos: [1] });
    const a = avaliarAlertas({
      itens: [item('i', [{ produto: p }])],
      ctx: contexto({ interacoes: null }),
      foraDaCategoria: [],
      dietas: [],
      decisoes: new Map(),
    });
    expect(a.map((x) => x.tipo)).toEqual(['base-nao-contratada']);
    expect(impede(a).impede).toBe(false);
  });
});
