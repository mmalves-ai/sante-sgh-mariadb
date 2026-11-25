// Regras do cadastro da CME (F7, 04-CME linha 115): produto reprocessável, caixa e kit com composição, fases e foto.
import { describe, expect, it } from 'vitest';
import {
  conferirCadastroCaixa,
  conferirFases,
  conferirFotoCme,
  conferirProdutoReprocessavel,
  conferirSituacaoProduto,
  type FaseDoCatalogo,
  ordenarFases,
  type PecaComposicao,
  TAMANHO_MAXIMO_FOTO_CME,
  tipoDaFotoCme,
  usoDoLimite,
} from './cadastro.js';

const produtoOk = {
  descricao: 'PINCA SINTETICA',
  tipo: 'instrumental',
  codigoBarras: null,
  limiteReprocessamentos: null,
  contadorReprocessamentos: 0,
  validadeDias: 30,
  tempoMinutos: 15,
  temperaturaCelsius: 134,
};

const peca = (o: Partial<PecaComposicao> = {}): PecaComposicao => ({
  produto: 1,
  insumo: null,
  bem: null,
  quantidade: 1,
  pecaMestre: false,
  codigoBarras: null,
  suspenso: false,
  ...o,
});
const caixaOk = {
  codigo: 'CX-1',
  descricao: 'CAIXA SINTETICA',
  natureza: 'caixa',
  validadeDias: 30,
  controlaReprocessamentos: false,
  limiteReprocessamentos: null,
  reprocessamentos: 0,
  pecas: [peca(), peca({ produto: null, insumo: 9, quantidade: 2.5 })],
};
const produtos = new Map([
  [1, { descricao: 'PINCA', situacao: 'ativo' }],
  [2, { descricao: 'TESOURA', situacao: 'em_manutencao' }],
  [3, { descricao: 'AFASTADOR', situacao: 'descartado' }],
]);
const campos = (p: { campo: string }[]) => p.map((x) => x.campo);

const catalogo: FaseDoCatalogo[] = [
  { id: 10, descricao: 'Recepção', ordem: 1, ativo: true, exigeCiclo: false },
  { id: 11, descricao: 'Limpeza', ordem: 2, ativo: true, exigeCiclo: false },
  { id: 12, descricao: 'Esterilização', ordem: 5, ativo: true, exigeCiclo: true },
  { id: 13, descricao: 'Antiga', ordem: 9, ativo: false, exigeCiclo: false },
];

describe('produto reprocessável', () => {
  it('aceita o cadastro completo e recusa cada campo fora da regra', () => {
    expect(conferirProdutoReprocessavel(produtoOk)).toEqual([]);
    expect(
      campos(
        conferirProdutoReprocessavel({
          ...produtoOk,
          descricao: ' ',
          tipo: 'caixa',
          codigoBarras: 'a b',
          validadeDias: 0,
          tempoMinutos: 2000,
          temperaturaCelsius: 0,
        }),
      ),
    ).toEqual(['descricao', 'tipo', 'codigoBarras', 'validadeDias', 'tempoMinutos', 'temperaturaCelsius']);
  });
  it('o limite do fabricante não fica abaixo do contador (RDC 15/2012, art. 22)', () => {
    expect(
      conferirProdutoReprocessavel({
        ...produtoOk,
        limiteReprocessamentos: 3,
        contadorReprocessamentos: 5,
      })[0]?.mensagem,
    ).toContain('5 reprocessamentos');
    expect(
      conferirProdutoReprocessavel({ ...produtoOk, limiteReprocessamentos: 5, contadorReprocessamentos: 5 }),
    ).toEqual([]);
    expect(campos(conferirProdutoReprocessavel({ ...produtoOk, limiteReprocessamentos: 0 }))).toEqual([
      'limiteReprocessamentos',
    ]);
  });
  it('a situação: o descartado não volta e a mesma situação é recusada', () => {
    expect(conferirSituacaoProduto('ativo', 'em_manutencao')).toEqual([]);
    expect(conferirSituacaoProduto('em_manutencao', 'ativo')).toEqual([]);
    expect(conferirSituacaoProduto('ativo', 'ativo')).toHaveLength(1);
    expect(conferirSituacaoProduto('descartado', 'ativo')[0]?.mensagem).toContain('não volta');
    expect(conferirSituacaoProduto('ativo', 'sumido')).toHaveLength(1);
  });
  it('o alerta do limite: sem limite, livre, perto (10% finais) e atingido', () => {
    expect(usoDoLimite(3, null)).toEqual({ restante: null, alerta: 'sem_limite' });
    expect(usoDoLimite(10, 100)).toEqual({ restante: 90, alerta: 'livre' });
    expect(usoDoLimite(91, 100)).toEqual({ restante: 9, alerta: 'perto' });
    expect(usoDoLimite(4, 5)).toEqual({ restante: 1, alerta: 'perto' });
    expect(usoDoLimite(5, 5)).toEqual({ restante: 0, alerta: 'atingido' });
  });
});

