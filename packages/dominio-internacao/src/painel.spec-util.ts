// Leituras SINTÉTICAS do painel (testes): dois blocos, uma UTI, iniciais já calculadas (nunca o nome).
import type { LeiturasPainel } from '@sgh/contratos';
import { d } from './massa.spec-util.js';

export function leituras(): LeiturasPainel {
  return {
    blocos: [
      { bloco: '1', nome: 'Bloco A' },
      { bloco: '2', nome: 'Bloco B' },
      { bloco: '9', nome: 'Sem acomodação' },
    ],
    acomodacoes: [
      { bloco: '1', acomodacao: 'ENF', nome: 'Enfermaria', tipo: 1 },
      { bloco: '2', acomodacao: 'UTI', nome: 'Terapia intensiva', tipo: 3 },
    ],
    leitos: [
      { id: 1, bloco: '1', acomodacao: 'ENF', leito: '01', status: 'A', reg: 501, ramal: 210 },
      { id: 2, bloco: '1', acomodacao: 'ENF', leito: '02', status: 'A', reg: 0, ramal: null },
      { id: 3, bloco: '1', acomodacao: 'ENF', leito: '03', status: 'I', reg: 0, ramal: null },
      { id: 4, bloco: '2', acomodacao: 'UTI', leito: '01', status: 'A', reg: 502, ramal: null },
      // Ocupado sem internação em aberto (aviso) e inativo ocupado (aviso).
      { id: 5, bloco: '2', acomodacao: 'UTI', leito: '02', status: 'I', reg: 999, ramal: null },
      // Leito de bloco sem cadastro de bloco nem de acomodação.
      { id: 6, bloco: '7', acomodacao: 'X', leito: '01', status: '', reg: 503, ramal: null },
    ],
    abertas: [
      {
        reg: 501,
        bloco: '1',
        acomodacao: 'ENF',
        leito: '01',
        entrada: d('2026-10-11'),
        iniciais: 'MSO',
        nascimento: d('1950-01-15'),
        sexo: 'F',
        convenio: 'CONVÊNIO SINTÉTICO ',
        tipoTrecho: 1,
      },
      {
        reg: 502,
        bloco: '2',
        acomodacao: 'UTI',
        leito: '01',
        entrada: d('2026-10-20'),
        iniciais: 'JPS',
        nascimento: null,
        sexo: 'x',
        convenio: null,
        tipoTrecho: null,
      },
      // Registrada em outro leito que o que a marca.
      {
        reg: 503,
        bloco: '1',
        acomodacao: 'ENF',
        leito: '02',
        entrada: d('2026-10-01'),
        iniciais: 'ABCDEFGHIJ',
        nascimento: d('2000-05-05'),
        sexo: 'M',
        convenio: '  ',
        tipoTrecho: 7,
      },
      // Em aberto sem leito marcado.
      {
        reg: 504,
        bloco: '1',
        acomodacao: 'ENF',
        leito: '04',
        entrada: d('2026-10-15'),
        iniciais: 'LN',
        nascimento: null,
        sexo: null,
        convenio: null,
        tipoTrecho: 1,
      },
    ],
    tipos: new Map([
      [1, 'Enfermaria'],
      [3, 'U.T.I.'],
    ]),
  };
}
