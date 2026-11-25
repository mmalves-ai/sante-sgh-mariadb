import { describe, expect, it } from 'vitest';
import {
  CRITICAS_AUTOMATICAS_CATALOGO,
  criticasDaRegraRol,
  idadeNaData,
  negativaParaRegistro,
  type RegraCoberturaRol,
} from './autorizacao-rol.js';

const regra = (p: Partial<RegraCoberturaRol> = {}): RegraCoberturaRol => ({
  codigo: '40101010',
  noRol: true,
  diretriz: null,
  exigeJunta: false,
  exigePericia: false,
  sexoPermitido: null,
  idadeMinima: null,
  idadeMaxima: null,
  quantidadeMaximaSolicitacao: null,
  ...p,
});
const ctx = (p: Partial<Parameters<typeof criticasDaRegraRol>[1]> = {}) => ({
  sexo: 'F',
  nascimento: '1990-06-15',
  hoje: '2026-11-25',
  itens: [{ codigo: '40101010', quantidade: 1 }],
  ...p,
});
const codigos = (r: { codigo: string }[]) => r.map((x) => x.codigo);

describe('regra de cobertura do rol', () => {
  it('item sem regra ou regra sem restrição: nenhuma crítica', () => {
    expect(criticasDaRegraRol([], ctx())).toEqual([]);
    expect(criticasDaRegraRol([regra()], ctx())).toEqual([]);
  });
  it('sexo não permitido bloqueia; sexo não informado não confere', () => {
    const r = criticasDaRegraRol([regra({ sexoPermitido: 'masculino' })], ctx());
    expect(r).toEqual([
      expect.objectContaining({ codigo: 'rol-sexo-nao-permitido', bloqueia: true, critica: 4 }),
    ]);
    expect(r[0]!.texto).toContain('40101010');
    expect(criticasDaRegraRol([regra({ sexoPermitido: 'masculino' })], ctx({ sexo: '' }))).toEqual([]);
  });
  it('idade fora da faixa bloqueia, nos dois limites; aniversário conta no dia', () => {
    expect(idadeNaData('1990-11-25', '2026-11-25')).toBe(36);
    expect(idadeNaData('1990-11-26', '2026-11-25')).toBe(35);
    expect(codigos(criticasDaRegraRol([regra({ idadeMinima: 40 })], ctx()))).toEqual([
      'rol-idade-fora-da-faixa',
    ]);
    expect(codigos(criticasDaRegraRol([regra({ idadeMaxima: 30 })], ctx()))).toEqual([
      'rol-idade-fora-da-faixa',
    ]);
    expect(criticasDaRegraRol([regra({ idadeMinima: 36, idadeMaxima: 36 })], ctx())).toEqual([]);
    expect(criticasDaRegraRol([regra({ idadeMinima: 40 })], ctx({ nascimento: '' }))).toEqual([]);
  });
  it('quantidade acima do máximo por solicitação bloqueia com o domínio quantidade', () => {
    const r = criticasDaRegraRol(
      [regra({ quantidadeMaximaSolicitacao: 2 })],
      ctx({ itens: [{ codigo: '40101010', quantidade: 3 }] }),
    );
    expect(r).toEqual([
      expect.objectContaining({ codigo: 'rol-quantidade-acima', bloqueia: true, critica: 5 }),
    ]);
  });
  it('fora do rol, diretriz, junta e perícia só avisam', () => {
    const r = criticasDaRegraRol(
      [regra({ noRol: false, diretriz: 'DUT 12', exigeJunta: true, exigePericia: true })],
      ctx(),
    );
    expect(codigos(r)).toEqual([
      'rol-fora-do-rol',
      'rol-diretriz-a-conferir',
      'rol-exige-junta',
      'rol-exige-pericia',
    ]);
    expect(r.every((x) => !x.bloqueia)).toBe(true);
    expect(r[1]!.texto).toContain('DUT 12');
  });
  it('todo código das críticas está no catálogo semeado', () => {
    const r = criticasDaRegraRol(
      [
        regra({
          noRol: false,
          diretriz: 'x',
          exigeJunta: true,
          exigePericia: true,
          sexoPermitido: 'masculino',
          idadeMinima: 50,
          quantidadeMaximaSolicitacao: 0,
        }),
      ],
      ctx(),
    );
    for (const c of codigos(r)) {
      expect(CRITICAS_AUTOMATICAS_CATALOGO[c]).toBeDefined();
      expect(c.length).toBeLessThanOrEqual(30);
    }
    expect(Object.keys(CRITICAS_AUTOMATICAS_CATALOGO).every((c) => c.length <= 30)).toBe(true);
  });
});

describe('negativa de cobertura (RN 395)', () => {
  const base = {
    numeroGuia: 'G000123',
    criticas: [] as string[],
    fundamento: null,
    comunicado: 'Comunicado',
  };
  it('só na negada e na parcial', () => {
    expect(negativaParaRegistro({ ...base, situacao: 'autorizada' })).toBeNull();
    expect(negativaParaRegistro({ ...base, situacao: 'em_analise' as never })).toBeNull();
    expect(negativaParaRegistro({ ...base, situacao: 'negada' })).toMatchObject({
      numero: 'NEG-G000123',
      fundamento: 'outro',
      clausula: null,
      descricao: 'Comunicado',
    });
  });
  it('o fundamento pela crítica que pesou, depois pelo texto do auditor', () => {
    const f = (criticas: string[], fundamento: string | null) =>
      negativaParaRegistro({ ...base, situacao: 'parcial', criticas, fundamento })?.fundamento;
    expect(f(['em-carencia', 'cpt-vigente'], 'cláusula 5')).toBe('carencia');
    expect(f(['urgencia-em-carencia'], null)).toBe('carencia');
    expect(f(['cpt-vigente'], null)).toBe('cobertura_parcial_temporaria');
    expect(f(['rol-fora-do-rol'], null)).toBe('fora_rol');
    expect(f([], 'Lei 9.656/1998, art. 12')).toBe('norma_regulatoria');
    expect(f([], 'RN 465/2021')).toBe('norma_regulatoria');
    expect(f([], 'Cláusula 7.2 do contrato')).toBe('clausula_contratual');
  });
  it('cláusula com até 100 caracteres; sem comunicado, a descrição é o fundamento', () => {
    const n = negativaParaRegistro({
      ...base,
      situacao: 'negada',
      fundamento: 'x'.repeat(150),
      comunicado: null,
    });
    expect(n?.clausula).toHaveLength(100);
    expect(n?.descricao).toBe('x'.repeat(150));
  });
});
