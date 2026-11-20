// @vitest-environment jsdom
// M57 (etapa 1): o cliente do MPI da Rede valida a resposta pelo contrato (fora dele, recusa), monta a consulta da fila
// só com os filtros preenchidos, manda as decisões por POST com o CSRF e a Idempotency-Key e resume a gravação por banco;
// os textos das telas não citam o outro sistema pelo nome nem nome de tabela (ADR 0023).
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  abrirProntuarioRede,
  atualizarFilaRede,
  consultaDaFila,
  decidirParRede,
  desfazerVinculoRede,
  lerAvisoRede,
  lerFilaRede,
  lerVinculosRede,
  resumoGravacao,
} from './api-rede.js';
import { mensagensRede } from './i18n.js';

afterEach(() => vi.unstubAllGlobals());

const lado = (estabelecimento: string, id: number) => ({
  estabelecimento,
  estabelecimentoNome: `Estabelecimento ${estabelecimento}`,
  id,
  prontuario: 1000 + id,
  nome: 'PACIENTE SINTETICO',
  nascimento: '1980-05-17',
  sexo: 'F',
  maeMascarada: 'M*** S***',
  cpfMascarado: '***.***.123-45',
  cnsMascarado: null,
  disponivel: true,
});
const fila = {
  itens: [
    {
      chave: 'pc:1|sx:2',
      local: lado('pc', 1),
      remoto: lado('sx', 2),
      pontuacao: 90,
      criterios: ['cpf', 'nome'],
      divergencias: ['sexo_diferente'],
      situacao: 'aberto',
      origem: null,
      decididoPor: null,
      decididoEm: null,
    },
  ],
  total: 1,
  pagina: 1,
  porPagina: 20,
  porFaixa: { alta: 1, media: 0, baixa: 0 },
  estabelecimentos: [
    { codigo: 'pc', nome: 'A' },
    { codigo: 'sx', nome: 'B' },
  ],
};

function resposta(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
}

