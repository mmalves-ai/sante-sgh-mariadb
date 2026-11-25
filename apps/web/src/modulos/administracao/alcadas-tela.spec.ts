import { describe, expect, it } from 'vitest';
import type { AlcadaApi } from './api-alcadas.js';
import { corpoDe, formDe, formVazio, nivelVazio, valorDe } from './alcadas-tela.js';

const base = () => {
  const f = formVazio('2026-12-01');
  f.documento = 'SC';
  f.descricao = 'Compras sintéticas';
  f.niveis = [
    { ...nivelVazio(1), aprovador: 'COMPRADOR', valorMaximo: '1.000,00' },
    { ...nivelVazio(2), tipo: 'conta', aprovador: 'SINT.GESTOR', valorMinimo: '1000,01' },
  ];
  return f;
};

describe('tela das alçadas (01-ADM L59)', () => {
  it('lê valores em reais com vírgula ou ponto e recusa o resto', () => {
    expect(valorDe('1.500,50')).toBe(1500.5);
    expect(valorDe('1500.5')).toBe(1500.5);
    expect(valorDe('')).toBeNull();
    expect(valorDe('abc')).toBeNaN();
    expect(valorDe('1,234')).toBeNaN();
  });

  it('monta o corpo com o aprovador no lado certo e o último nível sem teto', () => {
    const r = corpoDe(base());
    expect(r.problema).toBeNull();
    const corpo = (r as { corpo: { niveis: Record<string, unknown>[]; vigenciaFim: unknown } }).corpo;
    expect(corpo.vigenciaFim).toBeNull();
    expect(corpo.niveis[0]).toMatchObject({ perfil: 'COMPRADOR', usuario: null, valorMaximo: 1000 });
    expect(corpo.niveis[1]).toMatchObject({ perfil: null, usuario: 'SINT.GESTOR', valorMaximo: null });
  });

  it('valida na hora pelas mesmas regras do domínio', () => {
    const semDoc = { ...base(), documento: '' };
    expect(corpoDe(semDoc).problema).toBe('documento-obrigatorio');
    const semAprovador = base();
    semAprovador.niveis[0]!.aprovador = '';
    expect(corpoDe(semAprovador).problema).toBe('aprovador-obrigatorio');
    const buraco = base();
    buraco.niveis[1]!.nivel = 3;
    expect(corpoDe(buraco).problema).toBe('nivel-com-buraco');
    const meio = base();
    meio.niveis[0]!.valorMaximo = '';
    expect(corpoDe(meio).problema).toBe('nivel-sem-teto-no-meio');
    const acumulado = base();
    acumulado.niveis[0]!.acumulado = '5000';
    expect(corpoDe(acumulado).problema).toBe('acumulado-sem-periodo');
    const vig = { ...base(), vigenciaFim: '2026-11-01' };
    expect(corpoDe(vig).problema).toBe('vigencia-invalida');
    const prazo = { ...base(), prazoHoras: '0' };
    expect(corpoDe(prazo).problema).toBe('prazo-invalido');
  });

  it('a regra lida volta ao formulário com id, versão e aprovadores', () => {
    const lida: AlcadaApi = {
      id: 7,
      versao: 2,
      documento: 'SC',
      documentoDescricao: 'Solicitação de compra',
      descricao: 'Compras',
      modo: 'paralelo',
      quantidadeNiveis: 1,
      prazoHoras: 24,
      acaoPrazoVencido: 'escalar',
      permiteAutoaprovacao: false,
      exigeJustificativaRecusa: true,
      vigenciaInicio: '2026-01-01',
      vigenciaFim: null,
      ativo: true,
      vigente: true,
      pedidos: 0,
      niveis: [
        {
          nivel: 1,
          perfil: null,
          usuario: 'SINT.GESTOR',
          valorMinimo: 0,
          valorMaximo: null,
          valorAcumuladoMaximo: 9000,
          periodoAcumulado: 'mes',
          obrigatorio: true,
          prazoHoras: null,
        },
      ],
    };
    const f = formDe(lida);
    expect(f).toMatchObject({ id: 7, versao: 2, modo: 'paralelo', prazoHoras: '24', vigenciaFim: '' });
    expect(f.niveis[0]).toMatchObject({
      tipo: 'conta',
      aprovador: 'SINT.GESTOR',
      acumulado: '9000',
      periodo: 'mes',
    });
    expect(corpoDe(f)).toMatchObject({ problema: null, corpo: { id: 7, versao: 2 } });
  });
});
