import { describe, expect, it } from 'vitest';
import { canalDaAbertura, errosDoCanal, moduloDaAbertura } from './modulo-da-abertura.js';
import { recusaAberturaPorCadastro, type RegraCampo } from './regras-campo.js';

describe('módulo de recepção da abertura (02-CAD linha 2)', () => {
  it('canal de entrada pelo tipo de atendimento e pela marcação', () => {
    expect(canalDaAbertura({ tipoAtendimento: 'urgencia' })).toBe('urgencia');
    expect(canalDaAbertura({ tipoAtendimento: 'internacao', marcacao: true })).toBe('internacao');
    expect(canalDaAbertura({ tipoAtendimento: 'externo' })).toBe('exames');
    expect(canalDaAbertura({ tipoAtendimento: 'ambulatorial', marcacao: true })).toBe('agenda');
    expect(canalDaAbertura({ tipoAtendimento: 'ambulatorial' })).toBe('demanda');
    expect(canalDaAbertura({ tipoAtendimento: null })).toBe('demanda');
  });

  it('o local da tela vale sobre todas as outras fontes', () => {
    expect(
      moduloDaAbertura({
        canal: 'agenda',
        local: 1,
        marcacao: 2,
        senha: 3,
        informado: 4,
        doCanal: 5,
        guiche: 6,
      }),
    ).toEqual({ modulo: 1, fonte: 'local' });
  });

  it('sem local: a origem registrada (marcação, depois senha), depois o informado', () => {
    expect(moduloDaAbertura({ canal: 'agenda', marcacao: 2, senha: 3, informado: 4, guiche: 6 })).toEqual({
      modulo: 2,
      fonte: 'marcacao',
    });
    expect(moduloDaAbertura({ canal: 'demanda', local: null, senha: 3, informado: 4 })).toEqual({
      modulo: 3,
      fonte: 'senha',
    });
    expect(moduloDaAbertura({ canal: 'demanda', informado: 4, doCanal: 5, guiche: 6 })).toEqual({
      modulo: 4,
      fonte: 'informado',
    });
  });

  it('agenda e demanda: o guichê da sessão antes do canal; urgência, internação e exames: o canal antes', () => {
    expect(moduloDaAbertura({ canal: 'demanda', doCanal: 5, guiche: 6 }).fonte).toBe('guiche');
    expect(moduloDaAbertura({ canal: 'agenda', doCanal: 5, guiche: 6 }).fonte).toBe('guiche');
    expect(moduloDaAbertura({ canal: 'demanda', doCanal: 5 })).toEqual({ modulo: 5, fonte: 'canal' });
    expect(moduloDaAbertura({ canal: 'urgencia', doCanal: 5, guiche: 6 })).toEqual({
      modulo: 5,
      fonte: 'canal',
    });
    expect(moduloDaAbertura({ canal: 'internacao', doCanal: 5, guiche: 6 }).fonte).toBe('canal');
    expect(moduloDaAbertura({ canal: 'exames', guiche: 6 })).toEqual({ modulo: 6, fonte: 'guiche' });
  });

  it('nenhuma fonte com módulo: nulo; valor inválido é ignorado', () => {
    expect(moduloDaAbertura({ canal: 'demanda' })).toEqual({ modulo: null, fonte: null });
    expect(moduloDaAbertura({ canal: 'demanda', local: 0, marcacao: -1, senha: 1.5, doCanal: 7 })).toEqual({
      modulo: 7,
      fonte: 'canal',
    });
  });

  it('o canal declarado no módulo é conferido', () => {
    expect(errosDoCanal(null)).toEqual([]);
    expect(errosDoCanal('urgencia')).toEqual([]);
    expect(errosDoCanal('pronto-socorro')).toEqual(['canal-invalido']);
  });

  it('o módulo escolhido pela origem leva a regra do módulo à abertura', () => {
    const regras: RegraCampo[] = [
      {
        campo: 'celular',
        estabelecimento: null,
        modulo: 5,
        tipoAtendimento: 'todos',
        fontePagadora: null,
        exigencia: 'obrigatorio',
      },
    ];
    const modulo = moduloDaAbertura({
      canal: canalDaAbertura({ tipoAtendimento: 'urgencia' }),
      doCanal: 5,
    }).modulo;
    expect(
      recusaAberturaPorCadastro(regras, { estabelecimento: 1, modulo, tipoAtendimento: 'urgencia' }, {})
        ?.campos,
    ).toEqual(['celular']);
    const semModulo = moduloDaAbertura({ canal: 'demanda' }).modulo;
    expect(recusaAberturaPorCadastro(regras, { estabelecimento: 1, modulo: semModulo }, {})).toBeNull();
  });
});
