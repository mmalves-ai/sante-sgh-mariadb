import { urnProblema } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import { ErroApi, erroDaResposta, mensagemDoErro } from './problem-details.js';

function texto(chave: string): string {
  return chave
    .split('.')
    .reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], mensagensWeb) as string;
}

describe('Problem Details em português claro (regra 15)', () => {
  it('cada tipo conhecido tem título e texto pt-BR, sem detalhe técnico', () => {
    for (const tipo of [
      'conflito-de-versao',
      'nao-autenticado',
      'sem-permissao',
      'nao-encontrado',
      'entrada-invalida',
      'registro-em-edicao',
      'indisponivel',
      'erro-interno',
    ] as const) {
      const m = mensagemDoErro(new ErroApi({ type: urnProblema(tipo) }, 500));
      expect(m.tipo).toBe(tipo);
      expect(texto(m.titulo)).toMatch(/\S/);
      expect(texto(m.texto)).not.toMatch(/SQL|stack|exception|null|undefined|TB[A-Z]/i);
    }
  });

  it('o detalhe técnico do servidor nunca vira texto; a correlação vai para o suporte', () => {
    const m = mensagemDoErro(
      new ErroApi(
        { type: urnProblema('erro-interno'), detail: 'SQLCODE -803 em TBXYZ', correlacao: 'abc-123-def' },
        500,
      ),
    );
    expect(m.texto).toBe('erros.erro-interno.texto');
    expect(m.correlacao).toBe('abc-123-def');
    expect(texto('erros.correlacao')).toContain('{codigo}');
  });

  it('sem Problem Details, usa o status; falha de rede tem mensagem própria; outros erros, a genérica', () => {
    expect(mensagemDoErro(new ErroApi(null, 403)).tipo).toBe('sem-permissao');
    expect(mensagemDoErro(new ErroApi(null, 418)).tipo).toBe('erro-interno');
    expect(mensagemDoErro(new TypeError('fetch failed')).tipo).toBe('rede');
    expect(mensagemDoErro(new Error('x')).tipo).toBe('erro-interno');
  });

  it('lê Problem Details da resposta, com a correlação do cabeçalho se faltar no corpo', async () => {
    const r = new Response(JSON.stringify({ type: urnProblema('sem-permissao'), status: 403 }), {
      status: 403,
      headers: { 'content-type': 'application/problem+json', 'x-correlacao': 'corr-cabecalho-1' },
    });
    const e = await erroDaResposta(r);
    expect(e.status).toBe(403);
    expect(e.problema?.correlacao).toBe('corr-cabecalho-1');
    const semCorpo = await erroDaResposta(new Response('não é json', { status: 502 }));
    expect(semCorpo.problema).toBeNull();
  });

  it('recusa de negócio mostra o motivo do servidor; 409 com código e sem alterações não é conflito de versão', () => {
    const porTipo = mensagemDoErro(
      new ErroApi({ type: urnProblema('recusa-de-negocio'), codigo: 'x', detail: 'Já foi unificado.' }, 409),
    );
    expect(porTipo.tipo).toBe('recusa-de-negocio');
    expect(porTipo.motivo).toBe('Já foi unificado.');
    const porCodigo = mensagemDoErro(
      new ErroApi({ type: 'about:blank', codigo: 'favorecido-terceiro', detail: 'Confirme.' }, 409),
    );
    expect(porCodigo.tipo).toBe('recusa-de-negocio');
    expect(porCodigo.motivo).toBe('Confirme.');
    const versao = mensagemDoErro(
      new ErroApi({ type: 'about:blank', codigo: 'x', detail: 'y', alteracoes: [] }, 409),
    );
    expect(versao.tipo).toBe('conflito-de-versao');
    expect(versao.motivo).toBeNull();
    expect(mensagemDoErro(new ErroApi(null, 409)).tipo).toBe('conflito-de-versao');
  });
});
