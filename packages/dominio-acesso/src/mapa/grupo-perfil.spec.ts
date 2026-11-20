import { describe, expect, it } from 'vitest';
import { proporPerfilDoGrupo, TETO_ACESSO_AMPLO } from './grupo-perfil.js';

const perms = (n: number, categoria: 'clinica' | 'administrativa' | 'financeira' | 'tecnica' | null) =>
  Array.from({ length: n }, (_, i) => ({ codigo: `x.y${i}.ler`, categoria }));

describe('proposta do mapa grupo → perfil (regra 6)', () => {
  it('MASTER, MASTER_SEM_FINANCEIRO e SEM GRUPO: revisão individual, nunca assistencial', () => {
    for (const grupo of ['MASTER', 'MASTER_SEM_FINANCEIRO', 'SEM GRUPO']) {
      const p = proporPerfilDoGrupo({ grupo, permissoes: perms(10, 'clinica'), usuariosAtivos: 30 });
      expect(p.perfil).toBeNull();
      expect(p.assistencial).toBe(false);
      expect(p.revisao).toBe('individual');
    }
  });
  it('acima do teto de permissões também é acesso amplo', () => {
    const p = proporPerfilDoGrupo({
      grupo: 'NOVO_GRUPO',
      permissoes: perms(TETO_ACESSO_AMPLO + 1, 'administrativa'),
      usuariosAtivos: 1,
    });
    expect(p.revisao).toBe('individual');
    expect(p.total).toBe(TETO_ACESSO_AMPLO + 1);
  });
  it('grupo do mapa: o perfil do mapa, revisão recomendada (não exigida)', () => {
    const p = proporPerfilDoGrupo({ grupo: 'MEDICOS', permissoes: perms(3, 'clinica'), usuariosAtivos: 5 });
    expect(p).toMatchObject({
      perfil: 'medico',
      origem: 'mapa-dos-grupos',
      assistencial: true,
      revisao: 'recomendada',
    });
    expect(p.porCategoria.clinica).toBe(3);
    const s = proporPerfilDoGrupo({ grupo: 'FATURAMENTO', permissoes: [], usuariosAtivos: 0 });
    expect(s.revisao).toBe('sem-usuarios');
  });
  it('painel e grupos sem usuários continuam sem perfil', () => {
    expect(proporPerfilDoGrupo({ grupo: 'PAINEIS', permissoes: [], usuariosAtivos: 3 }).revisao).toBe(
      'individual',
    );
    expect(proporPerfilDoGrupo({ grupo: 'TI', permissoes: [], usuariosAtivos: 0 }).revisao).toBe(
      'sem-usuarios',
    );
  });
  it('grupo fora do mapa: pela categoria dominante; clínica não vira perfil por adivinhação', () => {
    const adm = proporPerfilDoGrupo({
      grupo: 'NOVO_ADM',
      permissoes: [...perms(4, 'administrativa'), ...perms(1, 'financeira'), ...perms(1, null)],
      usuariosAtivos: 2,
    });
    expect(adm).toMatchObject({
      perfil: 'administrativo-area',
      origem: 'permissoes-usadas',
      revisao: 'recomendada',
    });
    expect(adm.porCategoria['sem-categoria']).toBe(1);
    const fin = proporPerfilDoGrupo({
      grupo: 'NOVO_FIN',
      permissoes: perms(2, 'financeira'),
      usuariosAtivos: 0,
    });
    expect(fin).toMatchObject({ perfil: 'financeiro', revisao: 'sem-usuarios' });
    const cli = proporPerfilDoGrupo({
      grupo: 'NOVO_CLI',
      permissoes: perms(5, 'clinica'),
      usuariosAtivos: 1,
    });
    expect(cli).toMatchObject({
      perfil: null,
      origem: 'nenhuma',
      assistencial: false,
      revisao: 'individual',
    });
    const vazio = proporPerfilDoGrupo({ grupo: 'NOVO_VAZIO', permissoes: [], usuariosAtivos: 1 });
    expect(vazio.perfil).toBeNull();
  });
});
