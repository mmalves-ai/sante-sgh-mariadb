// O catálogo oficial versionado das obrigações acessórias (catalogo-obrigacoes-oficiais.ts): a edição vigente na data, a
// situação de cada obrigação (vigente, encerrada, futura) e a recusa da geração das encerradas (SEFIP, CAGED e RAIS).
import { ErroOperacao } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import {
  catalogoObrigacoesNa,
  EDICOES_OBRIGACOES_OFICIAIS,
  edicaoObrigacoesNa,
  exigirObrigacaoComGerador,
  situacaoObrigacaoNa,
} from './catalogo-obrigacoes-oficiais.js';

const codigoDe = (fn: () => void): string => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    return e instanceof ErroOperacao ? `${e.problema.status}:${e.problema.codigo}` : String(e);
  }
};

describe('catálogo oficial das obrigações acessórias', () => {
  it('a edição vigente lista eSocial, EFD-Reinf, DCTFWeb e FGTS Digital vigentes; SEFIP, CAGED e RAIS encerradas', () => {
    const c = catalogoObrigacoesNa('2026-11-24');
    expect(c.edicao).toBe('2026-11');
    const vigentes = c.obrigacoes.filter((o) => o.situacao === 'vigente').map((o) => o.codigo);
    const encerradas = c.obrigacoes.filter((o) => o.situacao === 'encerrada').map((o) => o.codigo);
    expect(vigentes).toEqual(['esocial', 'efd-reinf', 'dctfweb', 'fgts-digital']);
    expect(encerradas).toEqual(['sefip', 'caged', 'rais']);
    // Toda encerrada diz o ato e o que a substituiu, e nenhuma tem gerador.
    for (const o of c.obrigacoes.filter((x) => x.situacao === 'encerrada')) {
      expect(o.atoEncerramento, o.codigo).toBeTruthy();
      expect(o.substituidaPor.length, o.codigo).toBeGreaterThan(0);
      expect(o.geradaPeloSistema, o.codigo).toBe(false);
    }
  });

  it('a situação pela data: futura antes do início, vigente até a substituição, encerrada a partir dela', () => {
    const fgts = EDICOES_OBRIGACOES_OFICIAIS[0]!.obrigacoes.find((o) => o.codigo === 'fgts-digital')!;
    const sefip = EDICOES_OBRIGACOES_OFICIAIS[0]!.obrigacoes.find((o) => o.codigo === 'sefip')!;
    expect(situacaoObrigacaoNa(fgts, '2024-02-29')).toBe('futura');
    expect(situacaoObrigacaoNa(fgts, '2024-03-01')).toBe('vigente');
    expect(situacaoObrigacaoNa(sefip, '2024-02-29')).toBe('vigente');
    expect(situacaoObrigacaoNa(sefip, '2024-03-01')).toBe('encerrada');
  });

  it('a edição na data: a mais recente publicada até ela (nunca se altera uma edição publicada)', () => {
    const nova = { ...EDICOES_OBRIGACOES_OFICIAIS[0]!, edicao: '2027-06', publicadaEm: '2027-06-01' };
    const edicoes = [...EDICOES_OBRIGACOES_OFICIAIS, nova];
    expect(edicaoObrigacoesNa('2027-05-31', edicoes).edicao).toBe('2026-11');
    expect(edicaoObrigacoesNa('2027-06-01', edicoes).edicao).toBe('2027-06');
    expect(edicaoObrigacoesNa('2020-01-01', edicoes).edicao).toBe('2026-11');
  });

  it('a geração: FGTS Digital passa; SEFIP, CAGED e RAIS recusam com 409 obrigacao-encerrada', () => {
    const c = catalogoObrigacoesNa('2026-11-24');
    expect(codigoDe(() => exigirObrigacaoComGerador(c, 'fgts-digital'))).toBe('ok');
    for (const t of ['sefip', 'caged', 'rais'] as const)
      expect(
        codigoDe(() => exigirObrigacaoComGerador(c, t)),
        t,
      ).toBe('409:obrigacao-encerrada');
  });
});
