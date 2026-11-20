// Regra 9 do M57 (etapa 3): o data mart da Rede. Pseudônimo por estabelecimento por padrão; o comum (pela pessoa da
// Rede) só quando a liberação da DP-42 está ligada em TODOS os estabelecimentos; as cargas de modos ou versões
// diferentes não se juntam. Massa sintética.
import { describe, expect, it } from 'vitest';
import {
  avisosDasCargasDaRede,
  colunasIdentificadoras,
  conferirCargasDaRede,
  ErroConsolidacaoDataMart,
  ESCOPO_PSEUDONIMO_REDE,
  ESQUEMA_DATAMART,
  impressaoDaChave,
  modoDoPseudonimo,
  pseudonimo,
  pseudonimoDoPaciente,
  TABELAS_FATO_DATAMART,
  VERSAO_ESQUEMA_DATAMART,
} from './datamart.js';

const CHAVE = 'chave-sintetica-de-teste-0123456789';
const PESSOA = '0b0c7a3e-1111-4222-8333-444455556666';

describe('data mart da Rede', () => {
  it('todo fato tem a dimensão estabelecimento e nenhum dado pessoal', () => {
    expect(TABELAS_FATO_DATAMART).toEqual([
      'fato_internacao_dia',
      'fato_internacao',
      'fato_atendimento',
      'fato_item_conta',
      'fato_dispensacao',
    ]);
    for (const t of ESQUEMA_DATAMART) expect(Object.keys(t.colunas)[0]).toBe('estabelecimento');
    expect(colunasIdentificadoras(ESQUEMA_DATAMART)).toEqual([]);
    expect(VERSAO_ESQUEMA_DATAMART).toBe(3);
  });

  it('por estabelecimento (padrão): o mesmo paciente tem pseudônimos diferentes em cada um, mesmo com a pessoa da Rede', () => {
    const a = pseudonimoDoPaciente(CHAVE, 'por-estabelecimento', 'pc', 10, PESSOA);
    const b = pseudonimoDoPaciente(CHAVE, 'por-estabelecimento', 'hs', 20, PESSOA);
    expect(a).not.toBe(b);
    expect(a).toBe(pseudonimo(CHAVE, 'pc:paciente', 10));
    expect(a).not.toContain('10');
  });

  it('comum (só com a DP-42): o paciente ligado no MPI tem o mesmo pseudônimo nos dois; sem vínculo, o do estabelecimento', () => {
    const a = pseudonimoDoPaciente(CHAVE, 'comum', 'pc', 10, PESSOA);
    const b = pseudonimoDoPaciente(CHAVE, 'comum', 'hs', 20, PESSOA);
    expect(a).toBe(b);
    expect(a).toBe(pseudonimo(CHAVE, ESCOPO_PSEUDONIMO_REDE, PESSOA));
    expect(a).not.toContain(PESSOA.slice(0, 8));
    expect(pseudonimoDoPaciente(CHAVE, 'comum', 'pc', 11, null)).toBe(pseudonimo(CHAVE, 'pc:paciente', 11));
    // Outra chave, outro pseudônimo (sem a chave do cofre, ninguém volta à pessoa).
    expect(pseudonimoDoPaciente(`${CHAVE}-outra`, 'comum', 'pc', 10, PESSOA)).not.toBe(a);
  });

  it('o modo comum só com a liberação ligada em todos os estabelecimentos', () => {
    expect(modoDoPseudonimo([true, true])).toBe('comum');
    expect(modoDoPseudonimo([true, false])).toBe('por-estabelecimento');
    expect(modoDoPseudonimo([])).toBe('por-estabelecimento');
  });

  it('as cargas só se juntam com o esquema atual, um arquivo por estabelecimento da rede e o mesmo modo', () => {
    const c = (
      estabelecimento: string,
      modoPseudonimo = 'por-estabelecimento',
      versaoEsquema = VERSAO_ESQUEMA_DATAMART,
      extra: { carregadoEm?: string; chaveImpressao?: string; dadosAte?: string } = {},
    ) => ({
      estabelecimento,
      versaoEsquema,
      modoPseudonimo,
      dadosAte: '2026-07-05',
      carregadoEm: '2026-07-05T06:00:00.000Z',
      chaveImpressao: impressaoDaChave(CHAVE),
      ...extra,
    });
    const recusa = (fn: () => unknown) => {
      try {
        fn();
        return 'aceito';
      } catch (e) {
        expect(e).toBeInstanceOf(ErroConsolidacaoDataMart);
        return (e as Error).message;
      }
    };
    expect(conferirCargasDaRede([c('pc'), c('hs')], ['pc', 'hs'])).toBe('por-estabelecimento');
    expect(conferirCargasDaRede([c('pc', 'comum'), c('hs', 'comum')], ['pc', 'hs'])).toBe('comum');
    expect(recusa(() => conferirCargasDaRede([c('pc'), c('hs', 'comum')], ['pc', 'hs']))).toMatch(/modos/);
    expect(recusa(() => conferirCargasDaRede([c('pc'), c('pc')], ['pc']))).toMatch(/Mais de uma/);
    expect(recusa(() => conferirCargasDaRede([c('zz')], ['pc']))).toMatch(/não é de um estabelecimento/);
    expect(recusa(() => conferirCargasDaRede([c('pc', 'por-estabelecimento', 1)], ['pc']))).toMatch(
      /recarregue/,
    );
    expect(recusa(() => conferirCargasDaRede([c('pc', 'outro')], ['pc']))).toMatch(/desconhecido/);
    expect(recusa(() => conferirCargasDaRede([], ['pc']))).toMatch(/Nenhuma/);
    // Chaves diferentes (por exemplo, a chave aleatória de dev de outra carga) não se juntam.
    const outra = impressaoDaChave(`${CHAVE}-outra`);
    expect(outra).not.toBe(impressaoDaChave(CHAVE));
    expect(impressaoDaChave(CHAVE)).toMatch(/^[0-9a-f]{16}$/);
    expect(impressaoDaChave(CHAVE)).not.toContain(CHAVE.slice(0, 8));
    expect(
      recusa(() =>
        conferirCargasDaRede(
          [c('pc'), c('hs', 'por-estabelecimento', VERSAO_ESQUEMA_DATAMART, { chaveImpressao: outra })],
          ['pc', 'hs'],
        ),
      ),
    ).toMatch(/chaves de pseudônimo diferentes/);
    expect(
      recusa(() => conferirCargasDaRede([c('pc', 'por-estabelecimento', 3, { chaveImpressao: '' })], ['pc'])),
    ).toMatch(/impressão da chave/);
    // A carga velha de um estabelecimento junto da nova de outro é recusada.
    const velha = { carregadoEm: '2026-06-20T06:00:00.000Z' };
    expect(
      recusa(() => conferirCargasDaRede([c('pc'), c('hs', 'por-estabelecimento', 3, velha)], ['pc', 'hs'])),
    ).toMatch(/distam mais de 36 horas/);
    const ontem = { carregadoEm: '2026-07-04T08:00:00.000Z' };
    expect(conferirCargasDaRede([c('pc'), c('hs', 'por-estabelecimento', 3, ontem)], ['pc', 'hs'])).toBe(
      'por-estabelecimento',
    );
    // Os dados até datas distantes avisam (não recusam).
    expect(
      avisosDasCargasDaRede([c('pc'), c('hs', 'por-estabelecimento', 3, { dadosAte: '2026-07-04' })]),
    ).toEqual([]);
    expect(
      avisosDasCargasDaRede([c('pc'), c('hs', 'por-estabelecimento', 3, { dadosAte: '2026-06-01' })]),
    ).toEqual(['Os dados de hs vão até uma data anterior à dos demais estabelecimentos.']);
  });
});
