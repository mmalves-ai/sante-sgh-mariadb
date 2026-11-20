// Regra 4 do M55 (fatia F2) e as regras da rouparia: dados SINTÉTICOS (setores 901 a 903, peças 1 a 4).
import type { MovimentoRoupa, PecaRoupa, RegistrarMovimentoRoupaEntrada } from '@sgh/contratos';
import { esquemaRegistrarMovimentoRoupa, MENSAGENS_ROUPARIA } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  conferirCancelamentoRoupa,
  conferirMovimentoRoupa,
  conferirPecaRoupa,
  conferirRetornoRoupa,
  envioAberto,
  horasEntre,
  indicadoresRouparia,
  kgPorSetorDia,
  kgPorSetorNoPeriodo,
  normalizarMovimentoRoupa,
  pecasEmCirculacao,
  situacaoCotaSetor,
  totalPecas,
} from './rouparia.js';

const HOJE = '2026-10-28';
const ctx = {
  hoje: HOJE,
  pecasAtivas: new Set([1, 2, 3, 4]),
  setoresAtivos: new Set([901, 902, 903]),
};
const mov = (x: Partial<RegistrarMovimentoRoupaEntrada> & { tipo: RegistrarMovimentoRoupaEntrada['tipo'] }) =>
  esquemaRegistrarMovimentoRoupa.parse({ chave: 'teste-rouparia-1', data: HOJE, ...x });
const codigos = (r: { codigo: string }[]) => r.map((x) => x.codigo);

let seq = 0;
const linha = (x: Partial<MovimentoRoupa> & Pick<MovimentoRoupa, 'tipo'>): MovimentoRoupa => ({
  id: ++seq,
  data: HOJE,
  em: `${HOJE}T08:00:00`,
  centroCusto: null,
  remessa: null,
  pesoKg: null,
  pecas: 0,
  itens: [],
  lavanderia: null,
  fornecedor: null,
  motivoPerda: null,
  diferencaKg: null,
  diferencaPct: null,
  ocorrencia: false,
  observacao: null,
  situacao: 'registrado',
  por: 'SINT.ROUPARIA',
  canceladoPor: null,
  canceladoEm: null,
  motivoCancelamento: null,
  versao: 1,
  ...x,
});

