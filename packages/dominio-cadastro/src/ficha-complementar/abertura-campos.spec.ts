// Regra de campo do cadastro na abertura do atendimento (F3.1, 02-CAD linha 2): o tipo da regra pelo tipo com que a
// recepção abre, a recusa com os campos que faltam no escopo e as exceções (cadastro provisório, regra que não é de
// obrigatoriedade). Dados sintéticos.
import { describe, expect, it } from 'vitest';
import { type RegraCampo, recusaAberturaPorCadastro, tipoAtendimentoDaAbertura } from './regras-campo.js';

const regra = (r: Partial<RegraCampo> & Pick<RegraCampo, 'campo' | 'exigencia'>): RegraCampo => ({
  estabelecimento: null,
  modulo: null,
  tipoAtendimento: 'todos',
  fontePagadora: null,
  ...r,
});
const COMPLETO = { nome: 'PACIENTE SINTETICO', nomeMae: null, celular: null, email: null };

describe('regra de campo do cadastro na abertura do atendimento', () => {
  it('o tipo com que a recepção abre vira o tipo da regra; tipo desconhecido fica só com a regra geral', () => {
    expect(tipoAtendimentoDaAbertura('consulta')).toBe('ambulatorial');
    expect(tipoAtendimentoDaAbertura('pa')).toBe('urgencia');
    expect(tipoAtendimentoDaAbertura('exame')).toBe('externo');
    expect(tipoAtendimentoDaAbertura('requisicaoLab')).toBe('externo');
    expect(tipoAtendimentoDaAbertura('internacao')).toBe('internacao');
    expect(tipoAtendimentoDaAbertura('domiciliar')).toBe('domiciliar');
    expect(tipoAtendimentoDaAbertura('todos')).toBeNull();
    expect(tipoAtendimentoDaAbertura('toString')).toBeNull();
    expect(tipoAtendimentoDaAbertura(null)).toBeNull();
  });

  it('recusa com os campos obrigatórios do escopo que faltam, pelo rótulo da regra, em ordem', () => {
    const regras = [
      regra({ id: 1, campo: 'nomeMae', exigencia: 'obrigatorio', fontePagadora: 7 }),
      regra({
        id: 2,
        campo: 'celular',
        exigencia: 'obrigatorio',
        tipoAtendimento: 'urgencia',
        rotulo: 'Celular do paciente',
      }),
      regra({ id: 3, campo: 'email', exigencia: 'obrigatorio', tipoAtendimento: 'internacao' }),
    ];
    const r = recusaAberturaPorCadastro(
      regras,
      { estabelecimento: 1, tipoAtendimento: 'urgencia', fontePagadora: 7 },
      COMPLETO,
    );
    expect(r).toEqual({
      codigo: 'cadastro-incompleto',
      detalhe:
        'Complete o cadastro do paciente antes de abrir o atendimento: Celular do paciente, Nome da mãe.',
      campos: ['celular', 'nomeMae'],
      pendentes: [
        { campo: 'celular', rotulo: 'Celular do paciente' },
        { campo: 'nomeMae', rotulo: 'Nome da mãe' },
      ],
    });
  });

  it('fora do escopo da regra, com o campo preenchido ou com a regra inativa, a abertura segue', () => {
    const regras = [
      regra({ id: 1, campo: 'nomeMae', exigencia: 'obrigatorio', fontePagadora: 7 }),
      regra({ id: 2, campo: 'email', exigencia: 'obrigatorio', ativo: false }),
    ];
    expect(recusaAberturaPorCadastro(regras, { estabelecimento: 1, fontePagadora: 8 }, COMPLETO)).toBeNull();
    expect(
      recusaAberturaPorCadastro(
        regras,
        { estabelecimento: 1, fontePagadora: 7 },
        { ...COMPLETO, nomeMae: 'MAE SINTETICA' },
      ),
    ).toBeNull();
  });

  it('a regra mais específica vence: o opcional do estabelecimento libera o obrigatório da rede', () => {
    const regras = [
      regra({ id: 1, campo: 'email', exigencia: 'obrigatorio' }),
      regra({ id: 2, campo: 'email', exigencia: 'opcional', estabelecimento: 5 }),
    ];
    expect(recusaAberturaPorCadastro(regras, { estabelecimento: 5 }, COMPLETO)).toBeNull();
    expect(recusaAberturaPorCadastro(regras, { estabelecimento: 6 }, COMPLETO)?.campos).toEqual(['email']);
  });

  it('somente leitura não impede a abertura, e o cadastro provisório (não identificado) nunca é barrado', () => {
    const regras = [
      regra({ id: 1, campo: 'nome', exigencia: 'somente_leitura' }),
      regra({ id: 2, campo: 'nomeMae', exigencia: 'obrigatorio' }),
    ];
    expect(recusaAberturaPorCadastro(regras, { estabelecimento: 1 }, COMPLETO)?.campos).toEqual(['nomeMae']);
    expect(
      recusaAberturaPorCadastro(regras, { estabelecimento: 1 }, COMPLETO, { provisorio: true }),
    ).toBeNull();
  });
});
