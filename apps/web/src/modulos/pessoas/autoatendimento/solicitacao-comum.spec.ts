// W0-06, parte 6d: o formulário único das solicitações vira a entrada do mesmo Zod do servidor, tipo a tipo; a hora do
// SanteHora (HH:MM) vira o instante; a pendência aponta o campo; os textos não citam o sistema antigo nem tabelas.
import type { SolicitacaoPessoaResposta } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { dataBr } from '../comum.js';
import { mensagensSolicitacoes } from './i18n-solicitacoes.js';
import {
  formDecisaoVazio,
  formSolicitacaoVazio,
  horaHhMm,
  montarDecisao,
  montarPedido,
  periodoDoPedido,
} from './solicitacao-comum.js';

const MOTIVO = 'Viagem com a família já marcada';

describe('solicitações do autoatendimento: montagem do pedido', () => {
  it('férias: dias e abono como número, observação é o motivo', () => {
    const f = { ...formSolicitacaoVazio('ferias'), inicio: '2026-12-07', diasGozo: '20', diasAbono: '10' };
    const r = montarPedido(f, MOTIVO, 7);
    expect(r).toEqual({
      ok: true,
      entrada: {
        tipo: 'ferias',
        vinculo: 7,
        inicio: '2026-12-07',
        diasGozo: 20,
        diasAbono: 10,
        adiantaDecimo: false,
        observacao: MOTIVO,
      },
    });
  });

  it('férias com menos de 5 dias ou sem início apontam o campo', () => {
    const curto = montarPedido(
      { ...formSolicitacaoVazio('ferias'), inicio: '2026-12-07', diasGozo: '3' },
      MOTIVO,
      null,
    );
    expect(curto).toMatchObject({
      ok: false,
      campo: 'diasGozo',
      mensagem: 'As férias têm pelo menos 5 dias.',
    });
    const semInicio = montarPedido(formSolicitacaoVazio('ferias'), MOTIVO, null);
    expect(semInicio).toMatchObject({ ok: false, campo: 'inicio' });
  });

  it('abono: sem último dia vale um dia só; o movimento fica para o gestor', () => {
    const r = montarPedido({ ...formSolicitacaoVazio('abono'), inicio: '2026-11-10' }, MOTIVO, null);
    expect(r.ok && r.entrada).toMatchObject({
      tipo: 'abono',
      inicio: '2026-11-10',
      fim: '2026-11-10',
      movimento: null,
    });
    const invertido = montarPedido(
      { ...formSolicitacaoVazio('abono'), inicio: '2026-11-10', fim: '2026-11-09' },
      MOTIVO,
      null,
    );
    expect(invertido).toMatchObject({ ok: false, campo: 'fim' });
  });

  it('ajuste de ponto: inclusão monta o instante; desconsiderar exige a marcação; justificativa exige o movimento', () => {
    const base = { ...formSolicitacaoVazio('ajuste_ponto'), dia: '2026-11-12' };
    const inc = montarPedido({ ...base, hora: '0712' }, MOTIVO, null);
    expect(inc.ok && inc.entrada).toMatchObject({
      ajuste: 'inclusao',
      instante: '2026-11-12T07:12',
      marcacao: null,
    });
    expect(montarPedido(base, MOTIVO, null)).toMatchObject({ ok: false, campo: 'instante' });
    expect(montarPedido({ ...base, ajuste: 'desconsiderar' }, MOTIVO, null)).toMatchObject({
      ok: false,
      campo: 'marcacao',
    });
    const des = montarPedido({ ...base, ajuste: 'desconsiderar', marcacao: 55, hora: '0712' }, MOTIVO, null);
    expect(des.ok && des.entrada).toMatchObject({ marcacao: 55, instante: null });
    expect(montarPedido({ ...base, ajuste: 'justificativa' }, MOTIVO, null)).toMatchObject({
      ok: false,
      campo: 'movimento',
    });
  });

  it('alteração cadastral: só o nome, com o valor correto', () => {
    const r = montarPedido(
      { ...formSolicitacaoVazio('alteracao_cadastral'), valorNovo: 'Ana Souza' },
      MOTIVO,
      3,
    );
    expect(r.ok && r.entrada).toMatchObject({ campo: 'nome', valorNovo: 'Ana Souza', vinculo: 3 });
    expect(montarPedido(formSolicitacaoVazio('alteracao_cadastral'), MOTIVO, 3)).toMatchObject({
      ok: false,
      campo: 'valorNovo',
    });
  });

  it('atestado: CID opcional em maiúsculas, registro vazio vira nulo, CID inválido aponta o campo', () => {
    const f = {
      ...formSolicitacaoVazio('atestado'),
      inicio: '2026-11-10',
      fim: '2026-11-12',
      emitidoEm: '2026-11-10',
      diasAtestado: '3',
      emitente: 'Dra. Maria',
      cid: 'j11.1',
    };
    const r = montarPedido(f, MOTIVO, null);
    expect(r.ok && r.entrada).toMatchObject({
      tipo: 'atestado',
      atestado: { dias: 3, cid: 'J11.1', registroConselho: null, arquivo: null },
    });
    const semCid = montarPedido({ ...f, cid: ' ' }, MOTIVO, null);
    expect(semCid.ok && semCid.entrada.tipo === 'atestado' && semCid.entrada.atestado.cid).toBeNull();
    expect(montarPedido({ ...f, cid: 'XX' }, MOTIVO, null)).toMatchObject({
      ok: false,
      campo: 'atestado.cid',
    });
  });

  it('o motivo curto não passa (o mesmo limite do servidor)', () => {
    const r = montarPedido({ ...formSolicitacaoVazio('abono'), inicio: '2026-11-10' }, 'curto', null);
    expect(r).toMatchObject({ ok: false, campo: 'observacao' });
  });

  it('hora em quatro dígitos ou HH:MM', () => {
    expect(horaHhMm('0705')).toBe('07:05');
    expect(horaHhMm('23:59')).toBe('23:59');
    expect(horaHhMm('2460')).toBeNull();
    expect(horaHhMm(null)).toBeNull();
  });

  it('o período do pedido em uma linha', () => {
    const s = { tipo: 'ferias', inicio: '2026-12-07', fim: null, diasGozo: 20 } as SolicitacaoPessoaResposta;
    expect(periodoDoPedido(s, dataBr)).toBe('07/12/2026 · 20 dias');
    const a = { ...s, tipo: 'abono', fim: '2026-12-08' } as SolicitacaoPessoaResposta;
    expect(periodoDoPedido(a, dataBr)).toBe('07/12/2026 a 08/12/2026');
    expect(periodoDoPedido({ ...a, fim: '2026-12-07' }, dataBr)).toBe('07/12/2026');
    expect(periodoDoPedido({ ...a, inicio: null }, dataBr)).toBe('');
  });

  it('os textos não citam o sistema antigo nem nome de tabela', () => {
    expect(JSON.stringify(mensagensSolicitacoes)).not.toMatch(/spdata|legado|SGH_|TB[A-Z]{3,}/i);
  });
});

