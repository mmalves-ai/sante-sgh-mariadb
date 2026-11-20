import { describe, expect, it } from 'vitest';
import {
  type ContaModelo,
  conferirAplicarModelo,
  passosDoPlano,
  planoDoModelo,
  textoCanonicoDoPlano,
} from './usuario-modelo.js';

const conta = (login: string, extra: Partial<ContaModelo> = {}): ContaModelo => ({
  login,
  ativo: true,
  bloqueado: false,
  grupo: null,
  papeis: [],
  perfis: [],
  ...extra,
});
const ativos = new Set(['ENFERMAGEM', 'RECEPCAO', 'MASTER']);
const gestor = { login: 'GESTOR', perfis: ['gestor-acessos'] };

describe('conferirAplicarModelo', () => {
  it('recusa aplicar no próprio acesso, no modelo igual ao alvo, ao auditor e a contas fora de uso', () => {
    expect(conferirAplicarModelo(gestor, conta('ANA'), conta('GESTOR'))?.codigo).toBe('a-si-mesmo');
    expect(conferirAplicarModelo(gestor, conta('ANA'), conta('ANA'))?.codigo).toBe('modelo-e-o-alvo');
    expect(
      conferirAplicarModelo({ login: 'AUD', perfis: ['auditor'] }, conta('ANA'), conta('BIA'))?.codigo,
    ).toBe('auditor-nao-altera');
    expect(conferirAplicarModelo(gestor, conta('ANA', { bloqueado: true }), conta('BIA'))?.codigo).toBe(
      'modelo-indisponivel',
    );
    expect(conferirAplicarModelo(gestor, conta('ANA'), conta('BIA', { ativo: false }))?.codigo).toBe(
      'alvo-indisponivel',
    );
    expect(conferirAplicarModelo(gestor, conta('ANA'), conta('BIA'))).toBeNull();
  });
});

