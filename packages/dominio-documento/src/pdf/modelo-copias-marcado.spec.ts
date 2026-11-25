// 04-INT L69 (C2-034): as cópias do documento saem no mesmo PDF, cada uma em página nova com "Cópia k de n", e o campo
// marcado leva negrito e parágrafos sem abrir o HTML do modelo (tudo escapado antes). Massa sintética.
import { describe, expect, it } from 'vitest';
import { copiasDoDocumento, htmlDocumento, htmlMarcado, type DadosDocumento } from './modelo.js';

const base: DadosDocumento = {
  titulo: 'Termo de prova',
  produto: 'P',
  estabelecimento: 'Estabelecimento Fictício',
  emitidoEm: '25/11/2026 10:00',
  via: null,
  campos: [{ rotulo: 'Paciente', valor: 'Paciente Fictício' }],
  qrSvg: '',
  identificadorQr: 'QQQQ',
  fontesCss: '',
};
const conta = (html: string, trecho: string) => html.split(trecho).length - 1;

describe('documento com cópias e texto marcado', () => {
  it('as cópias se repetem no mesmo PDF, cada uma marcada e em página nova', () => {
    const tres = htmlDocumento({ ...base, copias: 3 });
    expect(conta(tres, '<section class="copia">')).toBe(3);
    expect(conta(tres, '<h1>Termo de prova</h1>')).toBe(3);
    expect(conta(tres, 'Valide pelo QR (código QQQQ)')).toBe(3);
    expect(tres).toContain('<div class="via">Cópia 1 de 3</div>');
    expect(tres).toContain('<div class="via">Cópia 3 de 3</div>');
    expect(tres).toContain('.copia+.copia{break-before:page}');
    const uma = htmlDocumento(base);
    expect(conta(uma, '<section class="copia">')).toBe(1);
    expect(uma).not.toContain('Cópia 1');
    expect(conta(htmlDocumento({ ...base, copias: 1 }), '<section class="copia">')).toBe(1);
    // A via (reemissão) e a cópia convivem.
    const via2 = htmlDocumento({ ...base, via: '2ª via', copias: 2 });
    expect(conta(via2, '<div class="via">2ª via</div>')).toBe(2);
    expect(via2).toContain('Cópia 2 de 2');
  });

  it('as cópias ficam entre 1 e 20', () => {
    expect([undefined, Number.NaN, 0, -3, 2.4, 2.6, 20, 21, 500].map((c) => copiasDoDocumento(c))).toEqual([
      1, 1, 1, 1, 2, 3, 20, 20, 20,
    ]);
    expect(conta(htmlDocumento({ ...base, copias: 99 }), '<section class="copia">')).toBe(20);
  });

  it('o texto marcado leva negrito e parágrafos, com todo o resto escapado', () => {
    expect(htmlMarcado('Eu, **Paciente Fictício**, autorizo.\nLinha 2\n\nSegundo parágrafo')).toBe(
      '<p>Eu, <strong>Paciente Fictício</strong>, autorizo.<br>Linha 2</p><p>Segundo parágrafo</p>',
    );
    expect(htmlMarcado('<script>x</script> **<b>y</b>**')).toBe(
      '<p>&lt;script&gt;x&lt;/script&gt; <strong>&lt;b&gt;y&lt;/b&gt;</strong></p>',
    );
    // Asterisco solto ou par vazio não vira negrito.
    expect(htmlMarcado('2 * 3 = 6 e ****')).toBe('<p>2 * 3 = 6 e ****</p>');
    expect(htmlMarcado('a\r\nb')).toBe('<p>a<br>b</p>');
    const html = htmlDocumento({
      ...base,
      campos: [
        { rotulo: 'Documento', valor: 'Termo de **Fulano**', formato: 'marcado' },
        { rotulo: 'Puro', valor: 'Sem **marca**' },
      ],
    });
    expect(html).toContain('<td><p>Termo de <strong>Fulano</strong></p></td>');
    expect(html).toContain('<td>Sem **marca**</td>');
  });
});
