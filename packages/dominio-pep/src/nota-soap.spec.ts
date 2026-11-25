import { describe, expect, it } from 'vitest';
import {
  acaoNotaSoap,
  cidsSugeridos,
  CONFIGURACAO_NOTA_SOAP_PADRAO,
  type ConfiguracaoNotaSoap,
  configuracaoNotaAplicavel,
  gestacaoPelaDum,
  idadeGestacionalTexto,
  type NotaSoapEntrada,
  type TermoCodigoNota,
  textoNotaSoap,
  validarConfiguracaoNota,
  validarNotaSoap,
} from './nota-soap.js';

const cfg = (o: Partial<ConfiguracaoNotaSoap> = {}): ConfiguracaoNotaSoap => ({
  ...CONFIGURACAO_NOTA_SOAP_PADRAO,
  id: 1,
  ...o,
});
const termos = new Map<number, TermoCodigoNota>([
  [10, { id: 10, sistema: 'ciap2', codigo: 'K86', ativo: true }],
  [11, { id: 11, sistema: 'ciap2', codigo: 'K85', ativo: false }],
  [20, { id: 20, sistema: 'cid10', codigo: 'I10', ativo: true }],
  [21, { id: 21, sistema: 'cid10', codigo: 'I15', ativo: true }],
]);
const nota = (o: Partial<NotaSoapEntrada> = {}): NotaSoapEntrada => ({
  tipo: 'consulta',
  subjetivo: 'Cefaleia há dois dias.',
  objetivo: null,
  avaliacao: 'Hipertensão.',
  plano: 'Retorno em 30 dias.',
  criticidade: null,
  dataUltimaMenstruacao: null,
  edema: null,
  codigos: [{ parte: 'avaliacao', ciapId: null, cidId: 20, incluirListaProblemas: true }],
  ...o,
});
const AGORA = new Date('2026-11-25T12:00:00Z');
const codigos = (v: { falhas: { codigo: string }[] }) => v.falhas.map((f) => f.codigo);

describe('configuração aplicável da nota', () => {
  const lista = [
    cfg({ id: 1 }),
    cfg({ id: 2, estabelecimentoId: 5 }),
    cfg({ id: 3, especialidadeId: 7 }),
    cfg({ id: 4, estabelecimentoId: 5, especialidadeId: 7 }),
    cfg({ id: 5, estabelecimentoId: 5, especialidadeId: 8, ativo: false }),
  ];
  it('a mais específica vence; a inativa e a de outro escopo não valem', () => {
    expect(configuracaoNotaAplicavel(lista, 5, 7).id).toBe(4);
    expect(configuracaoNotaAplicavel(lista, 6, 7).id).toBe(3);
    expect(configuracaoNotaAplicavel(lista, 5, 8).id).toBe(2);
    expect(configuracaoNotaAplicavel(lista, 6, null).id).toBe(1);
    expect(configuracaoNotaAplicavel([], 6, null)).toBe(CONFIGURACAO_NOTA_SOAP_PADRAO);
  });
  it('recusa configuração sem parte obrigatória e CID obrigatório sem avaliação', () => {
    const base = { ...cfg(), descricao: 'Ambulatório' };
    expect(validarConfiguracaoNota(base)).toEqual([]);
    expect(
      validarConfiguracaoNota({
        ...base,
        descricao: ' ',
        exigeAvaliacao: false,
        exigePlano: false,
        exigeCidAvaliacao: true,
      }).map((f) => f.codigo),
    ).toEqual(['descricao-obrigatoria', 'configuracao-sem-parte', 'cid-sem-avaliacao']);
  });
});

