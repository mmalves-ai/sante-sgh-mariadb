import { describe, expect, it } from 'vitest';
import {
  criticarAberturaPlano,
  escolherRegraPlano,
  inicioPeriodoTeto,
  type PropostaRegraPlano,
  type RegraPlano,
  validarRegraPlano,
} from './regra-plano.js';

const base: PropostaRegraPlano = {
  planoId: null,
  categoriaId: null,
  estabelecimentoId: null,
  exigeCarteira: false,
  exigeValidadeCarteira: false,
  exigeTitular: false,
  exigeGuia: false,
  exigeSenhaAutorizacao: false,
  exigeCodigoValidacao: false,
  tamanhoCarteira: null,
  prefixoCarteira: null,
  permiteDependentes: true,
  prazoRetornoDias: null,
  documentosExigidos: [],
  orientacaoRecepcao: null,
  tetoAtendimentos: null,
  tetoPeriodoDias: null,
  tetoBloqueia: false,
  pendencia: 'nenhuma',
  pendenciaMotivo: null,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
};
const regra = (id: number, p: Partial<RegraPlano> = {}): RegraPlano => ({
  ...base,
  id,
  fontePagadoraId: 1,
  ...p,
});
const dados = {
  data: '2026-11-25',
  carteira: null,
  validadeCarteira: null,
  guia: null,
  senhaAutorizacao: null,
  validadeSenha: null,
  atendimentosNoPeriodo: 0,
};

describe('validarRegraPlano', () => {
  it('aceita a regra mínima', () => {
    expect(validarRegraPlano(base)).toEqual({});
  });
  it('marca vigência invertida, tamanho, prefixo e carteira não exigida', () => {
    const e = validarRegraPlano({
      ...base,
      vigenciaFim: '2025-12-31',
      tamanhoCarteira: 4,
      prefixoCarteira: '12345',
    });
    expect(Object.keys(e).sort()).toEqual(['exigeCarteira', 'prefixoCarteira', 'vigenciaFim']);
  });
  it('pede teto e período juntos, e motivo na pendência', () => {
    expect(validarRegraPlano({ ...base, tetoAtendimentos: 2 })).toHaveProperty('tetoAtendimentos');
    expect(validarRegraPlano({ ...base, tetoBloqueia: true })).toHaveProperty('tetoBloqueia');
    expect(validarRegraPlano({ ...base, tetoAtendimentos: 2, tetoPeriodoDias: 400 })).toHaveProperty(
      'tetoPeriodoDias',
    );
    expect(validarRegraPlano({ ...base, pendencia: 'bloqueio' })).toHaveProperty('pendenciaMotivo');
    expect(
      validarRegraPlano({ ...base, pendencia: 'alerta', pendenciaMotivo: 'Contrato em revisão' }),
    ).toEqual({});
  });
  it('recusa documento vazio ou repetido', () => {
    expect(validarRegraPlano({ ...base, documentosExigidos: ['RG', 'rg'] })).toHaveProperty(
      'documentosExigidos',
    );
    expect(validarRegraPlano({ ...base, documentosExigidos: [' '] })).toHaveProperty('documentosExigidos');
  });
});

describe('escolherRegraPlano', () => {
  const chave = { planoId: 10, planoSuperiorId: 9, categoriaId: 3, estabelecimentoId: 7, data: '2026-11-25' };
  it('plano exato vence plano superior, que vence a regra da fonte', () => {
    const regras = [regra(1), regra(2, { planoId: 9 }), regra(3, { planoId: 10 })];
    expect(escolherRegraPlano(regras, chave)?.id).toBe(3);
    expect(escolherRegraPlano(regras.slice(0, 2), chave)?.id).toBe(2);
    expect(escolherRegraPlano(regras.slice(0, 1), chave)?.id).toBe(1);
  });
  it('ignora outro plano, outra categoria, outro estabelecimento e fora da vigência', () => {
    const regras = [
      regra(1, { planoId: 11 }),
      regra(2, { categoriaId: 4 }),
      regra(3, { estabelecimentoId: 8 }),
      regra(4, { vigenciaFim: '2026-11-24' }),
      regra(5, { vigenciaInicio: '2026-11-26' }),
    ];
    expect(escolherRegraPlano(regras, chave)).toBeNull();
  });
  it('empate: o início mais recente; estabelecimento próprio vence o de todos', () => {
    expect(escolherRegraPlano([regra(1), regra(2, { vigenciaInicio: '2026-06-01' })], chave)?.id).toBe(2);
    expect(escolherRegraPlano([regra(1), regra(2, { estabelecimentoId: 7 })], chave)?.id).toBe(2);
  });
});

