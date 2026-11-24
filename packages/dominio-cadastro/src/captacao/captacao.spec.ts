import { describe, expect, it } from 'vitest';
import { conferirCaptacao, totaisPorCanal } from './captacao.js';

describe('origem e indicação do paciente', () => {
  it('aceita o espontâneo com o paciente identificado', () => {
    expect(conferirCaptacao({ canal: 'espontaneo', paciente: 1 })).toEqual([]);
  });

  it('exige o captado', () => {
    expect(conferirCaptacao({ canal: 'site' }).map((x) => x.codigo)).toEqual(['captado-obrigatorio']);
    expect(conferirCaptacao({ canal: 'site', contatoNome: '  ' })).toHaveLength(1);
    expect(conferirCaptacao({ canal: 'site', preCadastro: 3 })).toEqual([]);
  });

  it('cada canal exige o seu indicador', () => {
    expect(conferirCaptacao({ canal: 'indicacao_profissional', paciente: 1 })[0]?.campo).toBe(
      'indicadorProfissional',
    );
    expect(
      conferirCaptacao({ canal: 'indicacao_profissional', paciente: 1, indicadorProfissional: 9 }),
    ).toEqual([]);
    expect(conferirCaptacao({ canal: 'indicacao_paciente', paciente: 1, indicadorNome: 'Vizinha' })).toEqual(
      [],
    );
    expect(conferirCaptacao({ canal: 'parceiro', paciente: 1 })[0]?.codigo).toBe('indicador-obrigatorio');
    expect(conferirCaptacao({ canal: 'campanha', paciente: 1 })[0]?.codigo).toBe('campanha-obrigatoria');
  });

  it('ninguém indica a si mesmo', () => {
    expect(
      conferirCaptacao({ canal: 'indicacao_paciente', paciente: 5, indicadorPaciente: 5 }).map(
        (x) => x.codigo,
      ),
    ).toEqual(['autoindicacao']);
  });

  it('totaliza por canal na ordem fixa, com zero para o canal sem captação', () => {
    const t = totaisPorCanal([{ canal: 'site', total: 4 }]);
    expect(t).toHaveLength(9);
    expect(t.find((x) => x.canal === 'site')?.total).toBe(4);
    expect(t[0]).toEqual({ canal: 'indicacao_profissional', total: 0 });
  });
});
