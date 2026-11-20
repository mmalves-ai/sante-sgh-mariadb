import { describe, expect, it } from 'vitest';
import { linhasDaPrescricaoImpressa } from './impressao.js';

describe('prescrição impressa (documento)', () => {
  it('item a item com dose, via, frequência, horários, marcas e a observação', () => {
    const l = linhasDaPrescricaoImpressa(
      [
        {
          tipoNome: 'Medicamento',
          descricao: 'DIPIRONA SINTETICO 500 MG/ML',
          dose: '2 ML',
          via: 'Endovenosa',
          frequencia: '06/06',
          situacao: 'ativo',
          incluidoDepois: false,
          observacaoEnfermagem: 'Diluir em 10 mL; “aspas” – ½ dose',
          horarios: [
            { dataHora: '2026-10-21T18:00:00', rotulo: 'Prescrito' },
            { dataHora: '2026-10-22T00:00:00', rotulo: 'Prescrito' },
          ],
        },
        {
          tipoNome: 'Cuidado',
          descricao: 'Controle de sinais vitais',
          dose: null,
          via: null,
          frequencia: '08/08',
          situacao: 'suspenso',
          incluidoDepois: true,
          observacaoEnfermagem: null,
          horarios: [],
        },
      ],
      'Jejum após as 22:00',
    );
    expect(l).toEqual([
      '1) Medicamento: DIPIRONA SINTETICO 500 MG/ML — 2 ML — Endovenosa — 06/06',
      '   Horários: 18:00 Prescrito · 00:00 Prescrito',
      '   Para a enfermagem: Diluir em 10 mL; “aspas” – ½ dose',
      '2) Cuidado: Controle de sinais vitais — 08/08 (Suspenso; Incluído depois)',
      'Observação: Jejum após as 22:00',
    ]);
  });

  it('sem itens e sem observação: corpo vazio', () => {
    expect(linhasDaPrescricaoImpressa([], null)).toEqual([]);
  });
});
