import { chaveDaLinha, lerChaveDaLinha, lerReferenciaSegredoLegado, SEGREDOS_LEGADO } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  bloqueioRetiradaSegredo,
  bloqueioRetiradaSenhaSecundaria,
  contagemProtegida,
  contingenciaLigadaDoValor,
  referenciaDaColuna,
  resumoChave,
} from './segredos.js';

const livre = { contingenciaLigada: false, receitaLigada: true, cofreDisponivel: true };

describe('M59-F3 regra 7: chave da linha e referência do cofre', () => {
  it('monta e lê a chave na ordem do catálogo; recusa coluna trocada, separador e tamanho', () => {
    const k = chaveDaLinha('servico_tiss_convenio', { convenio_id: 12, versao_tiss_id: 3 });
    expect(k).toBe('convenio_id=12;versao_tiss_id=3');
    expect(lerChaveDaLinha('servico_tiss_convenio', k)).toEqual({ convenio_id: '12', versao_tiss_id: '3' });
    expect(lerChaveDaLinha('servico_tiss_convenio', 'versao_tiss_id=3;convenio_id=12')).toBeNull();
    expect(lerChaveDaLinha('convenio', 'id=1;X=2')).toBeNull();
    expect(lerChaveDaLinha('convenio', 'id=1=2')).toBeNull();
    expect(lerChaveDaLinha('integracao_bancaria_externa', 'BANCO=1')).toBeNull();
    expect(() => chaveDaLinha('convenio', { id: "1'; --" })).toThrow(/inválida/);
  });
  it('referência por estabelecimento, tabela, resumo da chave e coluna do catálogo; o resumo não traz a chave', () => {
    const r = referenciaDaColuna('pc', 'estabelecimento', 'id=1', 'senha_proxy');
    expect(r).toMatch(/^cofre:parceiro\/pc\/estabelecimento\/[0-9a-f]{16}\/senha_proxy$/);
    expect(r).not.toContain('id=1');
    expect(lerReferenciaSegredoLegado(r)).toEqual({
      hospital: 'pc',
      tabela: 'estabelecimento',
      resumoChave: resumoChave('estabelecimento', 'id=1'),
      coluna: 'senha_proxy',
    });
    expect(resumoChave('estabelecimento', 'id=1')).not.toBe(resumoChave('estabelecimento', 'id=2'));
    expect(() => referenciaDaColuna('pc', 'estabelecimento', 'id=1', 'nome')).toThrow();
    expect(lerReferenciaSegredoLegado('cofre:psc/pc/x/client-secret')).toBeNull();
  });
  it('catálogo: chave e colunas sem repetição; vazio declarado para cada coluna', () => {
    for (const s of SEGREDOS_LEGADO) {
      expect(s.colunas.length).toBeGreaterThan(0);
      expect(Object.keys(s.vazio).sort()).toEqual([...s.colunas].sort());
      expect(s.rotulo).not.toMatch(/SPDATA|legado|sistema atual/i);
    }
  });
});

describe('M59-F3 regras 1 e 7: retirada do segredo de parceiro', () => {
  const linha = {
    tabela: 'estabelecimento',
    comValor: ['senha_proxy', 'senha_provedor'],
    noCofre: ['senha_proxy', 'senha_provedor'],
    rotacionadas: ['senha_proxy', 'senha_provedor'],
  };
  it('na ordem: sem valor, contingência, receita, cofre, falta no cofre, rotação pendente', () => {
    expect(bloqueioRetiradaSegredo({ ...linha, comValor: [] }, livre)).toBe('sem-valor');
    expect(bloqueioRetiradaSegredo(linha, { ...livre, contingenciaLigada: true })).toBe('contingencia-ativa');
    expect(bloqueioRetiradaSegredo(linha, { ...livre, receitaLigada: false })).toBe('operacao-desligada');
    expect(bloqueioRetiradaSegredo(linha, { ...livre, cofreDisponivel: false })).toBe('cofre-indisponivel');
    expect(bloqueioRetiradaSegredo({ ...linha, noCofre: ['senha_proxy'] }, livre)).toBe('falta-no-cofre');
    expect(bloqueioRetiradaSegredo({ ...linha, rotacionadas: ['senha_proxy'] }, livre)).toBe(
      'rotacao-pendente',
    );
    expect(bloqueioRetiradaSegredo({ ...linha, rotacionadas: [] }, livre)).toBe('rotacao-pendente');
    expect(bloqueioRetiradaSegredo(linha, livre)).toBeNull();
  });
  it('coluna fora do catálogo não conta como valor; tabela fora do catálogo é erro', () => {
    expect(
      bloqueioRetiradaSegredo(
        { tabela: 'estabelecimento', comValor: ['nome'], noCofre: [], rotacionadas: [] },
        livre,
      ),
    ).toBe('sem-valor');
    expect(() =>
      bloqueioRetiradaSegredo(
        { tabela: 'integracao_bancaria_externa', comValor: ['senha_portal'], noCofre: [], rotacionadas: [] },
        livre,
      ),
    ).toThrow();
  });
});

describe('M59-F3: senhas secundárias', () => {
  const c = { contingenciaLigada: false, receitaLigada: true, operador: 'GESTOR' };
  it('sem valor, contingência, receita e a própria', () => {
    expect(bloqueioRetiradaSenhaSecundaria({ login: 'A', colunas: [] }, c)).toBe('sem-valor');
    expect(bloqueioRetiradaSenhaSecundaria({ login: 'A', colunas: ['outra_coluna'] }, c)).toBe('sem-valor');
    expect(
      bloqueioRetiradaSenhaSecundaria(
        { login: 'A', colunas: ['senha_liberacao'] },
        { ...c, contingenciaLigada: true },
      ),
    ).toBe('contingencia-ativa');
    expect(
      bloqueioRetiradaSenhaSecundaria(
        { login: 'A', colunas: ['senha_liberacao'] },
        { ...c, receitaLigada: false },
      ),
    ).toBe('operacao-desligada');
    expect(
      bloqueioRetiradaSenhaSecundaria({ login: 'GESTOR', colunas: ['senha_cancelamento_nota'] }, c),
    ).toBe('a-si-mesmo');
    expect(
      bloqueioRetiradaSenhaSecundaria({ login: 'A', colunas: ['senha_cancelamento_nota'] }, c),
    ).toBeNull();
  });
  it('contingência: só "não" desliga (ausente é ligada); contagem protegida', () => {
    for (const v of [null, undefined, '', 'sim', 'S', 'qualquer'])
      expect(contingenciaLigadaDoValor(v)).toBe(true);
    for (const v of ['nao', 'não', 'N', 'false', 'F']) expect(contingenciaLigadaDoValor(v)).toBe(false);
    expect([0, 1, 4, 5].map(contagemProtegida)).toEqual([0, '<5', '<5', 5]);
  });
});
