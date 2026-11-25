import { describe, expect, it } from 'vitest';
import { calcularIndicadoresAgregados } from './indicadores.js';
import {
  gruposDosIndicadores,
  internacoesDoPa,
  observacoesDosIndicadores,
  tipoAteDoTipo,
} from './indicadores-leitura.js';

describe('leitura dos indicadores do atendimento sobre o banco do cliente', () => {
  it('o grupo contado vira o vocabulário do cálculo: tipo, laboratório, sem especialidade e caráter', () => {
    const g = gruposDosIndicadores([
      { tipo: 'consulta', laboratorio: false, semEspecialidade: false, caraterTiss: '1', total: 3 },
      { tipo: 'pa', laboratorio: false, semEspecialidade: false, caraterTiss: '2', total: 2 },
      { tipo: 'requisicaoLab', laboratorio: false, semEspecialidade: true, caraterTiss: '1', total: 4 },
      { tipo: 'consulta', laboratorio: false, semEspecialidade: false, caraterTiss: null, total: 1 },
    ]);
    expect(g).toContainEqual({
      tipoAte: tipoAteDoTipo('consulta'),
      laboratorio: false,
      especialidadeZero: false,
      caracters: 2,
      total: 3,
    });
    expect(g).toContainEqual({
      tipoAte: 11,
      laboratorio: false,
      especialidadeZero: false,
      caracters: 3,
      total: 2,
    });
    // A requisição de laboratório é do tipo, mesmo sem a marca na categoria.
    expect(g.find((x) => x.tipoAte === 23)).toMatchObject({ laboratorio: true, total: 4 });
    // Caráter sem código conhecido: "não informado" (0).
    expect(g.find((x) => x.caracters === 0)?.total).toBe(1);
  });

  it('só os tipos do atendimento externo entram; grupos de mesma chave somam', () => {
    const g = gruposDosIndicadores([
      {
        tipo: 'internacao-hospitalar',
        laboratorio: false,
        semEspecialidade: false,
        caraterTiss: '1',
        total: 9,
      },
      { tipo: 'pa', laboratorio: false, semEspecialidade: false, caraterTiss: '2', total: 2 },
      { tipo: 'pa', laboratorio: false, semEspecialidade: false, caraterTiss: '2', total: 5 },
      { tipo: 'pa', laboratorio: false, semEspecialidade: false, caraterTiss: '2', total: 0 },
    ]);
    expect(g).toEqual([
      { tipoAte: 11, laboratorio: false, especialidadeZero: false, caracters: 3, total: 7 },
    ]);
    expect(tipoAteDoTipo('tipo-que-nao-existe')).toBe(0);
  });

  it('a troca de leito não abre observação nova; quem ainda está no leito conta até agora', () => {
    const o = observacoesDosIndicadores(
      [
        {
          cabecalho: 'AT-1',
          entrada: '2026-01-10T10:00:00.000Z',
          saida: '2026-01-10T12:00:00.000Z',
          trocaDeLeito: true,
        },
        {
          cabecalho: 'AT-1',
          entrada: '2026-01-10T10:00:00.000Z',
          saida: '2026-01-11T11:30:00.000Z',
          trocaDeLeito: false,
        },
        { cabecalho: 'AT-2', entrada: '2026-01-11T09:00:00.000Z', saida: null, trocaDeLeito: false },
      ],
      '2026-01-11T12:00:00.000Z',
    );
    expect(o).toEqual([
      { cabecalho: 'AT-1', minutos: 25 * 60 + 30 },
      { cabecalho: 'AT-2', minutos: 180 },
    ]);
  });

  it('a internação via PA conta uma vez por ficha, com as duas parcelas', () => {
    expect(
      internacoesDoPa([
        { peloDesfecho: true, peloEncaminhamento: false, total: 3 },
        { peloDesfecho: false, peloEncaminhamento: true, total: 2 },
        { peloDesfecho: true, peloEncaminhamento: true, total: 1 },
        { peloDesfecho: false, peloEncaminhamento: false, total: 40 },
      ]),
    ).toEqual({ viaDesfecho: 4, viaEncaminhamento: 3, total: 6 });
  });

  it('o que a leitura devolve fecha a conta do indicador (denominador sem a requisição; observação acima de 24 h)', () => {
    const i = calcularIndicadoresAgregados(
      { inicio: '2026-01-10', fim: '2026-01-11' },
      {
        porTipo: gruposDosIndicadores([
          { tipo: 'consulta', laboratorio: false, semEspecialidade: false, caraterTiss: '1', total: 3 },
          { tipo: 'pa', laboratorio: false, semEspecialidade: false, caraterTiss: '2', total: 2 },
          { tipo: 'requisicaoLab', laboratorio: true, semEspecialidade: true, caraterTiss: '1', total: 4 },
        ]),
        desfechos: [{ desfecho: 'evasao', tipoAte: 11, total: 1 }],
        marcasPa: [],
        observacoes: observacoesDosIndicadores(
          [
            {
              cabecalho: 'AT-1',
              entrada: '2026-01-10T10:00:00.000Z',
              saida: '2026-01-11T11:30:00.000Z',
              trocaDeLeito: false,
            },
          ],
          '2026-01-11T12:00:00.000Z',
        ),
        paTotal: 2,
        internacoesPa: internacoesDoPa([{ peloDesfecho: true, peloEncaminhamento: false, total: 1 }]),
      },
    );
    expect(i.atendimentos).toBe(5);
    expect(i.requisicoesLaboratorio).toBe(4);
    expect(i.pa).toMatchObject({
      atendimentos: 2,
      evasoes: 1,
      observacoes: 1,
      observacoesAcima24h: 1,
      internacoes: 1,
      taxaInternacao: 50,
    });
  });
});
