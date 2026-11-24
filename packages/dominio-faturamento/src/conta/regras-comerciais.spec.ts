import { describe, expect, it } from 'vitest';
import {
  calcularDescontoVolume,
  calcularFranquia,
  cobrancaLigacao,
  cobrancaRemocao,
  escolherRegraConta,
  type FranquiaContrato,
  motivoFranquiaNaoVale,
  periodoDaQuebra,
  type RegraCriacaoConta,
  tipoDaLigacao,
  validarFaixasDesconto,
  validarFranquia,
  validarRegraConta,
} from './regras-comerciais.js';

const regra = (o: Partial<RegraCriacaoConta> & { id: number }): RegraCriacaoConta => ({
  acao: 'criar_conta',
  fonteDestino: 9,
  prioridade: 100,
  vigenciaInicio: '2026-01-01',
  ativo: true,
  ...o,
});

describe('06-FAT linha 13: criação e quebra de contas por regra', () => {
  it('valida o cadastro: destino, quebra sem critério, plano sem fonte e exceção vazia', () => {
    expect(validarRegraConta({ acao: 'criar_conta', vigenciaInicio: '2026-01-01' })).toHaveProperty(
      'fonteDestino',
    );
    expect(validarRegraConta({ acao: 'quebrar_conta', vigenciaInicio: '2026-01-01' })).toHaveProperty(
      'periodicidade',
    );
    expect(
      validarRegraConta({ acao: 'quebrar_conta', periodicidade: 'mensal', vigenciaInicio: '2026-01-01' }),
    ).toEqual({});
    expect(validarRegraConta({ ...regra({ id: 1 }), planoOrigem: 3 })).toHaveProperty('planoOrigem');
    expect(validarRegraConta({ ...regra({ id: 1 }), excecoes: [{}] })).toHaveProperty('excecoes.0');
  });

  it('escolhe pela prioridade, depois pela mais específica; exceção, vigência e inativa afastam', () => {
    const regras = [
      regra({ id: 1, origemEntrada: 5 }),
      regra({ id: 2, origemEntrada: 5, setor: 7, fonteDestino: 10 }),
      regra({ id: 3, setor: 7, prioridade: 50, excecoes: [{ categoriaAtendimento: 2 }] }),
      regra({ id: 4, vigenciaInicio: '2027-01-01', prioridade: 1 }),
      regra({ id: 5, ativo: false, prioridade: 1 }),
    ];
    const s = { data: '2026-03-10', origemEntrada: 5, setor: 7, categoriaAtendimento: 2 };
    const e = escolherRegraConta(regras, s);
    expect(e.regra?.id).toBe(2);
    expect(e.avaliadas.find((a) => a.id === 3)?.motivo).toBe('excecao');
    expect(e.avaliadas.find((a) => a.id === 4)?.motivo).toBe('fora_da_vigencia');
    expect(e.avaliadas.find((a) => a.id === 5)?.motivo).toBe('inativa');
    expect(escolherRegraConta(regras, { ...s, categoriaAtendimento: 1 }).regra?.id).toBe(3);
    expect(escolherRegraConta(regras, { data: '2026-03-10', origemEntrada: 6 }).regra).toBeNull();
  });

  it('quebra por período: diária, semanal (segunda a domingo), quinzenal e mensal', () => {
    expect(periodoDaQuebra('diaria', '2026-02-11')).toEqual({ inicio: '2026-02-11', fim: '2026-02-11' });
    expect(periodoDaQuebra('semanal', '2026-02-11')).toEqual({ inicio: '2026-02-09', fim: '2026-02-15' });
    expect(periodoDaQuebra('quinzenal', '2026-02-16')).toEqual({ inicio: '2026-02-16', fim: '2026-02-28' });
    expect(periodoDaQuebra('mensal', '2028-02-03')).toEqual({ inicio: '2028-02-01', fim: '2028-02-29' });
    const e = escolherRegraConta(
      [regra({ id: 1, acao: 'quebrar_conta', fonteDestino: null, periodicidade: 'quinzenal' })],
      { data: '2026-05-03' },
      'quebrar_conta',
    );
    expect(e.periodo).toEqual({ inicio: '2026-05-01', fim: '2026-05-15' });
  });
});

