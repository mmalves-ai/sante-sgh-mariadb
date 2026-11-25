// F3.8, 07-FIN linha 66 (C1-026): segregação de funções no pagamento eletrônico. Quem mantém os dados bancários e a
// chave Pix do credor (financeiro.contaCredor.manter, pelo perfil do cadastro de credores) não é quem gera a remessa
// (financeiro.remessa.gerar) nem quem paga; a rota de cada um declara a sua permissão e a trilha no handler.
import 'reflect-metadata';
import { PERMISSOES_FINANCEIRO_M32, PERFIS_COMPLEMENTARES } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { opcoesDasPermissoes } from '../../autorizacao/catalogo.js';
import { CHAVE_AUDITADO_NO_HANDLER, CHAVE_PERMISSAO } from '../../autorizacao/decoradores.js';
import { CONTAS_SINTETICAS } from '../acesso/fonte-sintetica.js';
import { PagamentoEletronicoController } from './pagamento-eletronico.controller.js';

const proto = PagamentoEletronicoController.prototype as unknown as Record<string, object>;
const meta = (chave: string, metodo: string): unknown => {
  const alvo = proto[metodo];
  if (!alvo) throw new Error(`rota ausente: ${metodo}`);
  return Reflect.getMetadata(chave, alvo);
};
const declaracao = (codigo: string) => PERMISSOES_FINANCEIRO_M32.find((p) => p.codigo === codigo);

describe('dados bancários do credor: permissão própria (C1-026)', () => {
  it('a gravação da conta do credor pede financeiro.contaCredor.manter; a remessa por Pix, financeiro.remessa.gerar', () => {
    expect(meta(CHAVE_PERMISSAO, 'manterConta')).toBe('financeiro.contaCredor.manter');
    expect(meta(CHAVE_PERMISSAO, 'gerarPix')).toBe('financeiro.remessa.gerar');
    expect(String(meta(CHAVE_AUDITADO_NO_HANDLER, 'manterConta'))).toMatch(/^financeiro\.manterContaCredor /);
    for (const m of ['credores', 'contas', 'bancos'])
      expect(meta(CHAVE_PERMISSAO, m)).toBe('financeiro.tituloPagar.ler');
  });

  it('a permissão é sensível e concedida pelo perfil do cadastro de credores, que existe no catálogo', () => {
    const d = declaracao('financeiro.contaCredor.manter');
    expect(d).toMatchObject({ criticidade: 'sensivel', concessaoPorPerfil: 'por-perfil' });
    expect(d?.perfis).toContain('cadastro-credor');
    expect(PERFIS_COMPLEMENTARES as readonly string[]).toContain('cadastro-credor');
    // Recurso só do novo: nenhuma opção do menu de origem dá a permissão (quem gera a remessa não a herda).
    expect(opcoesDasPermissoes('financeiro.contaCredor.manter')).toEqual([]);
  });

  it('o usuário sintético do cadastro de credores mantém a conta e não gera remessa; quem paga não mantém a conta', () => {
    const credor = CONTAS_SINTETICAS['SINT.FIN.CREDOR'];
    expect(credor?.perfisConcedidos).toEqual(['cadastro-credor']);
    const opcoesRemessa = new Set(
      opcoesDasPermissoes('financeiro.remessa.gerar', 'financeiro.tituloPagar.baixar'),
    );
    expect((credor?.concessoes?.opcoesGrupo ?? []).some((o) => opcoesRemessa.has(o))).toBe(false);
    const paga = CONTAS_SINTETICAS['SINT.FIN.PAGA'];
    expect(paga?.perfisConcedidos ?? []).not.toContain('cadastro-credor');
  });
});