describe('o que cada movimento pede', () => {
  it('a coleta: setor ativo e peso; as peças são opcionais', () => {
    expect(conferirMovimentoRoupa(mov({ tipo: 'coleta', centroCusto: 901, pesoKg: 12.5 }), ctx)).toEqual([]);
    expect(codigos(conferirMovimentoRoupa(mov({ tipo: 'coleta' }), ctx))).toEqual([
      'setor-obrigatorio',
      'peso-obrigatorio',
    ]);
    expect(
      codigos(conferirMovimentoRoupa(mov({ tipo: 'coleta', centroCusto: 999, pesoKg: 1 }), ctx)),
    ).toEqual(['setor-inativo']);
  });

  it('as datas: nem futura nem mais antiga que 31 dias', () => {
    const base = { tipo: 'coleta' as const, centroCusto: 901, pesoKg: 1 };
    expect(codigos(conferirMovimentoRoupa(mov({ ...base, data: '2026-10-29' }), ctx))).toEqual([
      'data-futura',
    ]);
    expect(codigos(conferirMovimentoRoupa(mov({ ...base, data: '2026-09-26' }), ctx))).toEqual([
      'data-antiga',
    ]);
    expect(conferirMovimentoRoupa(mov({ ...base, data: '2026-09-27' }), ctx)).toEqual([]);
  });

  it('o envio: sem setor, com peso e lavanderia; a terceirizada pede o fornecedor que existe', () => {
    const e = { tipo: 'envio' as const, pesoKg: 80 };
    expect(conferirMovimentoRoupa(mov({ ...e, lavanderia: 'propria' }), ctx)).toEqual([]);
    expect(codigos(conferirMovimentoRoupa(mov({ ...e, centroCusto: 901 }), ctx))).toEqual([
      'setor-nao-se-aplica',
      'lavanderia-obrigatoria',
    ]);
    expect(codigos(conferirMovimentoRoupa(mov({ ...e, lavanderia: 'terceirizada' }), ctx))).toEqual([
      'fornecedor-obrigatorio',
    ]);
    expect(
      codigos(
        conferirMovimentoRoupa(mov({ ...e, lavanderia: 'terceirizada', fornecedor: 7 }), {
          ...ctx,
          fornecedorExiste: false,
        }),
      ),
    ).toEqual(['fornecedor-inexistente']);
  });

  it('o retorno: o envio que existe, aberto e de data anterior', () => {
    const r = { tipo: 'retorno' as const, pesoKg: 78, remessa: 10 };
    const envio = { tipo: 'envio' as const, situacao: 'registrado' as const, data: '2026-10-27' };
    expect(conferirMovimentoRoupa(mov(r), { ...ctx, remessa: envio })).toEqual([]);
    expect(codigos(conferirMovimentoRoupa(mov({ ...r, remessa: null }), ctx))).toEqual([
      'remessa-obrigatoria',
    ]);
    expect(codigos(conferirMovimentoRoupa(mov(r), { ...ctx, remessa: null }))).toEqual([
      'remessa-inexistente',
    ]);
    expect(
      codigos(conferirMovimentoRoupa(mov(r), { ...ctx, remessa: { ...envio, tipo: 'coleta' } })),
    ).toEqual(['remessa-inexistente']);
    expect(
      codigos(conferirMovimentoRoupa(mov(r), { ...ctx, remessa: { ...envio, situacao: 'cancelado' } })),
    ).toEqual(['remessa-cancelada']);
    expect(
      codigos(conferirMovimentoRoupa(mov(r), { ...ctx, remessa: { ...envio, situacao: 'retornado' } })),
    ).toEqual(['remessa-ja-retornada']);
    expect(
      codigos(conferirMovimentoRoupa(mov({ ...r, data: '2026-10-26' }), { ...ctx, remessa: envio })),
    ).toEqual(['retorno-antes-do-envio']);
  });

  it('a entrega, a perda e o inventário: as peças do cadastro, sem repetir; zero só no inventário', () => {
    expect(
      conferirMovimentoRoupa(
        mov({ tipo: 'entrega', centroCusto: 902, itens: [{ peca: 1, quantidade: 20 }] }),
        ctx,
      ),
    ).toEqual([]);
    expect(codigos(conferirMovimentoRoupa(mov({ tipo: 'entrega', centroCusto: 902 }), ctx))).toEqual([
      'pecas-obrigatorias',
    ]);
    expect(
      codigos(
        conferirMovimentoRoupa(
          mov({
            tipo: 'entrega',
            centroCusto: 902,
            itens: [
              { peca: 1, quantidade: 2 },
              { peca: 1, quantidade: 3 },
              { peca: 9, quantidade: 0 },
            ],
          }),
          ctx,
        ),
      ),
    ).toEqual(['peca-repetida', 'peca-inexistente', 'quantidade-zero']);
    expect(
      codigos(conferirMovimentoRoupa(mov({ tipo: 'perda', itens: [{ peca: 2, quantidade: 1 }] }), ctx)),
    ).toEqual(['motivo-obrigatorio']);
    expect(
      conferirMovimentoRoupa(mov({ tipo: 'inventario', itens: [{ peca: 2, quantidade: 0 }] }), ctx),
    ).toEqual([]);
  });

  it('toda recusa tem o texto da tela', () => {
    const r = conferirMovimentoRoupa(mov({ tipo: 'coleta' }), ctx);
    for (const x of r) expect(x.mensagem).toBe(MENSAGENS_ROUPARIA[x.codigo]);
  });

  it('normalizar: o que o tipo não aceita vira nulo e as peças ficam em ordem', () => {
    const n = normalizarMovimentoRoupa(
      mov({
        tipo: 'envio',
        centroCusto: 901,
        pesoKg: 10,
        lavanderia: 'propria',
        fornecedor: 7,
        motivoPerda: 'dano',
        remessa: 3,
        itens: [
          { peca: 3, quantidade: 1 },
          { peca: 1, quantidade: 2 },
        ],
      }),
    );
    expect(n).toMatchObject({ centroCusto: null, fornecedor: null, motivoPerda: null, remessa: null });
    expect(n.itens.map((i) => i.peca)).toEqual([1, 3]);
    expect(
      normalizarMovimentoRoupa(mov({ tipo: 'envio', pesoKg: 1, lavanderia: 'terceirizada', fornecedor: 7 }))
        .fornecedor,
    ).toBe(7);
    expect(totalPecas(n.itens)).toBe(3);
  });
});

