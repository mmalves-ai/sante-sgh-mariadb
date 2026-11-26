// F7, 07-FIN linha 92 (C1-084): a aprovação da devolução do adiantamento ao paciente tem permissão própria. A
// financeiro.adiantamento.aprovar é a aprovação do adiantamento a fornecedor ou médico (alçada do título a pagar) e não
// serve à saída de dinheiro do caixa para o paciente; a devolução usa faturamento.devolucaoAdiantamento.aprovar, dada
// pelo perfil aprovador-devolucao-paciente. A rota de gravação declara a trilha no handler.
import 'reflect-metadata';
import { PERFIS_COMPLEMENTARES, PERMISSOES_FATURAMENTO_M30 } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { opcoesDasPermissoes } from '../../autorizacao/catalogo.js';
import { CHAVE_AUDITADO_NO_HANDLER, CHAVE_PERMISSAO } from '../../autorizacao/decoradores.js';
import { CONTAS_SINTETICAS } from '../acesso/fonte-sintetica.js';
import { ParticularAdiantamentoController } from './particular-adiantamento.controller.js';

const CODIGO = 'faturamento.devolucaoAdiantamento.aprovar';
const proto = ParticularAdiantamentoController.prototype as unknown as Record<string, object>;
const meta = (chave: string, metodo: string): unknown => {
  const alvo = proto[metodo];
  if (!alvo) throw new Error(`rota ausente: ${metodo}`);
  return Reflect.getMetadata(chave, alvo);
};

describe('devolução do adiantamento ao paciente: permissão própria da aprovação (C1-084)', () => {
  it('aprovar pede faturamento.devolucaoAdiantamento.aprovar e declara a trilha; pedir e cancelar seguem do caixa', () => {
    expect(meta(CHAVE_PERMISSAO, 'aprovarDevolucao')).toBe(CODIGO);
    expect(meta(CHAVE_AUDITADO_NO_HANDLER, 'aprovarDevolucao')).toBeTruthy();
    expect(meta(CHAVE_PERMISSAO, 'devolver')).toBe('faturamento.recibo.emitir');
    expect(meta(CHAVE_PERMISSAO, 'cancelarDevolucao')).toBe('faturamento.recibo.emitir');
  });

  it('está no catálogo, concedida pelo perfil aprovador-devolucao-paciente e sem opção do menu de origem', () => {
    const d = PERMISSOES_FATURAMENTO_M30.find((p) => p.codigo === CODIGO);
    expect(d).toMatchObject({
      concessaoPorPerfil: 'por-perfil',
      categoria: 'financeira',
      criticidade: 'sensivel',
    });
    expect(d?.perfis).toContain('aprovador-devolucao-paciente');
    for (const p of d?.perfis ?? []) expect(PERFIS_COMPLEMENTARES as readonly string[]).toContain(p);
    expect(opcoesDasPermissoes(CODIGO)).toEqual([]);
  });

  it('o aprovador do financeiro recebe o perfil; o operador do caixa (quem pede) não', () => {
    const d = PERMISSOES_FATURAMENTO_M30.find((p) => p.codigo === CODIGO);
    const temPeloPerfil = (login: string) => {
      const perfis = new Set(CONTAS_SINTETICAS[login]?.perfisConcedidos ?? []);
      return (d?.perfis ?? []).some((p) => perfis.has(p));
    };
    expect(temPeloPerfil('SINT.FIN.APROVA')).toBe(true);
    expect(temPeloPerfil('SINT.CAIXA')).toBe(false);
  });
});
