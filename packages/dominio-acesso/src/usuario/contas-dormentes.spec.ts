// W1-01 (parte 9a): regra das contas dormentes (dias por tipo, exceção justificada, nunca entrou, último gestor).
// Dados sintéticos.
import { describe, expect, it } from 'vitest';
import {
  avaliarDormencia,
  type ContaDormenciaLida,
  PADRAO_DORMENCIA,
  tipoContaDormencia,
  validarParametrosDormencia,
} from './contas-dormentes.js';

const hoje = '2026-11-18';
const conta = (login: string, ultimoAcesso: string | null, v: Partial<ContaDormenciaLida> = {}) => ({
  login,
  grupo: 'RECEPCAO',
  ativo: true,
  bloqueado: false,
  ultimoAcesso,
  ...v,
});

describe('W1-01 (parte 9a): contas dormentes', () => {
  it('bloqueia a pessoal acima de 90 dias e a de dispositivo só acima de 180', () => {
    const r = avaliarDormencia(
      [
        conta('SINT.A', '2026-08-19'), // 91 dias
        conta('SINT.B', '2026-08-20'), // 90 dias: ainda não
        conta('SINT.TV', '2026-06-01', { grupo: 'PAINEIS' }), // 170 dias: ainda não
        conta('SINT.TV2', '2026-05-01', { grupo: 'paineis' }), // 201 dias
      ],
      hoje,
      PADRAO_DORMENCIA,
      [],
      [],
    );
    expect(r.bloquear.map((c) => [c.login, c.tipo, c.diasSemAcesso, c.limiteDias])).toEqual([
      ['SINT.A', 'pessoal', 91, 90],
      ['SINT.TV2', 'dispositivo', 201, 180],
    ]);
    expect(tipoContaDormencia(null)).toBe('pessoal');
  });

  it('ignora inativas e já bloqueadas; quem nunca entrou só vai ao aviso', () => {
    const r = avaliarDormencia(
      [
        conta('SINT.I', '2020-01-01', { ativo: false }),
        conta('SINT.X', '2020-01-01', { bloqueado: true }),
        conta('SINT.N', null),
      ],
      hoje,
      PADRAO_DORMENCIA,
      [],
      [],
    );
    expect(r.bloquear).toEqual([]);
    expect(r.poupadas.map((c) => [c.login, c.situacao])).toEqual([['SINT.N', 'nunca-entrou']]);
  });

  it('exceção justificada vigente poupa; vencida não', () => {
    const r = avaliarDormencia(
      [conta('SINT.A', '2026-01-01'), conta('SINT.B', '2026-01-01'), conta('SINT.C', '2026-01-01')],
      hoje,
      PADRAO_DORMENCIA,
      [
        { login: 'SINT.A', ate: null, motivo: 'licença-maternidade' },
        { login: 'SINT.B', ate: '2026-11-18', motivo: 'plantão eventual' },
        { login: 'SINT.C', ate: '2026-11-17', motivo: 'vencida' },
      ],
      [],
    );
    expect(r.bloquear.map((c) => c.login)).toEqual(['SINT.C']);
    expect(r.poupadas.map((c) => [c.login, c.situacao, c.motivoExcecao])).toEqual([
      ['SINT.A', 'excecao', 'licença-maternidade'],
      ['SINT.B', 'excecao', 'plantão eventual'],
    ]);
  });

  it('administrador mínimo: com todos os gestores dormentes, o de acesso mais recente fica', () => {
    const r = avaliarDormencia(
      [conta('SINT.G1', '2026-01-01'), conta('SINT.G2', '2026-03-01'), conta('SINT.U', '2026-01-01')],
      hoje,
      PADRAO_DORMENCIA,
      [],
      ['SINT.G1', 'SINT.G2'],
    );
    expect(r.bloquear.map((c) => c.login)).toEqual(['SINT.G1', 'SINT.U']);
    expect(r.poupadas).toMatchObject([{ login: 'SINT.G2', situacao: 'ultimo-gestor' }]);
    // Com um gestor ativo em uso, todos os dormentes caem.
    const s = avaliarDormencia(
      [conta('SINT.G1', '2026-01-01'), conta('SINT.G3', '2026-11-10')],
      hoje,
      PADRAO_DORMENCIA,
      [],
      ['SINT.G1', 'SINT.G3'],
    );
    expect(s.bloquear.map((c) => c.login)).toEqual(['SINT.G1']);
  });

  it('desligada: nada a bloquear, a prévia continua', () => {
    const r = avaliarDormencia(
      [conta('SINT.A', '2026-01-01')],
      hoje,
      { ...PADRAO_DORMENCIA, ligada: false },
      [],
      [],
    );
    expect(r.bloquear).toEqual([]);
    expect(r.previa.map((c) => c.login)).toEqual(['SINT.A']);
  });

  it('parâmetros de 30 a 730 dias', () => {
    expect(validarParametrosDormencia(PADRAO_DORMENCIA)).toBeNull();
    expect(validarParametrosDormencia({ ...PADRAO_DORMENCIA, diasPessoal: 29 })).toMatch(/30 a 730/);
    expect(validarParametrosDormencia({ ...PADRAO_DORMENCIA, diasDispositivo: 731 })).toMatch(/30 a 730/);
  });
});
