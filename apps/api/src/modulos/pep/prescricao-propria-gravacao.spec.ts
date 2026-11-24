// Unidade da família de gravação da prescrição no banco próprio: conversões, nomes de operação, decisões, recusas
// de tipo de item ainda sem adaptador e as leituras sobre um Leitor dublê (sem banco).
import { ErroOperacao, type Executor, type Leitor } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import { PLANO_DO_TIPO } from '@sgh/contratos';
import { conferirCategoriaDoItem } from './prescricao-propria-itens.js';
import {
  CATEGORIA_DO_PLANO,
  conferirItensSuportados,
  decisaoGravada,
  GravacaoPrescricaoPropria,
  impressaoDoPedido,
  instanteLocal,
  nomeOperacao,
  podeSupervisionar,
  resultadoRepetido,
} from './prescricao-propria-gravacao.js';
import type { ItemGravacao } from './tipos-pep.js';

const ctx = {
  cliente: 'teste',
  estabelecimento: null,
  usuario: null,
  correlacao: 'spec',
  rede: 'r',
  hospital: 'H1',
};

/** Leitor dublê: responde pela primeira regra cujo trecho aparece no SQL. */
function dubleNucleo(regras: [string, Record<string, unknown>[]][]) {
  const sqls: string[] = [];
  const responder = (sql: string) => {
    sqls.push(sql);
    if (sql.includes('FROM estabelecimento WHERE codigo'))
      return [{ id: 7, fuso_horario: 'America/Sao_Paulo' }];
    return regras.find(([t]) => sql.includes(t))?.[1] ?? [];
  };
  const l = {
    consultar: async (sql: string) => responder(sql),
    uma: async (sql: string) => responder(sql)[0] ?? null,
  } as unknown as Leitor;
  const nucleo = {
    lerSomente: async <T>(_c: unknown, fn: (l: Leitor) => Promise<T>) => fn(l),
    criarExecutor: () => {
      throw new Error('sem executor no teste de unidade');
    },
  };
  return { porta: new GravacaoPrescricaoPropria(nucleo as never, 'teste'), sqls };
}

const item = (detalhe: Record<string, unknown>): ItemGravacao =>
  ({
    chave: 'k1',
    plano: 1,
    numDose: 1,
    frequencia: null,
    via: null,
    observacao: null,
    integracaoEstoque: false,
    detalhe,
    horarios: [],
  }) as unknown as ItemGravacao;

const med = {
  tipo: 'medicamento',
  produto: 1,
  dose: 500,
  unidade: 'mg',
  agora: false,
  naoAjustar: false,
  tempoInfusaoMinutos: null,
  naoPadronizado: null,
  justificativaAlergia: null,
  seNecessario: [],
  kit: [],
};