describe('a conferência do retorno com o envio', () => {
  it('dentro da tolerância: sem ocorrência', () => {
    const c = conferirRetornoRoupa({ pesoKg: 100, itens: [] }, { pesoKg: 97, itens: [] }, 5);
    expect(c).toMatchObject({ diferencaKg: 3, diferencaPct: 3, ocorrencia: false, pecasFaltando: [] });
  });

  it('acima da tolerância e com peças faltando: a ocorrência com as parcelas', () => {
    const c = conferirRetornoRoupa(
      {
        pesoKg: 100,
        itens: [
          { peca: 1, quantidade: 50 },
          { peca: 2, quantidade: 30 },
        ],
      },
      {
        pesoKg: 92.5,
        itens: [
          { peca: 1, quantidade: 48 },
          { peca: 2, quantidade: 30 },
        ],
      },
      5,
    );
    expect(c.diferencaKg).toBe(7.5);
    expect(c.diferencaPct).toBe(7.5);
    expect(c.ocorrencia).toBe(true);
    expect(c.pecasFaltando).toEqual([{ peca: 1, enviadas: 50, retornadas: 48, faltam: 2 }]);
    expect(c.motivos[0]).toMatch(/7,5 kg \(7,50% de 100 kg enviados\) acima da tolerância de 5%/);
    expect(c.motivos[1]).toMatch(/2 peça/);
  });

  it('o retorno mais pesado (roupa úmida) também conta pela diferença absoluta; sem peças contadas, sem faltas', () => {
    const c = conferirRetornoRoupa(
      { pesoKg: 50, itens: [{ peca: 1, quantidade: 10 }] },
      { pesoKg: 56, itens: [] },
      5,
    );
    expect(c.diferencaKg).toBe(-6);
    expect(c.ocorrencia).toBe(true);
    expect(c.pecasFaltando).toEqual([]);
    expect(conferirRetornoRoupa({ pesoKg: 0, itens: [] }, { pesoKg: 0, itens: [] }, 0).diferencaPct).toBe(0);
  });
});

describe('regra 4: kg de roupa por setor e por dia para o custeio', () => {
  const coletas = [
    linha({ tipo: 'coleta', centroCusto: 901, pesoKg: 10.2, data: '2026-10-27' }),
    linha({ tipo: 'coleta', centroCusto: 901, pesoKg: 4.3, data: '2026-10-27' }),
    linha({ tipo: 'coleta', centroCusto: 902, pesoKg: 8, data: '2026-10-27' }),
    linha({ tipo: 'coleta', centroCusto: 901, pesoKg: 9, data: '2026-10-28' }),
    linha({ tipo: 'coleta', centroCusto: 901, pesoKg: 99, data: '2026-10-28', situacao: 'cancelado' }),
    linha({ tipo: 'envio', pesoKg: 30 }),
  ];

  it('soma por dia e setor, sem as canceladas nem os outros movimentos', () => {
    expect(kgPorSetorDia(coletas)).toEqual([
      { data: '2026-10-27', centroCusto: 901, kg: 14.5, coletas: 2 },
      { data: '2026-10-27', centroCusto: 902, kg: 8, coletas: 1 },
      { data: '2026-10-28', centroCusto: 901, kg: 9, coletas: 1 },
    ]);
  });

  it('o total do setor no período com as parcelas por dia (maior primeiro)', () => {
    expect(kgPorSetorNoPeriodo(kgPorSetorDia(coletas))).toEqual([
      {
        centroCusto: 901,
        kg: 23.5,
        coletas: 3,
        dias: [
          { data: '2026-10-27', kg: 14.5 },
          { data: '2026-10-28', kg: 9 },
        ],
      },
      { centroCusto: 902, kg: 8, coletas: 1, dias: [{ data: '2026-10-27', kg: 8 }] },
    ]);
  });
});

