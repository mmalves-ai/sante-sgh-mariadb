import { describe, expect, it } from 'vitest';
import { CLASSES_DFM, classeDfm } from './classes.js';
import { campo, componente, grupo, modeloSintetico } from './fixtures.spec-util.js';
import { converterModelo, impressaoLayout, type ItemFormulario } from './mapeamento.js';

function achar(itens: readonly ItemFormulario[], linkId: string): ItemFormulario | undefined {
  for (const i of itens) {
    if (i.linkId === linkId) return i;
    const f = achar(i.itens, linkId);
    if (f) return f;
  }
  return undefined;
}

describe('mapeamento das 13 classes (regra 2)', () => {
  it('as 13 classes do cap-11 §11.1 estão no catálogo', () => {
    expect(CLASSES_DFM).toHaveLength(13);
    expect(new Set(CLASSES_DFM.map((c) => c.classe)).size).toBe(13);
    expect(classeDfm('TfRespEditUnidade')?.tipo).toBe('quantity');
    expect(classeDfm('TOutraCoisa')).toBeUndefined();
  });

  it('converte o modelo: linkId da ordem, árvore, x-legacy, inativo preservado, escolhas e expressões', async () => {
    const r = await converterModelo(modeloSintetico());
    expect(r.formato).toBe('sgh-formulario/1');
    expect(r.itens.map((i) => i.linkId)).toEqual(['01']);
    const secao = r.itens[0]!;
    expect(secao).toMatchObject({ tipo: 'group', widget: 'section', texto: 'SECAO FICTICIA', ativo: true });
    expect(secao.itens.map((i) => i.linkId)).toEqual(['01.01', '01.02', '01.03', '01.04']);
    const simNao = achar(r.itens, '01.01')!;
    expect(simNao.opcoes?.map((o) => [o.indice, o.valor])).toEqual([
      [1, false],
      [2, true],
    ]);
    expect(simNao['x-legacy']).toMatchObject({
      vinculo: 2,
      pergunta: 102,
      codPergunta: 2,
      ordem: '0101',
      tipo: '4',
      classe: 'TfRespComboBox',
      componente: 'cmp2',
      idResposta: 24,
      manterHist: 0,
    });
    const nivel = achar(r.itens, '01.02')!;
    expect(nivel.obrigatorio).toBe(true);
    expect(nivel.opcoes).toHaveLength(3);
    const data = achar(r.itens, '01.02.01')!;
    expect(data).toMatchObject({
      tipo: 'date',
      layout: { colunas: 6, largura: 350, altura: 40 },
      tamanhoMaximo: 12,
    });
    expect(data.expressoes?.[0]).toMatchObject({
      tipo: 'habilitar',
      padrao: 'habilitar-por-resposta',
      referencias: ['cmp2'],
    });
    const inativo = achar(r.itens, '01.03')!;
    expect(inativo).toMatchObject({ ativo: false, tipo: 'text', layout: { colunas: 3 } });
    const semComp = achar(r.itens, '01.04')!;
    expect(semComp).toMatchObject({ tipo: 'sem-componente', ativo: false, layout: null });
    expect(r.resumo).toMatchObject({
      vinculos: 6,
      vinculosAtivos: 4,
      vinculosInativos: 2,
      componentes: 5,
      componentesMapeados: 5,
      classesDesconhecidas: 0,
      caracteresSubstituicao: 0,
      vinculosSemComponente: 1,
      opcoesResolvidas: 5,
      escolhasPendentes: 0,
      expressoesHabilitar: 1,
      expressoesCalcular: 0,
    });
    expect(r.versoesLayout).toEqual([{ versao: 1, componentes: 5 }]);
    expect(r.impressaoLayout).toMatch(/^[0-9a-f]{64}$/);
    expect(r.pendencias).toEqual([]);
  });

  it('impressão digital muda quando o layout muda no Delphi (regra 6)', async () => {
    const m = modeloSintetico();
    const a = await impressaoLayout(m.componentes);
    const alterado = m.componentes.map((c, i) =>
      i === 0 ? { ...c, dfm: c.dfm.replace('Width = 744', 'Width = 700') } : c,
    );
    expect(await impressaoLayout(alterado)).not.toBe(a);
    expect(await impressaoLayout([...m.componentes].reverse())).toBe(a);
  });

  it('classe desconhecida, DFM inválido, ordem inválida, tipo inesperado, pai ausente e U+FFFD vão ao relatório', async () => {
    const m = modeloSintetico();
    const r = await converterModelo({
      ...m,
      vinculos: [
        ...m.vinculos,
        { id: 7, idPergunta: 101, ordem: '0105', obrigatorio: null, ativo: null },
        { id: 8, idPergunta: 101, ordem: '0106', obrigatorio: null, ativo: null },
        { id: 9, idPergunta: 101, ordem: '1', obrigatorio: null, ativo: null },
        { id: 10, idPergunta: 104, ordem: '0107', obrigatorio: null, ativo: null },
        { id: 11, idPergunta: 999, ordem: '0901', obrigatorio: null, ativo: null },
      ],
      componentes: [
        ...m.componentes,
        componente(7, 'TfRespNova', campo('cmp7', 'TfRespNova', '0105', 'Nova', 200)),
        componente(8, 'TfRespEdit', 'inherited cmp8: TfRespEdit\n  Width = '),
        componente(10, 'TfRespEdit', campo('cmp10', 'TfRespEdit', '0107', 'Texto�\u0081\u009D', 200)),
        componente(11, 'TGroupBoxPep', grupo('cmp11', '0901', 'Solta', 744)),
      ],
    });
    const tipos = r.pendencias.map((p) => p.tipo).sort();
    expect(tipos).toEqual([
      'classe-desconhecida',
      'dfm-invalido',
      'ordem-invalida',
      'pai-ausente',
      'tipo-inesperado',
    ]);
    expect(r.resumo.classesDesconhecidas).toBe(1);
    // U+FFFD e os controles C1 dos bytes CP1252 indefinidos (0x81, 0x9D) contam juntos.
    expect(r.resumo.caracteresSubstituicao).toBe(3);
    expect(r.resumo.componentesMapeados).toBe(7);
    expect(achar(r.itens, '01.05')?.tipo).toBe('nao-mapeado');
    expect(achar(r.itens, '01.06')?.tipo).toBe('nao-mapeado');
    expect(achar(r.itens, '09.01')?.texto).toBe('Solta');
    expect(r.resumo.porClasse['TfRespNova']).toBe(1);
  });

  it('pendência de escolha leva a sugestão sem aplicá-la', async () => {
    const m = modeloSintetico();
    const r = await converterModelo({
      ...m,
      // Uma resposta ativa a mais antes de "Leve" desalinha a ordem: o índice 3 ("Grave", ID 9999 de outra
      // pergunta) não resolve e fica pendente, com a resposta de mesmo rótulo só como sugestão.
      respostas: [
        ...m.respostas,
        { id: 3000, idPergunta: 103, cod: 30, ordem: 0, ativo: true, descricao: 'Outra' },
      ],
    });
    expect(r.resumo.escolhasPendentes).toBe(1);
    expect(r.pendencias).toEqual([
      {
        linkId: '01.02',
        tipo: 'escolha',
        detalhe: 'ID_RESPOSTA do DFM não pertence à pergunta',
        indice: 3,
        opcao: 'Grave',
        sugestaoIdResposta: 3003,
      },
    ]);
    expect(achar(r.itens, '01.02')?.opcoes?.map((o) => o.indice)).toEqual([1, 2]);
  });
});