describe('apoio da gravação da prescrição própria', () => {
  it('converte a hora civil do estabelecimento em instante UTC (com e sem segundos)', () => {
    expect(instanteLocal('2026-11-23T10:30', 'America/Sao_Paulo').toISOString()).toBe(
      '2026-11-23T13:30:00.000Z',
    );
    expect(instanteLocal('2026-01-05T23:59:59', 'America/Manaus').toISOString()).toBe(
      '2026-01-06T03:59:59.000Z',
    );
    expect(() => instanteLocal('23/11/2026', 'America/Sao_Paulo')).toThrow(ErroOperacao);
  });

  it('dá nome de operação no formato do executor (só minúsculas)', () => {
    expect(nomeOperacao('pep.copiarPrescricao')).toBe('pep.prescricao.copiar-prescricao');
    expect(nomeOperacao('pep.prescrever')).toBe('pep.prescricao.prescrever');
    expect(nomeOperacao('pep.prescrever')).toMatch(/^[a-z][a-z0-9_.-]{2,119}$/);
  });

  it('grava a decisão no vocabulário do banco (retirado → cancelou_item; com justificativa → justificou)', () => {
    expect(decisaoGravada('retirado', null)).toBe('cancelou_item');
    expect(decisaoGravada('mantido', 'Benefício maior')).toBe('justificou');
    expect(decisaoGravada('mantido', null)).toBe('aceitou');
    expect(decisaoGravada('exibido', null)).toBe('aceitou');
  });

  it('recusa com 501 o que ainda não tem adaptador e com 422 a incoerência clínica (dose zero, dieta, ventilação)', () => {
    const codigo = (f: () => void) => {
      try {
        f();
        return null;
      } catch (e) {
        return e instanceof ErroOperacao ? `${e.problema.status}:${e.problema.codigo}` : 'outro';
      }
    };
    expect(codigo(() => conferirItensSuportados([item(med)]))).toBeNull();
    expect(codigo(() => conferirItensSuportados([item({ tipo: 'procedimento' })]))).toBe(
      '501:pendente-modelo-proprio',
    );
    expect(codigo(() => conferirItensSuportados([item({ tipo: 'hemoterapia' })]))).toBe(
      '501:pendente-modelo-proprio',
    );
    // Dieta, solução, ventilação e "se necessário" gravam; a coerência clínica do domínio vira 422.
    const dieta = {
      tipo: 'dieta',
      classe: 'enteral',
      quantidade: 1500,
      velocidade: 60,
      unidadeInfusao: null,
      caracteristicas: [],
    };
    expect(codigo(() => conferirItensSuportados([item({ ...dieta, unidadeInfusao: 2 })]))).toBeNull();
    expect(codigo(() => conferirItensSuportados([item(dieta)]))).toBe('422:dieta-velocidade-sem-unidade');
    expect(
      codigo(() =>
        conferirItensSuportados([item({ ...med, seNecessario: [1, 2], intervaloMinimoMinutos: 360 })]),
      ),
    ).toBeNull();
    expect(codigo(() => conferirItensSuportados([item({ tipo: 'vni', fio2: 10 })]))).toBe(
      '422:ventilacao-fio2-fora-da-faixa',
    );
    expect(codigo(() => conferirItensSuportados([item({ ...med, kit: [{ produto: 1 }] })]))).toBe(
      '501:pendente-modelo-proprio',
    );
    expect(codigo(() => conferirItensSuportados([item({ ...med, dose: 0 })]))).toBe('422:dose-invalida');
    // Jejum e dieta livre gravam sem quantidade (antes vinham com o sentinela 0 e voltavam 422).
    const jejum = { ...dieta, classe: 'jejum', quantidade: null, velocidade: null };
    expect(codigo(() => conferirItensSuportados([item(jejum)]))).toBeNull();
    expect(codigo(() => conferirItensSuportados([item({ ...jejum, classe: 'livre' })]))).toBeNull();
    // "Se necessário" com horário fixo pendente é recusado.
    const sn = { ...med, seNecessario: [1], intervaloMinimoMinutos: 360 };
    expect(
      codigo(() =>
        conferirItensSuportados([
          { ...item(sn), horarios: [{ dataHora: '2026-11-24T10:00', relativo: null }] },
        ]),
      ),
    ).toBe('422:se-necessario-com-horario');
    // Etapa da solução fora da vigência da prescrição.
    const etapa = {
      etapa: 1,
      inicio: '2026-11-24T08:00',
      fim: '2026-11-24T12:00',
      velocidade: 125,
      unidadeInfusao: 1,
      volume: 500,
    };
    const solucao = {
      tipo: 'solucao',
      componentes: [{ dose: 500, principal: true, etapa: 1 }],
      etapas: [etapa],
    };
    expect(
      codigo(() =>
        conferirItensSuportados([item(solucao)], { inicio: '2026-11-24T09:00', fim: '2026-11-25T09:00' }),
      ),
    ).toBe('422:solucao-etapa-fora-da-vigencia');
    // VMI a pressão (sem volume corrente) passa; sem alvo nenhum, não.
    const vmi = {
      tipo: 'vmi',
      frequenciaRespiratoria: 16,
      peep: 5,
      volumeCorrente: null,
      pressao: 18,
      tempoInspiratorio: null,
      tempoExpiratorio: null,
      fio2: 40,
    };
    expect(codigo(() => conferirItensSuportados([item(vmi)]))).toBeNull();
    expect(codigo(() => conferirItensSuportados([item({ ...vmi, pressao: null })]))).toBe(
      '422:ventilacao-sem-alvo',
    );
  });

  it('o tipo de lançamento casa com o detalhe (plano de medicamento com dieta ou ventilação é recusado)', () => {
    const codigo = (f: () => void) => {
      try {
        f();
        return null;
      } catch (e) {
        return e instanceof ErroOperacao ? `${e.problema.status}:${e.problema.codigo}` : 'outro';
      }
    };
    expect(CATEGORIA_DO_PLANO[PLANO_DO_TIPO.jejum]).toBe('dieta');
    expect(CATEGORIA_DO_PLANO[PLANO_DO_TIPO.vmi]).toBe('ventilacao');
    expect(codigo(() => conferirCategoriaDoItem('medicamento', { tipo: 'dieta' } as never))).toBe(
      '422:tipo-item-incoerente',
    );
    expect(codigo(() => conferirCategoriaDoItem('medicamento', { tipo: 'vmi' } as never))).toBe(
      '422:tipo-item-incoerente',
    );
    expect(codigo(() => conferirCategoriaDoItem('ventilacao', { tipo: 'vni' } as never))).toBeNull();
  });
});

