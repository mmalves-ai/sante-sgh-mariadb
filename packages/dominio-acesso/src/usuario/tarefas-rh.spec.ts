// W1-01 (parte 11a): tarefas do provisionamento pelo RH (criar acesso na admissão, revisar na mudança, suspender no
// afastamento opcional), derivadas dos vínculos e do histórico; só a resolução é gravada. Dados sintéticos.
import { describe, expect, it } from 'vitest';
import {
  chaveCargoRh,
  PADRAO_RH,
  tarefasRh,
  validarResolucaoRh,
  type EntradaTarefasRh,
  type VinculoRh,
} from './tarefas-rh.js';

const v = (x: Partial<VinculoRh> & { id: number }): VinculoRh => ({
  nome: `SINT COLAB ${x.id}`,
  cargo: 'Técnico de Enfermagem',
  funcao: null,
  setor: 'UTI',
  admissao: '2026-11-01',
  desligamento: null,
  usuario: null,
  ...x,
});

const base = (x: Partial<EntradaTarefasRh> = {}): EntradaTarefasRh => ({
  hoje: '2026-11-19',
  vinculos: [],
  mudancas: [],
  afastamentos: [],
  resolucoes: [],
  perfilPorCargo: { 'TECNICO DE ENFERMAGEM': 'enfermagem' },
  parametros: PADRAO_RH,
  ...x,
});

