// Contratos da operadora própria (M56, etapa F0): inventário das 80 tabelas igual ao do marco na matriz, chaves por
// fatia desligadas no catálogo POL-3, permissões no catálogo e vocabulário dos domínios.
import { describe, expect, it } from 'vitest';
import { RECURSOS_DESLIGADOS, recursoDesligado } from '../liberacao/recursos.js';
import { DOMINIOS_M56 } from '../dominios/dominios-m56.gerado.js';
import { ARVORE_MENU } from '../menu/arvore.js';
import { CATALOGO_DECLARADO } from '../permissoes/catalogo.js';
import {
  PERFIL_PORTAL_PRESTADOR,
  PERFIS_OPERADORA,
  PERMISSOES_OPERADORA_M56,
} from '../permissoes/operadora.js';
import { FORMATO_CODIGO_PERMISSAO } from '../permissoes/tipos.js';
import { CHAVE_MODULO_OPERADORA, CHAVES_FATIA_OPERADORA, CHAVES_OPERADORA } from './chaves.js';
import { TELAS_OPERADORA } from './inventario.js';
import {
  CODIGOS_OBRIGACAO_ANS,
  OBRIGACOES_ANS,
  TIPOS_COBRANCA_OPERADORA,
  VINCULO_TITULAR,
  VINCULOS_TITULAR,
} from './vocabulario.js';
import { opcoesDoMapa } from '../permissoes/mapa-origem-teste.js';

describe('telas da operadora', () => {
  it('cada tela da operadora existe na árvore do menu', () => {
    const itens = new Set(ARVORE_MENU.map((i) => i.id));
    for (const id of Object.values(TELAS_OPERADORA)) expect(itens.has(id), id).toBe(true);
  });
});

describe('chaves de liberação da operadora (regra 1)', () => {
  it('a do módulo e as 10 das fatias estão no catálogo de recursos desligados, do M56', () => {
    expect(CHAVES_OPERADORA).toHaveLength(1 + CHAVES_FATIA_OPERADORA.length);
    expect(CHAVES_FATIA_OPERADORA).toHaveLength(10);
    for (const c of CHAVES_OPERADORA) {
      const r = recursoDesligado(c);
      expect(r, c).toBeDefined();
      expect(r?.marco).toBe('M56');
    }
    const todas = RECURSOS_DESLIGADOS.map((r) => r.chave);
    expect(new Set(todas).size).toBe(todas.length);
  });

  it('a do módulo pede o registro na ANS; a dos envios pede o certificado; a das mensagens, a base legal', () => {
    expect(recursoDesligado(CHAVE_MODULO_OPERADORA)?.prerequisitos.map((p) => p.tipo)).toEqual([
      'credenciamento',
    ]);
    // M56.7 (D-LEIAUTE-ANS-567): e a conferência dos arquivos de teste no validador oficial.
    expect(recursoDesligado('operadora.ans')?.prerequisitos.map((p) => p.tipo)).toEqual([
      'certificado',
      'aprovacao',
    ]);
    expect(recursoDesligado('operadora.mensagens')?.prerequisitos[0]?.descricao).toMatch(/DP-44/);
    expect(recursoDesligado('operadora.interface')?.decisao).toMatch(/M56-F8/);
  });

  it('título e descrição não citam o sistema anterior', () => {
    for (const c of CHAVES_OPERADORA) {
      const r = recursoDesligado(c);
      expect(`${r?.titulo} ${r?.descricao}`, c).not.toMatch(/spdata|legado|\bSGO\b|sistema atual/i);
    }
  });
});

