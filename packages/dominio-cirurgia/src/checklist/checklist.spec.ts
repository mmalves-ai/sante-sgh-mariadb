// Regra 1 do M46 (checklist de cirurgia segura em três momentos, cada item com quem confirmou e a hora).
import { LISTA_CHECKLIST_V1 as L, listaChecklist, type MomentoChecklist } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  alertasDoChecklist,
  type ChecklistLido,
  concluidoEm,
  type ConfirmacaoItem,
  conferirConclusao,
  conferirResposta,
  impedimentoDoMomento,
  incisaoLiberada,
  itensDoMomento,
  ORDEM_MOMENTOS,
  pendentesDoMomento,
  podeConfirmar,
  respostasAceitas,
  segurancaNoQuadro,
  vigentes,
} from './checklist.js';

const VAZIO: ChecklistLido = {
  lista: 1,
  versao: 1,
  inducaoEm: null,
  inducaoPor: null,
  timeoutEm: null,
  timeoutPor: null,
  saidaEm: null,
  saidaPor: null,
  excecaoEm: null,
  excecaoPor: null,
  excecaoMotivo: null,
};
let seq = 0;
const item = (L.itens as readonly { codigo: string; momento: MomentoChecklist }[]).map((i) => i);
function tudoOk(momento: MomentoChecklist, em = '2026-10-25T08:00'): ConfirmacaoItem[] {
  return itensDoMomento(L, momento).map((i) => ({
    id: ++seq,
    momento,
    item: i.codigo,
    resposta: i.tipo === 'pergunta' ? 'nao' : 'sim',
    observacao: null,
    em,
    usuario: 'SINT.CIRCULANTE',
  }));
}
const porCodigo = (c: string) => L.itens.find((i) => i.codigo === c)!;

describe('lista de verificação (versão 1)', () => {
  it('tem os três momentos da OMS na ordem, com 7, 7 e 5 itens, e códigos únicos', () => {
    expect(ORDEM_MOMENTOS).toEqual(['inducao', 'incisao', 'saida']);
    expect(itensDoMomento(L, 'inducao')).toHaveLength(7);
    expect(itensDoMomento(L, 'incisao')).toHaveLength(7);
    expect(itensDoMomento(L, 'saida')).toHaveLength(5);
    expect(new Set(item.map((i) => i.codigo)).size).toBe(L.itens.length);
    expect(listaChecklist(1)).toBe(L);
    expect(listaChecklist(99)).toBeUndefined();
  });
  it('as respostas aceitas pelo tipo do item', () => {
    expect(respostasAceitas(porCodigo('identidade'))).toEqual(['sim']);
    expect(respostasAceitas(porCodigo('sitioDemarcado'))).toEqual(['sim', 'na']);
    expect(respostasAceitas(porCodigo('alergiaConhecida'))).toEqual(['sim', 'nao']);
  });
});

describe('confirmar um item', () => {
  it('recusa o item desconhecido e o "não se aplica" numa pergunta', () => {
    expect(conferirResposta(undefined, { resposta: 'sim', observacao: null })).toEqual({
      ok: false,
      codigo: 'checklist-item-desconhecido',
    });
    expect(
      conferirResposta(porCodigo('alergiaConhecida'), { resposta: 'na', observacao: null }),
    ).toMatchObject({
      ok: false,
      codigo: 'checklist-resposta-invalida',
    });
  });
  it('a alergia conhecida exige a observação; o "não" de um item a fazer também (o que faltou)', () => {
    expect(
      conferirResposta(porCodigo('alergiaConhecida'), { resposta: 'sim', observacao: ' ' }),
    ).toMatchObject({
      codigo: 'checklist-observacao-obrigatoria',
    });
    expect(
      conferirResposta(porCodigo('alergiaConhecida'), { resposta: 'sim', observacao: 'Dipirona' }),
    ).toEqual({
      ok: true,
    });
    expect(conferirResposta(porCodigo('oximetro'), { resposta: 'nao', observacao: null })).toMatchObject({
      codigo: 'checklist-observacao-obrigatoria',
    });
    expect(
      conferirResposta(porCodigo('oximetro'), { resposta: 'nao', observacao: 'Sensor trocado' }),
    ).toEqual({
      ok: true,
    });
  });
  it('não confirma num momento concluído nem depois da saída', () => {
    expect(podeConfirmar(null, 'inducao')).toEqual({ ok: true });
    expect(podeConfirmar({ ...VAZIO, inducaoEm: '2026-10-25T08:00' }, 'inducao')).toMatchObject({
      codigo: 'checklist-momento-concluido',
    });
    expect(podeConfirmar({ ...VAZIO, saidaEm: '2026-10-25T10:00' }, 'incisao')).toMatchObject({
      codigo: 'checklist-momento-concluido',
    });
    expect(podeConfirmar({ ...VAZIO, inducaoEm: '2026-10-25T08:00' }, 'incisao')).toEqual({ ok: true });
  });
  it('a vigente é a última confirmação do item', () => {
    const a: ConfirmacaoItem = {
      id: 1,
      momento: 'inducao',
      item: 'oximetro',
      resposta: 'nao',
      observacao: 'Sem sinal',
      em: '2026-10-25T07:50',
      usuario: 'A',
    };
    const b: ConfirmacaoItem = {
      ...a,
      id: 2,
      resposta: 'sim',
      observacao: null,
      em: '2026-10-25T07:52',
      usuario: 'B',
    };
    expect(vigentes([b, a]).get('inducao:oximetro')?.usuario).toBe('B');
  });
});

