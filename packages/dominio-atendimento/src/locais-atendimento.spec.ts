// Regras dos locais de atendimento (02-REC linha 34): horário, encaminhamento, visibilidade e usuários do local.
import { describe, expect, it } from 'vitest';
import {
  diferencaLista,
  localAberto,
  validarHorarioLocal,
  validarLigacaoLocais,
  validarUsuariosLocal,
} from './locais-atendimento.js';

const f = (diaSemana: number | null, inicio: string, fim: string, diaNaoUtil = false) => ({
  diaSemana,
  diaNaoUtil,
  inicio,
  fim,
});

describe('horário do local', () => {
  it('aceita a semana em ordem e duas faixas no mesmo dia sem sobreposição', () => {
    const r = validarHorarioLocal([
      f(3, '13:00', '18:00'),
      f(2, '08:00', '12:00'),
      f(3, '07:00', '12:00'),
      f(null, '08:00', '12:00', true),
    ]);
    expect('faixas' in r && r.faixas.map((x) => `${x.diaNaoUtil ? 'nu' : x.diaSemana}-${x.inicio}`)).toEqual([
      '2-08:00',
      '3-07:00',
      '3-13:00',
      'nu-08:00',
    ]);
  });
  it('recusa faixa sobreposta, invertida, hora inválida e dia incoerente', () => {
    const cod = (r: ReturnType<typeof validarHorarioLocal>) => ('recusa' in r ? r.recusa.codigo : 'ok');
    expect(cod(validarHorarioLocal([f(2, '08:00', '12:00'), f(2, '11:30', '14:00')]))).toBe(
      'horario-sobreposto',
    );
    expect(cod(validarHorarioLocal([f(2, '12:00', '08:00')]))).toBe('horario-faixa-invertida');
    expect(cod(validarHorarioLocal([f(2, '8:00', '12:00')]))).toBe('horario-invalido');
    expect(cod(validarHorarioLocal([f(8, '08:00', '12:00')]))).toBe('horario-dia-invalido');
    expect(cod(validarHorarioLocal([f(2, '08:00', '12:00', true)]))).toBe('horario-dia-invalido');
    expect(cod(validarHorarioLocal([f(2, '08:00', '12:00'), f(3, '08:00', '12:00')]))).toBe('ok');
  });
  it('diz se o local está aberto (sem horário cadastrado, aberto)', () => {
    const s = [f(2, '08:00', '12:00'), f(null, '09:00', '10:00', true)];
    expect(localAberto(s, 2, false, '08:00')).toBe(true);
    expect(localAberto(s, 2, false, '12:00')).toBe(false);
    expect(localAberto(s, 3, false, '09:00')).toBe(false);
    expect(localAberto(s, 2, true, '09:30')).toBe(true);
    expect(localAberto([], 1, false, '03:00')).toBe(true);
  });
});

describe('ligação entre locais', () => {
  const locais = [
    { id: 1, ativo: true, permiteEncaminhamento: true },
    { id: 2, ativo: true, permiteEncaminhamento: false },
    { id: 3, ativo: false, permiteEncaminhamento: false },
  ];
  it('encaminha para outro local ativo da unidade, sem repetir', () => {
    expect(validarLigacaoLocais('encaminhamento', locais[0]!, [2, 2], locais)).toEqual({ destinos: [2] });
  });
  it('recusa a si mesmo, local inativo ou de fora e origem que não encaminha', () => {
    const cod = (r: ReturnType<typeof validarLigacaoLocais>) => ('recusa' in r ? r.recusa.codigo : 'ok');
    expect(cod(validarLigacaoLocais('encaminhamento', locais[0]!, [1], locais))).toBe('local-ligado-a-si');
    expect(cod(validarLigacaoLocais('encaminhamento', locais[0]!, [3], locais))).toBe(
      'local-destino-invalido',
    );
    expect(cod(validarLigacaoLocais('visibilidade', locais[0]!, [99], locais))).toBe(
      'local-destino-invalido',
    );
    expect(cod(validarLigacaoLocais('encaminhamento', locais[1]!, [1], locais))).toBe('local-nao-encaminha');
    expect(cod(validarLigacaoLocais('visibilidade', locais[1]!, [1], locais))).toBe('ok');
    expect(cod(validarLigacaoLocais('encaminhamento', locais[1]!, [], locais))).toBe('ok');
  });
  it('calcula o que entra, volta e sai sem apagar', () => {
    expect(diferencaLista([1, 2], [3], [2, 3, 4])).toEqual({ incluir: [4], reativar: [3], retirar: [1] });
  });
});

describe('usuários do local', () => {
  it('exige ao menos um papel e recusa repetição', () => {
    const cod = (r: ReturnType<typeof validarUsuariosLocal>) => ('recusa' in r ? r.recusa.codigo : 'ok');
    expect(cod(validarUsuariosLocal([{ usuario: 1, atuaNoLocal: false, podeOperar: false }]))).toBe(
      'usuario-sem-papel',
    );
    expect(
      cod(
        validarUsuariosLocal([
          { usuario: 1, atuaNoLocal: true, podeOperar: false },
          { usuario: 1, atuaNoLocal: false, podeOperar: true },
        ]),
      ),
    ).toBe('usuario-repetido');
    expect(cod(validarUsuariosLocal([{ usuario: 2, atuaNoLocal: true, podeOperar: true }]))).toBe('ok');
  });
});