describe('06-FAT linha 19: desconto por volume e franquia', () => {
  const faixas = [
    { sequencia: 1, volumeInicial: 0, volumeFinal: 10000, tipo: 'percentual' as const, percentual: 0 },
    { sequencia: 2, volumeInicial: 10000, volumeFinal: null, tipo: 'percentual' as const, percentual: 5 },
    {
      sequencia: 3,
      volumeInicial: 10000,
      volumeFinal: null,
      tipo: 'percentual' as const,
      percentual: 10,
      grupo: 4,
    },
  ];
  it('valida faixas: sobreposição no mesmo alvo, final menor que inicial e percentual fora', () => {
    expect(validarFaixasDesconto(faixas)).toEqual({});
    expect(
      validarFaixasDesconto([
        ...faixas,
        { sequencia: 4, volumeInicial: 5000, volumeFinal: 20000, tipo: 'percentual', percentual: 1 },
      ]),
    ).toHaveProperty('faixas.3.volumeInicial');
    expect(
      validarFaixasDesconto([
        { sequencia: 1, volumeInicial: 10, volumeFinal: 5, tipo: 'percentual', percentual: 120 },
      ]),
    ).toMatchObject({
      'faixas.0.volumeFinal': expect.any(String),
      'faixas.0.percentual': expect.any(String),
    });
  });

  it('faixa do volume; a do grupo vale para o grupo e a geral para o resto', () => {
    const linhas = [
      { valor: 1000, grupo: 4 },
      { valor: 500, grupo: 2 },
    ];
    expect(calcularDescontoVolume(faixas, 9000, linhas).desconto).toBe(0);
    const d = calcularDescontoVolume(faixas, 12000, linhas);
    expect(d.desconto).toBe(125);
    expect(d.faixas).toEqual([
      { sequencia: 2, base: 500, desconto: 25 },
      { sequencia: 3, base: 1000, desconto: 100 },
    ]);
    const fixo = [{ sequencia: 1, volumeInicial: 0, volumeFinal: null, tipo: 'valor' as const, valor: 900 }];
    expect(calcularDescontoVolume(fixo, 1, [{ valor: 300 }]).desconto).toBe(300);
  });

  const franquia: FranquiaContrato = {
    id: 1,
    tipo: 'valor',
    valorFranquia: 200,
    aplicaTitular: true,
    aplicaDependente: true,
    aplicaPensionista: false,
    idadeMinima: 18,
    vigenciaInicio: '2026-01-01',
    ativo: true,
    excecoes: [
      { item: 77, aplicaTitular: true, aplicaDependente: true, aplicaPensionista: true, ativo: true },
    ],
  };
  const sit = { data: '2026-04-01', vinculo: 'titular' as const, idade: 40 };
  const itens = [
    { item: 1, grupo: 4, quantidade: 2, valor: 150 },
    { item: 77, grupo: 4, quantidade: 1, valor: 900 },
    { item: 2, grupo: 5, quantidade: 3, valor: 30 },
  ];
  it('valida a franquia e diz por que não vale (vínculo, idade, vigência)', () => {
    expect(validarFranquia({ ...franquia, valorFranquia: null })).toHaveProperty('valorFranquia');
    expect(validarFranquia({ ...franquia, tipo: 'quantidade' })).toHaveProperty('quantidadePontos');
    expect(validarFranquia(franquia)).toEqual({});
    expect(motivoFranquiaNaoVale(franquia, { ...sit, vinculo: 'pensionista' })).toBe('vinculo_nao_coberto');
    expect(motivoFranquiaNaoVale(franquia, { ...sit, idade: 10 })).toBe('fora_da_idade');
    expect(motivoFranquiaNaoVale(franquia, { ...sit, data: '2025-12-31' })).toBe('fora_da_vigencia');
    expect(motivoFranquiaNaoVale(franquia, sit)).toBeNull();
  });
  it('calcula a franquia em valor, quantidade e percentual, sem o item excetuado e nunca acima da base', () => {
    expect(calcularFranquia(franquia, sit, itens)).toEqual({
      base: 180,
      quantidade: 5,
      valor: 180,
      itensConsiderados: [1, 2],
    });
    expect(
      calcularFranquia({ ...franquia, tipo: 'quantidade', quantidadePontos: 4, valorPonto: 10 }, sit, itens)
        .valor,
    ).toBe(40);
    expect(
      calcularFranquia(
        { ...franquia, tipo: 'percentual', percentualParticipacao: 10, valorParticipacao: 5, grupo: 4 },
        sit,
        itens,
      ),
    ).toMatchObject({ base: 150, valor: 20 });
  });
});

