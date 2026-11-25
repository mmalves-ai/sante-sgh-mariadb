// F3.6 (05-SUP linha 3): a política do local de estoque e a concessão do usuário por classificação, aplicadas às
// gravações: tipo de pedido que o local atende, só urgente, setores atendidos, o que o local guarda, atendimento em
// parte e o que o usuário requisita, movimenta e compra.
import { describe, expect, it } from 'vitest';
import {
  conferirAtendimentoParcial,
  conferirClassificacaoDoUsuario,
  conferirItensDoLocal,
  conferirSetorAtendido,
  conferirTipoDePedido,
  conferirUrgencia,
  localGuarda,
  type ConcessaoClassificacao,
  type ItemClassificado,
  type PoliticaLocal,
} from '@sgh/contratos/regras-suprimentos';

const base: PoliticaLocal = {
  nome: 'FARMACIA',
  atendeSetor: false,
  atendePaciente: false,
  atendeTransferencia: false,
  permiteAtendimentoParcial: true,
  apenasUrgente: false,
  setores: [],
  classificacao: [],
};
const seringa: ItemClassificado = { item: 1, nome: 'SERINGA', grupo: 10, subgrupo: 101 };
const dipirona: ItemClassificado = {
  item: 2,
  nome: 'DIPIRONA',
  grupo: 20,
  subgrupo: null,
  classificacoesDespesa: [7],
};

describe('política do local de estoque', () => {
  it('local sem nenhum tipo marcado atende todos; com um marcado, recusa os outros', () => {
    for (const t of ['setor', 'paciente', 'transferencia'] as const)
      expect(conferirTipoDePedido(base, t)).toBeNull();
    const soPaciente = { ...base, atendePaciente: true };
    expect(conferirTipoDePedido(soPaciente, 'paciente')).toBeNull();
    expect(conferirTipoDePedido(soPaciente, 'setor')).toMatchObject({
      codigo: 'local-nao-atende-setor',
      campos: ['local'],
    });
    expect(conferirTipoDePedido(soPaciente, 'transferencia')).toMatchObject({
      codigo: 'local-nao-atende-transferencia',
      campos: ['origem'],
    });
    expect(conferirTipoDePedido({ ...base, atendeSetor: true }, 'paciente')?.codigo).toBe(
      'local-nao-atende-paciente',
    );
  });

  it('só urgente: a requisição comum é recusada, a urgente passa', () => {
    expect(conferirUrgencia(base, false)).toBeNull();
    const p = { ...base, apenasUrgente: true };
    expect(conferirUrgencia(p, true)).toBeNull();
    expect(conferirUrgencia(p, false)).toMatchObject({ codigo: 'local-so-urgente', campos: ['urgente'] });
  });

  it('setores atendidos: sem lista não restringe; com lista, o setor de quem pede tem de estar nela', () => {
    expect(conferirSetorAtendido(base, [])).toBeNull();
    const p = { ...base, setores: [5, 6] };
    expect(conferirSetorAtendido(p, [9, 6])).toBeNull();
    expect(conferirSetorAtendido(p, [9])?.codigo).toBe('setor-nao-atendido');
    expect(conferirSetorAtendido(p, [])?.codigo).toBe('setor-nao-atendido');
  });

  it('classificação do local: grupo, subgrupo ou item; nada cadastrado guarda tudo', () => {
    expect(localGuarda(base, seringa)).toBe(true);
    expect(localGuarda({ ...base, classificacao: [{ grupo: 10 }] }, seringa)).toBe(true);
    expect(localGuarda({ ...base, classificacao: [{ subgrupo: 101 }] }, seringa)).toBe(true);
    expect(localGuarda({ ...base, classificacao: [{ item: 1 }] }, seringa)).toBe(true);
    const soMedicamento = { ...base, classificacao: [{ grupo: 20 }, { subgrupo: 999 }] };
    expect(localGuarda(soMedicamento, seringa)).toBe(false);
    // Subgrupo nulo do item não casa com alvo de subgrupo nulo.
    expect(
      localGuarda({ ...base, classificacao: [{ grupo: null, subgrupo: null, item: 3 }] }, dipirona),
    ).toBe(false);
    const r = conferirItensDoLocal(soMedicamento, [seringa, dipirona]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ codigo: 'item-fora-do-local', campos: ['itens'] });
    expect(r[0]!.mensagem).toContain('SERINGA');
  });

  it('atendimento em parte: só quando o local permite', () => {
    const itens = [
      { pendente: 3, atendido: 3 },
      { pendente: 2, atendido: 0 },
    ];
    expect(conferirAtendimentoParcial(base, itens)).toBeNull();
    const p = { ...base, permiteAtendimentoParcial: false };
    expect(conferirAtendimentoParcial(p, itens)?.codigo).toBe('atendimento-parcial-nao-permitido');
    expect(conferirAtendimentoParcial(p, [{ pendente: 3, atendido: 2.5 }])?.codigo).toBe(
      'atendimento-parcial-nao-permitido',
    );
    // Tudo o que está pendente (o já atendido antes não conta) passa.
    expect(
      conferirAtendimentoParcial(p, [
        { pendente: 3, atendido: 3 },
        { pendente: 0, atendido: 0 },
      ]),
    ).toBeNull();
  });
});

describe('concessão do usuário por classificação', () => {
  const c = (x: Partial<ConcessaoClassificacao>): ConcessaoClassificacao => ({
    grupo: null,
    subgrupo: null,
    classificacaoDespesa: null,
    requisitar: true,
    movimentar: false,
    comprar: false,
    vigente: true,
    ...x,
  });

  it('quem nunca teve concessão não tem restrição', () => {
    expect(conferirClassificacaoDoUsuario([], [seringa, dipirona], 'movimentar')).toEqual([]);
  });

  it('grupo inteiro, subgrupo e a ação marcada', () => {
    const cs = [c({ grupo: 10 }), c({ grupo: 20, subgrupo: 201, movimentar: true })];
    expect(conferirClassificacaoDoUsuario(cs, [seringa], 'requisitar')).toEqual([]);
    // A ação pesa: requisita o grupo 10, mas não movimenta.
    expect(conferirClassificacaoDoUsuario(cs, [seringa], 'movimentar')[0]).toMatchObject({
      codigo: 'item-fora-do-escopo',
      campos: ['itens'],
    });
    // O subgrupo da concessão restringe: a dipirona (sem subgrupo) fica fora.
    expect(conferirClassificacaoDoUsuario(cs, [dipirona], 'movimentar')).toHaveLength(1);
    expect(conferirClassificacaoDoUsuario(cs, [seringa, dipirona], 'comprar')).toHaveLength(2);
  });

  it('classificação de despesa atravessa grupos; com grupo junto, as duas pesam', () => {
    expect(
      conferirClassificacaoDoUsuario([c({ classificacaoDespesa: 7 })], [dipirona], 'requisitar'),
    ).toEqual([]);
    expect(
      conferirClassificacaoDoUsuario([c({ classificacaoDespesa: 7 })], [seringa], 'requisitar'),
    ).toHaveLength(1);
    expect(
      conferirClassificacaoDoUsuario([c({ grupo: 10, classificacaoDespesa: 7 })], [dipirona], 'requisitar'),
    ).toHaveLength(1);
  });

  it('retirar a última concessão não abre todos os itens', () => {
    const r = conferirClassificacaoDoUsuario([c({ grupo: 10, vigente: false })], [seringa], 'requisitar');
    expect(r[0]?.codigo).toBe('item-fora-do-escopo');
    expect(r[0]?.mensagem).toContain('SERINGA');
  });
});
