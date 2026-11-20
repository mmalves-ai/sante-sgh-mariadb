// M58-F4 (unidade, porta em memória e repasse falso): o serviço da fachada responde no contrato da API original
// (token por superfície, 401 antes do 404, erro sem texto do banco), serve convênios e a ação de situação em dois
// tempos (proposta não escreve; confirmação relê; uso único), repassa o que não serve e desliga a escrita por padrão.
import type { ValorParametro } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { PortaFachadaMemoria } from './porta-memoria.js';
import { type PedidoFachada, type Repassador, ServicoFachada } from './servico.js';

const T = { principal: 'p'.repeat(32), gestao: 'g'.repeat(32), auditoria: null };

function valor(chave: string, v: string, alvo = 'aa'): ValorParametro {
  return {
    id: `${alvo}:${chave}`,
    chave,
    nivel: 'estabelecimento',
    alvo,
    valor: v,
    vigenteDesde: '2026-01-01T00:00:00.000Z',
    vigenteAte: null,
    justificativa: 'teste da fachada',
    autor: 'SINT',
  };
}

function montar(
  params: Record<string, string>,
  repassar?: Repassador,
  /** Parâmetros de um segundo estabelecimento sintético ('bb'). */
  outro: Record<string, string> = {},
) {
  const porta = new PortaFachadaMemoria();
  const erros: string[] = [];
  const servico = new ServicoFachada({
    porta,
    tokens: T,
    valores: async () => [
      ...Object.entries(params).map(([k, v]) => valor(k, v)),
      ...Object.entries(outro).map(([k, v]) => valor(k, v, 'bb')),
    ],
    ...(repassar ? { repassar } : {}),
    raizEnsaios: null,
    cacheMs: 0,
    registrarErro: (id) => erros.push(id),
    uptime: () => 12,
  });
  return { porta, servico, erros };
}

const pedido = (metodo: string, caminho: string, o: Partial<PedidoFachada> = {}): PedidoFachada => {
  const [c, consulta = ''] = caminho.split('?');
  const query = Object.fromEntries(new URLSearchParams(consulta));
  return {
    rede: 'rede-sintetica',
    hospital: 'aa',
    metodo,
    caminho: c!,
    consulta,
    query,
    corpo: undefined,
    cabecalhos: { authorization: `Bearer ${T.principal}` },
    ...o,
  };
};

const LIGADA = { 'integracao.fachada.ligada': 'sim' };
const ESCRITA = { ...LIGADA, 'integracao.fachada.escrita': 'sim' };