describe('solicitações do autoatendimento: decisão do gestor (parte 6d-2)', () => {
  const base = {
    id: 41,
    versao: 3,
    movimento: null,
    justificativa: null,
  } as unknown as SolicitacaoPessoaResposta;
  const abono = { ...base, tipo: 'abono' } as SolicitacaoPessoaResposta;
  const ferias = { ...base, tipo: 'ferias' } as SolicitacaoPessoaResposta;
  const MOT = 'Conferido com a escala do setor';

  it('abono sem movimento não aprova; com o movimento do gestor vai a entrada do Zod', () => {
    expect(montarDecisao(abono, 'aprovar', MOT, formDecisaoVazio(abono))).toMatchObject({
      ok: false,
      campo: 'movimento',
    });
    const r = montarDecisao(abono, 'aprovar', MOT, { ...formDecisaoVazio(abono), movimento: 7, empresa: 2 });
    expect(r).toEqual({
      ok: true,
      entrada: {
        versao: 3,
        decisao: 'aprovar',
        motivo: MOT,
        movimento: 7,
        justificativa: null,
        empresa: null,
        aquisitivoInicio: null,
      },
    });
  });

  it('o movimento do pedido já vale; a recusa não leva os campos da aprovação', () => {
    const comMov = { ...abono, movimento: 5 } as SolicitacaoPessoaResposta;
    const r = montarDecisao(comMov, 'aprovar', MOT, formDecisaoVazio(comMov));
    expect(r.ok && r.entrada.movimento).toBe(5);
    const rec = montarDecisao(comMov, 'recusar', 'Fora do prazo combinado', formDecisaoVazio(comMov));
    expect(rec.ok && rec.entrada).toMatchObject({ decisao: 'recusar', movimento: null, empresa: null });
  });

  it('férias levam empresa e aquisitivo; a recusa curta aponta o motivo', () => {
    const f = { ...formDecisaoVazio(ferias), empresa: 2, aquisitivoInicio: '2025-03-01', movimento: 9 };
    const r = montarDecisao(ferias, 'aprovar', MOT, f);
    expect(r.ok && r.entrada).toMatchObject({ empresa: 2, aquisitivoInicio: '2025-03-01', movimento: null });
    expect(montarDecisao(ferias, 'recusar', 'curto', f)).toMatchObject({ ok: false, campo: 'motivo' });
  });
});
