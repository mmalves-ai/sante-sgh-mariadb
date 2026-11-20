import { describe, expect, it } from 'vitest';
import { avaliarDias, type DiaSessoes, sequenciaSemSessao } from './sem-sessao.js';

const dia = (n: number) => `2027-01-${String(n).padStart(2, '0')}`;
const limpo = (n: number): DiaSessoes => ({ dia: dia(n), loginsComConexao: [], conexoesProgramaAnterior: 0 });

describe('regra 3: dias sem sessão de pessoa no sistema anterior', () => {
  it('conta técnica combinada não quebra o dia; pessoa quebra', () => {
    const a = avaliarDias(
      [
        { dia: dia(1), loginsComConexao: ['tecnico ', 'MARIA'], conexoesProgramaAnterior: 0 },
        { dia: dia(2), loginsComConexao: ['TECNICO'], conexoesProgramaAnterior: 0 },
      ],
      ['tecnico'],
    );
    expect(a.map((x) => x.situacao)).toEqual(['com-sessao', 'limpo']);
    expect(a[0]!.pessoas).toBe(1);
  });

  it('conexão do programa ao banco sem retrato de login também é sessão (série do MON$)', () => {
    const [x] = avaliarDias([{ dia: dia(1), loginsComConexao: [], conexoesProgramaAnterior: 2 }], []);
    expect(x!.situacao).toBe('com-sessao');
  });

  it('dia sem retrato ou sem coleta é sem medida (falha fechada)', () => {
    const a = avaliarDias(
      [
        { dia: dia(1), loginsComConexao: null, conexoesProgramaAnterior: 0 },
        { dia: dia(2), loginsComConexao: [], conexoesProgramaAnterior: null },
      ],
      [],
    );
    expect(a.map((x) => x.situacao)).toEqual(['sem-medida', 'sem-medida']);
  });

  it('14 dias seguidos ficam verdes no 14º dia; a data verde é a do 14º', () => {
    const dias = avaliarDias(
      [
        { dia: dia(1), loginsComConexao: ['ANA'], conexoesProgramaAnterior: 1 },
        ...Array.from({ length: 20 }, (_, i) => limpo(i + 2)),
      ],
      [],
    );
    const s = sequenciaSemSessao(dias, dia(21), 14);
    expect(s.dias).toBe(20);
    expect(s.desde).toBe(dia(2));
    expect(s.verdeDesde).toBe(dia(15));
    expect(s.ultimaSessao).toBe(dia(1));
    expect(s.paradaSemMedida).toBeNull();
    expect(sequenciaSemSessao(dias, dia(21), 30).verdeDesde).toBeNull();
  });

  it('dia faltando na série para a sequência e é apontado', () => {
    const dias = avaliarDias([limpo(1), limpo(2), limpo(4), limpo(5)], []);
    const s = sequenciaSemSessao(dias, dia(5), 2);
    expect(s.dias).toBe(2);
    expect(s.paradaSemMedida).toBe(dia(3));
    expect(s.verdeDesde).toBe(dia(5));
  });

  it('sessão hoje zera a sequência', () => {
    const dias = avaliarDias(
      [limpo(1), { dia: dia(2), loginsComConexao: ['X'], conexoesProgramaAnterior: 0 }],
      [],
    );
    const s = sequenciaSemSessao(dias, dia(2), 1);
    expect(s).toMatchObject({ dias: 0, desde: null, verdeDesde: null, ultimaSessao: dia(2) });
  });

  it('sem nenhum dia: nada medido', () => {
    expect(sequenciaSemSessao([], dia(2), 14)).toMatchObject({ dias: 0, paradaSemMedida: null });
  });
});
