// Pontuação (M57, regra 3): nome, mãe e nascimento só sugerem; a fonética soma pouco; CNS pesa pouco; divergências
// descontam. Massa sintética: gêmeos, homônimos, mãe ausente, nome com grafia trocada.
import { describe, expect, it } from 'vitest';
import { comparavel } from './cadastro.js';
import { CNS_A, CPF_B, cadastro, noOutro } from './massa.spec-util.js';
import { PESOS_PAREAMENTO, pontuarPar } from './pontuacao.js';

const par = (a = {}, b = {}) => pontuarPar(comparavel(cadastro(a)), comparavel(noOutro(b)));

describe('pontuação', () => {
  it('tudo igual: teto 100 com todos os critérios', () => {
    const r = par({ cns: CNS_A }, { cns: CNS_A });
    expect(r.pontuacao).toBe(100);
    expect(r.criterios).toEqual(['cpf', 'cns', 'nome', 'mae', 'nascimento', 'sexo']);
    expect(r.divergencias).toEqual([]);
  });

  it('o CNS pesa pouco: CNS igual sozinho não chega ao limiar', () => {
    const r = par(
      { cpf: null, cns: CNS_A, nome: 'X', mae: null, nascimento: null, sexo: null },
      { cpf: null, cns: CNS_A, nome: 'Y', mae: null, nascimento: null, sexo: null },
    );
    expect(r.pontuacao).toBe(PESOS_PAREAMENTO.cns);
  });

  it('grafia trocada no nome conta pela fonética (todas as chaves), menos que o nome igual', () => {
    const r = par({ nome: 'ANA TESTE FICTICIA' }, { nome: 'ANNA THESTE FIKTICIA' });
    expect(r.criterios).toContain('nome_fonetico');
    expect(r.criterios).not.toContain('nome');
    expect(r.pontuacao).toBeLessThan(par().pontuacao);
  });

  it('só a primeira e a última palavra foneticamente iguais: pontas', () => {
    const r = par({ nome: 'ANA TESTE FICTICIA', cpf: null }, { nome: 'ANA SOUZA TESTE FICTICIA', cpf: null });
    expect(r.criterios).toContain('nome_fonetico');
    expect(r.pontuacao).toBe(
      PESOS_PAREAMENTO.nomeFoneticoPontas +
        PESOS_PAREAMENTO.mae +
        PESOS_PAREAMENTO.nascimento +
        PESOS_PAREAMENTO.sexo,
    );
  });

  it('nomes sem nenhuma chave em comum: divergência registrada', () => {
    const r = par({ nome: 'BEATRIZ CAMPOS' }, { nome: 'JOANA PEREIRA' });
    expect(r.divergencias).toContain('nome_diferente');
  });

  it('mãe com grafia trocada: fonética da mãe; mãe ausente não soma nem diverge', () => {
    expect(par({}, { mae: 'MARYA EXEMPLO FIKTICIA' }).criterios).toContain('mae_fonetica');
    const semMae = par({ mae: null }, {});
    expect(semMae.criterios).not.toContain('mae');
    expect(semMae.criterios).not.toContain('mae_fonetica');
    expect(semMae.divergencias).toEqual([]);
  });

  it('gêmeos (mesma mãe e nascimento, nomes e CPFs diferentes): CPF diferente desconta e fica abaixo do limiar', () => {
    const r = par({ nome: 'ANA TESTE FICTICIA' }, { nome: 'BEATRIZ TESTE FICTICIA', cpf: CPF_B });
    expect(r.divergencias).toContain('cpf_diferente');
    expect(r.pontuacao).toBeLessThan(50);
  });

  it('homônimo com nascimento e sexo diferentes: desconta, nunca negativo', () => {
    const r = par({ cpf: null, mae: null }, { cpf: null, mae: null, nascimento: '1955-01-02', sexo: 'M' });
    expect(r.divergencias).toEqual(['nascimento_diferente', 'sexo_diferente']);
    expect(r.pontuacao).toBe(PESOS_PAREAMENTO.nome - 15 - 10);
    const pior = par(
      { nome: 'BEATRIZ CAMPOS', mae: null },
      { nome: 'JOANA PEREIRA', mae: null, cpf: CPF_B, nascimento: '1955-01-02', sexo: 'M' },
    );
    expect(pior.pontuacao).toBe(0);
  });
});
