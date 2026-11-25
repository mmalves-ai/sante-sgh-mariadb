// F7, 07-FIN linha 114 (C2-059): a NF-e de saída de mercadoria tem permissão própria. Ler (lista, apoio, histórico e
// DANFE) pede financeiro.notaMercadoria.ler; emitir, cancelar e corrigir pedem financeiro.notaMercadoria.emitir, que é
// sensível, concedida pelo perfil do emissor de nota fiscal e com a trilha gravada pelo executor no handler.
import 'reflect-metadata';
import { PERFIS_COMPLEMENTARES, PERMISSOES_FINANCEIRO_M32 } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { opcoesDasPermissoes } from '../../autorizacao/catalogo.js';
import { CHAVE_AUDITADO_NO_HANDLER, CHAVE_PERMISSAO } from '../../autorizacao/decoradores.js';
import { NotaMercadoriaController } from './nota-mercadoria.controller.js';

const proto = NotaMercadoriaController.prototype as unknown as Record<string, object>;
const meta = (chave: string, metodo: string): unknown => {
  const alvo = proto[metodo];
  if (!alvo) throw new Error(`rota ausente: ${metodo}`);
  return Reflect.getMetadata(chave, alvo);
};
const declaracao = (codigo: string) => PERMISSOES_FINANCEIRO_M32.find((p) => p.codigo === codigo);

describe('NF-e de saída de mercadoria: permissão própria (C2-059)', () => {
  it('as leituras pedem financeiro.notaMercadoria.ler; as gravações, emitir, com a trilha no handler', () => {
    for (const m of ['listar', 'apoio', 'historico', 'danfe'])
      expect(meta(CHAVE_PERMISSAO, m)).toBe('financeiro.notaMercadoria.ler');
    for (const [m, op] of [
      ['emitir', 'financeiro.emitir_nota_mercadoria'],
      ['cancelar', 'financeiro.cancelar_nota_mercadoria'],
      ['corrigir', 'financeiro.corrigir_nota_mercadoria'],
    ] as const) {
      expect(meta(CHAVE_PERMISSAO, m)).toBe('financeiro.notaMercadoria.emitir');
      expect(String(meta(CHAVE_AUDITADO_NO_HANDLER, m))).toMatch(new RegExp(`^${op.replace('.', '\\.')} `));
    }
  });

  it('emitir é sensível e vem do perfil do emissor de nota fiscal, que existe no catálogo; nenhuma opção antiga a dá', () => {
    const emitir = declaracao('financeiro.notaMercadoria.emitir');
    expect(emitir).toMatchObject({ criticidade: 'sensivel', concessaoPorPerfil: 'por-perfil' });
    expect(emitir?.perfis).toEqual(['emissor-nota-fiscal', 'administrador-sistema']);
    expect(declaracao('financeiro.notaMercadoria.ler')?.perfis).toContain('emissor-nota-fiscal');
    expect(PERFIS_COMPLEMENTARES as readonly string[]).toContain('emissor-nota-fiscal');
    expect(opcoesDasPermissoes('financeiro.notaMercadoria.emitir')).toEqual([]);
  });
});
