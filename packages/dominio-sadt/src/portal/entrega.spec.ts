import { describe, expect, it } from 'vitest';
import {
  conferirCancelamentoEntrega,
  conferirEntrega,
  conferirPerfilPortal,
  conferirPrazo,
  conferirRestricaoPortal,
  cpfConfere,
  escolherPrazo,
  perfilAplicado,
  perfisSubstituidos,
  type PrazoEntrega,
  preverEntrega,
  publicacaoNoPortal,
  publicoAplicado,
  RecusaEntrega,
  restricaoVigente,
  situacaoDoPrazo,
} from './entrega.js';

const codigo = (fn: () => unknown): string => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    return e instanceof RecusaEntrega ? e.codigo : String(e);
  }
};
const TODOS = [true, true, true, true, true, true, true];
const UTEIS = [false, true, true, true, true, true, false];
const prazo = (p: Partial<PrazoEntrega>): PrazoEntrega => ({
  id: 1,
  exame: 10,
  setor: null,
  setorSolicitante: null,
  material: null,
  prioridade: 'rotina',
  tipoAtendimento: null,
  prazoDias: 1,
  prazoMinutos: null,
  horarioCorte: null,
  diasDaSemana: TODOS,
  ...p,
});

describe('prazo de entrega por setor e exame', () => {
  it('confere o cadastro na hora', () => {
    expect(codigo(() => conferirPrazo(prazo({})))).toBe('ok');
    expect(codigo(() => conferirPrazo(prazo({ prazoDias: 0 })))).toBe('prazo-sem-tempo');
    expect(codigo(() => conferirPrazo(prazo({ prazoDias: 0, prazoMinutos: 90 })))).toBe('ok');
    expect(codigo(() => conferirPrazo(prazo({ prazoDias: 400 })))).toBe('prazo-dias-invalido');
    expect(codigo(() => conferirPrazo(prazo({ horarioCorte: '25:00' })))).toBe('horario-corte-invalido');
    expect(codigo(() => conferirPrazo(prazo({ diasDaSemana: TODOS.map(() => false) })))).toBe(
      'prazo-sem-dia',
    );
  });

  it('escolhe o prazo mais específico e cai na rotina quando a prioridade não tem prazo próprio', () => {
    const geral = prazo({ id: 1, prazoDias: 5 });
    const doSetor = prazo({ id: 2, setor: 7, prazoDias: 3 });
    const doSetorInternado = prazo({ id: 3, setor: 7, tipoAtendimento: 'internacao', prazoDias: 1 });
    const urgente = prazo({ id: 4, prioridade: 'urgencia', prazoDias: 0, prazoMinutos: 120 });
    const todos = [geral, doSetor, doSetorInternado, urgente];
    const pedido = {
      exame: 10,
      setor: 7,
      setorSolicitante: null,
      material: null,
      prioridade: 'rotina' as const,
      tipoAtendimento: 'ambulatorial' as const,
    };
    expect(escolherPrazo(todos, pedido)?.id).toBe(2);
    expect(escolherPrazo(todos, { ...pedido, tipoAtendimento: 'internacao' })?.id).toBe(3);
    expect(escolherPrazo(todos, { ...pedido, setor: 9 })?.id).toBe(1);
    expect(escolherPrazo(todos, { ...pedido, prioridade: 'urgencia' })?.id).toBe(4);
    // Emergência sem prazo próprio: vale o de rotina mais específico.
    expect(escolherPrazo(todos, { ...pedido, prioridade: 'emergencia' })?.id).toBe(2);
    expect(escolherPrazo(todos, { ...pedido, exame: 99 })).toBeNull();
  });

  it('prevê a entrega com horário de corte, dias de realização e minutos', () => {
    // 2026-03-13 é sexta-feira.
    expect(preverEntrega(prazo({ prazoDias: 1 }), '2026-03-13T10:00')).toBe('2026-03-14T10:00');
    // Só dias úteis: um dia depois da sexta é a segunda.
    expect(preverEntrega(prazo({ prazoDias: 1, diasDaSemana: UTEIS }), '2026-03-13T10:00')).toBe(
      '2026-03-16T10:00',
    );
    // Depois do corte conta a partir da zero hora do próximo dia de realização.
    expect(
      preverEntrega(prazo({ prazoDias: 1, horarioCorte: '09:00', diasDaSemana: UTEIS }), '2026-03-13T10:00'),
    ).toBe('2026-03-17T00:00');
    // Urgência em minutos, no mesmo dia.
    expect(preverEntrega(prazo({ prazoDias: 0, prazoMinutos: 120 }), '2026-03-13T10:00')).toBe(
      '2026-03-13T12:00',
    );
    // Pedido no sábado de um exame que só roda em dia útil: começa na segunda.
    expect(
      preverEntrega(prazo({ prazoDias: 0, prazoMinutos: 60, diasDaSemana: UTEIS }), '2026-03-14T15:00'),
    ).toBe('2026-03-16T01:00');
    // Os minutos que viram o dia para um dia sem realização empurram para o próximo dia de realização.
    expect(
      preverEntrega(prazo({ prazoDias: 0, prazoMinutos: 180, diasDaSemana: UTEIS }), '2026-03-13T22:00'),
    ).toBe('2026-03-16T00:00');
  });

  it('diz a situação do exame diante da previsão', () => {
    expect(situacaoDoPrazo(null, '2026-03-13T10:00', null)).toBe('sem_prazo');
    expect(situacaoDoPrazo('2026-03-14T10:00', '2026-03-13T10:00', null)).toBe('no_prazo');
    expect(situacaoDoPrazo('2026-03-14T10:00', '2026-03-15T10:00', null)).toBe('atrasado');
    expect(situacaoDoPrazo('2026-03-14T10:00', '2026-03-20T10:00', '2026-03-14T09:00')).toBe(
      'liberado_no_prazo',
    );
    expect(situacaoDoPrazo('2026-03-14T10:00', '2026-03-20T10:00', '2026-03-14T11:00')).toBe(
      'liberado_atrasado',
    );
  });
});

