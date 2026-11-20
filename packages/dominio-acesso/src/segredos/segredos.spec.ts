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
    const k = chaveDaLinha('TBTISSWEBSERV', { ID_TBCONVEN: 12, ID_TBTISSSCHEMA: 3 });
    expect(k).toBe('ID_TBCONVEN=12;ID_TBTISSSCHEMA=3');
    expect(lerChaveDaLinha('TBTISSWEBSERV', k)).toEqual({ ID_TBCONVEN: '12', ID_TBTISSSCHEMA: '3' });
    expect(lerChaveDaLinha('TBTISSWEBSERV', 'ID_TBTISSSCHEMA=3;ID_TBCONVEN=12')).toBeNull();
    expect(lerChaveDaLinha('TBCONVEN', 'COD=1;X=2')).toBeNull();
    expect(lerChaveDaLinha('TBCONVEN', 'COD=1=2')).toBeNull();
    expect(lerChaveDaLinha('TBINFBANCO', 'BANCO=1')).toBeNull();
    expect(() => chaveDaLinha('TBCONVEN', { COD: "1'; --" })).toThrow(/inválida/);
  });
  it('referência por estabelecimento, tabela, resumo da chave e coluna do catálogo; o resumo não traz a chave', () => {
    const r = referenciaDaColuna('pc', 'TBHOSPIT', 'COD=1', 'SENHA_PROXY');
    expect(r).toMatch(/^cofre:parceiro\/pc\/TBHOSPIT\/[0-9a-f]{16}\/SENHA_PROXY$/);
    expect(r).not.toContain('COD=1');
    expect(lerReferenciaSegredoLegado(r)).toEqual({
      hospital: 'pc',
      tabela: 'TBHOSPIT',
      resumoChave: resumoChave('TBHOSPIT', 'COD=1'),
      coluna: 'SENHA_PROXY',
    });
    expect(resumoChave('TBHOSPIT', 'COD=1')).not.toBe(resumoChave('TBHOSPIT', 'COD=2'));
    expect(() => referenciaDaColuna('pc', 'TBHOSPIT', 'COD=1', 'NOME')).toThrow();
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
    tabela: 'TBHOSPIT',
    comValor: ['SENHA_PROXY', 'SENHAPROV'],
    noCofre: ['SENHA_PROXY', 'SENHAPROV'],
    rotacionadas: ['SENHA_PROXY', 'SENHAPROV'],
  };
  it('na ordem: sem valor, contingência, receita, cofre, falta no cofre, rotação pendente', () => {
    expect(bloqueioRetiradaSegredo({ ...linha, comValor: [] }, livre)).toBe('sem-valor');
    expect(bloqueioRetiradaSegredo(linha, { ...livre, contingenciaLigada: true })).toBe('contingencia-ativa');
    expect(bloqueioRetiradaSegredo(linha, { ...livre, receitaLigada: false })).toBe('operacao-desligada');
    expect(bloqueioRetiradaSegredo(linha, { ...livre, cofreDisponivel: false })).toBe('cofre-indisponivel');
    expect(bloqueioRetiradaSegredo({ ...linha, noCofre: ['SENHA_PROXY'] }, livre)).toBe('falta-no-cofre');
    expect(bloqueioRetiradaSegredo({ ...linha, rotacionadas: ['SENHA_PROXY'] }, livre)).toBe(
      'rotacao-pendente',
    );
    expect(bloqueioRetiradaSegredo({ ...linha, rotacionadas: [] }, livre)).toBe('rotacao-pendente');
    expect(bloqueioRetiradaSegredo(linha, livre)).toBeNull();
  });
  it('coluna fora do catálogo não conta como valor; tabela fora do catálogo é erro', () => {
    expect(
      bloqueioRetiradaSegredo(
        { tabela: 'TBHOSPIT', comValor: ['NOME'], noCofre: [], rotacionadas: [] },
        livre,
      ),
    ).toBe('sem-valor');
    expect(() =>
      bloqueioRetiradaSegredo(
        { tabela: 'TBINFBANCO', comValor: ['SENHA'], noCofre: [], rotacionadas: [] },
        livre,
      ),
    ).toThrow();
  });
});

describe('M59-F3: senhas secundárias', () => {
  const c = { contingenciaLigada: false, receitaLigada: true, operador: 'GESTOR' };
  it('sem valor, contingência, receita e a própria', () => {
    expect(bloqueioRetiradaSenhaSecundaria({ login: 'A', colunas: [] }, c)).toBe('sem-valor');
    expect(bloqueioRetiradaSenhaSecundaria({ login: 'A', colunas: ['DIG_SENHA'] }, c)).toBe('sem-valor');
    expect(
      bloqueioRetiradaSenhaSecundaria(
        { login: 'A', colunas: ['SENHA_SEC'] },
        { ...c, contingenciaLigada: true },
      ),
    ).toBe('contingencia-ativa');
    expect(
      bloqueioRetiradaSenhaSecundaria({ login: 'A', colunas: ['SENHA_SEC'] }, { ...c, receitaLigada: false }),
    ).toBe('operacao-desligada');
    expect(bloqueioRetiradaSenhaSecundaria({ login: 'GESTOR', colunas: ['SENHA_CAN_NF'] }, c)).toBe(
      'a-si-mesmo',
    );
    expect(bloqueioRetiradaSenhaSecundaria({ login: 'A', colunas: ['SENHA_CAN_NF'] }, c)).toBeNull();
  });
  it('contingência: só "não" desliga (ausente é ligada); contagem protegida', () => {
    for (const v of [null, undefined, '', 'sim', 'S', 'qualquer'])
      expect(contingenciaLigadaDoValor(v)).toBe(true);
    for (const v of ['nao', 'não', 'N', 'false', 'F']) expect(contingenciaLigadaDoValor(v)).toBe(false);
    expect([0, 1, 4, 5].map(contagemProtegida)).toEqual([0, '<5', '<5', 5]);
  });
});