describe('W1-01 (parte 11a): tarefas do RH', () => {
  it('admissão sem usuário gera "criar acesso" com o perfil sugerido pelo cargo (sem acento, maiúsculas); resolvida some', () => {
    expect(chaveCargoRh('  técnico   de enfermagem ')).toBe('TECNICO DE ENFERMAGEM');
    const e = base({
      vinculos: [
        v({ id: 1 }),
        v({ id: 2, cargo: 'Copeiro', funcao: 'Técnico de enfermagem' }),
        v({ id: 3, cargo: 'Copeiro' }),
        v({ id: 4, desligamento: '2026-11-10' }),
      ],
    });
    const t = tarefasRh(e);
    expect(t.map((x) => [x.tipo, x.vinculo, x.ref, x.perfilSugerido])).toEqual([
      ['criar-acesso', 1, 'admissao', 'enfermagem'],
      ['criar-acesso', 2, 'admissao', 'enfermagem'],
      ['criar-acesso', 3, 'admissao', null],
    ]);
    const r = tarefasRh({
      ...e,
      resolucoes: [{ tipo: 'criar-acesso', vinculo: 1, ref: 'admissao', situacao: 'feita' }],
    });
    expect(r.map((x) => x.vinculo)).toEqual([2, 3]);
  });

  it('mudança de cargo, função ou lotação em vigor gera "revisar acesso" (uma por vínculo, até a mais nova); a revisão cobre as anteriores', () => {
    const e = base({
      vinculos: [v({ id: 1, usuario: 900 })],
      mudancas: [
        {
          id: 10,
          vinculo: 1,
          tipo: 'cargo',
          vigencia: '2026-11-05',
          antes: 'Copeiro',
          depois: 'Técnico de Enfermagem',
        },
        { id: 11, vinculo: 1, tipo: 'lotacao', vigencia: '2026-11-06', antes: 'CC 1', depois: 'CC 2' },
        { id: 12, vinculo: 1, tipo: 'jornada', vigencia: '2026-11-06', antes: '40', depois: '36' },
        { id: 13, vinculo: 1, tipo: 'funcao', vigencia: '2026-12-01', antes: null, depois: 'Líder' },
      ],
    });
    const [t, ...resto] = tarefasRh(e);
    expect(resto).toEqual([]);
    expect(t).toMatchObject({
      tipo: 'revisar-acesso',
      ref: '11',
      desde: '2026-11-05',
      perfilSugerido: 'enfermagem',
    });
    expect(t?.detalhe).toEqual([
      'Cargo: Copeiro → Técnico de Enfermagem (2026-11-05)',
      'Lotação: CC 1 → CC 2 (2026-11-06)',
    ]);
    const revisado = {
      ...e,
      resolucoes: [{ tipo: 'revisar-acesso' as const, vinculo: 1, ref: '11', situacao: 'feita' as const }],
    };
    expect(tarefasRh(revisado)).toEqual([]);
    // A mudança futura entra quando passa a valer, e só ela fica em aberto.
    expect(tarefasRh({ ...revisado, hoje: '2026-12-01' }).map((x) => [x.ref, x.detalhe.length])).toEqual([
      ['13', 1],
    ]);
  });

  it('afastamento só gera "suspender" com o parâmetro ligado, em curso, com a duração mínima ou sem retorno', () => {
    const e = base({
      vinculos: [v({ id: 1, usuario: 900 }), v({ id: 2, usuario: 901 }), v({ id: 3 })],
      afastamentos: [
        { vinculo: 1, ref: 'ferias:5', natureza: 'ferias', inicio: '2026-11-10', fim: '2026-11-29' },
        {
          vinculo: 2,
          ref: 'afastamento:6',
          natureza: 'afastamento',
          inicio: '2026-11-18',
          fim: '2026-11-20',
        },
        { vinculo: 2, ref: 'afastamento:7', natureza: 'afastamento', inicio: '2026-11-01', fim: null },
        { vinculo: 3, ref: 'ferias:8', natureza: 'ferias', inicio: '2026-11-01', fim: null },
      ],
    });
    expect(tarefasRh(e).filter((x) => x.tipo === 'suspender-acesso')).toEqual([]);
    const ligado = { ...e, parametros: { suspenderAfastamento: true, diasMinimosAfastamento: 15 } };
    expect(
      tarefasRh(ligado)
        .filter((x) => x.tipo === 'suspender-acesso')
        .map((x) => [x.vinculo, x.ref]),
    ).toEqual([
      [2, 'afastamento:7'],
      [1, 'ferias:5'],
    ]);
    const dispensada = {
      ...ligado,
      resolucoes: [
        { tipo: 'suspender-acesso' as const, vinculo: 1, ref: 'ferias:5', situacao: 'dispensada' as const },
      ],
    };
    expect(
      tarefasRh(dispensada)
        .filter((x) => x.tipo === 'suspender-acesso')
        .map((x) => x.vinculo),
    ).toEqual([2]);
  });

  it('resolver: tarefa aberta, motivo de 10 a 200, login só (e obrigatório) ao concluir a criação', () => {
    const abertas = tarefasRh(base({ vinculos: [v({ id: 1 }), v({ id: 2, usuario: 7 })] }));
    const p = {
      tipo: 'criar-acesso' as const,
      vinculo: 1,
      ref: 'admissao',
      situacao: 'feita' as const,
      motivo: 'criado conforme cargo',
      login: 'SINT.NOVO',
    };
    expect(validarResolucaoRh(abertas, p)).toEqual({ ok: true });
    expect(validarResolucaoRh(abertas, { ...p, vinculo: 2 })).toMatchObject({ recusa: 'tarefa-inexistente' });
    expect(validarResolucaoRh(abertas, { ...p, motivo: 'curto' })).toMatchObject({ recusa: 'motivo-curto' });
    expect(validarResolucaoRh(abertas, { ...p, login: ' ' })).toMatchObject({ recusa: 'login-obrigatorio' });
    expect(
      validarResolucaoRh(abertas, { ...p, situacao: 'dispensada', motivo: 'terceiro sem acesso ao sistema' }),
    ).toMatchObject({ recusa: 'login-indevido' });
    expect(
      validarResolucaoRh(abertas, {
        ...p,
        situacao: 'dispensada',
        motivo: 'terceiro sem acesso ao sistema',
        login: null,
      }),
    ).toEqual({ ok: true });
  });
});