describe('caixa e kit com composição', () => {
  it('aceita a caixa com produto e item do estoque', () => {
    expect(conferirCadastroCaixa(caixaOk, produtos)).toEqual([]);
    expect(conferirCadastroCaixa({ ...caixaOk, natureza: 'kit' }, produtos)).toEqual([]);
  });
  it('recusa cabeçalho sem código, natureza inválida, validade fora e limite sem valor', () => {
    expect(
      campos(
        conferirCadastroCaixa(
          {
            ...caixaOk,
            codigo: '',
            natureza: 'bandeja',
            validadeDias: 9999,
            controlaReprocessamentos: true,
          },
          produtos,
        ),
      ),
    ).toEqual(['codigo', 'natureza', 'validadeDias', 'limiteReprocessamentos']);
    expect(
      conferirCadastroCaixa(
        { ...caixaOk, controlaReprocessamentos: true, limiteReprocessamentos: 2, reprocessamentos: 4 },
        produtos,
      )[0]?.mensagem,
    ).toContain('4 reprocessamentos');
  });
  it('composição: origem única, quantidade, produto ativo, repetição, peça mestre e pacote avulso', () => {
    const p = conferirCadastroCaixa(
      {
        ...caixaOk,
        pecas: [
          peca({ insumo: 9 }),
          peca({ quantidade: 1.5, pecaMestre: true }),
          peca({ produto: 2, pecaMestre: true }),
          peca({ produto: 99, quantidade: 0 }),
        ],
      },
      produtos,
    );
    const m = p.map((x) => x.mensagem).join(' | ');
    expect(m).toContain('Peça 1: escolha uma origem só');
    expect(m).toContain('Peça 2: o produto reprocessável conta em unidades inteiras');
    expect(m).toContain('Peça 2: o produto já está na caixa');
    expect(m).toContain('"TESOURA" está em manutenção');
    expect(m).toContain('Peça 4: o produto reprocessável não existe aqui');
    expect(m).toContain('Peça 4: a quantidade tem de ser maior que zero');
    expect(m).toContain('Só uma peça identifica a caixa');
    // A peça suspensa pode citar o produto fora de uso (a caixa segue montada sem ela).
    expect(
      conferirCadastroCaixa({ ...caixaOk, pecas: [peca(), peca({ produto: 3, suspenso: true })] }, produtos),
    ).toEqual([]);
    expect(
      conferirCadastroCaixa({ ...caixaOk, pecas: [peca({ suspenso: true })] }, produtos)[0]?.mensagem,
    ).toContain('ao menos uma peça em uso');
    expect(
      campos(conferirCadastroCaixa({ ...caixaOk, natureza: 'pacote_avulso' }, produtos)).includes('pecas'),
    ).toBe(true);
    expect(
      conferirCadastroCaixa(
        {
          ...caixaOk,
          pecas: [peca({ codigoBarras: 'AB-12' }), peca({ produto: null, insumo: 4, codigoBarras: 'AB-12' })],
        },
        produtos,
      )[0]?.mensagem,
    ).toContain('código de barras repetido');
  });
});

describe('fases do reprocessamento', () => {
  it('ordena pela ordem do fluxo do catálogo', () => {
    expect(
      ordenarFases(
        [
          { fase: 12, obrigatoria: true },
          { fase: 10, obrigatoria: false },
          { fase: 11, obrigatoria: true },
        ],
        catalogo,
      ).map((f) => f.fase),
    ).toEqual([10, 11, 12]);
  });
  it('aceita o fluxo com limpeza antes da esterilização e recusa o resto', () => {
    expect(
      conferirFases(
        [
          { fase: 11, obrigatoria: true },
          { fase: 12, obrigatoria: true },
        ],
        catalogo,
      ),
    ).toEqual([]);
    expect(conferirFases([], catalogo)).toHaveLength(1);
    const m = conferirFases(
      [
        { fase: 12, obrigatoria: false },
        { fase: 13, obrigatoria: false },
        { fase: 12, obrigatoria: false },
        { fase: 77, obrigatoria: false },
      ],
      catalogo,
    )
      .map((x) => x.mensagem)
      .join(' | ');
    expect(m).toContain('"Antiga" está fora de uso');
    expect(m).toContain('duas vezes');
    expect(m).toContain('não existe no catálogo');
    expect(m).toContain('Ao menos uma fase tem de ser obrigatória');
    expect(m).toContain('"Esterilização" exige ciclo');
  });
});

describe('foto de conferência', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  it('reconhece a imagem pelo conteúdo', () => {
    expect(tipoDaFotoCme(png)).toBe('image/png');
    expect(tipoDaFotoCme(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(tipoDaFotoCme(new TextEncoder().encode('RIFF0000WEBPVP8 '))).toBe('image/webp');
    expect(tipoDaFotoCme(new TextEncoder().encode('%PDF-1.7'))).toBeNull();
  });
  it('recusa vazio, grande e não imagem', () => {
    expect(conferirFotoCme(png)).toEqual([]);
    expect(conferirFotoCme(new Uint8Array())).toHaveLength(1);
    expect(conferirFotoCme(new TextEncoder().encode('texto'))[0]?.mensagem).toContain('PNG, JPEG ou WebP');
    const grande = new Uint8Array(TAMANHO_MAXIMO_FOTO_CME + 1);
    grande.set(png);
    expect(conferirFotoCme(grande)[0]?.mensagem).toContain('2 MB');
  });
});
