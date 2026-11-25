// F3.7, 06-FAT linha 9 (C1-040): o de-para do item do hospital para o código da fonte pagadora tem permissão própria.
// Quem mantém o de-para (preco.dePara.editar) não precisa editar o contrato do convênio (convenio.contrato.editar,
// crítica) e vice-versa; a consulta segue com preco.dePara.ler. As rotas de gravação declaram a trilha no handler.
import 'reflect-metadata';
import { PERMISSOES_M12, PERFIS_COMPLEMENTARES } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { opcoesDasPermissoes } from '../../autorizacao/catalogo.js';
import { CHAVE_AUDITADO_NO_HANDLER, CHAVE_PERMISSAO } from '../../autorizacao/decoradores.js';
import { CONTAS_SINTETICAS } from '../acesso/fonte-sintetica.js';
import { CobrancaController } from './cobranca.controller.js';

const proto = CobrancaController.prototype as unknown as Record<string, object>;
const meta = (chave: string, metodo: string): unknown => {
  const alvo = proto[metodo];
  if (!alvo) throw new Error(`rota ausente: ${metodo}`);
  return Reflect.getMetadata(chave, alvo);
};

describe('de-para da fonte pagadora: permissão própria (C1-040)', () => {
  it('gravar e encerrar o de-para pedem preco.dePara.editar, com a trilha no handler', () => {
    for (const m of ['gravarDePara', 'encerrarDePara']) {
      expect(meta(CHAVE_PERMISSAO, m)).toBe('preco.dePara.editar');
      expect(meta(CHAVE_AUDITADO_NO_HANDLER, m)).toBeTruthy();
    }
    // A equivalência do mat/med com a operadora continua com quem edita o contrato.
    expect(meta(CHAVE_PERMISSAO, 'gravarEquivalenciaMatmed')).toBe('convenio.contrato.editar');
  });

  it('a permissão está no catálogo, financeira, concedida por perfil existente e sem opção do menu de origem', () => {
    const d = PERMISSOES_M12.find((p) => p.codigo === 'preco.dePara.editar');
    expect(d).toMatchObject({ concessaoPorPerfil: 'por-perfil', categoria: 'financeira' });
    // O papel do faturamento que mantém o de-para recebe a permissão pelo perfil próprio, não só o administrador.
    expect(d?.perfis).toContain('faturamento-de-para');
    expect(PERFIS_COMPLEMENTARES as readonly string[]).toContain('faturamento-de-para');
    for (const p of d?.perfis ?? []) expect(PERFIS_COMPLEMENTARES as readonly string[]).toContain(p);
    // O perfil do de-para não dá a edição do contrato do convênio (crítica), que segue só pelas opções do menu.
    const contrato = PERMISSOES_M12.find((p) => p.codigo === 'convenio.contrato.editar');
    expect(contrato?.perfis ?? []).not.toContain('faturamento-de-para');
    expect(opcoesDasPermissoes('preco.dePara.editar')).toEqual([]);
    expect(PERMISSOES_M12.find((p) => p.codigo === 'preco.dePara.ler')).toBeTruthy();
  });

  it('o faturista do de-para recebe preco.dePara.editar pelo perfil e não recebe convenio.contrato.editar', () => {
    const conta = CONTAS_SINTETICAS['SINT.FAT.DEPARA'];
    expect(conta?.perfisConcedidos).toEqual(['faturamento-de-para']);
    const perfis = new Set(conta?.perfisConcedidos ?? []);
    const pelaPerfil = (codigo: string) =>
      (PERMISSOES_M12.find((p) => p.codigo === codigo)?.perfis ?? []).some((p) => perfis.has(p));
    expect(pelaPerfil('preco.dePara.editar')).toBe(true);
    expect(pelaPerfil('convenio.contrato.editar')).toBe(false);
    const opcoesContrato = new Set(opcoesDasPermissoes('convenio.contrato.editar'));
    const opcoes = conta?.concessoes?.opcoesGrupo ?? [];
    expect(opcoes.some((o) => opcoesContrato.has(o))).toBe(false);
    // Consulta o de-para pelas opções do menu de origem.
    const opcoesLer = new Set(opcoesDasPermissoes('preco.dePara.ler'));
    expect(opcoes.some((o) => opcoesLer.has(o))).toBe(true);
    // O supervisor do faturamento migrado continua mantendo o de-para.
    expect(CONTAS_SINTETICAS['SINT.FATURAMENTO']?.perfisConcedidos).toContain('faturamento-de-para');
  });
});
