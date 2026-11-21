import { describe, expect, it } from 'vitest';
import { procurarSegredos } from './segredos.ts';

// As linhas de exemplo são montadas em tempo de execução para o próprio verificador não acusá-las.
const k = (sufixo: string): string => ['FB', 'PC', sufixo].join('_');

describe('verificadores:segredos (regra 2)', () => {
  it('acusa valor em FB_*_SENHA e DB_*', () => {
    const texto = [`${k('SENHA')}=valor-de-teste`, `${'DB'}_PASSWORD: outro`].join('\n');
    expect(procurarSegredos(texto, 'x').map((a) => a.chave)).toEqual([k('SENHA'), 'DB_PASSWORD']);
  });

  it('aceita chave vazia, referência a variável e marcador de lugar', () => {
    const texto = [
      `${k('SENHA')}=`,
      `${k('SENHA')}=""`,
      `${k('SENHA')}=\${SENHA}`,
      `${k('SENHA')}=<senha>`,
    ].join('\n');
    expect(procurarSegredos(texto, 'x')).toEqual([]);
  });

  it('não confunde chave comum nem texto corrido', () => {
    const texto = [`${k('HOST')}=127.0.0.1`, `use a chave ${k('SENHA')}=algo no meio da frase`].join('\n');
    expect(procurarSegredos(texto, 'x')).toEqual([]);
  });

  it('nome de coluna como chave de objeto JSON (perfil de assinatura, M03) não é valor de segredo', () => {
    const texto = [`    "${k('SENHA')}": {`, `  "X_SENHA": [`, `  "X_SENHA": "valor"`].join('\n');
    const perfil = 'packages/legado/src/agenda/assinaturas/agenda.x/perfil-T.pc.json';
    expect(procurarSegredos(texto, perfil).map((a) => a.chave)).toEqual(['X_SENHA']);
    // fora dos arquivos de perfil e assinatura, objeto ou lista sob chave de segredo é achado (aninhado)
    expect(procurarSegredos(texto, 'config/x.json').map((a) => a.chave)).toEqual([
      k('SENHA'),
      'X_SENHA',
      'X_SENHA',
    ]);
  });
  it('em código, identificador nu é referência a constante; literal entre aspas e .env continuam achados', () => {
    const texto = [`  ${k('SENHA')}: SENHA_DE_TESTE,`, `  ${k('SENHA')}: 'literal',`].join('\n');
    expect(procurarSegredos(texto, 'tools/x.spec.ts').map((a) => a.linha)).toEqual([2]);
    expect(procurarSegredos(`${k('SENHA')}=SenhaReal01`, '.env.exemplo').map((a) => a.chave)).toEqual([
      k('SENHA'),
    ]);
    expect(procurarSegredos(`${k('SENHA')}: SenhaReal01`, 'config/x.yaml').map((a) => a.chave)).toEqual([
      k('SENHA'),
    ]);
  });
});
