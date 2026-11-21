import { describe, expect, it } from 'vitest';
import { resolverEscolhas, type RespostaLegado } from './escolhas.js';
import { combo } from './fixtures.spec-util.js';
import { lerDfm } from './leitor.js';

const respostas: RespostaLegado[] = [
  { id: 3001, cod: 31, ordem: 1, ativo: true, descricao: 'Leve' },
  { id: 3002, cod: 32, ordem: 2, ativo: true, descricao: 'Moderado' },
  { id: 3003, cod: 33, ordem: 3, ativo: true, descricao: 'Grave' },
  { id: 3004, cod: 34, ordem: 4, ativo: false, descricao: 'Antigo' },
];

describe('escolhas gravam índice, não código (regra 3)', () => {
  it('Sim/Não: índice 1 = Não, 2 = Sim, conferido pelo rótulo', () => {
    const o = lerDfm(combo('cmp2', '0101', 'Queda', ['', 'Não', 'Sim'], ['0', '2001', '2001']));
    const r = resolverEscolhas(o, 'cbxResp', '4', [
      { id: 2001, cod: null, ordem: 0, ativo: true, descricao: null },
    ]);
    expect(r.indiceVazio).toBe(true);
    expect(r.opcoes).toEqual([
      { indice: 1, texto: 'Não', idResposta: 2001, codigo: null, valor: false, origem: 'sim-nao' },
      { indice: 2, texto: 'Sim', idResposta: 2001, codigo: null, valor: true, origem: 'sim-nao' },
    ]);
    expect(r.pendencias).toEqual([]);
  });

  it('Sim/Não sem cbxId_Resposta: só a resposta única; com várias, idResposta null e pendência', () => {
    const o = lerDfm(combo('cmp2', '0101', 'Queda', ['', 'Não', 'Sim'], null));
    const unica = resolverEscolhas(o, 'cbxResp', '4', [
      { id: 2001, cod: null, ordem: 0, ativo: true, descricao: null },
    ]);
    expect(unica.opcoes.map((x) => x.idResposta)).toEqual([2001, 2001]);
    expect(unica.pendencias).toEqual([]);
    const varias = resolverEscolhas(o, 'cbxResp', '4', [
      { id: 2001, cod: null, ordem: 0, ativo: true, descricao: null },
      { id: 2002, cod: null, ordem: 1, ativo: true, descricao: null },
    ]);
    expect(varias.opcoes.map((x) => x.idResposta)).toEqual([null, null]);
    expect(varias.pendencias.map((p) => p.indice)).toEqual([1, 2]);
    expect(varias.pendencias[0]?.motivo).toMatch(/ID_RESPOSTA não resolvido/);
    expect(resolverEscolhas(o, 'cbxResp', '4', []).opcoes.map((x) => x.idResposta)).toEqual([null, null]);
  });

  it('Sim/Não fora do padrão vai à pendência', () => {
    const o = lerDfm(combo('cmp2', '0101', 'Queda', ['', 'Sim', 'Não'], null));
    const r = resolverEscolhas(o, 'cbxResp', '4', []);
    expect(r.opcoes).toEqual([]);
    expect(r.pendencias[0]?.motivo).toMatch(/Sim\/Não/);
    const extra = resolverEscolhas(
      lerDfm(combo('c', '01', 'Q', ['', 'Não', 'Sim', 'Talvez'], null)),
      'cbxResp',
      '4',
      [],
    );
    expect(extra.opcoes).toHaveLength(2);
    expect(extra.opcoes[0]?.idResposta).toBeNull();
    // Sem resposta cadastrada: Não e Sim ficam sem ID (pendência) e a opção extra também vai à pendência.
    expect(extra.pendencias.map((p) => p.indice)).toEqual([1, 2, 3]);
    expect(extra.pendencias).toContainEqual({
      indice: 3,
      texto: 'Talvez',
      motivo: 'Sim/Não com opção além de Não e Sim',
    });
  });

  it('resolve pelo ID_RESPOSTA do combo oculto e, na falta, pela ordem da opção do campo', () => {
    const o = lerDfm(
      combo('cmp3', '0102', 'Nivel', ['', 'Leve', 'Moderado', 'Grave'], ['0', '3001', '3002', '9999']),
    );
    const r = resolverEscolhas(o, 'cbxResp', '13', respostas);
    expect(r.opcoes.map((x) => [x.indice, x.idResposta, x.codigo, x.origem])).toEqual([
      [1, 3001, 31, 'id-resposta'],
      [2, 3002, 32, 'id-resposta'],
      [3, 3003, 33, 'ordem'],
    ]);
  });

  it('nunca adivinha: rótulo divergente, ID de outra pergunta ou sem lista viram pendência', () => {
    const o = lerDfm(
      combo(
        'cmp3',
        '0102',
        'Nivel',
        ['', 'Leve', 'Outro rotulo', 'Moderado', 'X'],
        ['0', '3001', '3001', '8888', ''],
      ),
    );
    const r = resolverEscolhas(o, 'cbxResp', '13', respostas);
    expect(r.opcoes.map((x) => x.indice)).toEqual([1]);
    expect(r.pendencias).toEqual([
      {
        indice: 2,
        texto: 'Outro rotulo',
        motivo: 'rótulo do DFM diferente do cadastro da opção de resposta',
      },
      {
        indice: 3,
        texto: 'Moderado',
        motivo: 'ID_RESPOSTA do DFM não pertence à pergunta',
        sugestaoIdResposta: 3002,
      },
      {
        indice: 4,
        texto: 'X',
        motivo: 'índice sem ID_RESPOSTA e sem resposta na mesma ordem com o mesmo rótulo',
      },
    ]);
    const semIds = resolverEscolhas(
      lerDfm(combo('c', '01', 'Q', ['', 'Grave'], null)),
      'cbxResp',
      '13',
      respostas,
    );
    expect(semIds.pendencias[0]?.motivo).toMatch(/sem cbxId_Resposta/);
    const semLista = resolverEscolhas(lerDfm(combo('c', '01', 'Q', [], null)), 'clbResp', '12', respostas);
    expect(semLista.pendencias[0]?.motivo).toMatch(/clbResp.Items ausente/);
  });

  it('lista de marcação começa no índice 0 (sem item vazio)', () => {
    const fonte = combo('c', '01', 'Q', ['Leve', 'Moderado'], ['3001', '3002']).replace(
      'cbxResp: TValidadeComboBox',
      'clbResp: TCheckListBox',
    );
    const r = resolverEscolhas(lerDfm(fonte), 'clbResp', '12', respostas);
    expect(r.indiceVazio).toBe(false);
    expect(r.opcoes.map((x) => x.indice)).toEqual([0, 1]);
  });
});