describe('protocolo de entrega no balcão', () => {
  const item = { item: 1, liberado: true, jaEntregue: false };
  const base = {
    retiradoPeloPaciente: true,
    nomeResponsavel: null,
    cpfResponsavel: null,
    documentoResponsavel: null,
    itens: [item],
  };

  it('confere o CPF pelos dígitos verificadores', () => {
    expect(cpfConfere('52998224725')).toBe(true);
    expect(cpfConfere('52998224724')).toBe(false);
    expect(cpfConfere('11111111111')).toBe(false);
    expect(cpfConfere('529.982.247-25')).toBe(false);
  });

  it('só entrega exame liberado, uma vez, e identifica quem retirou', () => {
    expect(codigo(() => conferirEntrega(base))).toBe('ok');
    expect(codigo(() => conferirEntrega({ ...base, itens: [] }))).toBe('entrega-vazia');
    expect(codigo(() => conferirEntrega({ ...base, itens: [item, item] }))).toBe('entrega-item-repetido');
    expect(codigo(() => conferirEntrega({ ...base, itens: [{ ...item, liberado: false }] }))).toBe(
      'entrega-nao-liberado',
    );
    expect(codigo(() => conferirEntrega({ ...base, itens: [{ ...item, jaEntregue: true }] }))).toBe(
      'entrega-ja-feita',
    );
    const terceiro = { ...base, retiradoPeloPaciente: false };
    expect(codigo(() => conferirEntrega(terceiro))).toBe('entrega-sem-responsavel');
    expect(codigo(() => conferirEntrega({ ...terceiro, nomeResponsavel: 'RESPONSAVEL SINTETICO' }))).toBe(
      'entrega-sem-documento',
    );
    expect(
      codigo(() =>
        conferirEntrega({
          ...terceiro,
          nomeResponsavel: 'RESPONSAVEL SINTETICO',
          cpfResponsavel: '52998224724',
        }),
      ),
    ).toBe('entrega-cpf-invalido');
    expect(
      codigo(() =>
        conferirEntrega({
          ...terceiro,
          nomeResponsavel: 'RESPONSAVEL SINTETICO',
          cpfResponsavel: '52998224725',
        }),
      ),
    ).toBe('ok');
    expect(
      codigo(() =>
        conferirEntrega({
          ...terceiro,
          nomeResponsavel: 'RESPONSAVEL SINTETICO',
          documentoResponsavel: 'RG 123',
        }),
      ),
    ).toBe('ok');
  });

  it('cancela só o protocolo vigente e com motivo', () => {
    expect(codigo(() => conferirCancelamentoEntrega('entregue', 'entregue ao paciente errado'))).toBe('ok');
    expect(codigo(() => conferirCancelamentoEntrega('entregue', ' x '))).toBe('entrega-sem-motivo');
    expect(codigo(() => conferirCancelamentoEntrega('cancelada', 'motivo valido'))).toBe(
      'entrega-ja-cancelada',
    );
  });
});

