// Contratos da assinatura ICP-Brasil (M49): permissões no catálogo, parâmetros com o padrão dentro da faixa, eventos de
// auditoria da regra 12, a chave de liberação e as entradas (o segredo nunca entra pela tela do provedor).
import { describe, expect, it } from 'vitest';
import { eventoAuditavel } from '../auditoria/eventos.js';
import { RECURSOS_DESLIGADOS } from '../liberacao/recursos.js';
import { PARAMETROS_DOCUMENTO_ASSINATURA } from '../parametros/documento-assinatura.js';
import { definicaoParametro } from '../parametros/definicoes.js';
import { CATALOGO_DECLARADO } from '../permissoes/catalogo.js';
import { PERMISSOES_DOCUMENTO_M49 } from '../permissoes/documento-assinatura.js';
import { FORMATO_CODIGO_PERMISSAO } from '../permissoes/tipos.js';
import {
  esquemaCodigoVerificacao,
  esquemaDefinirPoliticaAssinatura,
  esquemaPedirAssinaturaIcp,
  esquemaProvedorPsc,
  esquemaRespostaAgenteLocal,
  esquemaRetornoPsc,
  esquemaVincularCertificado,
} from './entradas.js';
import {
  MOTIVOS_RECUSA_ASSINATURA,
  NIVEIS_ASSINATURA,
  ROTULOS_NIVEL_ASSINATURA,
  TETO_LOTE_ASSINATURA,
  TIPOS_ATO_LEGADO_POR_TIPO_POLITICA,
  TIPOS_DOCUMENTO_POLITICA,
} from './vocabulario.js';

const H = 'a'.repeat(64);

describe('permissões do M49', () => {
  it('as da ficha (seção 7) estão no catálogo, com código válido e fonte de concessão', () => {
    const codigos = new Set(CATALOGO_DECLARADO.map((p) => p.codigo));
    for (const c of [
      'documento.assinatura.assinar',
      'documento.certificado.vincular',
      'documento.politica.ler',
      'documento.politica.editar',
      'documento.cadastro.ler',
      'documento.cadastro.editar',
      'documento.provedor.ler',
      'documento.provedor.editar',
    ])
      expect(codigos.has(c), c).toBe(true);
    for (const p of PERMISSOES_DOCUMENTO_M49) {
      expect(p.codigo).toMatch(FORMATO_CODIGO_PERMISSAO);
      expect(p.opcoesLegado.length > 0 || p.concessaoPorPerfil !== null, p.codigo).toBe(true);
    }
  });

  it('nenhuma repetida no catálogo inteiro', () => {
    const vistos = CATALOGO_DECLARADO.map((p) => p.codigo);
    expect(vistos.length).toBe(new Set(vistos).size);
  });

  it('assinar é clínica e crítica (reautenticação); a política e o provedor são críticos e por perfil', () => {
    const por = new Map<string, (typeof PERMISSOES_DOCUMENTO_M49)[number]>(
      PERMISSOES_DOCUMENTO_M49.map((p) => [p.codigo, p]),
    );
    expect(por.get('documento.assinatura.assinar')).toMatchObject({
      categoria: 'clinica',
      criticidade: 'critica',
    });
    expect(por.get('documento.politica.editar')).toMatchObject({
      concessaoPorPerfil: 'por-perfil',
      criticidade: 'critica',
    });
    expect(por.get('documento.provedor.editar')).toMatchObject({
      concessaoPorPerfil: 'por-perfil',
      criticidade: 'critica',
    });
    expect(por.get('documento.certificado.vincular')?.concessaoPorPerfil).toBe('todos-os-perfis-de-pessoa');
  });
});

describe('parâmetros, auditoria e liberação do M49', () => {
  it('cada parâmetro está no registro, com o padrão dentro da faixa', () => {
    for (const p of PARAMETROS_DOCUMENTO_ASSINATURA) {
      expect(definicaoParametro(p.chave), p.chave).toBe(p);
      if (p.tipo === 'inteiro') {
        const v = Number(p.padrao);
        expect(v).toBeGreaterThanOrEqual(p.minimo ?? -Infinity);
        expect(v).toBeLessThanOrEqual(p.maximo ?? Infinity);
      }
    }
    // Regra 10: o conector do conselho de medicina nasce desligado.
    expect(definicaoParametro('documento.atestaCfm')?.padrao).toBe('false');
    expect(definicaoParametro('documento.assinaturaMinimoAutoridades')?.padrao).toBe('2');
  });

  it('os eventos da regra 12 existem e ficam só na trilha própria', () => {
    for (const c of [
      'documento.assinatura.assinado',
      'documento.assinatura.falhou',
      'documento.assinatura.reprocessada',
      'documento.politica.alterada',
      'documento.certificado.vinculado',
    ]) {
      const e = eventoAuditavel(c);
      expect(e, c).not.toBeNull();
      expect(e?.legado).toBeNull();
    }
  });

  it('a chave assinatura.icp existe, é do M49 e tem o contrato do provedor como pré-requisito', () => {
    const r = RECURSOS_DESLIGADOS.find((x) => x.chave === 'assinatura.icp');
    expect(r?.marco).toBe('M49');
    expect(r?.prerequisitos.map((p) => p.tipo)).toEqual(['contrato', 'aprovacao']);
  });
});

