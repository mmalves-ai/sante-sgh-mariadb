// F7, 09-AREA linha 78 (C2-094): a entrada de serviço tomado tem permissão própria. Ler (apoio, lista, prévia das
// retenções e detalhe) pede financeiro.entradaServico.ler; registrar, concluir e cancelar pedem
// financeiro.entradaServico.lancar, que é sensível, concedida pelo perfil do emissor de nota fiscal e com a trilha
// gravada pelo executor no handler.
import 'reflect-metadata';
import { PERFIS_COMPLEMENTARES, PERMISSOES_FINANCEIRO_M32 } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { opcoesDasPermissoes } from '../../autorizacao/catalogo.js';
import { CHAVE_AUDITADO_NO_HANDLER, CHAVE_PERMISSAO } from '../../autorizacao/decoradores.js';
import { EntradaServicoController } from './entrada-servico.controller.js';

const proto = EntradaServicoController.prototype as unknown as Record<string, object>;
const meta = (chave: string, metodo: string): unknown => {
  const alvo = proto[metodo];
  if (!alvo) throw new Error(`rota ausente: ${metodo}`);
  return Reflect.getMetadata(chave, alvo);
};
const declaracao = (codigo: string) => PERMISSOES_FINANCEIRO_M32.find((p) => p.codigo === codigo);

describe('entrada de serviço tomado: permissão própria (C2-094)', () => {
  it('as leituras pedem financeiro.entradaServico.ler; as gravações, lancar, com a trilha no handler', () => {
    for (const m of ['apoio', 'listar', 'retencoes', 'detalhe'])
      expect(meta(CHAVE_PERMISSAO, m)).toBe('financeiro.entradaServico.ler');
    for (const [m, op] of [
      ['registrar', 'financeiro.entrada_servico_registrar'],
      ['concluir', 'financeiro.entrada_servico_concluir'],
      ['cancelar', 'financeiro.entrada_servico_cancelar'],
    ] as const) {
      expect(meta(CHAVE_PERMISSAO, m)).toBe('financeiro.entradaServico.lancar');
      expect(String(meta(CHAVE_AUDITADO_NO_HANDLER, m))).toMatch(new RegExp(`^${op.replace('.', '\\.')} `));
    }
  });

  it('lancar é sensível e vem do perfil do emissor de nota fiscal, que existe no catálogo; nenhuma opção antiga a dá', () => {
    const lancar = declaracao('financeiro.entradaServico.lancar');
    expect(lancar).toMatchObject({ criticidade: 'sensivel', concessaoPorPerfil: 'por-perfil' });
    expect(lancar?.perfis).toEqual(['emissor-nota-fiscal', 'administrador-sistema']);
    expect(declaracao('financeiro.entradaServico.ler')?.perfis).toEqual([
      'emissor-nota-fiscal',
      'administrador-sistema',
    ]);
    expect(PERFIS_COMPLEMENTARES as readonly string[]).toContain('emissor-nota-fiscal');
    expect(opcoesDasPermissoes('financeiro.entradaServico.lancar')).toEqual([]);
    expect(opcoesDasPermissoes('financeiro.entradaServico.ler')).toEqual([]);
  });
});
