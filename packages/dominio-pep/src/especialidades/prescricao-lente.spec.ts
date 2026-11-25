// Prescrição de lentes (03-PEP linha 139): faixas e passos do grau, eixo com o cilindro, adição pelo uso, campos da
// lente de contato, validade e cancelamento; transposição e equivalente esférico. Valores SINTÉTICOS.
import { describe, expect, it } from 'vitest';
import {
  conferirCancelamentoLente,
  conferirPrescricaoLente,
  equivalenteEsferico,
  type GrauOlho,
  lenteVigente,
  type PrescricaoLenteEntrada,
  somarMesesLente,
  transporGrau,
  validadeDaLente,
} from './prescricao-lente.js';

const HOJE = '2026-11-25';
const olho = (x: Partial<GrauOlho> = {}): GrauOlho => ({
  esferico: null,
  cilindrico: null,
  eixo: null,
  prisma: null,
  basePrisma: null,
  acuidade: null,
  ...x,
});
const base = (x: Partial<PrescricaoLenteEntrada> = {}): PrescricaoLenteEntrada => ({
  tipo: 'oculos',
  uso: 'longe',
  od: olho({ esferico: -1.5, cilindrico: -0.75, eixo: 180, acuidade: '20/20' }),
  oe: olho({ esferico: -1.25 }),
  adicao: null,
  distanciaPupilarMm: 63,
  curvaBase: null,
  diametro: null,
  validadeAte: null,
  observacao: null,
  ...x,
});
const campos = (e: PrescricaoLenteEntrada) => conferirPrescricaoLente(e, HOJE).map((x) => x.campo);

describe('prescrição de lentes', () => {
  it('aceita os óculos de longe e a lente de contato completos', () => {
    expect(conferirPrescricaoLente(base(), HOJE)).toEqual([]);
    expect(
      campos(
        base({
          tipo: 'lente_contato',
          od: olho({ esferico: -2 }),
          oe: olho({ esferico: -2.25 }),
          curvaBase: 8.6,
          diametro: 14.2,
          distanciaPupilarMm: null,
        }),
      ),
    ).toEqual([]);
  });

  it('recusa grau fora da faixa ou fora do passo de 0,25 e prescrição sem grau', () => {
    expect(campos(base({ od: olho({ esferico: -1.3 }) }))).toEqual(['od.esferico']);
    expect(campos(base({ oe: olho({ esferico: 31 }) }))).toEqual(['oe.esferico']);
    expect(campos(base({ od: olho(), oe: olho({ esferico: 0 }) }))).toEqual(['od.esferico']);
  });

  it('o eixo acompanha o cilindro: falta, sobra e faixa', () => {
    expect(campos(base({ od: olho({ esferico: 1, cilindrico: -1 }) }))).toEqual(['od.eixo']);
    expect(campos(base({ od: olho({ esferico: 1, eixo: 90 }) }))).toEqual(['od.eixo']);
    expect(campos(base({ od: olho({ esferico: 1, cilindrico: -1, eixo: 181 }) }))).toEqual(['od.eixo']);
  });

  it('adição pelo uso; prisma com base e nunca na lente de contato', () => {
    expect(campos(base({ uso: 'multifocal' }))).toEqual(['adicao']);
    expect(campos(base({ uso: 'multifocal', adicao: 2 }))).toEqual([]);
    expect(campos(base({ adicao: 2 }))).toEqual(['adicao']);
    expect(campos(base({ uso: 'perto', adicao: 4.5 }))).toEqual(['adicao']);
    expect(campos(base({ oe: olho({ esferico: -1, prisma: 2 }) }))).toEqual(['oe.basePrisma']);
    expect(campos(base({ oe: olho({ esferico: -1, basePrisma: 'interna' }) }))).toEqual(['oe.basePrisma']);
    expect(
      campos(
        base({ tipo: 'lente_contato', oe: olho({ esferico: -1, prisma: 1 }), curvaBase: 8.6, diametro: 14 }),
      ),
    ).toEqual(['oe.prisma']);
  });

  it('lente de contato pede curva e diâmetro; óculos não os levam; distância pupilar na faixa', () => {
    expect(campos(base({ tipo: 'lente_contato' }))).toEqual(['curvaBase', 'diametro']);
    expect(campos(base({ curvaBase: 8.6 }))).toEqual(['curvaBase']);
    expect(campos(base({ distanciaPupilarMm: 30 }))).toEqual(['distanciaPupilarMm']);
  });

  it('validade: padrão de um ano, nunca antes da emissão nem além de cinco anos', () => {
    expect(validadeDaLente(base(), HOJE)).toBe('2027-11-25');
    expect(validadeDaLente(base({ validadeAte: '2027-05-01' }), HOJE)).toBe('2027-05-01');
    expect(somarMesesLente('2026-01-31', 1)).toBe('2026-02-28');
    expect(campos(base({ validadeAte: '2026-11-24' }))).toEqual(['validadeAte']);
    expect(campos(base({ validadeAte: '2032-01-01' }))).toEqual(['validadeAte']);
  });

  it('cancelamento só da emitida e com motivo; vigência pela situação e validade', () => {
    expect(conferirCancelamentoLente('emitida', 'grau trocado')).toEqual([]);
    expect(conferirCancelamentoLente('cancelada', 'grau trocado').map((x) => x.campo)).toEqual(['situacao']);
    expect(conferirCancelamentoLente('emitida', ' ').map((x) => x.campo)).toEqual(['motivo']);
    expect(lenteVigente({ situacao: 'emitida', validadeAte: HOJE }, HOJE)).toBe(true);
    expect(lenteVigente({ situacao: 'emitida', validadeAte: '2026-11-24' }, HOJE)).toBe(false);
    expect(lenteVigente({ situacao: 'cancelada', validadeAte: null }, HOJE)).toBe(false);
  });

  it('transposição do cilindro e equivalente esférico', () => {
    expect(transporGrau({ esferico: -1.5, cilindrico: -0.75, eixo: 180 })).toEqual({
      esferico: -2.25,
      cilindrico: 0.75,
      eixo: 90,
    });
    expect(transporGrau({ esferico: 1, cilindrico: 1, eixo: 30 })).toEqual({
      esferico: 2,
      cilindrico: -1,
      eixo: 120,
    });
    expect(equivalenteEsferico({ esferico: -1.5, cilindrico: -0.75 })).toBe(-1.75);
    expect(equivalenteEsferico({ esferico: null, cilindrico: null })).toBeNull();
  });
});
