// Contratos do BI consolidado da Rede e dos serviços compartilhados (M57, etapa 3): permissões só do perfil da
// diretoria da Rede, sem nenhuma do prontuário (regra 10); os recursos desligados com o motivo (POL-3; DP-42); a
// validação dos registros de serviço compartilhado (CP1252, envolvidos sem repetição).
import { describe, expect, it } from 'vitest';
import { recursoDesligado } from '../liberacao/recursos.js';
import { CATALOGO_DECLARADO, PERFIS_COMPLEMENTARES } from '../permissoes/catalogo.js';
import { PERFIL_DIRETORIA_REDE, PERMISSOES_REDE_BI_CODIGOS } from '../permissoes/rede-bi.js';
import { FORMATO_CODIGO_PERMISSAO } from '../permissoes/tipos.js';
import {
  CHAVE_LIBERACAO_BI_REDE,
  CHAVE_PSEUDONIMO_COMUM_REDE,
  esquemaAlterarServicoCompartilhado,
  esquemaConsultaBiRede,
  esquemaConsultaServicosRede,
  esquemaNovoServicoCompartilhado,
} from './bi.js';

describe('permissões do BI da Rede', () => {
  it('as duas da etapa 3, no formato, só pelo perfil da diretoria da Rede', () => {
    const codigos = Object.values(PERMISSOES_REDE_BI_CODIGOS);
    expect(codigos).toEqual(['relatorio.biRede.acessar', 'rede.servico.registrar']);
    expect(PERFIS_COMPLEMENTARES).toContain(PERFIL_DIRETORIA_REDE);
    for (const c of codigos) {
      const p = CATALOGO_DECLARADO.find((x) => x.codigo === c)!;
      expect(p.codigo).toMatch(FORMATO_CODIGO_PERMISSAO);
      expect(p.concessaoPorPerfil).toBe('por-perfil');
      expect(p.perfis).toEqual([PERFIL_DIRETORIA_REDE]);
      expect(p.categoria).toBe('administrativa');
    }
  });

  it('regra 10: o perfil da diretoria da Rede não concede nenhuma permissão do prontuário', () => {
    const doPerfil = CATALOGO_DECLARADO.filter((p) => (p.perfis ?? []).includes(PERFIL_DIRETORIA_REDE));
    expect(doPerfil.map((p) => p.codigo).sort()).toEqual([
      'config.rotinaCliente.gerir',
      'rede.servico.registrar',
      'relatorio.biRede.acessar',
      'relatorio.painelGerencial.ler',
    ]);
    expect(doPerfil.some((p) => p.codigo.startsWith('pep.') || p.categoria === 'clinica')).toBe(false);
  });
});

describe('recursos do BI da Rede (POL-3)', () => {
  it('o BI e o pseudônimo comum saem desligados, com os pré-requisitos (o comum só com a DP-42)', () => {
    expect(recursoDesligado(CHAVE_LIBERACAO_BI_REDE)?.prerequisitos.length).toBe(2);
    const comum = recursoDesligado(CHAVE_PSEUDONIMO_COMUM_REDE)!;
    expect(comum.prerequisitos.map((p) => p.descricao).join(' ')).toMatch(/DP-42/);
  });
});

describe('consultas e registros', () => {
  it('a consulta do BI aceita só meses válidos', () => {
    expect(esquemaConsultaBiRede.safeParse({ de: '2026-01', ate: '2026-06' }).success).toBe(true);
    expect(esquemaConsultaBiRede.safeParse({ de: '2026-13' }).success).toBe(false);
    expect(esquemaConsultaBiRede.safeParse({ outro: '1' }).success).toBe(false);
  });

  it('o registro de serviço: título de 3 a 120, área do vocabulário, envolvidos sem repetição', () => {
    const ok = {
      area: 'compras',
      titulo: 'Compra conjunta de material SINTETICO',
      estabelecimentos: ['pc', 'hs'],
    };
    expect(esquemaNovoServicoCompartilhado.safeParse(ok).success).toBe(true);
    expect(esquemaNovoServicoCompartilhado.safeParse({ ...ok, titulo: 'ab' }).success).toBe(false);
    expect(esquemaNovoServicoCompartilhado.safeParse({ ...ok, area: 'rh' }).success).toBe(false);
    expect(esquemaNovoServicoCompartilhado.safeParse({ ...ok, estabelecimentos: ['pc', 'pc'] }).success).toBe(
      false,
    );
    expect(esquemaNovoServicoCompartilhado.safeParse({ ...ok, estabelecimentos: [] }).success).toBe(false);
    expect(esquemaNovoServicoCompartilhado.safeParse({ ...ok, titulo: 'Compra 😀 conjunta' }).success).toBe(
      false,
    );
    expect(esquemaAlterarServicoCompartilhado.safeParse({}).success).toBe(false);
    expect(esquemaAlterarServicoCompartilhado.safeParse({ situacao: 'adotada' }).success).toBe(true);
    expect(esquemaConsultaServicosRede.parse({})).toEqual({ pagina: 1, porPagina: 20 });
  });
});
