import { describe, expect, it } from 'vitest';
import {
  aposentadosPeloEnvio,
  type DadosMantenedora,
  errosAlterarLogotipo,
  errosArquivoLogotipo,
  errosInativarMantenedora,
  errosLogotipo,
  errosMantenedora,
  lerImagem,
  type LogotipoExistente,
  proximaSequencia,
  TAMANHO_MAXIMO_LOGOTIPO,
} from './identidade-estabelecimento.js';

/** PNG mínimo: assinatura e o cabeçalho com largura e altura. */
export function png(largura: number, altura: number, sobra = 0): Uint8Array {
  const b = new Uint8Array(33 + sobra);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, largura);
  new DataView(b.buffer).setUint32(20, altura);
  return b;
}
/** JPEG mínimo: um bloco de aplicação e o início de quadro com altura e largura. */
function jpeg(largura: number, altura: number): Uint8Array {
  const b = new Uint8Array(40);
  b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08]);
  new DataView(b.buffer).setUint16(13, altura);
  new DataView(b.buffer).setUint16(15, largura);
  return b;
}

const L = (
  id: number,
  sequencia: number,
  finalidade: string,
  ativo = true,
  excluido = false,
): LogotipoExistente => ({
  id,
  sequencia,
  finalidade,
  ativo,
  excluido,
});

const M: DadosMantenedora = {
  codigo: 'MANT-01',
  razaoSocial: 'Associação Sintética de Saúde',
  nomeFantasia: null,
  cnpj: '11222333000181',
  inscricaoEstadual: null,
  inscricaoMunicipal: null,
  nire: null,
  dataRegistroNire: null,
  registroCivil: null,
  dataRegistroCivil: null,
  cnaePrincipal: null,
  registroAns: null,
  tipoDeclarante: null,
  responsavel: null,
  contador: null,
  contadorCrc: null,
  site: null,
};
const HOJE = '2026-11-24';

describe('logotipo do estabelecimento', () => {
  it('lê o tipo e as dimensões do próprio arquivo (PNG e JPEG)', () => {
    expect(lerImagem(png(320, 120))).toEqual({ tipo: 'image/png', largura: 320, altura: 120 });
    expect(lerImagem(jpeg(640, 200))).toEqual({ tipo: 'image/jpeg', largura: 640, altura: 200 });
  });

  it('o que não é imagem, o truncado e a dimensão zero não passam', () => {
    expect(lerImagem(new TextEncoder().encode('%PDF-1.7 arquivo que nao e imagem'))).toBeNull();
    expect(lerImagem(png(320, 120).slice(0, 20))).toBeNull();
    expect(lerImagem(png(0, 120))).toBeNull();
    expect(lerImagem(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]))).toBeNull();
  });

  it('recusa o arquivo vazio, o que não é imagem, o grande demais e as dimensões fora da faixa', () => {
    expect(errosArquivoLogotipo(new Uint8Array(0))).toEqual(['arquivo-vazio']);
    expect(errosArquivoLogotipo(new Uint8Array(64).fill(7))).toEqual(['arquivo-nao-imagem']);
    expect(errosArquivoLogotipo(png(320, 120, TAMANHO_MAXIMO_LOGOTIPO))).toEqual(['arquivo-grande']);
    expect(errosArquivoLogotipo(png(5000, 120))).toEqual(['imagem-grande']);
    expect(errosArquivoLogotipo(png(320, 8))).toEqual(['imagem-pequena']);
    expect(errosArquivoLogotipo(png(320, 120))).toEqual([]);
  });

  it('confere a finalidade e o tamanho do cabeçalho e do rodapé', () => {
    expect(
      errosLogotipo({ finalidade: 'relatorio', cabecalhoRelatorio: 'Hospital', rodapeRelatorio: null }),
    ).toEqual([]);
    expect(
      errosLogotipo({
        finalidade: 'cartaz',
        cabecalhoRelatorio: 'x'.repeat(151),
        rodapeRelatorio: 'y'.repeat(151),
      }),
    ).toEqual(['finalidade-invalida', 'cabecalho-longo', 'rodape-longo']);
  });

  it('a sequência nunca é reaproveitada, nem a do excluído', () => {
    expect(proximaSequencia([])).toBe(1);
    expect(proximaSequencia([L(1, 1, 'tela'), L(2, 4, 'email', false, true)])).toBe(5);
  });

  it('o envio novo aposenta só o ativo da mesma finalidade', () => {
    const lista = [
      L(1, 1, 'relatorio'),
      L(2, 2, 'relatorio', false),
      L(3, 3, 'tela'),
      L(4, 4, 'relatorio', true, true),
    ];
    expect(aposentadosPeloEnvio(lista, 'relatorio').map((l) => l.id)).toEqual([1]);
    expect(aposentadosPeloEnvio(lista, 'portal')).toEqual([]);
  });

  it('a alteração não deixa dois ativos na mesma finalidade', () => {
    const lista = [
      L(1, 1, 'relatorio'),
      L(2, 2, 'relatorio', false),
      L(3, 3, 'tela'),
      L(9, 9, 'tela', true, true),
    ];
    expect(errosAlterarLogotipo(lista, { id: 2, finalidade: 'relatorio', ativo: true })).toEqual([
      'finalidade-com-logotipo-ativo',
    ]);
    expect(errosAlterarLogotipo(lista, { id: 3, finalidade: 'relatorio', ativo: true })).toEqual([
      'finalidade-com-logotipo-ativo',
    ]);
    expect(errosAlterarLogotipo(lista, { id: 2, finalidade: 'relatorio', ativo: false })).toEqual([]);
    expect(errosAlterarLogotipo(lista, { id: 2, finalidade: 'portal', ativo: true })).toEqual([]);
    expect(errosAlterarLogotipo(lista, { id: 9, finalidade: 'tela', ativo: true })).toEqual([
      'logotipo-inexistente',
    ]);
    expect(errosAlterarLogotipo(lista, { id: 77, finalidade: 'tela', ativo: true })).toEqual([
      'logotipo-inexistente',
    ]);
  });
});

