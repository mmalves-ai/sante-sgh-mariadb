import { describe, expect, it } from 'vitest';
import {
  CHAVES_ESPERADAS_LIBERACAO_FULL,
  chavesEsperadasLiberacaoFull,
  DECISAO_DO_DONO_EM_PRODUCAO,
  NUNCA_LIGAR_EM_MASSA,
  SEM_ENVIO_NO_DEV,
} from './liberacao-full.js';
import { RECURSOS_DESLIGADOS } from './recursos.js';

const chaves = new Set(RECURSOS_DESLIGADOS.map((r) => r.chave));

describe('liberação full: listas de exceção versionadas (ADR 0034)', () => {
  it('cada item é um recurso declarado, sem repetição, e com motivo', () => {
    for (const lista of [NUNCA_LIGAR_EM_MASSA, SEM_ENVIO_NO_DEV, DECISAO_DO_DONO_EM_PRODUCAO]) {
      expect(new Set(lista.map((e) => e.chave)).size).toBe(lista.length);
      for (const e of lista) {
        expect(chaves.has(e.chave), e.chave).toBe(true);
        expect(e.motivo.length).toBeGreaterThan(15);
      }
    }
  });

  it('as chaves que mandam mensagem ou e-mail a pessoa também pedem decisão do dono em produção', () => {
    const decisao = new Set(DECISAO_DO_DONO_EM_PRODUCAO.map((e) => e.chave));
    for (const e of SEM_ENVIO_NO_DEV) expect(decisao.has(e.chave)).toBe(true);
    expect([...decisao]).toEqual(
      expect.arrayContaining([
        'financeiro.fiscal',
        'faturamento.susAih',
        'faturamento.susBpa',
        'faturamento.susApac',
        'faturamento.susCiha',
        'suprimentos.ambulatorial',
        'integracao.apoio',
        'imagem.worklist',
        'catalogo.brasindice.responsavel',
        'catalogo.simpro.responsavel',
        'contabil.sped',
        'rede.acessoCruzado',
        'acesso.loginCertificado',
        'portal.medicoExterno',
        // Revisão do M61: a superfície pública e as integrações cuja aprovação é a autorização do dono.
        'portal.conta',
        'portal.agenda',
        'portal.pagamento',
        'telemedicina',
        'sadt.portal',
        'operadora.portalPrestador',
        'assinatura.icp',
        'integracao.parceiros',
        'portaria.catraca',
        'faturamento.lote',
      ]),
    );
    expect([...decisao].filter((c) => /^catalogo\..+\.responsavel$/.test(c)).length).toBe(13);
  });

  it('a fonte única de cor e o UTF-8 nunca ligam em massa', () => {
    expect(NUNCA_LIGAR_EM_MASSA.map((e) => e.chave).sort()).toEqual([
      'entrada.utf8',
      'integracao.classificacaoExterna',
    ]);
  });

  it('o padrão das chaves esperadas na instalação é todas-exceto as que o comando não liga', () => {
    expect(CHAVES_ESPERADAS_LIBERACAO_FULL.startsWith('todas-exceto:')).toBe(true);
    const fora = CHAVES_ESPERADAS_LIBERACAO_FULL.slice('todas-exceto:'.length).split(',');
    expect(fora).toContain('entrada.utf8');
    expect(fora).toContain('operadora.mensagens');
    expect(new Set(fora).size).toBe(fora.length);
    expect(chavesEsperadasLiberacaoFull('producao')).toBe(CHAVES_ESPERADAS_LIBERACAO_FULL);
    expect(chavesEsperadasLiberacaoFull('homolog')).toBe(CHAVES_ESPERADAS_LIBERACAO_FULL);
    // Em dev/ci, o comando liga as da decisão do dono: fora ficam só as que nunca ligam em massa e as de envio.
    const dev = chavesEsperadasLiberacaoFull('dev').slice('todas-exceto:'.length).split(',').sort();
    expect(dev).toEqual([...NUNCA_LIGAR_EM_MASSA, ...SEM_ENVIO_NO_DEV].map((e) => e.chave).sort());
  });

  it('nenhuma chave com aprovação que seja a autorização do dono ou o teste de invasão liga em produção sem decisão', () => {
    const decisao = new Set([...NUNCA_LIGAR_EM_MASSA, ...DECISAO_DO_DONO_EM_PRODUCAO].map((e) => e.chave));
    const abertas = RECURSOS_DESLIGADOS.filter((r) =>
      r.prerequisitos.some(
        (p) => p.tipo === 'aprovacao' && /autoriza[çc][ãa]o do dono|invas[ãa]o/i.test(p.descricao),
      ),
    ).filter((r) => !decisao.has(r.chave));
    expect(abertas.map((r) => r.chave)).toEqual([]);
  });
});
