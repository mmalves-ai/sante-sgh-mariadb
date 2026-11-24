// Texto padrão da descrição cirúrgica (04-CC linha 91).
import { describe, expect, it } from 'vitest';
import {
  camposDoTexto,
  preencherTexto,
  type TextoPadraoCirurgia,
  textosParaDescricao,
  validarTextoPadrao,
} from './texto-padrao.js';

const texto = (
  id: number,
  procedimento: number | null,
  cirurgiao: number | null,
  ativo = true,
): TextoPadraoCirurgia => ({
  id,
  titulo: `T${id}`,
  procedimento,
  cirurgiao,
  textoDescricao: 'x',
  textoRisco: null,
  textoIntercorrencia: null,
  ativo,
});

describe('texto padrão da descrição cirúrgica', () => {
  it('lista os campos a preencher sem repetir, dos três textos', () => {
    expect(
      camposDoTexto('Incisão {{via}} de {{ tamanho_cm }} cm; {{via}}', null, 'Sangramento {{volume_ml}}'),
    ).toEqual(['via', 'tamanho_cm', 'volume_ml']);
  });

  it('recusa título curto, descrição vazia e campo mal fechado', () => {
    expect(validarTextoPadrao({ titulo: 'Colecistectomia', textoDescricao: 'Incisão {{via}}' })).toEqual([]);
    const p = validarTextoPadrao({ titulo: 'ab', textoDescricao: ' ', textoRisco: 'Risco {{grau' });
    expect(p.map((x) => x.campo)).toEqual(['titulo', 'textoDescricao', 'textoRisco']);
    expect(validarTextoPadrao({ titulo: 'abc', textoDescricao: 'x {{Via}}' }).map((x) => x.campo)).toEqual([
      'textoDescricao',
    ]);
  });

  it('oferece primeiro o do cirurgião para o procedimento e esconde os de outros e os inativos', () => {
    const ts = [
      texto(1, null, null),
      texto(2, 50, null),
      texto(3, null, 7),
      texto(4, 50, 7),
      texto(5, 51, null),
      texto(6, 50, 8),
      texto(7, 50, 7, false),
    ];
    expect(textosParaDescricao(ts, { procedimento: 50, cirurgiao: 7 }).map((t) => t.id)).toEqual([
      4, 3, 2, 1,
    ]);
    expect(textosParaDescricao(ts, { procedimento: 51, cirurgiao: null }).map((t) => t.id)).toEqual([5, 1]);
  });

  it('preenche os campos e devolve os que faltam', () => {
    expect(preencherTexto('Via {{via}}, {{tamanho_cm}} cm', { via: 'mediana' })).toEqual({
      texto: 'Via mediana, {{tamanho_cm}} cm',
      faltando: ['tamanho_cm'],
    });
    expect(preencherTexto('Via {{via}}', { via: 'mediana' }).faltando).toEqual([]);
  });
});
