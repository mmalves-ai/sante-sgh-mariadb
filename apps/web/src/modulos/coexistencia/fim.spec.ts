// @vitest-environment jsdom
// M43: o cliente da aba "Fim da coexistência" e da revisão dos sem grupo e dos logins de painel valida a resposta
// pelo contrato (fora dele, recusa); a conferência do aparelho vai por POST com o CSRF e a Idempotency-Key; os textos
// da aba, da revisão e do aparelho não citam o outro sistema pelo nome (ADR 0023).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lerRevisaoUsuarios } from '../administracao/api.js';
import { conferirDispositivo } from '../recepcao/api-recepcao.js';
import { mensagensRecepcao } from '../recepcao/i18n.js';
import { lerFim, lerRevisaoFim } from './api.js';
import { mensagensCoexistencia } from './i18n.js';

afterEach(() => vi.unstubAllGlobals());

const item = (i: string, conjunto: 'cap15' | 'cap14') => ({
  item: i,
  conjunto,
  situacao: 'pendente',
  valor: '0 de 1',
  parcelas: [{ rotulo: 'liberadas', valor: 0 }],
  fonte: 'x',
  verdeDesde: null,
  motivo: 'falta',
});
const tela = {
  painel: {
    estabelecimento: 'pc',
    medidoEm: '2027-01-10 10:00:00',
    cap15: [
      item('operacoes-liberadas', 'cap15'),
      item('usuarios-com-trilha', 'cap15'),
      item('sem-sessao-14-dias', 'cap15'),
      item('competencia-pelo-novo', 'cap15'),
      item('sem-s1-aberto', 'cap15'),
    ],
    cap14: [
      item('sem-sessao-30-dias', 'cap14'),
      item('assinaturas-verdes', 'cap14'),
      item('contingencia-pronta', 'cap14'),
      item('aceite-diretoria', 'cap14'),
    ],
    fimRegistravel: false,
    pendencias: ['x'],
    fimRegistradoEm: null,
    divergencias: [],
  },
  foraPorEstado: [{ estado: 'verde', n: 3 }],
  foraPorModulo: [{ modulo: 'agenda', n: 3 }],
  usuariosPorPapel: [{ papel: 'recepcao', ativos: '<5', semTrilha: '<5', semAcesso: 0 }],
  excecoes: [],
  ensaios: [
    { tipo: 'kit-papel', data: null, resultado: null },
    { tipo: 'relatorio-por-posto', data: null, resultado: null },
    { tipo: 'pwa-offline', data: null, resultado: null },
    { tipo: 'queda-do-banco', data: null, resultado: null },
  ],
  contasCombinadas: 0,
  ata: null,
  aceiteDiretoria: null,
  dp6: { decididaEm: null, previstaPara: null, decisao: null },
  setoresAtrasados: [],
  registro: 'docs/coexistencia/fim/pc.yaml',
  registroInvalido: null,
};
const revisao = {
  estabelecimento: 'pc',
  contagem: {
    total: 10,
    ativos: 8,
    ativosSemGrupo: 1,
    ativosGrupoNulo: 0,
    paineisLivres: 1,
    paineisBloqueados: 0,
  },
  semGrupo: [{ login: 'SINT.A', grupo: 'SEM GRUPO', loginVazio: false, excecao: null }],
  parcelas: { semGrupo: 1, nulo: 0, loginVazio: 0 },
  gruposDestino: ['ATENDIMENTO'],
  paineis: [
    {
      login: 'TV01',
      situacao: 'sem-substituicao',
      dispositivo: null,
      dispositivoNome: null,
      conferidoEm: null,
    },
  ],
  listaVazia: false,
  paineisResolvidos: true,
};

describe('fim da coexistência (cliente)', () => {
  it('o painel e a revisão são validados pelo contrato; fora dele, recusa', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/revisao') ? revisao : tela))),
    );
    expect((await lerFim()).painel.cap15).toHaveLength(5);
    expect((await lerRevisaoFim()).semGrupo[0]?.login).toBe('SINT.A');
    expect((await lerRevisaoUsuarios()).paineis[0]?.situacao).toBe('sem-substituicao');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ painel: 1 }))),
    );
    await expect(lerFim()).rejects.toThrow();
  });

  it('conferir o aparelho vai por POST com o CSRF e a Idempotency-Key', async () => {
    const f = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: 7,
            tipo: 'painel',
            nome: 'TV',
            recepcao: 2,
            locais: [],
            geradores: [],
            conteudo: null,
            portalOrdem: null,
            usuarioLegado: null,
            voz: true,
            criadoEm: '2027-01-10T10:00:00',
            criadoPor: 'X',
            validoAte: '2028-01-10T10:00:00',
            revogadoEm: null,
            ultimoUso: null,
            prefixo: 'abcdefgh',
            loginSubstituido: 'TV01',
            conferidoEm: '2027-01-10T10:00:00',
            conferidoPor: 'X',
          }),
          { status: 201 },
        ),
    );
    vi.stubGlobal('fetch', f);
    expect((await conferirDispositivo(7, 'TV01', 'chave-teste-1')).loginSubstituido).toBe('TV01');
    const [url, init] = (f.mock.calls[0] ?? []) as unknown as [string, RequestInit];
    expect(url).toBe('/api/recepcao/dispositivos/7/conferir');
    expect(init.method).toBe('POST');
    const cab = init.headers as Record<string, string>;
    expect('x-csrf' in cab).toBe(true);
    expect(cab['idempotency-key']).toBe('chave-teste-1');
    expect(JSON.parse(String(init.body))).toEqual({ loginSubstituido: 'TV01' });
  });

  it('textos de produto: nem o nome do outro sistema, nem "legado", nem mandar fazer lá', () => {
    const textos = JSON.stringify([mensagensCoexistencia.fim, mensagensRecepcao.dispositivos]);
    expect(textos).not.toMatch(/SPDATA|legado|sistema atual|faça no/i);
    expect(mensagensCoexistencia.abas.fim).toBe('Fim da coexistência');
  });
});
