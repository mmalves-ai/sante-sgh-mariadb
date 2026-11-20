// Regra 10 (ficha do M21): um lugar por vez; o movimento não se apaga (exclusão lógica, só o último); não se recebe o
// que não foi enviado; o descarte com o aval da comissão; a cobrança da devolução; a leitura do código de barras.
import { describe, expect, it } from 'vitest';
import {
  conferirMovimentoArquivo,
  contaDoCodigoDeBarras,
  devolucaoAtrasada,
  localizacaoAtual,
  podeExcluir,
} from './same.js';

const dia = 86_400_000;
const movs = [
  { id: 1, operacao: 1, origem: 1, destino: 1, em: 0, excluido: false },
  { id: 2, operacao: 2, origem: 1, destino: 5, em: dia, excluido: false },
  { id: 3, operacao: 5, origem: 5, destino: 9, em: 2 * dia, excluido: true },
];

describe('SAME', () => {
  it('a localização é o destino do último movimento não excluído', () => {
    expect(localizacaoAtual(movs)?.id).toBe(2);
    expect(localizacaoAtual([])).toBeNull();
    expect(podeExcluir(movs, 2)).toBe(true);
    expect(podeExcluir(movs, 1)).toBe(false);
  });

  it('um lugar por vez; o recebimento só do que foi enviado; o descarte com o aval', () => {
    const atual = localizacaoAtual(movs);
    expect(conferirMovimentoArquivo(atual, { operacao: 6, setorOrigem: 1, setorDestino: 5 })).toBeNull();
    expect(conferirMovimentoArquivo(atual, { operacao: 6, setorOrigem: 1, setorDestino: 9 })?.codigo).toBe(
      'nao-enviado',
    );
    expect(conferirMovimentoArquivo(atual, { operacao: 5, setorOrigem: 9, setorDestino: 10 })?.codigo).toBe(
      'outro-lugar',
    );
    expect(conferirMovimentoArquivo(atual, { operacao: 5, setorOrigem: 5, setorDestino: 10 })).toBeNull();
    expect(conferirMovimentoArquivo(atual, { operacao: 1, setorOrigem: 1, setorDestino: 1 })?.codigo).toBe(
      'ja-registrado',
    );
    expect(conferirMovimentoArquivo(null, { operacao: 1, setorOrigem: 1, setorDestino: 1 })).toBeNull();
    expect(conferirMovimentoArquivo(null, { operacao: 2, setorOrigem: 1, setorDestino: 5 })?.codigo).toBe(
      'sem-registro',
    );
    expect(conferirMovimentoArquivo(atual, { operacao: 4, setorOrigem: 5, setorDestino: 5 })?.codigo).toBe(
      'sem-aval',
    );
    expect(
      conferirMovimentoArquivo(atual, {
        operacao: 4,
        setorOrigem: 5,
        setorDestino: 5,
        avalComissao: 'ATA 12/2026',
      }),
    ).toBeNull();
    expect(
      conferirMovimentoArquivo(
        { operacao: 4, origem: 5, destino: 5 },
        { operacao: 2, setorOrigem: 5, setorDestino: 1 },
      )?.codigo,
    ).toBe('descartado');
    expect(
      conferirMovimentoArquivo(
        { operacao: 1, origem: 1, destino: 1 },
        { operacao: 6, setorOrigem: 1, setorDestino: 1 },
      )?.codigo,
    ).toBe('nao-enviado');
  });

  it('a devolução cobrada pelo prazo e o código de barras', () => {
    expect(devolucaoAtrasada({ operacao: 2, destino: 5, em: 0 }, 8, 7, 8 * dia)).toBe(true);
    expect(devolucaoAtrasada({ operacao: 2, destino: 5, em: 0 }, 8, 7, 6 * dia)).toBe(false);
    expect(devolucaoAtrasada({ operacao: 6, destino: 8, em: 0 }, 8, 7, 30 * dia)).toBe(false);
    expect(devolucaoAtrasada({ operacao: 4, destino: 5, em: 0 }, 8, 7, 30 * dia)).toBe(false);
    expect(devolucaoAtrasada(null, 8, 7, 30 * dia)).toBe(false);
    expect(contaDoCodigoDeBarras(' 7131-50 ')).toBe(713150);
    expect(contaDoCodigoDeBarras('abc')).toBeNull();
    expect(contaDoCodigoDeBarras('1234567890123')).toBeNull();
  });
});