describe('indicadores com as parcelas', () => {
  const base = {
    de: '2026-10-01',
    ate: '2026-10-28',
    kgColetados: 1200,
    kgEnviados: 1150,
    kgRetornados: 1120,
    pacientesDia: 400,
    pecasPerdidas: 12,
    pecasEmCirculacao: 1500,
    precoKgCentavos: 450,
    retornos: 20,
    ocorrencias: 2,
  };

  it('kg por paciente-dia, índice de perda e custo por paciente-dia', () => {
    const i = indicadoresRouparia(base);
    expect(i.kgPorPacienteDia).toMatchObject({ valor: 3, numerador: 1200, denominador: 400 });
    expect(i.kgPorPacienteDia.conta).toBe(
      '1.200 kg coletados ÷ 400 pacientes-dia = 3,00 kg por paciente-dia.',
    );
    expect(i.indicePerda).toMatchObject({ valor: 0.8, numerador: 12, denominador: 1500 });
    expect(i.custoPorPacienteDia).toMatchObject({ valor: 12.94, numerador: 5175, precoKgCentavos: 450 });
    expect(i.custoPorPacienteDia.conta).toMatch(/1\.150 kg enviados × R\$ 4,50 = R\$ 5\.175,00 ÷ 400/);
    expect(i).toMatchObject({ ocorrencias: 2, retornos: 20 });
  });

  it('sem denominador ou sem preço: o valor fica nulo e a conta diz por quê', () => {
    const i = indicadoresRouparia({ ...base, pacientesDia: 0, pecasEmCirculacao: 0 });
    expect(i.kgPorPacienteDia.valor).toBeNull();
    expect(i.kgPorPacienteDia.conta).toMatch(/sem pacientes-dia/);
    expect(i.indicePerda.valor).toBeNull();
    expect(i.indicePerda.conta).toMatch(/sem inventário/);
    expect(i.custoPorPacienteDia.valor).toBeNull();
    expect(i.custoPorPacienteDia.conta).toMatch(/sem pacientes-dia/);
    const semPreco = indicadoresRouparia({ ...base, precoKgCentavos: 0 });
    expect(semPreco.custoPorPacienteDia.valor).toBeNull();
    expect(semPreco.custoPorPacienteDia.conta).toMatch(/não informado/);
  });
});