describe('06-FAT linha 23: ambulância e ligação tarifada', () => {
  const regras = [
    { id: 1, fonte: null, categoria: 3, forma: 'quilometro' as const, rota: null, item: 50, ativo: true },
    { id: 2, fonte: 8, categoria: 3, forma: 'quilometro' as const, rota: null, item: 51, ativo: true },
    { id: 3, fonte: null, categoria: 3, forma: 'trajeto' as const, rota: 11, item: 52, ativo: true },
  ];
  it('trajeto com regra cobra 1; senão por km, a da fonte antes da padrão; volta dobra o trajeto de ida', () => {
    const rota = { id: 11, distanciaKm: 12.5, idaEVolta: false };
    expect(cobrancaRemocao(regras, { fonte: 8, categoria: 3, rota })).toMatchObject({
      quantidade: 1,
      regra: { id: 3 },
    });
    expect(cobrancaRemocao(regras, { fonte: 8, categoria: 3, km: 30 })).toMatchObject({
      quantidade: 30,
      regra: { id: 2 },
    });
    expect(
      cobrancaRemocao(regras, { fonte: 9, categoria: 3, rota: { ...rota, id: 12 }, comVolta: true }),
    ).toMatchObject({ quantidade: 25, regra: { id: 1 } });
    expect(cobrancaRemocao(regras, { fonte: 9, categoria: 3 }).erros).toHaveProperty('km');
    expect(cobrancaRemocao(regras, { fonte: 9, categoria: 4, km: 3 }).regra).toBeNull();
  });
  it('ligação: minuto iniciado, segundo, valor do tarifador, tipo não cobrável e sem duração', () => {
    const r = { id: 1, itemMinuto: 60, itemSegundo: null, assumeValorTarifador: false, ativo: true };
    expect(cobrancaLigacao(r, true, { duracaoSegundos: 61, valorTarifador: null })).toMatchObject({
      item: 60,
      quantidade: 2,
    });
    expect(
      cobrancaLigacao({ ...r, itemMinuto: null, itemSegundo: 61 }, true, {
        duracaoSegundos: 61,
        valorTarifador: null,
      }),
    ).toMatchObject({ item: 61, quantidade: 61 });
    expect(
      cobrancaLigacao({ ...r, assumeValorTarifador: true }, true, {
        duracaoSegundos: 30,
        valorTarifador: 2.456,
      }),
    ).toMatchObject({ quantidade: 1, unitario: 2.46 });
    expect(cobrancaLigacao(r, false, { duracaoSegundos: 30, valorTarifador: null }).motivo).toBe(
      'tipo_nao_cobravel',
    );
    expect(cobrancaLigacao(r, true, { duracaoSegundos: 0, valorTarifador: null }).motivo).toBe('sem_duracao');
    expect(cobrancaLigacao(null, true, { duracaoSegundos: 9, valorTarifador: null }).motivo).toBe(
      'sem_regra',
    );
    expect(tipoDaLigacao('celular_local')).toBe('celular');
    expect(tipoDaLigacao('interurbano')).toBe('interurbana');
  });
});
