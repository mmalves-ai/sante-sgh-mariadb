import { TIPO_GUIA } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  type AlcadaAutorizador,
  parametrosDosPrazos,
  prazoDaRespostaRegulatorio,
  type PrazoRegulatorio,
  problemasDaAlcada,
  valorAutorizado,
  vencimentoDoPrazo,
} from './autorizacao-prazo-alcada.js';

const linha = (p: Partial<PrazoRegulatorio> = {}): PrazoRegulatorio => ({
  codigo: 'resposta_padrao',
  prazo: 5,
  unidade: 'dia_util',
  vigenciaInicio: '2020-01-01',
  vigenciaFim: null,
  ativo: true,
  ...p,
});
const eletivo = { carater: 'E' as const, tipoGuia: 2, altaComplexidade: false };
// 2026-11-20 é sexta-feira.
const AGORA = '2026-11-20T10:00:00';

describe('C2-122 prazo da resposta pelo cadastro regulatório', () => {
  it('urgência é imediata, sem linha do cadastro', () => {
    expect(prazoDaRespostaRegulatorio({ ...eletivo, carater: 'U' }, AGORA, [linha()])).toEqual({
      tipo: 'imediato',
      prazoEm: AGORA,
      origem: null,
    });
  });
  it('eletivo comum usa a linha resposta_padrao vigente (dias úteis pulam o fim de semana)', () => {
    const r = prazoDaRespostaRegulatorio(eletivo, AGORA, [linha({ prazo: 3 })]);
    expect(r).toEqual({ tipo: 'padrao', prazoEm: '2026-11-25T23:59:59', origem: 'resposta_padrao' });
  });
  it('internação e alta complexidade usam resposta_complexa; a mais recente vigente vence', () => {
    const linhas = [
      linha({ codigo: 'resposta_complexa', prazo: 10 }),
      linha({ codigo: 'resposta_complexa', prazo: 2, unidade: 'dia', vigenciaInicio: '2026-01-01' }),
      linha({ codigo: 'resposta_complexa', prazo: 1, vigenciaInicio: '2027-01-01' }),
    ];
    expect(prazoDaRespostaRegulatorio({ ...eletivo, tipoGuia: TIPO_GUIA.internacao }, AGORA, linhas)).toEqual(
      {
        tipo: 'complexo',
        prazoEm: '2026-11-22T23:59:59',
        origem: 'resposta_complexa',
      },
    );
    expect(prazoDaRespostaRegulatorio({ ...eletivo, altaComplexidade: true }, AGORA, linhas).tipo).toBe(
      'complexo',
    );
  });
  it('linha vencida ou inativa não vale: cai no padrão da norma, sem origem', () => {
    const linhas = [linha({ prazo: 1, vigenciaFim: '2025-12-31' }), linha({ prazo: 2, ativo: false })];
    expect(prazoDaRespostaRegulatorio(eletivo, AGORA, linhas)).toEqual({
      tipo: 'padrao',
      prazoEm: '2026-11-27T23:59:59',
      origem: null,
    });
  });
  it('prazo em horas soma a partir do instante', () => {
    expect(vencimentoDoPrazo('2026-11-20 22:30:00', 4, 'hora')).toBe('2026-11-21T02:30:00');
  });
  it('parâmetros da tela vêm do cadastro em dias úteis', () => {
    expect(
      parametrosDosPrazos(
        [linha({ prazo: 4 }), linha({ codigo: 'resposta_complexa', prazo: 8 })],
        '2026-11-20',
      ),
    ).toEqual({ diasUteisPadrao: 4, diasUteisComplexo: 8, diasValidadeSenha: 30 });
    expect(parametrosDosPrazos([linha({ prazo: 9, unidade: 'hora' })], '2026-11-20').diasUteisPadrao).toBe(5);
  });
});

const alcada = (p: Partial<AlcadaAutorizador> = {}): AlcadaAutorizador => ({
  nivel: 1,
  valorLimite: 1000,
  autorizaGuia: true,
  autorizaProcedimento: false,
  autorizaProrrogacao: false,
  negaItem: false,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  ativo: true,
  ...p,
});
const HOJE = '2026-11-20';
const itens = [
  { quantidade: 2, valorUnitario: 300 },
  { quantidade: 1, valorUnitario: null },
];

describe('C2-122 alçada do autorizador na decisão', () => {
  it('valor autorizado soma quantidade pelo valor de referência', () => {
    expect(valorAutorizado(itens)).toBe(600);
  });
  it('sem alçada ligada, só o limite do auditor vale', () => {
    expect(problemasDaAlcada(null, null, { situacao: 'parcial', itens, prorrogacao: true }, HOJE)).toEqual(
      [],
    );
    expect(problemasDaAlcada(null, 500, { situacao: 'autorizada', itens, prorrogacao: false }, HOJE)).toEqual(
      [{ codigo: 'alcada-valor-acima', campo: 'itens' }],
    );
  });
  it('alçada dentro do limite autoriza; acima do menor limite recusa', () => {
    const d = { situacao: 'autorizada' as const, itens, prorrogacao: false };
    expect(problemasDaAlcada(alcada(), null, d, HOJE)).toEqual([]);
    expect(problemasDaAlcada(alcada({ valorLimite: 599.99 }), null, d, HOJE)).toEqual([
      { codigo: 'alcada-valor-acima', campo: 'itens' },
    ]);
    expect(problemasDaAlcada(alcada({ valorLimite: null }), 100, d, HOJE)[0]?.codigo).toBe(
      'alcada-valor-acima',
    );
  });
  it('negar item exige a permissão; a negativa total não confere valor', () => {
    expect(
      problemasDaAlcada(
        alcada({ valorLimite: 1 }),
        null,
        { situacao: 'negada', itens, prorrogacao: false },
        HOJE,
      ),
    ).toEqual([{ codigo: 'alcada-nao-nega', campo: 'decisao' }]);
    expect(
      problemasDaAlcada(
        alcada({ negaItem: true }),
        null,
        { situacao: 'parcial', itens, prorrogacao: false },
        HOJE,
      ),
    ).toEqual([]);
  });
  it('autorizar exige guia ou procedimento; prorrogação exige a sua permissão', () => {
    expect(
      problemasDaAlcada(
        alcada({ autorizaGuia: false }),
        null,
        { situacao: 'autorizada', itens, prorrogacao: true },
        HOJE,
      ).map((x) => x.codigo),
    ).toEqual(['alcada-nao-autoriza', 'alcada-nao-prorroga']);
    expect(
      problemasDaAlcada(
        alcada({ autorizaGuia: false, autorizaProcedimento: true, autorizaProrrogacao: true }),
        null,
        { situacao: 'autorizada', itens, prorrogacao: true },
        HOJE,
      ),
    ).toEqual([]);
  });
  it('alçada vencida ou inativa recusa a decisão', () => {
    const d = { situacao: 'autorizada' as const, itens, prorrogacao: false };
    expect(problemasDaAlcada(alcada({ vigenciaFim: '2026-11-19' }), null, d, HOJE)).toEqual([
      { codigo: 'alcada-fora-da-vigencia', campo: 'auditor' },
    ]);
    expect(problemasDaAlcada(alcada({ ativo: false }), null, d, HOJE)[0]?.codigo).toBe(
      'alcada-fora-da-vigencia',
    );
  });
});
