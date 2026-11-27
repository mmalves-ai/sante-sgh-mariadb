// F7, 06-SUS linha 53 (C1-051): a configuração do faturamento SUS (permissão por usuário e setor e parâmetros por
// instrumento) é editada pela faturamento.susConfiguracao.editar, concedida por perfil: o perfil próprio da supervisão
// do faturamento SUS (supervisao-faturamento-sus) ou o administrador do sistema. A supervisão recebe o perfil, e o
// faturista SUS só lê. Sem opção do menu de origem: quem só tem as opções do faturamento SUS não configura.
import { PERFIS_COMPLEMENTARES, PERMISSOES_FATURAMENTO_M51 } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { opcoesDasPermissoes } from '../../autorizacao/catalogo.js';
import { CONTAS_SINTETICAS } from '../acesso/fonte-sintetica.js';

const CODIGO = 'faturamento.susConfiguracao.editar';
const pelaPerfil = (login: string): boolean => {
  const perfis = new Set(CONTAS_SINTETICAS[login]?.perfisConcedidos ?? []);
  return (PERMISSOES_FATURAMENTO_M51.find((p) => p.codigo === CODIGO)?.perfis ?? []).some((p) =>
    perfis.has(p),
  );
};

describe('configuração do faturamento SUS: permissão por perfil (C1-051)', () => {
  it('a permissão é por perfil, com o perfil próprio da supervisão e sem opção do menu de origem', () => {
    const d = PERMISSOES_FATURAMENTO_M51.find((p) => p.codigo === CODIGO);
    expect(d).toMatchObject({ concessaoPorPerfil: 'por-perfil' });
    expect(d?.perfis).toEqual(['supervisao-faturamento-sus', 'administrador-sistema']);
    expect(PERFIS_COMPLEMENTARES as readonly string[]).toContain('supervisao-faturamento-sus');
    expect(opcoesDasPermissoes(CODIGO)).toEqual([]);
  });

  it('a supervisão do SUS configura pelo perfil; o faturista SUS e o administrador sintético, não', () => {
    expect(CONTAS_SINTETICAS['SINT.SUS.CONFIGURACAO']?.perfisConcedidos).toEqual([
      'supervisao-faturamento-sus',
    ]);
    expect(pelaPerfil('SINT.SUS.CONFIGURACAO')).toBe(true);
    expect(pelaPerfil('SINT.FATURISTA.SUS')).toBe(false);
    expect(pelaPerfil('SINT.ADMIN')).toBe(false);
  });
});