describe('validação da nota', () => {
  it('o rascunho aceita a nota parcial e recusa a vazia', () => {
    expect(
      codigos(
        validarNotaSoap(
          nota({ avaliacao: null, plano: null, codigos: [] }),
          cfg(),
          termos,
          'rascunho',
          AGORA,
        ),
      ),
    ).toEqual([]);
    expect(
      codigos(
        validarNotaSoap(
          nota({ subjetivo: ' ', avaliacao: null, plano: null, codigos: [] }),
          cfg(),
          termos,
          'rascunho',
          AGORA,
        ),
      ),
    ).toEqual(['nota-vazia']);
  });
  it('na assinatura exige as partes da configuração e o CID-10 na avaliação', () => {
    expect(codigos(validarNotaSoap(nota(), cfg(), termos, 'assinatura', AGORA))).toEqual([]);
    const v = validarNotaSoap(
      nota({
        plano: null,
        codigos: [{ parte: 'plano', ciapId: null, cidId: 21, incluirListaProblemas: false }],
      }),
      cfg({ exigeObjetivo: true }),
      termos,
      'assinatura',
      AGORA,
    );
    // o plano tem código: conta como preenchido; o objetivo falta; a avaliação não tem CID
    expect(codigos(v)).toEqual(['parte-obrigatoria', 'avaliacao-sem-cid']);
    expect(v.falhas[0]!.mensagem).toContain('objetivo');
    expect(
      codigos(
        validarNotaSoap(
          nota({ codigos: [] }),
          cfg({ exigeCidAvaliacao: false }),
          termos,
          'assinatura',
          AGORA,
        ),
      ),
    ).toEqual([]);
  });
  it('a CIAP-2 só entra com a configuração ligada e com termo ativo do sistema certo', () => {
    const c = (ciapId: number, cidId: number | null = null) =>
      nota({ codigos: [{ parte: 'avaliacao', ciapId, cidId, incluirListaProblemas: false }] });
    expect(codigos(validarNotaSoap(c(10, 20), cfg(), termos, 'rascunho', AGORA))).toEqual(['ciap-desligada']);
    expect(codigos(validarNotaSoap(c(10, 20), cfg({ usaCiap: true }), termos, 'assinatura', AGORA))).toEqual(
      [],
    );
    expect(codigos(validarNotaSoap(c(11), cfg({ usaCiap: true }), termos, 'rascunho', AGORA))).toEqual([
      'codigo-invalido',
    ]);
    expect(codigos(validarNotaSoap(c(20), cfg({ usaCiap: true }), termos, 'rascunho', AGORA))).toEqual([
      'codigo-invalido',
    ]);
    expect(codigos(validarNotaSoap(c(10), cfg({ usaCiap: true }), termos, 'assinatura', AGORA))).toEqual([
      'avaliacao-sem-cid',
    ]);
  });
  it('código vazio, repetido, fora da avaliação na lista de problemas e com CID não correspondente', () => {
    const v = validarNotaSoap(
      nota({
        codigos: [
          { parte: 'avaliacao', ciapId: null, cidId: null, incluirListaProblemas: false },
          { parte: 'plano', ciapId: null, cidId: 20, incluirListaProblemas: true },
          { parte: 'plano', ciapId: null, cidId: 20, incluirListaProblemas: false },
          { parte: 'avaliacao', ciapId: 10, cidId: 21, incluirListaProblemas: false },
        ],
      }),
      cfg({ usaCiap: true }),
      termos,
      'rascunho',
      AGORA,
      [{ ciapId: 10, cidId: 20, preferencial: true }],
    );
    expect(codigos(v)).toEqual(['codigo-vazio', 'problema-fora-da-avaliacao', 'codigo-repetido']);
    expect(v.avisos).toHaveLength(1);
  });
  it('gestação pela data da última menstruação: data provável do parto e idade gestacional', () => {
    expect(gestacaoPelaDum('2026-04-01', AGORA)).toEqual({
      dataProvavelParto: '2027-01-06',
      idadeGestacionalDias: 238,
    });
    expect(idadeGestacionalTexto(238)).toBe('34s 0d');
    expect(gestacaoPelaDum('2026-02-30', AGORA)).toBeNull();
    const pn = (dum: string | null) =>
      codigos(
        validarNotaSoap(
          nota({ tipo: 'pre_natal', dataUltimaMenstruacao: dum }),
          cfg(),
          termos,
          'assinatura',
          AGORA,
        ),
      );
    expect(pn(null)).toEqual(['dum-obrigatoria']);
    expect(pn('2026-12-01')).toEqual(['dum-futura']);
    expect(pn('2025-11-01')).toEqual(['idade-gestacional-invalida']);
    expect(pn('2026-02-31')).toEqual(['dum-invalida']);
    expect(pn('2026-04-01')).toEqual([]);
  });
  it('criticidade, edema e tamanho dos textos', () => {
    expect(
      codigos(
        validarNotaSoap(
          nota({ criticidade: 'grave', edema: '+++++', plano: 'x'.repeat(20_001) }),
          cfg(),
          termos,
          'rascunho',
          AGORA,
        ),
      ),
    ).toEqual(['texto-longo', 'criticidade-invalida', 'edema-invalido']);
  });
});

describe('ciclo da nota', () => {
  it('rascunho: só o autor edita e assina; assinada não muda; sem efeito com justificativa', () => {
    const r = { situacao: 'rascunho' as const, autorUsuarioId: 1 };
    const a = { situacao: 'assinada' as const, autorUsuarioId: 1 };
    expect(acaoNotaSoap(r, 1, 'editar')).toEqual([]);
    expect(acaoNotaSoap(r, 2, 'assinar')[0]!.codigo).toBe('nao-autor');
    expect(acaoNotaSoap(a, 1, 'editar')[0]!.codigo).toBe('nota-assinada');
    expect(acaoNotaSoap(r, 1, 'sem_efeito')).toEqual([]);
    expect(acaoNotaSoap(a, 1, 'sem_efeito', 'curta')[0]!.codigo).toBe('justificativa-obrigatoria');
    expect(acaoNotaSoap(a, 1, 'sem_efeito', 'Lançada no paciente errado')).toEqual([]);
    expect(acaoNotaSoap({ situacao: 'sem_efeito', autorUsuarioId: 1 }, 1, 'sem_efeito')[0]!.codigo).toBe(
      'nota-sem-efeito',
    );
  });
  it('sugestão de CID pela correspondência e texto para o prontuário', () => {
    expect(
      cidsSugeridos(10, [
        { ciapId: 10, cidId: 30, preferencial: false },
        { ciapId: 10, cidId: 25, preferencial: false },
        { ciapId: 10, cidId: 40, preferencial: true },
        { ciapId: 11, cidId: 1, preferencial: true },
      ]),
    ).toEqual([40, 25, 30]);
    expect(
      textoNotaSoap({ subjetivo: 'Dor', objetivo: null, avaliacao: '', plano: 'Repouso' }, [
        { parte: 'avaliacao', rotulo: 'I10 Hipertensão' },
      ]),
    ).toBe('S: Dor\nA: [I10 Hipertensão]\nP: Repouso');
  });
});
