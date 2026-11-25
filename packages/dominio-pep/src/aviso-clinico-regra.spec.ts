import { describe, expect, it } from 'vitest';
import {
  type CandidatoAvisoClinico,
  destinatariosDoAviso,
  prioridadeDoAviso,
  type RegraAvisoClinicoAplicavel,
  regraValeParaEvento,
  validarRegraAvisoClinico,
  validarTipoAvisoClinico,
} from './aviso-clinico-regra.js';

const base = {
  nome: 'Valor crítico na UTI',
  mensagem: 'Resultado com valor crítico',
  tipoAviso: 'valor_critico',
  canais: ['sistema'] as const,
  alvos: [{ tipo: 'setor' as const, id: 10 }],
  vigenciaInicio: '2026-11-01',
  vigenciaFim: null,
};

const regra = (x: Partial<RegraAvisoClinicoAplicavel> = {}): RegraAvisoClinicoAplicavel => ({
  id: 1,
  tipoAviso: 'valor_critico',
  setorEvento: null,
  especialidadeEvento: null,
  ativa: true,
  vigenciaInicio: '2026-11-01',
  vigenciaFim: null,
  canais: ['sistema'],
  alvos: [{ tipo: 'setor', id: 10 }],
  ...x,
});
const evento = { tipoAviso: 'valor_critico', setor: 10, especialidade: 5, dia: '2026-11-25' };
const pessoa = (usuario: number, x: Partial<CandidatoAvisoClinico> = {}): CandidatoAvisoClinico => ({
  usuario,
  profissional: usuario + 100,
  setores: [],
  especialidades: [],
  categorias: [],
  perfis: [],
  temEmail: true,
  ...x,
});

describe('validarRegraAvisoClinico', () => {
  it('aceita a regra completa e recusa cada falta pelo nome', () => {
    expect(validarRegraAvisoClinico(base)).toBeNull();
    expect(validarRegraAvisoClinico({ ...base, nome: ' ' })).toBe('nome-vazio');
    expect(validarRegraAvisoClinico({ ...base, tipoAviso: null })).toBe('sem-evento');
    expect(validarRegraAvisoClinico({ ...base, mensagem: '' })).toBe('mensagem-vazia');
    expect(validarRegraAvisoClinico({ ...base, canais: [] })).toBe('sem-canal');
    expect(validarRegraAvisoClinico({ ...base, alvos: [] })).toBe('sem-destinatario');
    expect(
      validarRegraAvisoClinico({
        ...base,
        alvos: [
          { tipo: 'setor', id: 10 },
          { tipo: 'setor', id: 10 },
        ],
      }),
    ).toBe('destinatario-repetido');
    expect(validarRegraAvisoClinico({ ...base, vigenciaFim: '2026-10-01' })).toBe('vigencia-invertida');
  });

  it('o tipo de aviso tem código em minúsculas e descrição', () => {
    expect(validarTipoAvisoClinico({ codigo: 'valor_critico', descricao: 'Valor crítico' })).toBeNull();
    expect(validarTipoAvisoClinico({ codigo: 'Valor Critico', descricao: 'x' })).toBe('tipo-codigo-invalido');
    expect(validarTipoAvisoClinico({ codigo: 'ok_1', descricao: ' ' })).toBe('tipo-descricao-vazia');
  });
});

describe('regraValeParaEvento', () => {
  it('confere tipo, situação, vigência, setor e especialidade do evento', () => {
    expect(regraValeParaEvento(regra(), evento)).toBe(true);
    expect(regraValeParaEvento(regra({ tipoAviso: 'resultado' }), evento)).toBe(false);
    expect(regraValeParaEvento(regra({ ativa: false }), evento)).toBe(false);
    expect(regraValeParaEvento(regra({ vigenciaInicio: '2026-12-01' }), evento)).toBe(false);
    expect(regraValeParaEvento(regra({ vigenciaFim: '2026-11-24' }), evento)).toBe(false);
    expect(regraValeParaEvento(regra({ setorEvento: 10 }), evento)).toBe(true);
    expect(regraValeParaEvento(regra({ setorEvento: 11 }), evento)).toBe(false);
    expect(regraValeParaEvento(regra({ especialidadeEvento: 6 }), evento)).toBe(false);
  });
});

describe('destinatariosDoAviso', () => {
  it('cada alvo encaixa a pessoa certa; e-mail só com endereço; o autor fica de fora', () => {
    const avisos = destinatariosDoAviso(
      [
        regra({
          canais: ['sistema', 'email'],
          alvos: [
            { tipo: 'setor', id: 10 },
            { tipo: 'especialidade', id: 5 },
            { tipo: 'categoria_profissional', id: 3 },
            { tipo: 'perfil', id: 7 },
            { tipo: 'usuario', id: 6 },
          ],
        }),
      ],
      evento,
      [
        pessoa(1, { setores: [10] }),
        pessoa(2, { especialidades: [5], temEmail: false }),
        pessoa(3, { categorias: [3] }),
        pessoa(4, { perfis: [7] }),
        pessoa(5, { setores: [99] }),
        pessoa(6),
        pessoa(9, { setores: [10] }),
      ],
      9,
    );
    expect(avisos).toHaveLength(1);
    const d = avisos[0]!.destinos.map((x) => `${x.usuario}:${x.canal}`);
    expect(d).toEqual([
      '1:sistema',
      '1:email',
      '2:sistema',
      '3:sistema',
      '3:email',
      '4:sistema',
      '4:email',
      '6:sistema',
      '6:email',
    ]);
    expect(avisos[0]!.destinos[0]!.profissional).toBe(101);
  });

  it('a mesma pessoa no mesmo canal recebe uma vez; regra sem destino não gera aviso', () => {
    const avisos = destinatariosDoAviso(
      [
        regra({ id: 1 }),
        regra({ id: 2, canais: ['sistema', 'email'] }),
        regra({ id: 3, alvos: [{ tipo: 'setor', id: 77 }] }),
        regra({ id: 4, tipoAviso: 'resultado' }),
      ],
      evento,
      [pessoa(1, { setores: [10] })],
      null,
    );
    expect(avisos.map((a) => [a.regra, a.destinos.map((x) => x.canal)])).toEqual([
      [1, ['sistema']],
      [2, ['email']],
    ]);
  });
});

describe('prioridadeDoAviso', () => {
  it('média do tipo vira normal no aviso', () => {
    expect(prioridadeDoAviso('media')).toBe('normal');
    expect(prioridadeDoAviso('critica')).toBe('critica');
    expect(prioridadeDoAviso('baixa')).toBe('baixa');
  });
});