describe('vocabulário', () => {
  it('os níveis são os da coluna do documento (M22/M23), em ordem crescente, com rótulo', () => {
    expect(NIVEIS_ASSINATURA).toEqual(['eletronica-simples', 'eletronica-avancada', 'icp-brasil']);
    for (const n of NIVEIS_ASSINATURA) expect(ROTULOS_NIVEL_ASSINATURA[n].length).toBeGreaterThan(3);
  });
  it('as mensagens de recusa não citam outro sistema', () => {
    for (const m of Object.values(MOTIVOS_RECUSA_ASSINATURA))
      expect(m).not.toMatch(/SPDATA|legado|sistema antigo/i);
  });
});

describe('entradas', () => {
  it('vincular: provedor só em nuvem; DER em base64', () => {
    expect(
      esquemaVincularCertificado.safeParse({ midia: 'nuvem', provedor: 'psc-teste', certificado: 'MIIB' })
        .success,
    ).toBe(true);
    expect(esquemaVincularCertificado.safeParse({ midia: 'a3', certificado: 'MIIB' }).success).toBe(true);
    expect(esquemaVincularCertificado.safeParse({ midia: 'nuvem', certificado: 'MIIB' }).success).toBe(false);
    expect(
      esquemaVincularCertificado.safeParse({ midia: 'a1', provedor: 'psc-teste', certificado: 'MIIB' })
        .success,
    ).toBe(false);
    expect(esquemaVincularCertificado.safeParse({ midia: 'a1', certificado: 'não é base64' }).success).toBe(
      false,
    );
    // Nunca a chave privada: campo extra é recusado.
    expect(
      esquemaVincularCertificado.safeParse({ midia: 'a1', certificado: 'MIIB', chave: 'x' }).success,
    ).toBe(false);
  });

  it('política: AD-RB/AD-RT só no nível ICP; justificativa obrigatória', () => {
    const base = {
      tipoDocumento: 'atestado',
      conselho: 'CRM',
      destino: 'externo',
      justificativa: 'Decisão da diretoria clínica',
    };
    expect(
      esquemaDefinirPoliticaAssinatura.safeParse({ ...base, nivel: 'icp-brasil', politicaIcp: 'AD-RT' })
        .success,
    ).toBe(true);
    expect(esquemaDefinirPoliticaAssinatura.safeParse({ ...base, nivel: 'icp-brasil' }).success).toBe(false);
    expect(
      esquemaDefinirPoliticaAssinatura.safeParse({
        ...base,
        nivel: 'eletronica-avancada',
        politicaIcp: 'AD-RB',
      }).success,
    ).toBe(false);
    expect(
      esquemaDefinirPoliticaAssinatura.safeParse({ ...base, nivel: 'eletronica-avancada' }).success,
    ).toBe(true);
    expect(
      esquemaDefinirPoliticaAssinatura.safeParse({
        ...base,
        nivel: 'eletronica-avancada',
        justificativa: 'curta',
      }).success,
    ).toBe(false);
    expect(
      esquemaDefinirPoliticaAssinatura.safeParse({ ...base, conselho: 'crm', nivel: 'eletronica-avancada' })
        .success,
    ).toBe(false);
  });

  it('pedido de assinatura: um hash por documento, sem repetir, até o teto do lote', () => {
    expect(
      esquemaPedirAssinaturaIcp.safeParse({ documentos: [1, 2], hashes: [H, H], certificado: 3 }).success,
    ).toBe(true);
    expect(
      esquemaPedirAssinaturaIcp.safeParse({ documentos: [1, 2], hashes: [H], certificado: 3 }).success,
    ).toBe(false);
    expect(
      esquemaPedirAssinaturaIcp.safeParse({ documentos: [1, 1], hashes: [H, H], certificado: 3 }).success,
    ).toBe(false);
    const n = TETO_LOTE_ASSINATURA + 1;
    expect(
      esquemaPedirAssinaturaIcp.safeParse({
        documentos: Array.from({ length: n }, (_, i) => i + 1),
        hashes: Array.from({ length: n }, () => H),
        certificado: 3,
      }).success,
    ).toBe(false);
    expect(
      esquemaPedirAssinaturaIcp.safeParse({ documentos: [1], hashes: ['A'.repeat(64)], certificado: 3 })
        .success,
    ).toBe(false);
  });

  it('retorno do provedor e resposta do agente local têm forma fechada', () => {
    expect(esquemaRetornoPsc.safeParse({ state: 'x'.repeat(43), code: 'abc' }).success).toBe(true);
    expect(esquemaRetornoPsc.safeParse({ state: 'curto', code: 'abc' }).success).toBe(false);
    expect(
      esquemaRespostaAgenteLocal.safeParse({
        desafio: 'd'.repeat(43),
        assinaturas: [{ hash: H, assinatura: 'AAAA' }],
        certificado: 'MIIB',
      }).success,
    ).toBe(true);
  });

  it('provedor: https terminado em /v0 e sem campo de segredo', () => {
    const p = {
      codigo: 'psc-teste',
      nome: 'Provedor de teste',
      uriBase: 'https://psc.exemplo.invalid/v0',
      clientId: 'cliente',
      autoridades: ['AC A', 'AC B'],
      ativo: false,
    };
    expect(esquemaProvedorPsc.safeParse(p).success).toBe(true);
    expect(esquemaProvedorPsc.safeParse({ ...p, uriBase: 'http://psc.exemplo.invalid/v0' }).success).toBe(
      false,
    );
    expect(esquemaProvedorPsc.safeParse({ ...p, uriBase: 'https://psc.exemplo.invalid/v1' }).success).toBe(
      false,
    );
    expect(esquemaProvedorPsc.safeParse({ ...p, clientSecret: 'x' }).success).toBe(false);
    // client_id e endereço só em ASCII imprimível (fora do CP1252 a coluna do banco recusaria com erro genérico).
    expect(esquemaProvedorPsc.safeParse({ ...p, clientId: 'cliente-ő' }).success).toBe(false);
    expect(esquemaProvedorPsc.safeParse({ ...p, clientId: 'cliente 1' }).success).toBe(false);
    expect(esquemaProvedorPsc.safeParse({ ...p, clientId: 'cliente\u{1F600}' }).success).toBe(false);
    expect(esquemaProvedorPsc.safeParse({ ...p, uriBase: 'https://psc.exemplo.invalid/ő/v0' }).success).toBe(
      false,
    );
  });

  it('ponte com o tipo de ato do legado (PRTPASSINATURA): todo tipo da política tem pelo menos um ID', () => {
    for (const t of TIPOS_DOCUMENTO_POLITICA) {
      const ids = TIPOS_ATO_LEGADO_POR_TIPO_POLITICA[t];
      expect(ids.length, t).toBeGreaterThan(0);
      for (const i of ids) expect(Number.isInteger(i) && i > 0, `${t}:${i}`).toBe(true);
    }
    // Os que o novo grava (M22 a M26) vêm primeiro.
    expect(TIPOS_ATO_LEGADO_POR_TIPO_POLITICA['registro-clinico'][0]).toBe(36);
    expect(TIPOS_ATO_LEGADO_POR_TIPO_POLITICA.prescricao[0]).toBe(37);
    expect(TIPOS_ATO_LEGADO_POR_TIPO_POLITICA.atestado[0]).toBe(40);
    expect(TIPOS_ATO_LEGADO_POR_TIPO_POLITICA.receita[0]).toBe(41);
    expect(TIPOS_ATO_LEGADO_POR_TIPO_POLITICA['pedido-exame'][0]).toBe(79);
  });

  it('eventos da etapa 1: pedido gravado, pedido consumido e teste do provedor (leitura não é "alterado")', () => {
    for (const c of [
      'documento.assinatura.pedida',
      'documento.assinatura.autorizacao-consumida',
      'documento.provedor.testado',
    ])
      expect(eventoAuditavel(c), c).not.toBeNull();
  });

  it('código do verificador: opaco, 16 a 64 caracteres seguros para URL', () => {
    expect(esquemaCodigoVerificacao.safeParse({ codigo: 'AbCd_1234-xyzXYZ' }).success).toBe(true);
    expect(esquemaCodigoVerificacao.safeParse({ codigo: '12345' }).success).toBe(false);
    expect(esquemaCodigoVerificacao.safeParse({ codigo: "' OR 1=1 --xxxxxxxx" }).success).toBe(false);
  });
});