describe('concluir o momento (regra 1)', () => {
  it('na ordem: a pausa cirúrgica só depois da entrada; a saída só depois da pausa ou da exceção', () => {
    expect(impedimentoDoMomento(L, null, 'incisao', tudoOk('incisao'))).toBe(
      'checklist-momento-fora-de-ordem',
    );
    expect(
      impedimentoDoMomento(L, { ...VAZIO, inducaoEm: '2026-10-25T08:00' }, 'saida', tudoOk('saida')),
    ).toBe('checklist-momento-fora-de-ordem');
    expect(
      impedimentoDoMomento(
        L,
        { ...VAZIO, inducaoEm: '2026-10-25T08:00', excecaoEm: '2026-10-25T08:10', excecaoPor: 'SUP' },
        'saida',
        tudoOk('saida'),
      ),
    ).toBeNull();
  });
  it('com todos os itens respondidos de forma que conclui; o "não" de um item a fazer impede', () => {
    const c = tudoOk('inducao');
    expect(impedimentoDoMomento(L, null, 'inducao', c)).toBeNull();
    const sem = c.filter((x) => x.item !== 'oximetro');
    expect(impedimentoDoMomento(L, null, 'inducao', sem)).toBe('checklist-itens-pendentes');
    expect(pendentesDoMomento(L, 'inducao', sem).map((i) => i.codigo)).toEqual(['oximetro']);
    const nao = [...c, { ...c[3]!, id: 999, resposta: 'nao' as const, observacao: 'Sem sensor' }];
    expect(pendentesDoMomento(L, 'inducao', nao).map((i) => i.codigo)).toEqual(['oximetro']);
  });
  it('o horário não volta: nem antes do momento anterior, nem antes das confirmações do momento', () => {
    const c = { ...VAZIO, inducaoEm: '2026-10-25T08:00', inducaoPor: 'A' };
    expect(
      conferirConclusao(L, c, 'incisao', tudoOk('incisao', '2026-10-25T07:59'), '2026-10-25T07:59'),
    ).toEqual({
      ok: false,
      codigo: 'checklist-horario-fora-de-ordem',
    });
    expect(
      conferirConclusao(L, c, 'incisao', tudoOk('incisao', '2026-10-25T08:20'), '2026-10-25T08:10'),
    ).toEqual({
      ok: false,
      codigo: 'checklist-horario-fora-de-ordem',
    });
    expect(
      conferirConclusao(L, c, 'incisao', tudoOk('incisao', '2026-10-25T08:05'), '2026-10-25T08:10'),
    ).toEqual({
      ok: true,
    });
    expect(conferirConclusao(L, c, 'inducao', tudoOk('inducao'), '2026-10-25T08:30')).toEqual({
      ok: false,
      codigo: 'checklist-momento-concluido',
    });
  });
  it('concluidoEm, incisão liberada e o resumo do quadro com os alertas', () => {
    const c = { ...VAZIO, inducaoEm: '2026-10-25T08:00', timeoutEm: '2026-10-25T08:10' };
    expect(concluidoEm(null, 'inducao')).toBeNull();
    expect(concluidoEm(c, 'incisao')).toBe('2026-10-25T08:10');
    expect(concluidoEm(c, 'saida')).toBeNull();
    expect(incisaoLiberada(null)).toBe(false);
    expect(incisaoLiberada(c)).toBe(true);
    expect(incisaoLiberada({ ...VAZIO, excecaoEm: '2026-10-25T08:00' })).toBe(true);
    const conf = [
      ...tudoOk('inducao'),
      {
        id: 5000,
        momento: 'inducao' as const,
        item: 'alergiaConhecida',
        resposta: 'sim' as const,
        observacao: 'Látex',
        em: '2026-10-25T08:00',
        usuario: 'A',
      },
    ];
    expect(alertasDoChecklist(L, conf).map((i) => i.codigo)).toEqual(['alergiaConhecida']);
    expect(segurancaNoQuadro(L, c, conf)).toEqual({
      inducao: true,
      incisao: true,
      saida: false,
      excecao: false,
      alertas: 1,
    });
    expect(segurancaNoQuadro(L, null, [])).toEqual({
      inducao: false,
      incisao: false,
      saida: false,
      excecao: false,
      alertas: 0,
    });
  });
});
