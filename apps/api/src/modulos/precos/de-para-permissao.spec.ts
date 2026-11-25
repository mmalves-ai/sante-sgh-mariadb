// F3.7, 06-FAT linha 9 (C1-040): o de-para do item do hospital para o código da fonte pagadora tem permissão própria.
// Quem mantém o de-para (preco.dePara.editar) não precisa editar o contrato do convênio (convenio.contrato.editar,
// crítica) e vice-versa; a consulta segue com preco.dePara.ler. As rotas de gravação declaram a trilha no handler.
import 'reflect-metadata';
import { PERMISSOES_M12, PERFIS_COMPLEMENTARES } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { opcoesDasPermissoes } from '../../autorizacao/catalogo.js';
import { CHAVE_AUDITADO_NO_HANDLER, CHAVE_PERMISSAO } from '../../autorizacao/decoradores.js';
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
    expect(d?.perfis?.length).toBeGreaterThan(0);
    for (const p of d?.perfis ?? []) expect(PERFIS_COMPLEMENTARES as readonly string[]).toContain(p);
    expect(opcoesDasPermissoes('preco.dePara.editar')).toEqual([]);
    expect(PERMISSOES_M12.find((p) => p.codigo === 'preco.dePara.ler')).toBeTruthy();
  });
});