describe('planoDoModelo', () => {
  const modelo = conta('ANA', {
    grupo: 'ENFERMAGEM',
    papeis: [
      { papel: 3, nome: 'Enfermeiro', ativo: true },
      { papel: 5, nome: 'Técnico', ativo: true },
      { papel: 7, nome: 'Antigo', ativo: false },
    ],
    perfis: [
      { id: '1', perfil: 'faturista', fim: null },
      { id: '2', perfil: 'estoquista', fim: '2027-01-01T00:00:00.000Z' },
    ],
  });
  const alvo = conta('BIA', {
    grupo: 'RECEPCAO',
    papeis: [
      { papel: 5, nome: 'Técnico', ativo: false },
      { papel: 9, nome: 'Recepção', ativo: true },
    ],
    perfis: [
      { id: '10', perfil: 'faturista', fim: null },
      { id: '11', perfil: 'recepcionista', fim: null },
    ],
  });

  it("'somar' só acrescenta: troca o grupo, concede e reativa papéis, concede perfis com o mesmo fim", () => {
    const p = planoDoModelo(modelo, alvo, 'somar', ativos);
    expect(p.grupo).toEqual({ de: 'RECEPCAO', para: 'ENFERMAGEM' });
    expect(p.papeisConceder).toEqual([{ papel: 3, nome: 'Enfermeiro' }]);
    expect(p.papeisReativar).toEqual([{ papel: 5, nome: 'Técnico' }]);
    expect(p.papeisRetirar).toEqual([]);
    expect(p.perfisConceder).toEqual([{ perfil: 'estoquista', fim: '2027-01-01T00:00:00.000Z' }]);
    expect(p.perfisRetirar).toEqual([]);
    expect(p.iguais).toBe(1);
    expect(passosDoPlano(p)).toBe(4);
  });

  it("'igualar' também retira do alvo o papel e o perfil que o modelo não tem", () => {
    const p = planoDoModelo(modelo, alvo, 'igualar', ativos);
    expect(p.papeisRetirar).toEqual([{ papel: 9, nome: 'Recepção' }]);
    expect(p.perfisRetirar).toEqual([{ id: '11', perfil: 'recepcionista' }]);
    expect(passosDoPlano(p)).toBe(6);
  });

  it('segregação: não propaga nem retira privilégio de gestão; perfil do conselho e grupo inativo ficam de fora', () => {
    const m = conta('ANA', {
      grupo: 'MASTER',
      papeis: [{ papel: 0, nome: 'Gestor de acessos', ativo: true }],
      perfis: [
        { id: '1', perfil: 'gestor-acessos', fim: null },
        { id: '2', perfil: 'administrador-sistema', fim: null },
        { id: '3', perfil: 'assistencial-com-conselho', fim: null },
      ],
    });
    const a = conta('BIA', { grupo: 'RECEPCAO' });
    const p = planoDoModelo(m, a, 'somar', ativos);
    expect(passosDoPlano(p)).toBe(0);
    expect(p.ignorados.map((i) => `${i.tipo}:${i.motivo}`).sort()).toEqual([
      'grupo:privilegio-nominal',
      'papel:privilegio-nominal',
      'perfil:privilegio-nominal',
      'perfil:privilegio-nominal',
      'perfil:vem-do-conselho',
    ]);
    // O alvo gestor não perde o papel 0 nem o perfil no 'igualar'; o alvo do grupo MASTER não é rebaixado.
    const g = conta('CAIO', {
      grupo: 'MASTER',
      papeis: [{ papel: 0, nome: 'Gestor de acessos', ativo: true }],
      perfis: [{ id: '9', perfil: 'gestor-acessos', fim: null }],
    });
    const q = planoDoModelo(conta('ANA', { grupo: 'RECEPCAO' }), g, 'igualar', ativos);
    expect(passosDoPlano(q)).toBe(0);
    expect(q.ignorados).toHaveLength(3);
    // Grupo inativo do modelo.
    const r = planoDoModelo(conta('ANA', { grupo: 'VELHO' }), a, 'somar', ativos);
    expect(r.grupo).toBeNull();
    expect(r.ignorados).toEqual([{ tipo: 'grupo', item: 'VELHO', motivo: 'grupo-inativo' }]);
  });

  it('segregação: o auditor não se acumula com o gestor de acessos do alvo', () => {
    const m = conta('ANA', { perfis: [{ id: '1', perfil: 'auditor', fim: null }] });
    const a = conta('BIA', { perfis: [{ id: '2', perfil: 'gestor-acessos', fim: null }] });
    const p = planoDoModelo(m, a, 'somar', ativos);
    expect(p.perfisConceder).toEqual([]);
    expect(p.ignorados).toEqual([{ tipo: 'perfil', item: 'auditor', motivo: 'segregacao' }]);
  });

  it('segregação nos papéis SBIS: Administrador (1) é nominal; Auditor (2) não vai a quem fica gestor', () => {
    const m = conta('ANA', {
      papeis: [
        { papel: 1, nome: 'Administrador', ativo: true },
        { papel: 2, nome: 'Auditor', ativo: true },
      ],
    });
    const a = conta('BIA', { perfis: [{ id: '2', perfil: 'gestor-acessos', fim: null }] });
    const p = planoDoModelo(m, a, 'somar', ativos);
    expect(passosDoPlano(p)).toBe(0);
    expect(p.ignorados).toEqual([
      { tipo: 'papel', item: '1 Administrador', motivo: 'privilegio-nominal' },
      { tipo: 'papel', item: '2 Auditor', motivo: 'segregacao' },
    ]);
    // Sem o gestor, o Auditor (2) entra.
    expect(planoDoModelo(m, conta('CAIO'), 'somar', ativos).papeisConceder).toEqual([
      { papel: 2, nome: 'Auditor' },
    ]);
  });

  it('é determinístico (o texto canônico da prévia é o mesmo da gravação) e muda quando o alvo muda', () => {
    const t1 = textoCanonicoDoPlano('ANA', 'BIA', 'somar', planoDoModelo(modelo, alvo, 'somar', ativos));
    const t2 = textoCanonicoDoPlano('ANA', 'BIA', 'somar', planoDoModelo(modelo, alvo, 'somar', ativos));
    expect(t1).toBe(t2);
    const outro = { ...alvo, grupo: 'ENFERMAGEM' };
    expect(
      textoCanonicoDoPlano('ANA', 'BIA', 'somar', planoDoModelo(modelo, outro, 'somar', ativos)),
    ).not.toBe(t1);
  });
});