describe('serviço da fachada', () => {
  it('desligada por padrão: 503 fachada_desligada; token e 404 como a API original', async () => {
    const { servico } = montar({});
    const r = await servico.atender(pedido('GET', '/convenios'));
    expect(r).toMatchObject({ status: 503, corpo: { status: 'error', codigo: 'fachada_desligada' } });
    const sem = await servico.atender(pedido('GET', '/convenios', { cabecalhos: {} }));
    expect(sem).toMatchObject({ status: 401, corpo: { codigo: 'nao_autorizado' } });
    // Rota inexistente: sem token 401, com token 404 (a autenticação vem antes).
    expect((await servico.atender(pedido('GET', '/xyz', { cabecalhos: {} }))).status).toBe(401);
    expect(await servico.atender(pedido('GET', '/xyz'))).toMatchObject({
      status: 404,
      corpo: { codigo: 'rota_nao_encontrada' },
    });
  });

  it('serve saúde, convênios e o status das ações', async () => {
    const { servico } = montar(LIGADA);
    expect((await servico.atender(pedido('GET', '/health', { cabecalhos: {} }))).corpo).toEqual({
      status: 'ok',
      uptime: 12,
    });
    expect((await servico.atender(pedido('GET', '/health/db'))).corpo).toMatchObject({
      status: 'ok',
      db: 'firebird',
      charset: { banco: 'NONE', colunaObs: 'NONE', conexao: 'NONE', efetivo: 'CP1252' },
    });
    const l = await servico.atender(pedido('GET', '/convenios?ativo=true'));
    expect(l.corpo).toMatchObject({ total: 2 });
    const b = await servico.atender(pedido('GET', '/convenios?busca=sintetico%20dois'));
    // Por palavra, ordenado pela relevância (o mais parecido primeiro; o corte de 35% mantém o outro).
    expect(b.corpo).toMatchObject({
      total: 2,
      convenios: [{ codigo: 30, ativo: false }, { codigo: 20 }],
      sugestoes: [],
    });
    expect((await servico.atender(pedido('GET', '/convenios?limite=0'))).corpo).toEqual({
      status: 'error',
      codigo: 'parametro_invalido',
      message: 'Requisição inválida: O parâmetro "limite" deve ser no mínimo 1.',
    });
    expect((await servico.atender(pedido('GET', '/convenios/30'))).corpo).toEqual({
      codigo: 30,
      nome: 'CONVENIO SINTETICO DOIS',
      ativo: false,
      permiteAtendimento: 0,
    });
    expect((await servico.atender(pedido('GET', '/convenios/99'))).status).toBe(404);
    expect((await servico.atender(pedido('GET', '/convenios/40000'))).corpo).toMatchObject({
      codigo: 'valor_fora_da_faixa',
    });
    const s = await servico.atender(pedido('GET', '/acoes/status'));
    expect(s.corpo).toMatchObject({ habilitada: false, propostasPendentes: 0, validadePropostaMinutos: 15 });
    expect(servico.usoDe('rede-sintetica', 'aa').de('GET /convenios')).toEqual({ chamadas: 3, erros: 1 });
  });

  it('gestão com token próprio; sem destino a operação não servida fica desligada', async () => {
    const { servico } = montar(LIGADA);
    expect((await servico.atender(pedido('GET', '/gestao/receita'))).status).toBe(401);
    const g = await servico.atender(
      pedido('GET', '/gestao/receita', { cabecalhos: { 'x-api-key': T.gestao } }),
    );
    expect(g).toMatchObject({ status: 503, corpo: { codigo: 'superficie_desligada' } });
  });

  it('escrita desligada por padrão: proposta e confirmação recusadas sem escrever', async () => {
    const { servico, porta } = montar(LIGADA);
    const r = await servico.atender(
      pedido('POST', '/acoes/convenios/situacao', { corpo: { convenio: 20, operacao: 'suspender' } }),
    );
    expect(r).toMatchObject({ status: 403, corpo: { codigo: 'acoes_desabilitadas' } });
    expect(
      (await servico.atender(pedido('POST', '/acoes/confirmar', { corpo: { propostaId: 'x' } }))).status,
    ).toBe(403);
    expect(porta.gravacoes).toHaveLength(0);
  });

  it('dois tempos: proposta não escreve, confirmação grava como hal-ai e vale uma vez', async () => {
    const { servico, porta } = montar(ESCRITA);
    const p = await servico.atender(
      pedido('POST', '/acoes/convenios/situacao', { corpo: { convenio: 20, operacao: 'suspender' } }),
    );
    expect(p.status).toBe(200);
    const proposta = p.corpo as {
      propostaId: string;
      aplicada: boolean;
      convenio: unknown;
      alertas: string[];
    };
    expect(proposta.aplicada).toBe(false);
    expect(proposta.convenio).toEqual({
      codigo: 20,
      nome: 'CONVENIO SINTETICO UM',
      situacaoAtual: 'A',
      situacaoDepois: 'I',
    });
    expect(porta.gravacoes).toHaveLength(0);
    const c = await servico.atender(
      pedido('POST', '/acoes/confirmar', { corpo: { propostaId: proposta.propostaId } }),
    );
    expect(c).toMatchObject({
      status: 200,
      corpo: { aplicada: true, situacaoAnterior: 'A', situacaoAtual: 'I', operacao: 'suspender' },
    });
    expect(porta.gravacoes).toHaveLength(1);
    expect(porta.gravacoes[0]).toMatchObject({ cod: 20, operacao: 'suspender' });
    const de = await servico.atender(
      pedido('POST', '/acoes/confirmar', { corpo: { propostaId: proposta.propostaId } }),
    );
    expect(de).toMatchObject({ status: 404, corpo: { codigo: 'proposta_nao_encontrada' } });
    // Já suspenso: o primeiro tempo recusa sem proposta.
    const ja = await servico.atender(
      pedido('POST', '/acoes/convenios/situacao', { corpo: { convenio: 20, operacao: 'suspender' } }),
    );
    expect(ja).toMatchObject({
      status: 409,
      corpo: { codigo: 'acao_sem_efeito', motivo: 'ja_esta_no_estado_pedido' },
    });
  });

  it('a proposta fica presa ao estabelecimento: por outro caminho é 404 e nada se grava', async () => {
    // Os dois estabelecimentos sintéticos com a fachada e a escrita ligadas; a proposta nasce em 'aa'.
    const { servico, porta } = montar(ESCRITA, undefined, ESCRITA);
    const p = await servico.atender(
      pedido('POST', '/acoes/convenios/situacao', { corpo: { convenio: 20, operacao: 'suspender' } }),
    );
    const id = (p.corpo as { propostaId: string }).propostaId;
    const noOutro = await servico.atender(
      pedido('POST', '/acoes/confirmar', { hospital: 'bb', corpo: { propostaId: id } }),
    );
    expect(noOutro).toMatchObject({ status: 404, corpo: { codigo: 'proposta_nao_encontrada' } });
    expect(porta.gravacoes).toHaveLength(0);
    // O status e o painel de 'bb' não veem a proposta nem o uso de 'aa'.
    const s = await servico.atender(pedido('GET', '/acoes/status', { hospital: 'bb' }));
    expect(s.corpo).toMatchObject({ habilitada: true, propostasPendentes: 0 });
    const painelOutro = await servico.painel('rede-sintetica', 'bb', false);
    expect(painelOutro.operacoes.find((o) => o.id === 'POST /acoes/convenios/situacao')?.chamadas).toBe(0);
    const sa = await servico.atender(pedido('GET', '/acoes/status'));
    expect(sa.corpo).toMatchObject({ propostasPendentes: 1 });
    // A tentativa por 'bb' não consumiu a proposta: pelo caminho de origem ela ainda vale (uma vez).
    const c = await servico.atender(pedido('POST', '/acoes/confirmar', { corpo: { propostaId: id } }));
    expect(c).toMatchObject({ status: 200, corpo: { aplicada: true } });
    expect(porta.gravacoes).toHaveLength(1);
    // Escrita desligada na origem depois da proposta: a confirmação pela origem é recusada (403).
    const desligar = montar(ESCRITA, undefined, ESCRITA);
    const p2 = await desligar.servico.atender(
      pedido('POST', '/acoes/convenios/situacao', { corpo: { convenio: 20, operacao: 'suspender' } }),
    );
    const id2 = (p2.corpo as { propostaId: string }).propostaId;
    // Mesmo motor, configuração nova da origem (escrita desligada): sem escrita, 403; por 'bb', 404.
    const servico2 = new ServicoFachada({
      porta: desligar.porta,
      tokens: T,
      valores: async () => [
        valor('integracao.fachada.ligada', 'sim'),
        ...Object.entries(ESCRITA).map(([k, v]) => valor(k, v, 'bb')),
      ],
      raizEnsaios: null,
      cacheMs: 0,
      motor: desligar.servico.motor,
    });
    expect(
      (await servico2.atender(pedido('POST', '/acoes/confirmar', { corpo: { propostaId: id2 } }))).status,
    ).toBe(403);
    expect(
      await servico2.atender(
        pedido('POST', '/acoes/confirmar', { hospital: 'bb', corpo: { propostaId: id2 } }),
      ),
    ).toMatchObject({ status: 404, corpo: { codigo: 'proposta_nao_encontrada' } });
    expect(desligar.porta.gravacoes).toHaveLength(0);
  });

  it('estado mudado depois da proposta: 409 sem gravar; erro do banco nunca vaza', async () => {
    const { servico, porta, erros } = montar(ESCRITA);
    const p = await servico.atender(
      pedido('POST', '/acoes/convenios/situacao', { corpo: { convenio: 30, operacao: 'reativar' } }),
    );
    const id = (p.corpo as { propostaId: string }).propostaId;
    porta.mudarPorFora(30, 'A');
    const c = await servico.atender(pedido('POST', '/acoes/confirmar', { corpo: { propostaId: id } }));
    expect(c).toMatchObject({ status: 409, corpo: { codigo: 'proposta_desatualizada' } });
    expect(porta.gravacoes).toHaveLength(0);
    // Falha crua na gravação: 500 genérico, o texto só no registro de erro (pelo identificador da operação).
    porta.mudarPorFora(30, 'I');
    const p2 = await servico.atender(
      pedido('POST', '/acoes/convenios/situacao', { corpo: { convenio: 30, operacao: 'reativar' } }),
    );
    porta.falhaNaGravacao = new Error('Dynamic SQL Error SQL error code = -204 Table unknown TBCONVEN');
    const c2 = await servico.atender(
      pedido('POST', '/acoes/confirmar', {
        corpo: { propostaId: (p2.corpo as { propostaId: string }).propostaId },
      }),
    );
    expect(c2.status).toBe(500);
    expect(JSON.stringify(c2.corpo)).not.toMatch(/SQL|TBCONVEN/);
    expect(c2.corpo).toMatchObject({ codigo: 'erro_interno' });
    expect(erros).toEqual(['POST /acoes/confirmar']);
    // Corpo inválido: a mensagem da validação.
    const v = await servico.atender(pedido('POST', '/acoes/convenios/situacao', { corpo: { convenio: 30 } }));
    expect(v.corpo).toMatchObject({ codigo: 'parametro_invalido' });
  });

  it('repassa o que não serve (com o token e a query) e a confirmação da proposta de lá', async () => {
    const chamadas: {
      url: string;
      metodo: string;
      cabecalhos: Record<string, string>;
      corpo: string | null;
    }[] = [];
    const repassar: Repassador = async (r) => {
      chamadas.push({ ...r, cabecalhos: { ...r.cabecalhos } });
      return { status: 200, corpo: { repassado: true } };
    };
    const { servico } = montar(
      { ...ESCRITA, 'integracao.fachada.destino': 'http://api-original.test' },
      repassar,
    );
    const m = await servico.atender(pedido('GET', '/medicos?nome=SILVA'));
    expect(m).toEqual({ status: 200, corpo: { repassado: true } });
    expect(chamadas[0]).toMatchObject({
      url: 'http://api-original.test/medicos?nome=SILVA',
      metodo: 'GET',
      cabecalhos: { authorization: `Bearer ${T.principal}` },
      corpo: null,
    });
    await servico.atender(pedido('POST', '/acoes/confirmar', { corpo: { propostaId: 'prop_de_la' } }));
    expect(chamadas[1]).toMatchObject({
      url: 'http://api-original.test/acoes/confirmar',
      corpo: '{"propostaId":"prop_de_la"}',
    });
    // A original fora do ar: 503 destino_indisponivel.
    const fora = montar({ ...LIGADA, 'integracao.fachada.destino': 'http://x.test' }, async () => {
      throw new Error('ECONNREFUSED');
    });
    expect(await fora.servico.atender(pedido('GET', '/medicos'))).toMatchObject({
      status: 503,
      corpo: { codigo: 'destino_indisponivel' },
    });
  });

  it('painel: desligada, sem token exposto, com o uso e a prontidão', async () => {
    const { servico } = montar(LIGADA);
    await servico.atender(pedido('GET', '/convenios'));
    const p = await servico.painel('rede-sintetica', 'aa', true);
    expect(p.configuracao.ligada).toBe(true);
    expect(p.necessidade.situacao).toBe('nao-necessaria');
    expect(p.operacoes.find((o) => o.id === 'GET /convenios')?.chamadas).toBe(1);
    expect(p.prontidaoUtf8.pronta).toBe(true);
    expect(JSON.stringify(p)).not.toContain(T.principal);
    expect(p.pode.configurar).toBe(true);
  });
});