describe('peças em circulação e a cota do setor', () => {
  const movs = [
    linha({
      id: 100,
      tipo: 'inventario',
      centroCusto: 901,
      data: '2026-10-20',
      itens: [{ peca: 1, quantidade: 30 }],
    }),
    linha({
      id: 101,
      tipo: 'inventario',
      centroCusto: 901,
      data: '2026-10-25',
      itens: [
        { peca: 1, quantidade: 20 },
        { peca: 2, quantidade: 5 },
      ],
    }),
    linha({
      id: 102,
      tipo: 'inventario',
      centroCusto: null,
      data: '2026-10-25',
      itens: [{ peca: 1, quantidade: 200 }],
    }),
    linha({
      id: 103,
      tipo: 'inventario',
      centroCusto: 902,
      data: '2026-10-26',
      itens: [{ peca: 1, quantidade: 9 }],
      situacao: 'cancelado',
    }),
    linha({
      id: 104,
      tipo: 'entrega',
      centroCusto: 901,
      data: '2026-10-26',
      itens: [{ peca: 1, quantidade: 15 }],
    }),
    linha({
      id: 105,
      tipo: 'coleta',
      centroCusto: 901,
      data: '2026-10-27',
      pesoKg: 5,
      itens: [{ peca: 1, quantidade: 12 }],
    }),
    linha({
      id: 106,
      tipo: 'perda',
      centroCusto: 901,
      data: '2026-10-27',
      itens: [{ peca: 2, quantidade: 1 }],
      motivoPerda: 'dano',
    }),
    linha({
      id: 107,
      tipo: 'entrega',
      centroCusto: 901,
      data: '2026-10-24',
      itens: [{ peca: 1, quantidade: 99 }],
    }),
  ];

  it('o último inventário de cada local, sem os cancelados', () => {
    expect(pecasEmCirculacao(movs)).toBe(225);
  });

  it('o estimado no setor e a reposição até a cota, com a conta', () => {
    const s = situacaoCotaSetor(
      901,
      [
        { centroCusto: 901, peca: 1, quantidade: 30, versao: 1 },
        { centroCusto: 901, peca: 2, quantidade: 3, versao: 1 },
        { centroCusto: 901, peca: 3, quantidade: 0, versao: 1 },
        { centroCusto: 902, peca: 1, quantidade: 10, versao: 1 },
      ],
      movs,
    );
    expect(s.inventarioEm).toBe('2026-10-25');
    expect(s.itens).toEqual([
      {
        peca: 1,
        cota: 30,
        estimado: 23,
        reposicao: 7,
        conta: 'inventário 20 + entregues 15 − coletadas 12 − perdidas 0 = 23; cota 30 − 23 = repor 7.',
      },
      {
        peca: 2,
        cota: 3,
        estimado: 4,
        reposicao: 0,
        conta: 'inventário 5 + entregues 0 − coletadas 0 − perdidas 1 = 4; cota 3 − 4 = repor 0.',
      },
    ]);
    const sem = situacaoCotaSetor(903, [{ centroCusto: 903, peca: 1, quantidade: 4, versao: 1 }], movs);
    expect(sem.inventarioEm).toBeNull();
    expect(sem.itens[0]).toMatchObject({ estimado: 0, reposicao: 4 });
    expect(sem.itens[0]!.conta).toMatch(/^sem inventário: 0/);
  });
});

describe('envio aberto e cancelamento', () => {
  it('horas e atraso pelo prazo', () => {
    expect(horasEntre('2026-10-26T08:00', '2026-10-28T09:30:00')).toBe(49);
    expect(horasEntre('2026-10-28T09:00:00', '2026-10-28T08:00:00')).toBe(0);
    const e = linha({
      tipo: 'envio',
      em: '2026-10-26T08:00:00',
      pesoKg: 40,
      pecas: 0,
      lavanderia: 'propria',
    });
    expect(envioAberto(e, '2026-10-28T09:00:00', 48)).toMatchObject({
      horasDesdeEnvio: 49,
      atrasado: true,
      pesoKg: 40,
    });
    expect(envioAberto({ ...e, pesoKg: null }, '2026-10-27T09:00:00', 48)).toMatchObject({
      atrasado: false,
      pesoKg: 0,
    });
  });

  it('só o movimento vivo, na versão vista, no prazo; o envio só sem o retorno', () => {
    const m = linha({ tipo: 'coleta', em: '2026-10-28T08:00:00' });
    const c = { agora: '2026-10-28T10:00:00', prazoHoras: 24, versaoVista: 1 };
    expect(conferirCancelamentoRoupa(m, c)).toBeNull();
    expect(conferirCancelamentoRoupa(null, c)?.codigo).toBe('movimento-inexistente');
    expect(conferirCancelamentoRoupa({ ...m, situacao: 'cancelado' }, c)?.codigo).toBe('movimento-cancelado');
    expect(conferirCancelamentoRoupa(m, { ...c, versaoVista: 2 })?.codigo).toBe('versao-desatualizada');
    expect(conferirCancelamentoRoupa({ ...m, tipo: 'envio', situacao: 'retornado' }, c)?.codigo).toBe(
      'envio-com-retorno',
    );
    expect(conferirCancelamentoRoupa(m, { ...c, agora: '2026-10-29T09:00:00' })?.codigo).toBe(
      'fora-do-prazo-de-cancelamento',
    );
  });
});

