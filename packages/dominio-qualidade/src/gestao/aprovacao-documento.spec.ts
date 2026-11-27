import { describe, expect, it } from 'vitest';
import { conferirDecisaoEtapa, montarEtapasAprovacao } from './aprovacao-documento.js';

const montadas = montarEtapasAprovacao('autor', 'REVISOR', 'aprovador');
if ('recusa' in montadas) throw new Error('montagem recusada');
const etapas = montadas.etapas;
const decidir = (o: Partial<Parameters<typeof conferirDecisaoEtapa>[0]>) =>
  conferirDecisaoEtapa({
    etapas,
    sequencia: 2,
    decisor: 'revisor',
    decisao: 'aprovada',
    parecer: null,
    ...o,
  });

describe('fluxo de aprovação por etapas do documento da qualidade', () => {
  it('monta elaboração aprovada, revisão e aprovação pendentes; recusa a mesma pessoa em duas etapas', () => {
    expect(etapas.map((x) => [x.sequencia, x.etapa, x.responsavel, x.situacao])).toEqual([
      [1, 'elaboracao', 'AUTOR', 'aprovada'],
      [2, 'revisao', 'REVISOR', 'pendente'],
      [3, 'aprovacao', 'APROVADOR', 'pendente'],
    ]);
    expect(montarEtapasAprovacao('a', 'b', 'A')).toEqual({ recusa: 'designacao-repetida' });
    expect(montarEtapasAprovacao('a', 'b', 'b')).toEqual({ recusa: 'designacao-repetida' });
  });

  it('a revisão aprovada passa à aprovação; a última aprovada publica', () => {
    expect(decidir({})).toEqual({ situacao: 'em_aprovacao', publicar: false });
    const revisada = etapas.map((x) => (x.sequencia === 2 ? { ...x, situacao: 'aprovada' as const } : x));
    expect(
      conferirDecisaoEtapa({
        etapas: revisada,
        sequencia: 3,
        decisor: 'APROVADOR',
        decisao: 'aprovada',
        parecer: null,
      }),
    ).toEqual({ situacao: 'vigente', publicar: true });
  });

  it('recusa a etapa fora de ordem, a já decidida, a inexistente e o decisor não designado', () => {
    expect(decidir({ sequencia: 3, decisor: 'aprovador' })).toEqual({ recusa: 'etapa-fora-de-ordem' });
    expect(decidir({ sequencia: 1, decisor: 'autor' })).toEqual({ recusa: 'etapa-ja-decidida' });
    expect(decidir({ sequencia: 9 })).toEqual({ recusa: 'etapa-inexistente' });
    expect(decidir({ decisor: 'AUTOR' })).toEqual({ recusa: 'decisor-nao-designado' });
  });

  it('devolver ou reprovar exige parecer e encerra o fluxo sem publicar', () => {
    expect(decidir({ decisao: 'devolvida', parecer: 'curto' })).toEqual({ recusa: 'parecer-obrigatorio' });
    expect(decidir({ decisao: 'reprovada', parecer: 'Falta o fluxograma do processo.' })).toEqual({
      situacao: 'devolvida',
      publicar: false,
    });
  });
});
