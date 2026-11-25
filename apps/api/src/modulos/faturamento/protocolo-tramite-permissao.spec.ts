// F3.7, 06-FAT linha 22 (C1-114): o protocolo de documentos entre setores tem permissões próprias. A
// faturamento.protocolo.registrar é o protocolo do lote da operadora (supervisor, sensível) e não serve ao setor que
// emite nem ao que recebe; o trâmite usa faturamento.tramite.ler e faturamento.tramite.registrar, dadas pelo perfil
// protocolo-documentos. As rotas de gravação declaram a trilha no handler.
import 'reflect-metadata';
import { ARVORE_MENU, PERFIS_COMPLEMENTARES, PERMISSOES_FATURAMENTO_M30 } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { opcoesDasPermissoes } from '../../autorizacao/catalogo.js';
import { CHAVE_AUDITADO_NO_HANDLER, CHAVE_PERMISSAO } from '../../autorizacao/decoradores.js';
import { CONTAS_SINTETICAS } from '../acesso/fonte-sintetica.js';
import { AuditoriaTramiteController } from './auditoria-tramite.controller.js';

const proto = AuditoriaTramiteController.prototype as unknown as Record<string, object>;
const meta = (chave: string, metodo: string): unknown => {
  const alvo = proto[metodo];
  if (!alvo) throw new Error(`rota ausente: ${metodo}`);
  return Reflect.getMetadata(chave, alvo);
};
const declaracao = (codigo: string) => PERMISSOES_FATURAMENTO_M30.find((p) => p.codigo === codigo);

describe('protocolo de documentos entre setores: permissões próprias (C1-114)', () => {
  it('consultar pede faturamento.tramite.ler; emitir, enviar, conferir e cancelar pedem faturamento.tramite.registrar', () => {
    for (const m of ['protocolos', 'alvosProtocolo'])
      expect(meta(CHAVE_PERMISSAO, m)).toBe('faturamento.tramite.ler');
    for (const m of ['emitir', 'enviar', 'conferir', 'cancelarProtocolo']) {
      expect(meta(CHAVE_PERMISSAO, m)).toBe('faturamento.tramite.registrar');
      expect(meta(CHAVE_AUDITADO_NO_HANDLER, m)).toBeTruthy();
    }
  });

  it('as duas estão no catálogo, concedidas pelo perfil protocolo-documentos e sem opção do menu de origem', () => {
    for (const codigo of ['faturamento.tramite.ler', 'faturamento.tramite.registrar']) {
      const d = declaracao(codigo);
      expect(d).toMatchObject({ concessaoPorPerfil: 'por-perfil', categoria: 'administrativa' });
      expect(d?.perfis).toContain('protocolo-documentos');
      for (const p of d?.perfis ?? []) expect(PERFIS_COMPLEMENTARES as readonly string[]).toContain(p);
      expect(opcoesDasPermissoes(codigo)).toEqual([]);
    }
    // O protocolo do lote da operadora segue do supervisor, sem o perfil do trâmite.
    expect(declaracao('faturamento.protocolo.registrar')).toBeUndefined();
  });

  it('o item do menu abre com a permissão de consulta do trâmite', () => {
    const item = ARVORE_MENU.find((i) => i.rota === '/faturamento/protocolos');
    expect(item?.permissao).toBe('faturamento.tramite.ler');
  });

  it('o faturista das contas recebe o perfil; a conta das contas sem o perfil não grava o trâmite', () => {
    const perfisDe = (login: string) => new Set(CONTAS_SINTETICAS[login]?.perfisConcedidos ?? []);
    const pelaPerfil = (login: string, codigo: string) =>
      (declaracao(codigo)?.perfis ?? []).some((p) => perfisDe(login).has(p));
    expect(pelaPerfil('SINT.CONTAS', 'faturamento.tramite.ler')).toBe(true);
    expect(pelaPerfil('SINT.CONTAS', 'faturamento.tramite.registrar')).toBe(true);
    expect(pelaPerfil('SINT.CONTAS.C10', 'faturamento.tramite.registrar')).toBe(false);
  });
});
