// 03-PEP L131: regra de cabeçalho por tipo de documento. Massa sintética.
import { describe, expect, it } from 'vitest';
import {
  aplicarExibicao,
  montarCabecalho,
  type RegraCabecalho,
  resolverCabecalho,
  validarRegraCabecalho,
} from './cabecalho.js';
import { htmlDocumento } from './modelo.js';

const r = (p: Partial<RegraCabecalho>): RegraCabecalho => ({
  id: 1,
  estabelecimento: null,
  tipoDocumento: null,
  fonte: 'estabelecimento',
  cabecalho: null,
  rodape: null,
  exibeDadosPaciente: true,
  exibeAssinatura: true,
  ativo: true,
  ...p,
});
const est = {
  nome: 'Hospital Sintético',
  cnpj: '12345678000195',
  cnes: '1234567',
  endereco: 'Rua A, 1',
  telefone: null,
};

describe('regra de cabeçalho', () => {
  it('valida texto próprio, linhas e marcação', () => {
    expect(validarRegraCabecalho({ fonte: 'personalizado', cabecalho: null, rodape: null })[0]?.campo).toBe(
      'cabecalho',
    );
    expect(
      validarRegraCabecalho({ fonte: 'estabelecimento', cabecalho: 'Linha', rodape: null }),
    ).toHaveLength(1);
    expect(
      validarRegraCabecalho({
        fonte: 'personalizado',
        cabecalho: 'a\nb\nc\nd\ne\nf\ng',
        rodape: '<b>x</b>',
      }).map((f) => f.campo),
    ).toEqual(['cabecalho', 'rodape']);
    expect(
      validarRegraCabecalho({ fonte: 'personalizado', cabecalho: 'Hospital\nAla B', rodape: 'Fim' }),
    ).toEqual([]);
  });
  it('escolhe a regra mais específica entre as ativas', () => {
    const regras = [
      r({ id: 1 }),
      r({ id: 2, estabelecimento: 10 }),
      r({ id: 3, tipoDocumento: 7 }),
      r({ id: 4, estabelecimento: 10, tipoDocumento: 7 }),
      r({ id: 5, estabelecimento: 10, tipoDocumento: 8, ativo: false }),
    ];
    expect(resolverCabecalho(regras, 10, 7)?.id).toBe(4);
    expect(resolverCabecalho(regras, 11, 7)?.id).toBe(3);
    expect(resolverCabecalho(regras, 10, 8)?.id).toBe(2);
    expect(resolverCabecalho(regras, 11, 8)?.id).toBe(1);
    expect(resolverCabecalho(regras, 10, null)?.id).toBe(2);
    expect(resolverCabecalho([], 10, 7)).toBeNull();
  });
  it('monta as linhas pela fonte', () => {
    expect(montarCabecalho(null, est, null).linhas).toEqual([
      'Hospital Sintético',
      'CNPJ 12.345.678/0001-95 · CNES 1234567',
      'Rua A, 1',
    ]);
    const proprio = montarCabecalho(
      r({
        fonte: 'personalizado',
        cabecalho: 'Linha 1\n\nLinha 2',
        rodape: 'Rodapé',
        exibeAssinatura: false,
      }),
      est,
      null,
    );
    expect(proprio).toEqual({
      linhas: ['Linha 1', 'Linha 2'],
      rodape: ['Rodapé'],
      exibeDadosPaciente: true,
      exibeAssinatura: false,
    });
    expect(montarCabecalho(r({ fonte: 'mantenedora' }), est, { ...est, nome: 'Mantenedora' }).linhas[0]).toBe(
      'Mantenedora',
    );
  });

  it('o documento imprime as linhas da regra no cabeçalho e o rodapé antes da validação, escapados', () => {
    const m = montarCabecalho(
      r({ fonte: 'personalizado', cabecalho: 'Ala <B>\nServiço de arquivo', rodape: 'Cópia fiel' }),
      est,
      null,
    );
    const html = htmlDocumento({
      titulo: 'Cópia',
      produto: 'SGH',
      estabelecimento: 'Hospital Sintético',
      emitidoEm: '25/11/2026',
      via: null,
      campos: [],
      qrSvg: '<svg></svg>',
      identificadorQr: 'X',
      fontesCss: '',
      cabecalhoLinhas: m.linhas,
      rodapeLinhas: m.rodape,
    });
    expect(html).toContain('Ala &lt;B&gt;<br>Serviço de arquivo');
    expect(html).not.toContain('<div>Hospital Sintético</div>');
    expect(html.indexOf('<p class="rodape">Cópia fiel</p>')).toBeLessThan(html.indexOf('<footer>'));
    const padrao = htmlDocumento({
      titulo: 'T',
      produto: 'SGH',
      estabelecimento: 'Hospital Sintético',
      emitidoEm: '25/11/2026',
      via: null,
      campos: [],
      qrSvg: '',
      identificadorQr: 'X',
      fontesCss: '',
    });
    expect(padrao).toContain('<div>Hospital Sintético</div>');
    expect(padrao).not.toContain('class="rodape"');
  });
});

describe('aplicarExibicao (03-PEP L131)', () => {
  const campos = [
    { rotulo: 'Paciente', valor: 'x', grupo: 'paciente' as const },
    { rotulo: 'Corpo', valor: 'y' },
    { rotulo: 'Assinatura', valor: 'z', grupo: 'assinatura' as const },
  ];
  it('esconde só o grupo que a regra desliga', () => {
    const r = (p: boolean, a: boolean) =>
      aplicarExibicao(campos, { exibeDadosPaciente: p, exibeAssinatura: a }).map((c) => c.rotulo);
    expect(r(true, true)).toEqual(['Paciente', 'Corpo', 'Assinatura']);
    expect(r(false, true)).toEqual(['Corpo', 'Assinatura']);
    expect(r(true, false)).toEqual(['Paciente', 'Corpo']);
    expect(r(false, false)).toEqual(['Corpo']);
  });
});
