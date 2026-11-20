// Regras 3 e 3a do M37: o acesso ao novo só com o setor liberado e a trilha do papel concluída; o lote aplica de uma
// vez e lista quem ficou de fora.
import { describe, expect, it } from 'vitest';
import {
  type ConclusaoValida,
  decidirAcesso,
  papelDoGrupo,
  type PessoaDoLote,
  pessoaNoSetor,
  planejarLoteCoexistencia,
  type SetorDoLote,
  setorLiberado,
  trilhaConcluida,
} from './acesso-apos-trilha.js';

const pessoa = (login: string, grupo: string | null, extra: Partial<PessoaDoLote> = {}): PessoaDoLote => ({
  login,
  grupo,
  unidades: [],
  locais: [],
  ativo: true,
  ...extra,
});
const setor = (extra: Partial<SetorDoLote> = {}): SetorDoLote => ({
  codigo: 'agendamento',
  onda: 1,
  situacao: 'liberado',
  papeis: ['recepcao'],
  composicao: [],
  ...extra,
});
const aprovado = (login: string, onda = 1, dia = '2026-11-03'): ConclusaoValida => ({
  login,
  papel: 'recepcao',
  onda,
  resultado: 'aprovado',
  concluidoEm: dia,
});

describe('acesso depois da trilha (regra 3)', () => {
  it('papel pelo grupo do legado (sem acento, maiúsculas); sem grupo ou grupo avulso: outros', () => {
    expect(papelDoGrupo('MEDICOS')).toBe('medico');
    expect(papelDoGrupo('médicos')).toBe('medico');
    expect(papelDoGrupo(null)).toBe('outros');
    expect(papelDoGrupo('GRUPO_QUE_NAO_EXISTE')).toBe('outros');
  });

  it('setor liberado só em liberado, acompanhamento e migrado', () => {
    expect(setorLiberado('treinamento')).toBe(false);
    expect(setorLiberado('acompanhamento')).toBe(true);
  });

  it('pertence ao setor pela composição gravada (grupo, unidade, local) ou pelo papel do grupo', () => {
    const recepcao = pessoa('SINT.R', 'RECEPCAO_ATENDIMENTO', { unidades: [2], locais: [7] });
    const papelRecepcao = papelDoGrupo('RECEPCAO_ATENDIMENTO');
    expect(pessoaNoSetor(recepcao, setor({ papeis: [papelRecepcao] }))).toBe(true);
    expect(pessoaNoSetor(recepcao, setor({ papeis: ['medico'] }))).toBe(papelRecepcao === 'medico');
    expect(pessoaNoSetor(recepcao, setor({ composicao: [{ tipo: 'unidade', valor: '2' }] }))).toBe(true);
    expect(pessoaNoSetor(recepcao, setor({ composicao: [{ tipo: 'local', valor: '7' }] }))).toBe(true);
    expect(pessoaNoSetor(recepcao, setor({ composicao: [{ tipo: 'local', valor: '8' }] }))).toBe(false);
    expect(
      pessoaNoSetor(recepcao, setor({ composicao: [{ tipo: 'grupo', valor: 'recepcao_atendimento' }] })),
    ).toBe(true);
    expect(pessoaNoSetor(pessoa('X', null), setor({ composicao: [{ tipo: 'grupo', valor: 'A' }] }))).toBe(
      false,
    );
  });

  it('a conclusão mais recente vale: "refazer" depois de "aprovado" desfaz', () => {
    const c: ConclusaoValida[] = [
      aprovado('sint.r', 1, '2026-11-01'),
      { ...aprovado('SINT.R', 1, '2026-11-05'), resultado: 'refazer' },
    ];
    expect(trilhaConcluida('SINT.R', 'recepcao', 1, c)).toBe(false);
    expect(trilhaConcluida('SINT.R', 'recepcao', 1, c.slice(0, 1))).toBe(true);
    expect(trilhaConcluida('SINT.R', 'recepcao', 2, c.slice(0, 1))).toBe(false);
    expect(trilhaConcluida('SINT.R', 'medico', 1, c.slice(0, 1))).toBe(false);
  });

  it('decide com o motivo: inativo, setor não liberado, fora do setor, sem trilha; e libera quem cumpre', () => {
    const grupo = 'RECEPCAO_ATENDIMENTO';
    const s = setor({ papeis: [papelDoGrupo(grupo)] });
    expect(decidirAcesso(pessoa('A', grupo, { ativo: false }), s, [])).toEqual({
      pode: false,
      motivo: 'usuário inativo ou bloqueado',
    });
    expect(
      decidirAcesso(pessoa('A', grupo), setor({ situacao: 'treinamento', papeis: s.papeis }), []),
    ).toMatchObject({
      pode: false,
      motivo: expect.stringContaining('treinamento'),
    });
    expect(decidirAcesso(pessoa('A', 'MEDICOS'), s, [])).toMatchObject({
      motivo: 'a pessoa não pertence ao setor',
    });
    expect(decidirAcesso(pessoa('A', grupo), s, [])).toMatchObject({
      motivo: expect.stringContaining('não concluída'),
    });
    expect(decidirAcesso(pessoa('A', grupo), s, [{ ...aprovado('A'), papel: papelDoGrupo(grupo) }])).toEqual({
      pode: true,
    });
  });
});

describe('liberação em lote (regra 3a)', () => {
  const grupo = 'RECEPCAO_ATENDIMENTO';
  const papel = papelDoGrupo(grupo);
  const s = setor({ papeis: [papel] });
  // 50 pessoas sintéticas do setor; as 10 últimas sem trilha concluída.
  const pessoas = Array.from({ length: 50 }, (_, i) => pessoa(`SINT.T${String(i).padStart(2, '0')}`, grupo));
  const conclusoes = pessoas.slice(0, 40).map((p) => ({ ...aprovado(p.login), papel }));

  it('setor inteiro: 40 entram, as 10 sem trilha ficam de fora e listadas', () => {
    const r = planejarLoteCoexistencia(
      { tipo: 'setor', valores: [] },
      [...pessoas, pessoa('SINT.MED', 'MEDICOS')],
      s,
      conclusoes,
    );
    expect(r.incluidos).toHaveLength(40);
    expect(r.fora).toHaveLength(10);
    expect(r.fora.every((f) => f.motivo.includes('não concluída'))).toBe(true);
  });

  it('por grupo e por lista de usuários (login inexistente fica de fora, nunca ligado às cegas)', () => {
    expect(
      planejarLoteCoexistencia({ tipo: 'grupo', valores: [grupo] }, pessoas, s, conclusoes).incluidos,
    ).toHaveLength(40);
    const r = planejarLoteCoexistencia(
      { tipo: 'usuarios', valores: ['sint.t00', 'SINT.T00', 'NINGUEM', ' '] },
      pessoas,
      s,
      conclusoes,
    );
    expect(r.incluidos).toEqual(['SINT.T00']);
    expect(r.fora).toEqual([{ login: 'NINGUEM', motivo: 'usuário não encontrado no estabelecimento' }]);
  });
});
