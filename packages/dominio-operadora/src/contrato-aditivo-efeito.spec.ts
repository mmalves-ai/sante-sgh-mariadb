// Efeito do aditivo nos planos ofertados e baixa da efetivação do cancelamento (08-SGO L94, C2-108).
import { describe, expect, it } from 'vitest';
import {
  creditoDoCancelamento,
  efeitoDoAditivo,
  motivoDaBaixa,
  type OfertaDoContrato,
} from './cadastro-complementar.js';

const ofertas: OfertaDoContrato[] = [
  { id: 1, plano: 10, tabela: 100, inicio: '2026-01-01', fim: null },
  { id: 2, plano: 20, tabela: 200, inicio: '2026-01-01', fim: null },
  { id: 3, plano: 30, tabela: 300, inicio: '2025-01-01', fim: '2025-12-31' },
];
const sem = () => 0;
const base = { efeito: '2026-12-01', planoAnterior: null, planoNovo: null, tabelaPreco: null };
const codigos = (x: { problemas: { codigo: string }[] }) => x.problemas.map((p) => p.codigo);

describe('efeitoDoAditivo', () => {
  it('troca de plano: encerra na véspera, abre o novo com as condições do anterior e move os beneficiários', () => {
    const e = efeitoDoAditivo(
      { ...base, tipo: 'troca_plano', planoAnterior: 10, planoNovo: 30 },
      ofertas,
      sem,
    );
    expect(e.problemas).toEqual([]);
    expect(e.fechar).toEqual([{ oferta: 1, fim: '2026-11-30' }]);
    expect(e.abrir).toEqual([{ plano: 30, tabela: 100, inicio: '2026-12-01', copiaDe: 1 }]);
    expect(e.mover).toEqual({ de: 10, para: 30 });
  });
  it('troca recusa plano anterior não ofertado e plano novo já ofertado', () => {
    expect(
      codigos(
        efeitoDoAditivo({ ...base, tipo: 'troca_plano', planoAnterior: 30, planoNovo: 40 }, ofertas, sem),
      ),
    ).toEqual(['plano-nao-ofertado']);
    expect(
      codigos(
        efeitoDoAditivo({ ...base, tipo: 'troca_plano', planoAnterior: 10, planoNovo: 20 }, ofertas, sem),
      ),
    ).toEqual(['plano-ja-ofertado']);
  });
  it('inclusão exige a tabela de preço e abre a oferta', () => {
    expect(
      codigos(efeitoDoAditivo({ ...base, tipo: 'inclusao_plano', planoNovo: 40 }, ofertas, sem)),
    ).toEqual(['tabela-obrigatoria']);
    const e = efeitoDoAditivo(
      { ...base, tipo: 'inclusao_plano', planoNovo: 40, tabelaPreco: 400 },
      ofertas,
      sem,
    );
    expect([e.fechar, e.abrir]).toEqual([
      [],
      [{ plano: 40, tabela: 400, inicio: '2026-12-01', copiaDe: null }],
    ]);
  });
  it('exclusão só sem beneficiário vigente e sem deixar o contrato sem plano', () => {
    expect(
      codigos(efeitoDoAditivo({ ...base, tipo: 'exclusao_plano', planoAnterior: 20 }, ofertas, () => 3)),
    ).toEqual(['plano-com-beneficiarios']);
    expect(
      codigos(efeitoDoAditivo({ ...base, tipo: 'exclusao_plano', planoAnterior: 20 }, ofertas.slice(1), sem)),
    ).toEqual(['contrato-sem-plano']);
    expect(
      efeitoDoAditivo({ ...base, tipo: 'exclusao_plano', planoAnterior: 20 }, ofertas, sem).fechar,
    ).toEqual([{ oferta: 2, fim: '2026-11-30' }]);
  });
  it('preço troca a tabela das ofertas vigentes (todas ou a do plano citado)', () => {
    expect(codigos(efeitoDoAditivo({ ...base, tipo: 'preco' }, ofertas, sem))).toEqual([
      'tabela-obrigatoria',
    ]);
    const todas = efeitoDoAditivo({ ...base, tipo: 'preco', tabelaPreco: 500 }, ofertas, sem);
    expect(todas.fechar.map((f) => f.oferta)).toEqual([1, 2]);
    expect(todas.abrir.map((a) => [a.plano, a.tabela, a.copiaDe])).toEqual([
      [10, 500, 1],
      [20, 500, 2],
    ]);
    const uma = efeitoDoAditivo({ ...base, tipo: 'preco', planoNovo: 20, tabelaPreco: 500 }, ofertas, sem);
    expect(uma.abrir.map((a) => a.plano)).toEqual([20]);
    expect(
      codigos(efeitoDoAditivo({ ...base, tipo: 'preco', planoNovo: 20, tabelaPreco: 200 }, ofertas, sem)),
    ).toEqual(['tabela-igual']);
  });
  it('efeito no mesmo dia da abertura da oferta é recusado (não fecha antes de abrir)', () => {
    expect(
      codigos(
        efeitoDoAditivo({ ...base, efeito: '2026-01-01', tipo: 'preco', tabelaPreco: 500 }, ofertas, sem),
      ),
    ).toContain('efeito-na-abertura');
  });
  it('cláusula e prorrogação não mexem nos planos', () => {
    const e = efeitoDoAditivo({ ...base, tipo: 'clausula' }, ofertas, sem);
    expect([e.problemas, e.fechar, e.abrir, e.mover]).toEqual([[], [], [], null]);
  });
});

describe('baixa e crédito da efetivação do cancelamento', () => {
  it('o motivo da baixa é o ligado ao motivo do cancelamento; sem ligação, diz o que falta', () => {
    expect(
      motivoDaBaixa(
        [
          { id: 9, motivoCancelamento: 2 },
          { id: 4, motivoCancelamento: 1 },
          { id: 3, motivoCancelamento: 1 },
        ],
        1,
      ),
    ).toEqual({ id: 3 });
    expect(motivoDaBaixa([{ id: 9, motivoCancelamento: null }], 1)).toMatchObject({
      codigo: 'motivo-baixa-ausente',
    });
  });
  it('crédito positivo em centavos; zero ou nulo, sem crédito', () => {
    expect(creditoDoCancelamento(null)).toEqual({ valor: null, problema: null });
    expect(creditoDoCancelamento(0)).toEqual({ valor: null, problema: null });
    expect(creditoDoCancelamento(150.25).valor).toBe(150.25);
    expect(creditoDoCancelamento(-1).problema?.codigo).toBe('credito-invalido');
    expect(creditoDoCancelamento(1.234).problema?.codigo).toBe('credito-invalido');
  });
});
