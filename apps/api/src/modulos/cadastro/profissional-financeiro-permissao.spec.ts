// C2-004 (02-CAD linha 16): os dados fiscais e as contas do profissional são concedidos pelo administrador pelo mapa
// perfil → permissão da gestão de acesso (mínimo privilégio, LGPD): de fábrica só o administrador do sistema; o cargo do
// repasse (perfil financeiro) recebe pela decisão no mapa, e a recusa "Permissão fora do mapa" não se aplica a elas.
import { describe, expect, it } from 'vitest';
import { CATALOGO_COMPLETO } from '../../autorizacao/catalogo.js';
import { PERFIS_DA_TELA } from '../acesso/gestao.controller.js';

const CODIGOS = ['cadastro.profissionalFinanceiro.ler', 'cadastro.profissionalFinanceiro.editar'];

describe('permissões do financeiro do profissional pelo mapa perfil → permissão', () => {
  it('são concedidas por perfil, só ao administrador de fábrica, e o mapa as aceita para o perfil financeiro', () => {
    for (const codigo of CODIGOS) {
      const p = CATALOGO_COMPLETO.find((x) => x.codigo === codigo);
      expect(p, codigo).toBeDefined();
      // O mapa perfil → permissão só aceita o que é concedido por perfil (POR_PERFIL da gestão).
      expect(p?.concessaoPorPerfil).toBe('por-perfil');
      expect(p?.perfis).toEqual(['administrador-sistema']);
    }
    expect(PERFIS_DA_TELA).toContain('financeiro');
  });
});
