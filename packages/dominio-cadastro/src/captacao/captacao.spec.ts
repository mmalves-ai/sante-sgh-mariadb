import { describe, expect, it } from 'vitest';
import { conferirCaptacao, totaisPorCanal, type TipoIndicacaoRegra } from './captacao.js';

const livre: TipoIndicacaoRegra = {
  id: 1,
  ativo: true,
  categoria: 'outro',
  exigeProfissional: false,
  exigeComplemento: false,
};
const medico: TipoIndicacaoRegra = { ...livre, id: 2, categoria: 'medico_externo', exigeProfissional: true };
const pacienteIndica: TipoIndicacaoRegra = {
  ...livre,
  id: 3,
  categoria: 'proprio_paciente',
  exigeComplemento: true,
};

describe('captação do paciente (origem e indicação)', () => {
  it('aceita o espontâneo com o paciente identificado', () => {
    expect(conferirCaptacao({ canal: 'espontaneo', tipoIndicacao: livre, paciente: 1 })).toEqual([]);
  });

  it('exige o captado', () => {
    expect(conferirCaptacao({ canal: 'site', tipoIndicacao: livre }).map((x) => x.codigo)).toEqual([
      'captado-obrigatorio',
    ]);
    expect(conferirCaptacao({ canal: 'site', tipoIndicacao: livre, contatoNome: '  ' })).toHaveLength(1);
    expect(conferirCaptacao({ canal: 'site', tipoIndicacao: livre, preCadastro: 3 })).toEqual([]);
  });

  it('exige um tipo de indicação ativo do cadastro do hospital', () => {
    expect(conferirCaptacao({ canal: 'site', tipoIndicacao: null, paciente: 1 })[0]?.codigo).toBe(
      'tipo-indicacao-obrigatorio',
    );
    expect(
      conferirCaptacao({ canal: 'site', tipoIndicacao: { ...livre, ativo: false }, paciente: 1 })[0]?.codigo,
    ).toBe('tipo-indicacao-obrigatorio');
  });

  it('as exigências vêm do tipo de indicação, não do canal', () => {
    expect(conferirCaptacao({ canal: 'telefone', tipoIndicacao: medico, paciente: 1 })[0]?.campo).toBe(
      'indicadorProfissional',
    );
    expect(
      conferirCaptacao({ canal: 'telefone', tipoIndicacao: medico, paciente: 1, indicadorProfissional: 9 }),
    ).toEqual([]);
    expect(conferirCaptacao({ canal: 'site', tipoIndicacao: pacienteIndica, paciente: 1 })[0]?.codigo).toBe(
      'complemento-obrigatorio',
    );
    expect(
      conferirCaptacao({
        canal: 'site',
        tipoIndicacao: pacienteIndica,
        paciente: 1,
        indicadorNome: 'Vizinha',
      }),
    ).toEqual([]);
    // O canal "indicação de profissional" sem um tipo que exija o profissional não pede nada a mais.
    expect(conferirCaptacao({ canal: 'indicacao_profissional', tipoIndicacao: livre, paciente: 1 })).toEqual(
      [],
    );
  });

  it('a campanha pede o nome dela', () => {
    expect(conferirCaptacao({ canal: 'campanha', tipoIndicacao: livre, paciente: 1 })[0]?.codigo).toBe(
      'campanha-obrigatoria',
    );
  });

  it('ninguém indica a si mesmo', () => {
    expect(
      conferirCaptacao({
        canal: 'indicacao_paciente',
        tipoIndicacao: pacienteIndica,
        paciente: 5,
        indicadorPaciente: 5,
      }).map((x) => x.codigo),
    ).toEqual(['autoindicacao']);
  });

  it('totaliza por canal na ordem fixa, com zero para o canal sem captação', () => {
    const t = totaisPorCanal([{ canal: 'site', total: 4 }]);
    expect(t).toHaveLength(9);
    expect(t.find((x) => x.canal === 'site')?.total).toBe(4);
    expect(t[0]).toEqual({ canal: 'indicacao_profissional', total: 0 });
  });
});