describe('peças e kits do enxoval', () => {
  const pecas: PecaRoupa[] = [
    {
      id: 1,
      nome: 'Lençol de solteiro',
      categoria: 'lencol',
      pesoGramas: 600,
      custoReposicaoCentavos: 3500,
      composicao: [],
      ativa: true,
      versao: 2,
    },
    {
      id: 2,
      nome: 'Fronha',
      categoria: 'fronha',
      pesoGramas: 150,
      custoReposicaoCentavos: null,
      composicao: [],
      ativa: true,
      versao: 1,
    },
    {
      id: 3,
      nome: 'Kit leito',
      categoria: 'kit',
      pesoGramas: 1500,
      custoReposicaoCentavos: null,
      composicao: [{ peca: 1, quantidade: 2 }],
      ativa: true,
      versao: 1,
    },
    {
      id: 4,
      nome: 'Cobertor antigo',
      categoria: 'cobertor',
      pesoGramas: 1200,
      custoReposicaoCentavos: null,
      composicao: [],
      ativa: false,
      versao: 1,
    },
  ];
  const e = (x: Record<string, unknown>) => ({
    nome: 'Toalha de banho',
    categoria: 'toalha' as const,
    pesoGramas: 500,
    custoReposicaoCentavos: null,
    composicao: [],
    ativa: true,
    versaoVista: null,
    ...x,
  });

  it('nome único entre as ativas (sem diferença de caixa) e a versão vista', () => {
    expect(conferirPecaRoupa(e({}), { id: null, pecas })).toEqual([]);
    expect(codigos(conferirPecaRoupa(e({ nome: 'FRONHA' }), { id: null, pecas }))).toEqual([
      'nome-duplicado',
    ]);
    expect(conferirPecaRoupa(e({ nome: 'Cobertor antigo' }), { id: null, pecas })).toEqual([]);
    expect(
      conferirPecaRoupa(e({ nome: 'Fronha', categoria: 'fronha', versaoVista: 1 }), { id: 2, pecas }),
    ).toEqual([]);
    expect(codigos(conferirPecaRoupa(e({ nome: 'Fronha', versaoVista: 9 }), { id: 2, pecas }))).toEqual([
      'versao-desatualizada',
    ]);
  });

  it('o kit: composição de peças ativas, sem kit dentro; só o kit tem composição', () => {
    const kit = (composicao: unknown[]) => e({ nome: 'Kit novo', categoria: 'kit', composicao });
    expect(
      conferirPecaRoupa(
        kit([
          { peca: 1, quantidade: 2 },
          { peca: 2, quantidade: 1 },
        ]),
        { id: null, pecas },
      ),
    ).toEqual([]);
    expect(codigos(conferirPecaRoupa(kit([]), { id: null, pecas }))).toEqual(['kit-sem-composicao']);
    expect(codigos(conferirPecaRoupa(kit([{ peca: 3, quantidade: 1 }]), { id: null, pecas }))).toEqual([
      'kit-dentro-de-kit',
    ]);
    expect(codigos(conferirPecaRoupa(kit([{ peca: 4, quantidade: 1 }]), { id: null, pecas }))).toEqual([
      'peca-inexistente',
    ]);
    expect(
      codigos(conferirPecaRoupa(e({ composicao: [{ peca: 1, quantidade: 1 }] }), { id: null, pecas })),
    ).toEqual(['composicao-so-de-kit']);
  });
});
