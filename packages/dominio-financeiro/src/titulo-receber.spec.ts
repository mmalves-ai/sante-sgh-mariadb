// Regras 9, 10 e 13 do M32: devedor e origem, a conta que gera título e a baixa manual como exceção.
import { describe, expect, it } from 'vitest';
import {
  atendimentoDaConta,
  conferirBaixaManual,
  conferirContaParaTitulo,
  contasSemTitulo,
  DEVEDORES,
  devedorDaConta,
  ORIGEM_GRAVADA_PELO_NOVO,
  ROTULO_DEVEDOR,
  ROTULO_ORIGEM_BAIXA,
  ROTULO_ORIGEM_RECEBER,
} from './index.js';

describe('título a receber (regras 9, 10 e 13)', () => {
  it('devedores e origens com as legendas (F e E a confirmar); o novo grava V', () => {
    expect(DEVEDORES).toEqual(['C', 'E', 'I', 'T', 'L', 'O']);
    expect(ROTULO_DEVEDOR.C).toBe('Convênio');
    expect(ROTULO_ORIGEM_RECEBER.F).toContain('a confirmar');
    expect(ROTULO_ORIGEM_RECEBER.E).toContain('a confirmar');
    expect(ORIGEM_GRAVADA_PELO_NOVO).toBe('V');
    expect(ROTULO_ORIGEM_BAIXA.M).toBe('Baixa manual');
    expect(devedorDaConta({ particular: false, tipoConta: 'I' })).toBe('C');
    expect(devedorDaConta({ particular: true, tipoConta: 'I' })).toBe('I');
    expect(devedorDaConta({ particular: true, tipoConta: 'E' })).toBe('E');
    expect(atendimentoDaConta('I')).toBe('I');
  });
  it('a conta gera título fechada ou apresentada, sem título e com valor', () => {
    expect(conferirContaParaTitulo({ fechada: 'A', titulo: 0, valor: 10 })).toBeNull();
    expect(conferirContaParaTitulo({ fechada: 's', titulo: null, valor: 10 })).toBeNull();
    expect(conferirContaParaTitulo({ fechada: 'A', titulo: 77, valor: 10 })?.codigo).toBe('conta-titulada');
    expect(conferirContaParaTitulo({ fechada: 'N', titulo: 0, valor: 10 })?.codigo).toBe('conta-aberta');
    expect(conferirContaParaTitulo({ fechada: 'A', titulo: 0, valor: 0 })?.codigo).toBe('conta-sem-valor');
  });
  it('contas sem título nos dois sistemas: 13.260 ligadas de 40.693 (32,59%), 3 pelo novo', () => {
    const contas = [
      ...Array.from({ length: 13_257 }, () => ({ titulada: true, tituladaPeloNovo: false })),
      ...Array.from({ length: 3 }, () => ({ titulada: true, tituladaPeloNovo: true })),
      ...Array.from({ length: 27_433 }, () => ({ titulada: false, tituladaPeloNovo: false })),
    ];
    expect(contasSemTitulo(contas)).toEqual({
      contas: 40_693,
      comTitulo: 13_260,
      peloNovo: 3,
      semTitulo: 27_433,
      percentualLigadas: 32.59,
    });
    expect(contasSemTitulo([]).percentualLigadas).toBe(0);
  });
  it('baixa manual: permissão própria, em aberto, motivo, valor até o do título', () => {
    const p = {
      emAberto: true,
      valorTitulo: 100,
      valorRecebido: 100,
      motivo: 'conferido no extrato',
      temPermissaoManual: true,
    };
    expect(conferirBaixaManual(p)).toBeNull();
    expect(conferirBaixaManual({ ...p, temPermissaoManual: false })?.codigo).toBe(
      'sem-permissao-baixa-manual',
    );
    expect(conferirBaixaManual({ ...p, emAberto: false })?.codigo).toBe('titulo-baixado');
    expect(conferirBaixaManual({ ...p, motivo: 'curto' })?.codigo).toBe('motivo-obrigatorio');
    expect(conferirBaixaManual({ ...p, valorRecebido: 0 })?.codigo).toBe('valor-obrigatorio');
    expect(conferirBaixaManual({ ...p, valorRecebido: 100.01 })?.codigo).toBe('valor-acima-do-titulo');
  });
});
