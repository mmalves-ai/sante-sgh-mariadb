// Rastreio do paciente no bloco (M46, etapa 2) e o painel para familiares (regra 5: só o código anônimo, a etapa e o
// horário).
import { describe, expect, it } from 'vitest';
import { FORMATO_CODIGO_PAINEL, gerarCodigoPainel, validadeDoCodigo } from './codigo.js';
import {
  conferirMovimento,
  estadoDoAgendamentoPeloLocal,
  estadoDoRastreio,
  etapaDoPainel,
  movimentosPermitidos,
  type MovimentoBloco,
  rotuloEtapa,
  rotuloLocal,
  visivelNoPainel,
} from './rastreio.js';

const LOCAIS = [1, 2, 3, 4, 5];
let n = 0;
const mov = (p: Partial<MovimentoBloco> & Pick<MovimentoBloco, 'tipo' | 'em'>): MovimentoBloco => ({
  id: ++n,
  sequencia: n,
  local: null,
  localAnterior: null,
  salaCirurgica: null,
  destino: null,
  ...p,
});

describe('estado do rastreio', () => {
  it('sem movimento: fora do bloco, só a entrada cabe; sem etapa no painel', () => {
    const e = estadoDoRastreio([]);
    expect(e).toMatchObject({ dentro: false, local: null, ultimo: null });
    expect(movimentosPermitidos(e)).toEqual(['admissao']);
    expect(etapaDoPainel(e)).toBeNull();
    expect(visivelNoPainel(e, '2026-10-25T08:00', 120)).toBe(false);
  });
  it('o caminho pré-operatório → espera → sala → recuperação → saída, com a etapa do painel', () => {
    n = 0;
    const h: MovimentoBloco[] = [mov({ tipo: 'admissao', local: 1, em: '2026-10-25T07:00' })];
    expect(etapaDoPainel(estadoDoRastreio(h))).toBe('preparo');
    h.push(mov({ tipo: 'transferencia', local: 2, em: '2026-10-25T07:20' }));
    expect(etapaDoPainel(estadoDoRastreio(h))).toBe('aguardando');
    h.push(mov({ tipo: 'transferencia', local: 3, salaCirurgica: 2, em: '2026-10-25T07:40' }));
    const naSala = estadoDoRastreio(h);
    expect(naSala).toMatchObject({ dentro: true, local: 3, salaCirurgica: 2, desde: '2026-10-25T07:40' });
    expect(etapaDoPainel(naSala)).toBe('cirurgia');
    expect(movimentosPermitidos(naSala)).toEqual(['transferencia', 'alta']);
    h.push(mov({ tipo: 'transferencia', local: 4, em: '2026-10-25T09:40' }));
    expect(etapaDoPainel(estadoDoRastreio(h))).toBe('recuperacao');
    h.push(mov({ tipo: 'alta', destino: 'unidade', em: '2026-10-25T10:40' }));
    const fora = estadoDoRastreio(h);
    expect(fora).toMatchObject({ dentro: false, saida: { em: '2026-10-25T10:40', destino: 'unidade' } });
    expect(fora.localAntesDaSaida).toEqual({ local: 4, salaCirurgica: null });
    expect(etapaDoPainel(fora)).toBe('saiu');
    expect(visivelNoPainel(fora, '2026-10-25T12:40', 120)).toBe(true);
    expect(visivelNoPainel(fora, '2026-10-25T12:41', 120)).toBe(false);
    expect(movimentosPermitidos(fora, '2026-10-25T11:00')).toEqual(['readmissao', 'cancelamentoAlta']);
    expect(movimentosPermitidos(fora, '2026-10-25T12:00')).toEqual(['readmissao']);
  });
  it('o local "outros" vira "no centro cirúrgico" no painel; a saída sem local antes não se desfaz', () => {
    n = 0;
    const h = [mov({ tipo: 'admissao', local: 5, em: '2026-10-25T07:00' })];
    expect(etapaDoPainel(estadoDoRastreio(h))).toBe('noBloco');
    expect(
      etapaDoPainel(estadoDoRastreio([mov({ tipo: 'admissao', local: 77, em: '2026-10-25T07:00' })])),
    ).toBe('noBloco');
    const s = estadoDoRastreio([mov({ tipo: 'alta', destino: 'outro', em: '2026-10-25T07:00' })]);
    expect(movimentosPermitidos(s)).toEqual(['readmissao']);
    expect(etapaDoPainel({ ...s, saida: null })).toBeNull();
  });
});

