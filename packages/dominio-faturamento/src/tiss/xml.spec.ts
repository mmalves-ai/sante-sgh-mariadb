import { describe, expect, it } from 'vitest';
import { conferirHashEpilogo } from './lote.js';
import { desescapar, el, escapar, opcional, serializar, textos } from './xml.js';

describe('XML canônico da mensagem', () => {
  it('omite filhos vazios, escapa e desescapa entidades', () => {
    expect(el('a', null, undefined, false, '', 'x')).toEqual({ nome: 'a', filhos: ['x'] });
    expect(opcional('b', null)).toBeNull();
    expect(opcional('b', '')).toBeNull();
    expect(opcional('b', 3)).toEqual({ nome: 'b', filhos: ['3'] });
    expect(escapar('<a & "b">')).toBe('&lt;a &amp; &quot;b&quot;&gt;');
    expect(desescapar('&lt;&gt;&quot;&apos;&#65;&#x42;&amp;lt;')).toBe('<>"\'AB&lt;');
    expect(serializar(el('r', el('c', 'Ç&')))).toBe(
      '<?xml version="1.0" encoding="ISO-8859-1"?><ans:r xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas"><ans:c>Ç&amp;</ans:c></ans:r>',
    );
    expect(textos(el('r', 'a', el('c', 'b')))).toEqual(['a', 'b']);
  });

  it('hash de XML com caractere fora do ISO-8859-1 não confere (sem lançar)', () => {
    expect(conferirHashEpilogo('<ans:x>€</ans:x><ans:epilogo><ans:hash>0</ans:hash></ans:epilogo>')).toEqual({
      confere: false,
      informado: '0',
      calculado: '',
    });
  });
});
