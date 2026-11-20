// O aviso da consulta de um item do menu: a fase só para o item sem tela de trabalho; o item com a tela própria mostra
// as tabelas como apoio (correção do M45.6: os cadastros das especialidades).
import { ARVORE_MENU } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { avisoDoItem } from './aviso-item.js';

const item = (id: string) => ARVORE_MENU.find((i) => i.id === id) ?? null;

describe('aviso da consulta do item', () => {
  it('o item com a tela de trabalho própria não promete tela futura: as tabelas são de apoio', () => {
    expect(avisoDoItem(item('pep.especialidades.oftalmologia-exames-e-acuidade'))).toEqual({
      tipo: 'apoio',
      rota: '/pep/especialidades/oftalmologia',
    });
    expect(avisoDoItem(item('pep.especialidades.oncologia-protocolos-de-quimioterapia'))).toEqual({
      tipo: 'apoio',
      rota: '/pep/especialidades/oncologia',
    });
  });

  it('o item que só tem a consulta mantém o aviso da fase; fase 1 e item desconhecido, nada', () => {
    expect(
      avisoDoItem(
        item(
          'faturamento.operadora-propria-sgo-se-a-rede-tiver-plano.dominios-da-operadora-e-do-plano-proprio',
        ),
      ),
    ).toEqual({ tipo: 'fase', fase: 6 });
    // M54.7: o orçamento empresarial ganhou a tela; a consulta do item (os parâmetros) aponta para ela.
    expect(avisoDoItem(item('financeiro.orcamento-empresarial'))).toEqual({
      tipo: 'apoio',
      rota: '/financeiro/orcamento',
    });
    // M53.8: as obrigações legais ganharam a tela; a consulta do item aponta para ela.
    expect(avisoDoItem(item('gestao-de-pessoas.obrigacoes-legais-rais-caged-sefip-fgts'))).toEqual({
      tipo: 'apoio',
      rota: '/pessoas/obrigacoes',
    });
    // M53.6: o eSocial ganhou a tela; a consulta do item aponta para ela.
    expect(avisoDoItem(item('gestao-de-pessoas.esocial-eventos-lotes-retornos'))).toEqual({
      tipo: 'apoio',
      rota: '/pessoas/esocial',
    });
    // M53.1: a folha de pagamento ganhou a tela da competência; a consulta do item aponta para ela.
    expect(avisoDoItem(item('gestao-de-pessoas.folha-de-pagamento-rubricas-ferias-rescisao'))).toEqual({
      tipo: 'apoio',
      rota: '/pessoas/folha',
    });
    // M52.4: o ponto ganhou a tela; a consulta do item aponta para ela.
    expect(avisoDoItem(item('gestao-de-pessoas.ponto-eletronico-marcacoes-justificativas'))).toEqual({
      tipo: 'apoio',
      rota: '/pessoas/ponto',
    });
    // M52.1: o cadastro de colaboradores ganhou a tela; a consulta do item aponta para ela.
    expect(avisoDoItem(item('gestao-de-pessoas.cadastro-de-colaboradores-admissao-dependentes'))).toEqual({
      tipo: 'apoio',
      rota: '/pessoas/colaboradores',
    });
    expect(avisoDoItem({ fase: 1, rota: null })).toBeNull();
    expect(avisoDoItem({ fase: 5, rota: null })).toEqual({ tipo: 'fase', fase: 5 });
    expect(avisoDoItem(null)).toBeNull();
  });
});