describe('conferir o movimento', () => {
  const agora = '2026-10-25T11:00';
  it('a primeira tem de ser a entrada; local conhecido; a sala exige a sala cirúrgica', () => {
    expect(
      conferirMovimento(
        [],
        { tipo: 'transferencia', local: 2, salaCirurgica: null, em: agora },
        LOCAIS,
        agora,
      ),
    ).toEqual({
      ok: false,
      codigo: 'rastreio-movimento-invalido',
    });
    expect(
      conferirMovimento([], { tipo: 'admissao', local: 9, salaCirurgica: null, em: agora }, LOCAIS, agora),
    ).toEqual({
      ok: false,
      codigo: 'rastreio-local-desconhecido',
    });
    expect(
      conferirMovimento([], { tipo: 'admissao', local: 3, salaCirurgica: null, em: agora }, LOCAIS, agora),
    ).toEqual({
      ok: false,
      codigo: 'rastreio-sala-obrigatoria',
    });
    expect(
      conferirMovimento([], { tipo: 'admissao', local: 1, salaCirurgica: 4, em: agora }, LOCAIS, agora),
    ).toEqual({
      ok: true,
      local: 1,
      salaCirurgica: null,
      localAnterior: null,
    });
  });
  it('não muda para o mesmo local, não volta no tempo e a saída leva o local de antes', () => {
    n = 0;
    const h = [mov({ tipo: 'admissao', local: 1, em: '2026-10-25T08:00' })];
    expect(
      conferirMovimento(
        h,
        { tipo: 'transferencia', local: 1, salaCirurgica: null, em: agora },
        LOCAIS,
        agora,
      ),
    ).toEqual({
      ok: false,
      codigo: 'rastreio-mesmo-local',
    });
    expect(
      conferirMovimento(
        h,
        { tipo: 'transferencia', local: 2, salaCirurgica: null, em: '2026-10-25T07:59' },
        LOCAIS,
        agora,
      ),
    ).toEqual({ ok: false, codigo: 'rastreio-horario-fora-de-ordem' });
    expect(
      conferirMovimento(h, { tipo: 'alta', local: null, salaCirurgica: null, em: agora }, LOCAIS, agora),
    ).toEqual({
      ok: true,
      local: null,
      salaCirurgica: null,
      localAnterior: 1,
    });
    expect(
      conferirMovimento(h, { tipo: 'admissao', local: 2, salaCirurgica: null, em: agora }, LOCAIS, agora),
    ).toEqual({
      ok: false,
      codigo: 'rastreio-movimento-invalido',
    });
  });
  it('desfazer a saída volta ao local de antes, só dentro do prazo; depois, o retorno', () => {
    n = 0;
    const h = [
      mov({ tipo: 'admissao', local: 3, salaCirurgica: 2, em: '2026-10-25T08:00' }),
      mov({ tipo: 'alta', destino: 'uti', em: '2026-10-25T10:30' }),
    ];
    expect(
      conferirMovimento(
        h,
        { tipo: 'cancelamentoAlta', local: null, salaCirurgica: null, em: '2026-10-25T10:40' },
        LOCAIS,
        '2026-10-25T10:40',
      ),
    ).toEqual({ ok: true, local: 3, salaCirurgica: 2, localAnterior: null });
    expect(
      conferirMovimento(
        h,
        { tipo: 'cancelamentoAlta', local: null, salaCirurgica: null, em: '2026-10-25T11:40' },
        LOCAIS,
        '2026-10-25T11:40',
      ),
    ).toEqual({ ok: false, codigo: 'rastreio-cancelamento-vencido' });
    expect(
      conferirMovimento(
        h,
        { tipo: 'readmissao', local: 4, salaCirurgica: null, em: '2026-10-25T11:40' },
        LOCAIS,
        '2026-10-25T11:40',
      ),
    ).toMatchObject({ ok: true, local: 4 });
    const volta = [
      ...h,
      mov({ tipo: 'cancelamentoAlta', local: 3, salaCirurgica: 2, em: '2026-10-25T10:40' }),
    ];
    expect(estadoDoRastreio(volta)).toMatchObject({ dentro: true, local: 3, salaCirurgica: 2 });
  });
  it('rótulos, etapa e o estado do agendamento pelo local', () => {
    expect(rotuloLocal(null)).toBeNull();
    expect(rotuloLocal(4)).toBe('Recuperação pós-anestésica');
    expect(rotuloLocal(42)).toBe('Local 42');
    expect(rotuloEtapa('cirurgia')).toBe('Em cirurgia');
    expect(estadoDoAgendamentoPeloLocal(null)).toBeNull();
    expect(estadoDoAgendamentoPeloLocal(3)).toBe('em-sala');
    expect(estadoDoAgendamentoPeloLocal(1)).toBe('no-bloco');
  });
});

describe('código do painel para familiares', () => {
  it('três letras e três algarismos sem os caracteres que se confundem; nada do paciente entra', () => {
    const c = gerarCodigoPainel(() => new Uint8Array([0, 1, 2, 3, 4, 5]));
    expect(c).toBe('ACD-993');
    expect(c).toMatch(FORMATO_CODIGO_PAINEL);
    for (let i = 0; i < 200; i++) {
      const x = gerarCodigoPainel((k) =>
        Uint8Array.from({ length: k }, () => Math.floor(Math.random() * 256)),
      );
      expect(x).toMatch(FORMATO_CODIGO_PAINEL);
      expect(x).not.toMatch(/[0O1IL5S2Z8B]/);
    }
    expect(validadeDoCodigo('2026-10-25')).toBe('2026-10-25T23:59');
  });
});