describe('reenvio, idempotência e coassinatura', () => {
  it('o reenvio devolve o resultado inteiro do método, não só o id', () => {
    expect(
      resultadoRepetido({ tabela: 'prescricao', id: 9, resultado: '{"prescricao":9,"horarios":2}' }),
    ).toEqual({
      prescricao: 9,
      horarios: 2,
    });
    expect(resultadoRepetido({ tabela: 'prescricao_item', id: 5, resultado: '{"horarios":1}' })).toEqual({
      horarios: 1,
    });
    expect(resultadoRepetido({ tabela: 'prescricao', id: 9, resultado: 'null' })).toBeNull();
    // Resultado sem o método guardado (gravação de outra versão): recusa, nunca devolve o id no lugar da forma.
    expect(() => resultadoRepetido({ tabela: 'prescricao', id: 9 })).toThrow(ErroOperacao);
  });

  it('a impressão do pedido não depende da ordem das chaves e muda com o conteúdo', () => {
    const a = impressaoDoPedido({ x: 1, y: { b: [1, 2], a: 'z' } });
    expect(impressaoDoPedido({ y: { a: 'z', b: [1, 2] }, x: 1 })).toBe(a);
    expect(impressaoDoPedido({ x: 1, y: { b: [2, 1], a: 'z' } })).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('coassina só quem prescreve sem pedir coassinatura (o residente e a ocupação sem prescrição não)', () => {
    expect(podeSupervisionar(['225125'])).toBe(true);
    expect(podeSupervisionar(['223115', '225125'])).toBe(true);
    expect(podeSupervisionar(['223115'])).toBe(false);
    expect(podeSupervisionar(['010105'])).toBe(false);
    expect(podeSupervisionar([])).toBe(false);
  });
});

describe('leituras da família sobre o Leitor dublê', () => {
  it('marcas e prova: coassinatura pendente pelas colunas exigida e coassinada', async () => {
    const { porta } = dubleNucleo([
      [
        'SELECT p.id, p.origem, p.coassinatura_exigida',
        [
          { id: 1, origem: 'sistema', coassinatura_exigida: 1, coassinada_em: null },
          { id: 2, origem: 'migracao', coassinatura_exigida: 1, coassinada_em: new Date() },
          { id: 3, origem: 'sistema', coassinatura_exigida: 0, coassinada_em: null },
        ],
      ],
      ["e.evento = 'coassinatura'", [{ ocorrido_em: new Date('2026-11-23T13:00:00Z'), login: 'sup' }]],
      ['SELECT p.coassinatura_exigida', [{ coassinatura_exigida: 1, coassinada_em: new Date() }]],
    ]);
    const m = await porta.marcas(ctx, [1, 2, 3, 0]);
    expect([...m.entries()]).toEqual([
      [1, { feitaNoNovo: true, coassinaturaPendente: true }],
      [2, { feitaNoNovo: false, coassinaturaPendente: false }],
      [3, { feitaNoNovo: true, coassinaturaPendente: false }],
    ]);
    expect(await porta.prova(ctx, 1)).toEqual({
      eventos: [
        {
          tipo: 'coassinado',
          item: null,
          em: '2026-11-23T10:00:00',
          usuario: 'sup',
          hashAnterior: '',
          comoSuporte: false,
        },
      ],
      coassinaturaExigida: true,
      coassinada: true,
    });
  });

  it('decisões: do item (chave = id) e do item retirado (item null, chave da tela), versão da regra gravada', async () => {
    const { porta, sqls } = dubleNucleo([
      [
        'FROM decisao_alerta d',
        [
          {
            prescricao_item_id: 11,
            chave_item: null,
            processo: 'dose',
            decisao: 'justificou',
            justificativa: 'J',
            regra_alerta_id: 5,
            versao_regra: 3,
          },
          {
            prescricao_item_id: null,
            chave_item: 'k9',
            processo: 'alergia',
            decisao: 'cancelou_item',
            justificativa: null,
            regra_alerta_id: null,
            versao_regra: 2,
          },
        ],
      ],
    ]);
    expect(await porta.decisoes(ctx, 1)).toEqual([
      { item: 11, chave: '11', tipo: 'dose', decisao: 'mantido', justificativa: 'J', regra: '5', versao: 3 },
      {
        item: null,
        chave: 'k9',
        tipo: 'alergia',
        decisao: 'retirado',
        justificativa: null,
        regra: '',
        versao: 2,
      },
    ]);
    expect(sqls.find((x) => x.includes('FROM decisao_alerta d'))).toContain('COALESCE(d.versao_regra');
  });

  it('futuras: hora local, prescrição só quando efetivada, filtro por estabelecimento e sem as da carga', async () => {
    const { porta, sqls } = dubleNucleo([
      [
        'FROM planejamento_prescricao f',
        [
          {
            id: 1,
            liberar_em: new Date('2026-11-24T10:00:00Z'),
            descricao: 'Dipirona',
            situacao: 'programada',
            prescricao_id: null,
            itens: '[]',
          },
          {
            id: 2,
            liberar_em: new Date('2026-11-25T10:00:00Z'),
            descricao: 'Outra',
            situacao: 'efetivada',
            prescricao_id: 99,
            itens: '[]',
          },
        ],
      ],
    ]);
    const r = await porta.futuras(ctx, 5);
    expect(r).toEqual([
      {
        id: 1,
        aPartirDe: '2026-11-24T07:00:00',
        descricao: 'Dipirona',
        situacao: 'programada',
        prescricao: null,
        itemJson: '[]',
      },
      {
        id: 2,
        aPartirDe: '2026-11-25T07:00:00',
        descricao: 'Outra',
        situacao: 'efetivada',
        prescricao: 99,
        itemJson: '[]',
      },
    ]);
    const sql = sqls.find((s) => s.includes('planejamento_prescricao')) ?? '';
    expect(sql).toContain('f.estabelecimento_id = ?');
    expect(sql).toContain("f.origem <> 'migracao'");
  });

  it('reconciliações: lote com as linhas dele, em ordem', async () => {
    const { porta } = dubleNucleo([
      ['FROM reconciliacao_medicamentosa r', [{ id: 3, momento: 'admissao', em: null, usuario: 'med1' }]],
      [
        'FROM reconciliacao_item',
        [
          {
            lote: 3,
            descricao: 'Losartana',
            item_prescritivel_id: null,
            dose: '50 mg',
            frequencia: '1x',
            fonte: 'paciente',
            conduta: 'manter',
            justificativa: null,
            prescricao_item_id: null,
          },
        ],
      ],
    ]);
    const [r] = await porta.reconciliacoes(ctx, 5);
    expect(r?.lote).toBe(3);
    expect(r?.usuario).toBe('med1');
    expect(r?.linhas).toHaveLength(1);
    expect(r?.linhas[0]?.conduta).toBe('manter');
  });

  it('grades: horários separados e autor pelo login', async () => {
    const { porta } = dubleNucleo([
      [
        'FROM grade_horario_classe g',
        [
          {
            id: 1,
            unidade_assistencial_id: 4,
            classe: '6/6h',
            doses_por_dia: 4,
            horarios: '06:00;12:00;18:00;24:00'.replace('24:00', '00:00'),
            vigente_desde: '2026-11-01',
            ativo: 1,
            login: 'adm',
          },
        ],
      ],
    ]);
    expect(await porta.grades(ctx)).toEqual([
      {
        id: 1,
        unidade: 4,
        classe: '6/6h',
        numDoses: 4,
        horarios: ['06:00', '12:00', '18:00', '00:00'],
        vigenteDesde: '2026-11-01',
        ativa: true,
        autor: 'adm',
      },
    ]);
  });

  it('podeGravar: sem profissional com conselho ativo, consulta com o motivo (falha fechada)', async () => {
    const { porta } = dubleNucleo([]);
    expect(await porta.podeGravar(ctx, 'pep.prescrever', 'ninguem')).toEqual({
      pode: false,
      codigo: 'profissional-sem-cbo',
      motivo: expect.any(String),
    });
  });

  it('gravação sem o profissional da sessão: 409 profissional-sem-cbo, nada gravado', async () => {
    const { porta } = dubleNucleo([]);
    await expect(
      porta.programarFutura(ctx, 'ninguem', {
        atendimento: 1,
        paciente: 1,
        aPartirDe: '2026-11-24T08:00',
        descricao: 'x',
        itemJson: '[]',
        motivo: null,
      }),
    ).rejects.toMatchObject({ problema: { status: 409, codigo: 'profissional-sem-cbo' } });
  });

  it('ficha e regra ainda sem adaptador: 501', async () => {
    const { porta } = dubleNucleo([]);
    await expect(porta.registrarFicha()).rejects.toMatchObject({ problema: { status: 501 } });
    await expect(porta.gravarRegra()).rejects.toMatchObject({ problema: { status: 501 } });
  });
});

// O tipo do executor fica referenciado para o dublê (o teste de unidade nunca grava).
export type _Executor = Executor;