describe('mantenedora', () => {
  it('aceita o mínimo: código, razão social e CNPJ que confere', () => {
    expect(errosMantenedora(M, HOJE)).toEqual([]);
  });

  it('devolve todas as recusas de uma vez', () => {
    expect(
      errosMantenedora(
        {
          ...M,
          codigo: 'com espaço',
          razaoSocial: '  ',
          cnpj: '11222333000180',
          nire: '123',
          cnaePrincipal: '86',
          registroAns: '12',
          tipoDeclarante: 'outro',
          site: 'sem ponto',
        },
        HOJE,
      ),
    ).toEqual([
      'codigo-invalido',
      'razao-social-vazia',
      'cnpj-invalido',
      'nire-invalido',
      'cnae-invalido',
      'registro-ans-invalido',
      'tipo-declarante-invalido',
      'site-invalido',
    ]);
  });

  it('registro com número e data juntos, e data nunca no futuro', () => {
    expect(errosMantenedora({ ...M, dataRegistroNire: '2020-01-10' }, HOJE)).toEqual([
      'data-nire-sem-numero',
    ]);
    expect(errosMantenedora({ ...M, dataRegistroCivil: '2020-01-10' }, HOJE)).toEqual([
      'data-registro-civil-sem-numero',
    ]);
    expect(errosMantenedora({ ...M, nire: '31200000011', dataRegistroNire: '2026-11-25' }, HOJE)).toEqual([
      'data-nire-invalida',
    ]);
    expect(
      errosMantenedora(
        {
          ...M,
          nire: '31200000011',
          dataRegistroNire: HOJE,
          registroCivil: 'L-A 12',
          dataRegistroCivil: '1998-03-02',
        },
        HOJE,
      ),
    ).toEqual([]);
  });

  it('quem declara como operadora tem registro na agência', () => {
    expect(errosMantenedora({ ...M, tipoDeclarante: 'operadora' }, HOJE)).toEqual([
      'operadora-sem-registro-ans',
    ]);
    expect(
      errosMantenedora({ ...M, tipoDeclarante: 'prestador_e_operadora', registroAns: '123456' }, HOJE),
    ).toEqual([]);
    expect(errosMantenedora({ ...M, tipoDeclarante: 'prestador_saude' }, HOJE)).toEqual([]);
  });

  it('registro do contador só com o contador, que não é o responsável legal', () => {
    expect(errosMantenedora({ ...M, contadorCrc: 'MG-000000/O' }, HOJE)).toEqual(['crc-sem-contador']);
    expect(errosMantenedora({ ...M, contador: 5, responsavel: 5 }, HOJE)).toEqual([
      'contador-igual-responsavel',
    ]);
    expect(errosMantenedora({ ...M, contador: 5, responsavel: 6, contadorCrc: 'MG-000000/O' }, HOJE)).toEqual(
      [],
    );
  });

  it('só inativa a que nenhum estabelecimento usa', () => {
    expect(errosInativarMantenedora(0)).toEqual([]);
    expect(errosInativarMantenedora(2)).toEqual(['mantenedora-em-uso']);
  });
});