describe('cliente do MPI da Rede', () => {
  it('consulta da fila só com os filtros preenchidos; resposta validada pelo contrato', async () => {
    expect(consultaDaFila({ situacao: 'aberto', faixa: undefined, pagina: 2 })).toBe(
      '?situacao=aberto&pagina=2',
    );
    expect(consultaDaFila({})).toBe('');
    expect(consultaDaFila({ situacao: 'vinculado', prontuario: 50004 })).toBe(
      '?situacao=vinculado&prontuario=50004',
    );
    const buscar = vi.fn(async () => resposta(fila));
    const f = await lerFilaRede({ situacao: 'aberto', faixa: 'alta' }, buscar as never);
    expect(f.itens[0]!.chave).toBe('pc:1|sx:2');
    expect((buscar.mock.calls[0] as unknown[])[0]).toBe('/api/rede/mpi/fila?situacao=aberto&faixa=alta');
    const fora = vi.fn(async () => resposta({ ...fila, itens: [{ ...fila.itens[0], pontuacao: 400 }] }));
    await expect(lerFilaRede({}, fora as never)).rejects.toThrow();
  });

  it('decisão, desfazer e ciclo por POST com CSRF e Idempotency-Key; a chave vai codificada', async () => {
    document.cookie = 'sgh_csrf=tok';
    const gravado = {
      chave: 'pc:1|sx:2',
      pessoa: 'pessoa-1',
      bancos: [
        { estabelecimento: 'pc', situacao: 'gravado' },
        { estabelecimento: 'sx', situacao: 'pendente' },
      ],
    };
    const buscar = vi.fn(async () => resposta(gravado));
    const r = await decidirParRede('pc:1|sx:2', { decisao: 'mesma_pessoa' }, buscar as never);
    const [url, init] = buscar.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/rede/mpi/candidatos/pc%3A1%7Csx%3A2/decisao');
    expect(init.method).toBe('POST');
    const h = init.headers as Record<string, string>;
    expect(h['x-csrf']).toBeTypeOf('string');
    expect(h['idempotency-key']).toMatch(/^web-/);
    expect(resumoGravacao(r)).toEqual({ gravados: 1, total: 2, pendente: true });
    await desfazerVinculoRede(
      'pc:1|sx:2',
      { justificativa: 'Pessoas diferentes', reabrir: true },
      buscar as never,
    );
    expect((buscar.mock.calls[1] as unknown[])[0]).toBe('/api/rede/mpi/vinculos/pc%3A1%7Csx%3A2/desfazer');
    const ciclo = vi.fn(async () =>
      resposta({
        lidos: 3,
        automaticos: 1,
        naFila: 1,
        descartados: 0,
        duplicadosLocais: 0,
        inelegiveis: 0,
        marcas: [{ estabelecimento: 'pc', ultimoId: 3, ultimaAtualizacao: null }],
      }),
    );
    expect((await atualizarFilaRede(ciclo as never)).automaticos).toBe(1);
    const vinc = vi.fn(async () => resposta({ pessoa: null, vinculos: [] }));
    expect((await lerVinculosRede('sx', 2, vinc as never)).vinculos).toEqual([]);
    expect((vinc.mock.calls[0] as unknown[])[0]).toBe('/api/rede/mpi/cadastros/sx/2/vinculos');
  });

  it('etapa 2: o aviso validado pelo contrato; o acesso cruzado por POST com CSRF, motivo e justificativa', async () => {
    document.cookie = 'sgh_csrf=tok';
    const aviso = {
      situacao: 'com-atendimentos',
      estabelecimentos: [
        {
          estabelecimento: 'sx',
          estabelecimentoNome: 'B',
          idRemoto: 101,
          disponivel: true,
          atendimentos: 3,
          ultimoAtendimento: '2026-09-14',
          internacoes: 1,
          ultimaInternacao: '2026-08-02',
          podeAbrir: false,
        },
      ],
      acessoCruzado: { pode: false, motivo: 'Ainda não liberado.' },
    };
    const buscar = vi.fn(async () => resposta(aviso));
    expect((await lerAvisoRede(1, buscar as never)).estabelecimentos[0]!.atendimentos).toBe(3);
    expect((buscar.mock.calls[0] as unknown[])[0]).toBe('/api/rede/mpi/pacientes/1/aviso');
    // Fora do contrato (contagem negativa): recusa.
    const fora = vi.fn(async () =>
      resposta({ ...aviso, estabelecimentos: [{ ...aviso.estabelecimentos[0], atendimentos: -1 }] }),
    );
    await expect(lerAvisoRede(1, fora as never)).rejects.toThrow();
    const reg = {
      estabelecimento: 'sx',
      estabelecimentoNome: 'B',
      idRemoto: 101,
      prontuarioRemoto: 50101,
      eventos: [],
      pagina: 1,
      temMais: false,
    };
    const abrir = vi.fn(async () => resposta(reg));
    const r = await abrirProntuarioRede(
      1,
      'sx',
      { motivo: 'assistencia', justificativa: 'Em atendimento aqui', pagina: 1 },
      abrir as never,
    );
    expect(r.prontuarioRemoto).toBe(50101);
    const [url, init] = abrir.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/pep/rede/paciente/1/estabelecimentos/sx/linha-do-tempo');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['idempotency-key']).toMatch(/^web-/);
    expect(JSON.parse(String(init.body))).toEqual({
      motivo: 'assistencia',
      justificativa: 'Em atendimento aqui',
      pagina: 1,
    });
  });

  it('o erro do servidor vira erro na tela (Problem Details)', async () => {
    const buscar = vi.fn(async () =>
      resposta({ type: 'recurso-desligado', title: 'Funcionalidade desligada', status: 403 }, 403),
    );
    await expect(lerFilaRede({}, buscar as never)).rejects.toBeTruthy();
  });

  it('textos de produto: sem o nome do outro sistema, sem "legado" e sem nome de tabela', () => {
    const tudo = JSON.stringify(mensagensRede);
    expect(tudo).not.toMatch(/SPDATA|legado|sistema atual|sistema anterior|RICADPAC|SGH_/i);
  });
});