describe('publicação no portal: perfil e exame restrito', () => {
  const agora = new Date('2026-03-20T12:00:00Z');
  const laudo = {
    setor: 7,
    liberadoEm: new Date('2026-03-18T12:00:00Z'),
    entreguePresencialmente: false,
  };
  const perfil = { setores: [], ocultaExameRestrito: true, diasVisibilidade: null };

  it('confere o cadastro da restrição e do perfil', () => {
    expect(codigo(() => conferirRestricaoPortal({ regra: 'nunca_publicar', diasCarencia: null }))).toBe('ok');
    expect(codigo(() => conferirRestricaoPortal({ regra: 'apos_dias', diasCarencia: null }))).toBe(
      'restricao-sem-carencia',
    );
    expect(codigo(() => conferirRestricaoPortal({ regra: 'nunca_publicar', diasCarencia: 3 }))).toBe(
      'restricao-carencia-indevida',
    );
    const p = {
      codigo: 'PAC',
      descricao: 'Paciente',
      publico: 'paciente' as const,
      diasVisibilidade: null,
      atualizacaoMinutos: null,
      setores: [],
    };
    expect(codigo(() => conferirPerfilPortal(p))).toBe('ok');
    expect(codigo(() => conferirPerfilPortal({ ...p, codigo: 'a b' }))).toBe('perfil-codigo-invalido');
    expect(codigo(() => conferirPerfilPortal({ ...p, diasVisibilidade: 0 }))).toBe(
      'perfil-visibilidade-invalida',
    );
    expect(codigo(() => conferirPerfilPortal({ ...p, setores: [1, 1] }))).toBe('perfil-setor-repetido');
  });

  it('a restrição do estabelecimento vence a que vale para todos', () => {
    expect(
      restricaoVigente([
        { global: true, id: 1 },
        { global: false, id: 2 },
      ])?.id,
    ).toBe(2);
    expect(restricaoVigente([{ global: true, id: 1 }])?.id).toBe(1);
    expect(restricaoVigente([])).toBeNull();
  });

  it('decide o que cada perfil vê', () => {
    expect(publicacaoNoPortal(null, null, laudo, agora)).toEqual({ publica: true });
    expect(publicacaoNoPortal({ ...perfil, setores: [8] }, null, laudo, agora)).toEqual({
      publica: false,
      motivo: 'setor',
    });
    expect(publicacaoNoPortal({ ...perfil, setores: [7, 8] }, null, laudo, agora)).toEqual({ publica: true });
    expect(publicacaoNoPortal({ ...perfil, diasVisibilidade: 1 }, null, laudo, agora)).toEqual({
      publica: false,
      motivo: 'expirado',
    });
    const nunca = { regra: 'nunca_publicar' as const, diasCarencia: null };
    expect(publicacaoNoPortal(null, nunca, laudo, agora)).toEqual({ publica: false, motivo: 'restrito' });
    expect(publicacaoNoPortal(perfil, nunca, laudo, agora)).toEqual({ publica: false, motivo: 'restrito' });
    // O perfil que não oculta o exame restrito vê.
    expect(publicacaoNoPortal({ ...perfil, ocultaExameRestrito: false }, nunca, laudo, agora)).toEqual({
      publica: true,
    });
    const balcao = { regra: 'apos_entrega_presencial' as const, diasCarencia: null };
    expect(publicacaoNoPortal(perfil, balcao, laudo, agora)).toEqual({
      publica: false,
      motivo: 'aguarda_entrega',
    });
    expect(publicacaoNoPortal(perfil, balcao, { ...laudo, entreguePresencialmente: true }, agora)).toEqual({
      publica: true,
    });
    const carencia = { regra: 'apos_dias' as const, diasCarencia: 5 };
    expect(publicacaoNoPortal(perfil, carencia, laudo, agora)).toEqual({
      publica: false,
      motivo: 'carencia',
    });
    expect(publicacaoNoPortal(perfil, { ...carencia, diasCarencia: 2 }, laudo, agora)).toEqual({
      publica: true,
    });
  });

  it('um perfil ativo por público e alcance: o salvo substitui os outros, e o do estabelecimento vence o geral', () => {
    const perfis = [
      { id: 1, publico: 'paciente' as const, global: false, ativo: true },
      { id: 2, publico: 'paciente' as const, global: true, ativo: true },
      { id: 3, publico: 'medico_externo' as const, global: false, ativo: true },
      { id: 4, publico: 'paciente' as const, global: false, ativo: false },
      { id: 5, publico: 'paciente' as const, global: false, ativo: true },
    ];
    // O novo do estabelecimento desativa só os ativos do mesmo público e do mesmo alcance.
    expect(perfisSubstituidos({ id: 9, publico: 'paciente', global: false }, perfis)).toEqual([1, 5]);
    expect(perfisSubstituidos({ id: 9, publico: 'paciente', global: true }, perfis)).toEqual([2]);
    expect(perfisSubstituidos({ id: 3, publico: 'medico_externo', global: false }, perfis)).toEqual([]);
    // Reativar (salvar de novo) o antigo desativa o que estava valendo.
    expect(perfisSubstituidos({ id: 4, publico: 'paciente', global: false }, perfis)).toEqual([1, 5]);
    // O aplicado: o do estabelecimento antes do geral; entre dois do mesmo alcance (carga), o mais novo.
    expect(perfilAplicado(perfis, 'paciente')?.id).toBe(5);
    expect(perfilAplicado([perfis[1]!, perfis[3]!], 'paciente')?.id).toBe(2);
    expect(perfilAplicado([perfis[3]!], 'paciente')).toBeNull();
    expect(perfilAplicado(perfis, 'medico_externo')?.id).toBe(3);
    // Público que o portal não aplica: nenhum perfil vale, e o cadastro recusa.
    expect(perfilAplicado([{ id: 7, publico: 'empresa', global: false, ativo: true }], 'empresa')).toBeNull();
    expect(publicoAplicado('interno')).toBe(false);
    const base = {
      codigo: 'EMP',
      descricao: 'Empresa',
      diasVisibilidade: null,
      atualizacaoMinutos: null,
      setores: [],
    };
    expect(codigo(() => conferirPerfilPortal({ ...base, publico: 'empresa' }))).toBe(
      'perfil-publico-sem-efeito',
    );
    expect(codigo(() => conferirPerfilPortal({ ...base, publico: 'interno' }))).toBe(
      'perfil-publico-sem-efeito',
    );
    expect(() => conferirPerfilPortal({ ...base, publico: 'medico_externo' })).not.toThrow();
  });
});
