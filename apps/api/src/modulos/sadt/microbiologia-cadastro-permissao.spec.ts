// C1-083 (05-SADT linha 12): a tela dos painéis de antibiograma e pontos de corte abre para quem só cuida do catálogo
// (CCIH, comissão de controle de infecção hospitalar, ou o administrador do catálogo), sem ler resultados de exame.
// Toda leitura que a tela faz pede sadt.catalogo.ler, e toda gravação dela, sadt.catalogo.editar; a cultura segue com
// as permissões do resultado.
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { CHAVE_PERMISSAO } from '../../autorizacao/decoradores.js';
import { MicrobiologiaCadastroController } from './microbiologia-cadastro.controller.js';
import { MicrobiologiaController } from './microbiologia.controller.js';

const permissao = (classe: { prototype: object }, metodo: string): unknown =>
  Reflect.getMetadata(CHAVE_PERMISSAO, (classe.prototype as Record<string, unknown>)[metodo] as object);

describe('permissões da tela do cadastro do antibiograma', () => {
  it('as leituras da tela pedem só o catálogo', () => {
    expect(permissao(MicrobiologiaController, 'cadastroDosPaineis')).toBe('sadt.catalogo.ler');
    expect(permissao(MicrobiologiaCadastroController, 'pontos')).toBe('sadt.catalogo.ler');
  });

  it('as gravações da tela pedem a edição do catálogo', () => {
    for (const m of ['criarPainel', 'alterarPainel', 'criarPonto', 'alterarPonto', 'encerrarPonto'])
      expect(permissao(MicrobiologiaCadastroController, m), m).toBe('sadt.catalogo.editar');
  });

  it('a leitura da cultura continua com a permissão do resultado', () => {
    expect(permissao(MicrobiologiaController, 'cadastro')).toBe('sadt.resultado.ler');
  });
});