describe('permissões da operadora', () => {
  const codigos = new Set(CATALOGO_DECLARADO.map((p) => p.codigo));

  it('as 12 da ficha (seção 7) e as do D-PERM-56 estão no catálogo declarado', () => {
    for (const c of [
      'operadora.beneficiario.ler',
      'operadora.beneficiario.editar',
      'operadora.prestador.ler',
      'operadora.prestador.editar',
      'operadora.autorizacao.ler',
      'operadora.autorizacao.decidir',
      'operadora.cobranca.ler',
      'operadora.cobranca.gerar',
      'operadora.ans.ler',
      'operadora.ans.gerar',
      'operadora.dominio.ler',
      'operadora.dominio.editar',
    ])
      expect(codigos.has(c), c).toBe(true);
    for (const p of PERMISSOES_OPERADORA_M56) expect(codigos.has(p.codigo), p.codigo).toBe(true);
  });

  it('nenhuma vem do outro sistema; todas por perfil da operadora ou do portal, sem escopo', () => {
    const perfis = new Set<string>([...PERFIS_OPERADORA, PERFIL_PORTAL_PRESTADOR]);
    for (const p of PERMISSOES_OPERADORA_M56) {
      expect(p.codigo).toMatch(FORMATO_CODIGO_PERMISSAO);
      expect(p.codigo.startsWith('operadora.')).toBe(true);
      expect(opcoesDoMapa(p.codigo)).toEqual([]);
      expect(p.concessaoPorPerfil).toBe('por-perfil');
      expect(p.perfis?.length, p.codigo).toBeGreaterThan(0);
      for (const x of p.perfis ?? []) expect(perfis.has(x), `${p.codigo}: ${x}`).toBe(true);
      expect(p.escopos).toEqual([]);
    }
  });

  it('conteúdo clínico (guia e conta) nunca para o gestor; decidir e analisar exigem conselho', () => {
    for (const p of PERMISSOES_OPERADORA_M56.filter((x) => x.categoria === 'clinica'))
      expect(p.perfis?.includes('operadora-gestor'), p.codigo).toBe(false);
    const decidir = PERMISSOES_OPERADORA_M56.find((p) => p.codigo === 'operadora.autorizacao.decidir');
    expect(decidir?.exigeConselho).toBe(true);
    expect(PERMISSOES_OPERADORA_M56.find((p) => p.codigo === 'operadora.conta.analisar')?.exigeConselho).toBe(
      true,
    );
    expect(PERMISSOES_OPERADORA_M56.find((p) => p.codigo === 'operadora.ans.gerar')?.criticidade).toBe(
      'critica',
    );
    const portal = PERMISSOES_OPERADORA_M56.filter((p) => p.perfis?.includes(PERFIL_PORTAL_PRESTADOR));
    expect(portal.map((p) => p.codigo)).toEqual(['operadora.portal.acessar']);
  });

  it('o item do atendimento abre a quem lê os domínios: o gestor alcança e grava os motivos de ligação (revisão M56.5)', () => {
    const item = ARVORE_MENU.find(
      (i) =>
        i.id ===
        'faturamento.operadora-propria-sgo-se-a-rede-tiver-plano.atendimento-autorizacao-e-protocolos',
    );
    expect(item?.rota).toBe('/operadora/autorizacoes');
    expect(item?.permissao).toBe('operadora.dominio.ler');
    const perfisDe = (c: string) => PERMISSOES_OPERADORA_M56.find((p) => p.codigo === c)?.perfis ?? [];
    for (const perfil of PERFIS_OPERADORA)
      expect(perfisDe('operadora.dominio.ler'), perfil).toContain(perfil);
    // As guias (conteúdo clínico) seguem fora do gestor; a tela as esconde de quem não as lê.
    expect(perfisDe('operadora.autorizacao.ler')).not.toContain('operadora-gestor');
    const motivo = DOMINIOS_M56.find(
      (d) => d.subitem === 'operadoraAtendimento' && d.recurso === 'motivoLigacao',
    );
    expect(motivo?.perfis?.gravar).toContain('operadora-gestor');
    expect(motivo?.perfis?.ler).toContain('operadora-gestor');
  });
});

describe('vocabulário dos domínios', () => {
  it('tipos de cobrança 1 a 4 (ref 02) e o vínculo do titular', () => {
    expect(Object.keys(TIPOS_COBRANCA_OPERADORA)).toEqual(['1', '2', '3', '4']);
    expect(TIPOS_COBRANCA_OPERADORA[1]).toBe('Mensalidade');
    expect(VINCULOS_TITULAR[VINCULO_TITULAR]).toBe('Titular');
    expect(Object.keys(VINCULOS_TITULAR)).toHaveLength(8);
  });

  it('as obrigações com a ANS da ficha, cada uma com periodicidade', () => {
    expect(CODIGOS_OBRIGACAO_ANS).toEqual([
      'SIB',
      'SIP',
      'DIOPS',
      'TPS',
      'MONITORAMENTO_TISS',
      'RESSARCIMENTO_SUS',
    ]);
    for (const c of CODIGOS_OBRIGACAO_ANS) expect(OBRIGACOES_ANS[c].periodicidade).toBeTruthy();
  });
});
