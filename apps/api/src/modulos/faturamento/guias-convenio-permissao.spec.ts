// F3.7, 06-FAT linha 24 (C1-122): as guias do convênio no hospital. A tela abre com faturamento.guia.ler (menu e
// rota); as cinco gravações (assumir, resposta da operadora, abrir e resolver pendência, anexo) pedem
// faturamento.pendencia.editar e declaram a trilha no handler. A conta sintética SINT.GUIAS consulta e grava (o E2E
// @C1-122 entra por ela); a SINT.TISS só consulta (o caso do leitor no E2E).
import 'reflect-metadata';
import { ARVORE_MENU } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { opcoesDasPermissoes } from '../../autorizacao/catalogo.js';
import { CHAVE_AUDITADO_NO_HANDLER, CHAVE_PERMISSAO } from '../../autorizacao/decoradores.js';
import { CONTAS_SINTETICAS } from '../acesso/fonte-sintetica.js';
import { AuditoriaTramiteController } from './auditoria-tramite.controller.js';

const proto = AuditoriaTramiteController.prototype as unknown as Record<string, object>;
const metodoDaRota = (rota: string): string => {
  for (const nome of Object.getOwnPropertyNames(proto)) {
    const alvo = proto[nome];
    if (typeof alvo === 'function' && Reflect.getMetadata('path', alvo) === rota) return nome;
  }
  throw new Error(`rota ausente: ${rota}`);
};
const meta = (chave: string, metodo: string): unknown => Reflect.getMetadata(chave, proto[metodo]!);
/** A conta sintética tem a permissão quando alguma opção do grupo dela concede o código. */
const tem = (login: string, codigo: string): boolean => {
  const opcoes = new Set(CONTAS_SINTETICAS[login]?.concessoes?.opcoesGrupo ?? []);
  return opcoesDasPermissoes(codigo).some((o) => opcoes.has(o));
};

const GRAVACOES = [
  'faturamento/guias/:id/resposta',
  'faturamento/guias/:id/pendencias',
  'faturamento/guias/pendencias/:id/resolucao',
  'faturamento/guias/:id/responsavel',
  'faturamento/guias/:id/anexos',
];

describe('guias do convênio no hospital: permissões (C1-122)', () => {
  it('as cinco gravações pedem faturamento.pendencia.editar e declaram a trilha', () => {
    for (const rota of GRAVACOES) {
      const m = metodoDaRota(rota);
      expect(meta(CHAVE_PERMISSAO, m), rota).toBe('faturamento.pendencia.editar');
      expect(meta(CHAVE_AUDITADO_NO_HANDLER, m), rota).toBeTruthy();
    }
  });

  it('o item do menu abre a tela com faturamento.guia.ler', () => {
    const item = ARVORE_MENU.find((i) => i.rota === '/faturamento/guias-convenio');
    expect(item?.permissao).toBe('faturamento.guia.ler');
  });

  it('SINT.GUIAS consulta e grava; SINT.TISS só consulta', () => {
    expect(tem('SINT.GUIAS', 'faturamento.guia.ler')).toBe(true);
    expect(tem('SINT.GUIAS', 'faturamento.pendencia.editar')).toBe(true);
    expect(tem('SINT.TISS', 'faturamento.guia.ler')).toBe(true);
    expect(tem('SINT.TISS', 'faturamento.pendencia.editar')).toBe(false);
  });
});
