import { describe, expect, it } from 'vitest';
import { criarAbility, regrasDeAcesso } from './ability.js';
import { decidir } from './decisao.js';

const ab = (p: string[], unidades: string[] = []) =>
  criarAbility(
    regrasDeAcesso(p, {
      unidades,
      locais: [],
      convenios: [],
      centrosCusto: [],
      locaisEstoque: [],
      contasBancarias: [],
      tiposAgenda: [],
      tiposProntuario: [],
    }),
  );

describe('decisão em passos (regra 5): sessão → permissão → escopo → categoria → vínculo', () => {
  it('nega sem sessão, sem permissão e fora do escopo', () => {
    const a = ab(['pep.evolucao.ler'], ['1']);
    expect(decidir({ autenticado: false, ability: a, permissao: 'pep.evolucao.ler' })).toMatchObject({
      desfecho: 'nega',
      passo: 'sessao',
      auditar: false,
    });
    expect(decidir({ autenticado: true, ability: a, permissao: 'pep.evolucao.criar' }).passo).toBe(
      'permissao',
    );
    expect(
      decidir({ autenticado: true, ability: a, permissao: 'pep.evolucao.ler', registro: { unidade: 2 } }),
    ).toMatchObject({ desfecho: 'nega', passo: 'escopo', auditar: true });
  });

  it('categoria: ação privativa exige conselho', () => {
    const a = ab(['pep.atestado.criar']);
    expect(
      decidir({ autenticado: true, ability: a, permissao: 'pep.atestado.criar', exigeConselho: true }).passo,
    ).toBe('categoria');
    expect(
      decidir({
        autenticado: true,
        ability: a,
        permissao: 'pep.atestado.criar',
        exigeConselho: true,
        temConselho: true,
      }).desfecho,
    ).toBe('permite');
  });

  it('vínculo: oferece quebra de vidro a quem pode, nega a quem não pode, permite com emergência vigente', () => {
    const a = ab(['pep.evolucao.ler'], ['1']);
    const base = {
      autenticado: true,
      ability: a,
      permissao: 'pep.evolucao.ler',
      registro: { unidade: 1 },
      exigeVinculo: true,
      temVinculo: false,
    };
    expect(decidir({ ...base, podeQuebrarVidro: true }).desfecho).toBe('quebra-de-vidro');
    expect(decidir(base)).toMatchObject({ desfecho: 'nega', passo: 'vinculo' });
    expect(decidir({ ...base, emergenciaVigente: true })).toMatchObject({
      desfecho: 'permite',
      porEmergencia: true,
    });
    expect(decidir({ ...base, temVinculo: true })).toMatchObject({ desfecho: 'permite', auditar: true });
  });
});