describe('criticarAberturaPlano', () => {
  it('sem regra, nada a criticar', () => {
    expect(criticarAberturaPlano(null, dados)).toEqual({
      bloqueios: [],
      alertas: [],
      documentos: [],
      orientacao: null,
    });
  });
  it('bloqueia carteira ausente, guia e senha ausentes', () => {
    const r = regra(1, { exigeCarteira: true, exigeGuia: true, exigeSenhaAutorizacao: true });
    expect(criticarAberturaPlano(r, dados).bloqueios.map((x) => x.codigo)).toEqual([
      'carteira-obrigatoria',
      'guia-obrigatoria',
      'senha-obrigatoria',
    ]);
  });
  it('confere tamanho e prefixo da carteira sem pontuação', () => {
    const r = regra(1, { exigeCarteira: true, tamanhoCarteira: 6, prefixoCarteira: '00' });
    expect(criticarAberturaPlano(r, { ...dados, carteira: '00.12-34' }).bloqueios).toEqual([]);
    expect(
      criticarAberturaPlano(r, { ...dados, carteira: '1234567' }).bloqueios.map((x) => x.codigo),
    ).toEqual(['carteira-tamanho', 'carteira-prefixo']);
  });
  it('carteira e senha vencidas bloqueiam; validade em dia passa', () => {
    const r = regra(1, { exigeCarteira: true, exigeValidadeCarteira: true, exigeSenhaAutorizacao: true });
    const ok = {
      ...dados,
      carteira: '1',
      validadeCarteira: '2026-11-25',
      senhaAutorizacao: 'S',
      validadeSenha: '2026-12-01',
    };
    expect(criticarAberturaPlano(r, ok).bloqueios).toEqual([]);
    expect(
      criticarAberturaPlano(r, {
        ...ok,
        validadeCarteira: '2026-11-24',
        validadeSenha: '2026-11-01',
      }).bloqueios.map((x) => x.codigo),
    ).toEqual(['carteira-vencida', 'senha-vencida']);
    expect(criticarAberturaPlano(r, { ...ok, validadeCarteira: null }).bloqueios[0]?.codigo).toBe(
      'validade-carteira-obrigatoria',
    );
  });
  it('teto: alerta por padrão, bloqueio quando o contrato pede; abaixo do teto nada', () => {
    const r = regra(1, { tetoAtendimentos: 2, tetoPeriodoDias: 30 });
    expect(criticarAberturaPlano(r, { ...dados, atendimentosNoPeriodo: 1 }).alertas).toEqual([]);
    expect(criticarAberturaPlano(r, { ...dados, atendimentosNoPeriodo: 2 }).alertas[0]?.codigo).toBe(
      'teto-plano',
    );
    expect(
      criticarAberturaPlano({ ...r, tetoBloqueia: true }, { ...dados, atendimentosNoPeriodo: 3 }).bloqueios[0]
        ?.codigo,
    ).toBe('teto-plano');
  });
  it('pendência do plano: alerta ou bloqueio, com o motivo', () => {
    const a = criticarAberturaPlano(regra(1, { pendencia: 'alerta', pendenciaMotivo: 'Revisão' }), dados);
    expect(a.alertas[0]).toMatchObject({
      codigo: 'plano-pendente',
      mensagem: 'Plano com pendência: Revisão',
    });
    const b = criticarAberturaPlano(regra(1, { pendencia: 'bloqueio', pendenciaMotivo: 'Suspenso' }), dados);
    expect(b.bloqueios[0]?.codigo).toBe('plano-pendente');
  });
  it('titular e código de validação viram conferência; dependente recusado; documentos e orientação voltam', () => {
    const r = regra(1, {
      exigeTitular: true,
      exigeCodigoValidacao: true,
      permiteDependentes: false,
      documentosExigidos: ['Documento com foto'],
      orientacaoRecepcao: 'Conferir biometria',
    });
    const x = criticarAberturaPlano(r, { ...dados, dependente: true });
    expect(x.alertas.map((y) => y.codigo)).toEqual(['titular-conferir', 'codigo-validacao-conferir']);
    expect(x.bloqueios.map((y) => y.codigo)).toEqual(['dependente-nao-aceito']);
    expect(x.documentos).toEqual(['Documento com foto']);
    expect(x.orientacao).toBe('Conferir biometria');
    expect(criticarAberturaPlano(r, { ...dados, titular: 'X', codigoValidacao: 'T' }).alertas).toEqual([]);
  });
});

describe('inicioPeriodoTeto', () => {
  it('conta o dia da abertura', () => {
    expect(inicioPeriodoTeto('2026-11-25', 1)).toBe('2026-11-25');
    expect(inicioPeriodoTeto('2026-03-01', 30)).toBe('2026-01-31');
  });
});
