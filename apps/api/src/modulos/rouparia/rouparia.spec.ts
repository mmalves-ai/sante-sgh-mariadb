// Rouparia e lavanderia pela HTTP (M55, fatia F2; ficha, seções 4, 7 e 8; regra 4): a sessão real sobre a fonte
// sintética e a rouparia EM MEMÓRIA (nada conecta a banco; dados SINTÉTICOS: setores 9101 a 9104, a lavanderia 7101 e
// o enxoval de 6 peças), o relógio fixo em 2026-10-28 09:00; a chave `rouparia` desligada pelo administrador num app à
// parte.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import {
  chavesIniciaisSinteticas,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/configuracao-fonte.js';
import {
  esquemaDetalheMovimentoRoupa,
  esquemaEstatisticaRouparia,
  esquemaFornecedoresRouparia,
  esquemaIndicadoresRouparia,
  esquemaListaMovimentosRoupa,
  esquemaPainelRouparia,
  esquemaResultadoCotasRoupa,
  esquemaResultadoRouparia,
  esquemaSituacaoCotaSetor,
} from '@sgh/contratos';
import { PortaRoupariaMemoria } from './porta-memoria.js';

const R = '/api/hotelaria/rouparia';
const HOJE = '2026-10-28';
interface Sessao {
  cookie: string;
  csrf: string;
}

async function montar(o: { semRouparia?: boolean } = {}) {
  const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
  const trilha = new RegistradorTrilhaMemoria();
  const relogio = { hoje: HOJE, agora: `${HOJE}T09:00:00` };
  const rouparia = new PortaRoupariaMemoria(() => ({ ...relogio }));
  const configuracao = o.semRouparia
    ? fonteConfiguracaoMemoria(trilha, {
        chavesIniciais: () => chavesIniciaisSinteticas().filter((c) => c.chave !== 'rouparia'),
        prerequisitosIniciais: prerequisitosIniciaisSinteticos,
        parametrosIniciais: parametrosIniciaisSinteticos,
      })
    : undefined;
  const app: NestFastifyApplication = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    rouparia,
    ...(configuracao ? { configuracao } : {}),
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  let seq = 0;
  const novaChave = () => `teste-m552-${++seq}-${Date.now()}`;
  return {
    app,
    trilha,
    relogio,
    novaChave,
    async entrar(login: string): Promise<Sessao> {
      const r = await app.inject({
        method: 'POST',
        url: '/api/sessao',
        payload: { estabelecimento: 'aa', login, senha: SENHA },
      });
      expect(r.statusCode).toBe(201);
      const set = r.headers['set-cookie'] as string[];
      return {
        cookie: set.map((c) => c.split(';')[0]).join('; '),
        csrf:
          set
            .find((c) => c.startsWith('sgh_csrf='))
            ?.split(';')[0]
            ?.slice(9) ?? '',
      };
    },
    get: (s: Sessao, url: string) =>
      app.inject({ method: 'GET', url: `${R}${url}`, headers: { cookie: s.cookie } }),
    enviar(s: Sessao, metodo: 'POST' | 'PUT', url: string, payload: Record<string, unknown>, chave?: string) {
      const k = chave ?? novaChave();
      return app.inject({
        method: metodo,
        url: `${R}${url}`,
        headers: { cookie: s.cookie, 'x-csrf': s.csrf, 'idempotency-key': k },
        payload,
      });
    },
    fechar: () => app.close(),
  };
}
type App = Awaited<ReturnType<typeof montar>>;

let a: App;
let roup: Sessao;
let consulta: Sessao;
let sem: Sessao;

beforeAll(async () => {
  a = await montar();
  [roup, consulta, sem] = await Promise.all([
    a.entrar('SINT.ROUPARIA'),
    a.entrar('SINT.ROUPARIA.CONSULTA'),
    a.entrar('SINT.ESOCIAL.CONSULTA'),
  ]);
});
afterAll(async () => {
  await a?.fechar();
});

const movimento = (x: Record<string, unknown>, chave?: string) => {
  const k = chave ?? a.novaChave();
  return a.enviar(roup, 'POST', '/movimentos', { chave: k, data: HOJE, ...x }, k);
};

describe('rouparia: leitura e permissões', () => {
  it('o painel pela permissão de ler; o perfil complementar registra; quem não tem a opção não vê', async () => {
    expect((await a.get(sem, '')).statusCode).toBe(403);
    const c = await a.get(consulta, '');
    expect(c.statusCode).toBe(200);
    expect(c.json().gravacao.operacoes.registrar).toMatchObject({ pode: false });
    const p = (await a.get(roup, '')).json();
    expect(p.hoje).toBe(HOJE);
    expect(p.pecas).toHaveLength(6);
    expect(p.setores.map((x: { codigo: number }) => x.codigo)).toEqual([9101, 9102, 9103]);
    expect(p.parametros).toEqual({
      toleranciaPct: 5,
      prazoRetornoHoras: 48,
      precoKgCentavos: 0,
      cancelamentoHoras: 24,
    });
    expect(p.gravacao.operacoes.registrar).toMatchObject({ pode: true });
    expect((await movimento({ tipo: 'coleta', centroCusto: 9101, pesoKg: 1 }, undefined)).statusCode).toBe(
      201,
    );
    const k = a.novaChave();
    expect(
      (
        await a.enviar(
          consulta,
          'POST',
          '/movimentos',
          { chave: k, tipo: 'coleta', data: HOJE, centroCusto: 9101, pesoKg: 1 },
          k,
        )
      ).statusCode,
    ).toBe(403);
    expect(a.trilha.eventos.some((x) => x.evento === 'hotelaria.rouparia.lida')).toBe(true);
  });
});

describe('rouparia: movimentos', () => {
  it('a coleta pesada; o reenvio pela chave; as recusas da regra e da entrada', async () => {
    const k = a.novaChave();
    const r = await movimento(
      { tipo: 'coleta', centroCusto: 9102, pesoKg: 12.5, itens: [{ peca: 1, quantidade: 4 }] },
      k,
    );
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ ok: true, repetida: false, conferencia: null });
    const de = await movimento(
      { tipo: 'coleta', centroCusto: 9102, pesoKg: 12.5, itens: [{ peca: 1, quantidade: 4 }] },
      k,
    );
    expect(de.json()).toMatchObject({ repetida: true, id: r.json().id });
    expect((await movimento({ tipo: 'entrega', centroCusto: 9101 }, k)).json().codigo).toBe(
      'chave-de-outro-movimento',
    );
    expect((await movimento({ tipo: 'coleta', centroCusto: 9104, pesoKg: 1 })).json().codigo).toBe(
      'setor-inativo',
    );
    expect((await movimento({ tipo: 'coleta', centroCusto: 9101 })).json().codigo).toBe('peso-obrigatorio');
    expect(
      (await movimento({ tipo: 'coleta', centroCusto: 9101, pesoKg: 1, data: '2026-10-29' })).json().codigo,
    ).toBe('data-futura');
    expect((await movimento({ tipo: 'perda', itens: [{ peca: 1, quantidade: 1 }] })).json().codigo).toBe(
      'motivo-obrigatorio',
    );
    expect(
      (await movimento({ tipo: 'entrega', centroCusto: 9101, itens: [{ peca: 99, quantidade: 1 }] })).json()
        .codigo,
    ).toBe('peca-inexistente');
    expect((await movimento({ tipo: 'coleta', centroCusto: 9101, pesoKg: -1 })).statusCode).toBe(400);
    const semCabecalho = await a.app.inject({
      method: 'POST',
      url: `${R}/movimentos`,
      headers: { cookie: roup.cookie, 'x-csrf': roup.csrf, 'idempotency-key': 'outra-chave-123' },
      payload: { chave: 'chave-diferente-1', tipo: 'coleta', data: HOJE, centroCusto: 9101, pesoKg: 1 },
    });
    expect(semCabecalho.statusCode).toBe(400);
  });

  it('envio → retorno conferido com a ocorrência; o segundo retorno recusado; o painel com o envio aberto', async () => {
    const env = await movimento({
      tipo: 'envio',
      pesoKg: 100,
      lavanderia: 'terceirizada',
      fornecedor: 7101,
      itens: [{ peca: 1, quantidade: 50 }],
    });
    expect(env.statusCode).toBe(201);
    expect((await movimento({ tipo: 'envio', pesoKg: 1, lavanderia: 'terceirizada' })).json().codigo).toBe(
      'fornecedor-obrigatorio',
    );
    expect(
      (await movimento({ tipo: 'envio', pesoKg: 1, lavanderia: 'terceirizada', fornecedor: 9 })).json()
        .codigo,
    ).toBe('fornecedor-inexistente');
    const abertos = (await a.get(roup, '')).json().enviosAbertos;
    expect(abertos.some((x: { id: number }) => x.id === env.json().id)).toBe(true);
    const ret = await movimento({
      tipo: 'retorno',
      remessa: env.json().id,
      pesoKg: 92,
      itens: [{ peca: 1, quantidade: 48 }],
    });
    expect(ret.statusCode).toBe(201);
    expect(ret.json().conferencia).toMatchObject({ diferencaKg: 8, diferencaPct: 8, ocorrencia: true });
    expect(ret.json().mensagem).toMatch(/ocorrência para o fornecedor/);
    expect((await movimento({ tipo: 'retorno', remessa: env.json().id, pesoKg: 90 })).json().codigo).toBe(
      'remessa-ja-retornada',
    );
    const lido = (await a.get(roup, `/movimentos/${ret.json().id}`)).json();
    expect(lido.movimento).toMatchObject({ tipo: 'retorno', ocorrencia: true, diferencaKg: 8 });
    expect(lido.remessa).toMatchObject({ id: env.json().id, situacao: 'retornado' });
    expect((await a.get(roup, '/movimentos/999999')).statusCode).toBe(404);
    // O cancelamento do envio com retorno é recusado; o do retorno devolve o envio.
    expect(
      (
        await a.enviar(roup, 'POST', `/movimentos/${env.json().id}/cancelamento`, {
          versaoVista: 2,
          motivo: 'Teste do envio',
        })
      ).json().codigo,
    ).toBe('envio-com-retorno');
    const c = await a.enviar(roup, 'POST', `/movimentos/${ret.json().id}/cancelamento`, {
      versaoVista: 1,
      motivo: 'Pesagem errada',
    });
    expect(c.statusCode).toBe(201);
    expect((await a.get(roup, `/movimentos/${env.json().id}`)).json().movimento.situacao).toBe('registrado');
    expect(
      (
        await a.enviar(roup, 'POST', `/movimentos/${ret.json().id}/cancelamento`, {
          versaoVista: 2,
          motivo: 'De novo',
        })
      ).json().codigo,
    ).toBe('movimento-cancelado');
  });

  it('o cancelamento fora do prazo e a versão antiga', async () => {
    const m = await movimento({ tipo: 'coleta', centroCusto: 9103, pesoKg: 3 });
    expect(
      (
        await a.enviar(roup, 'POST', `/movimentos/${m.json().id}/cancelamento`, {
          versaoVista: 9,
          motivo: 'Teste da versão',
        })
      ).json().codigo,
    ).toBe('versao-desatualizada');
    a.relogio.agora = '2026-10-29T10:00:00';
    expect(
      (
        await a.enviar(roup, 'POST', `/movimentos/${m.json().id}/cancelamento`, {
          versaoVista: 1,
          motivo: 'Teste do prazo',
        })
      ).json().codigo,
    ).toBe('fora-do-prazo-de-cancelamento');
    a.relogio.agora = `${HOJE}T09:00:00`;
  });

  it('a lista do período com os filtros e a paginação; o filtro inválido', async () => {
    const l = (await a.get(roup, `/movimentos?de=${HOJE}&ate=${HOJE}&tipo=coleta&centroCusto=9102`)).json();
    expect(l.itens.length).toBeGreaterThanOrEqual(1);
    expect(
      l.itens.every(
        (x: { tipo: string; centroCusto: number }) => x.tipo === 'coleta' && x.centroCusto === 9102,
      ),
    ).toBe(true);
    expect(l.proximo).toBeNull();
    expect((await a.get(roup, '/movimentos?de=2026-01-01&ate=2026-10-28')).statusCode).toBe(400);
    expect((await a.get(roup, `/movimentos?de=${HOJE}&ate=${HOJE}&tipo=lavagem`)).statusCode).toBe(400);
  });
});

describe('rouparia: enxoval, cotas, estatística e indicadores', () => {
  it('a peça nova, o nome repetido, o kit e a alteração pela versão', async () => {
    const n = await a.enviar(roup, 'POST', '/pecas', {
      nome: 'Cobertor (sintético)',
      categoria: 'cobertor',
      pesoGramas: 1200,
    });
    expect(n.statusCode).toBe(201);
    expect(
      (
        await a.enviar(roup, 'POST', '/pecas', { nome: 'FRONHA', categoria: 'fronha', pesoGramas: 150 })
      ).json().codigo,
    ).toBe('nome-duplicado');
    expect(
      (
        await a.enviar(roup, 'POST', '/pecas', { nome: 'Kit vazio', categoria: 'kit', pesoGramas: 500 })
      ).json().codigo,
    ).toBe('kit-sem-composicao');
    const id = n.json().id;
    const alt = await a.enviar(roup, 'PUT', `/pecas/${id}`, {
      nome: 'Cobertor de lã (sintético)',
      categoria: 'cobertor',
      pesoGramas: 1300,
      versaoVista: 1,
    });
    expect(alt.statusCode).toBe(200);
    expect(alt.json().versao).toBe(2);
    expect(
      (
        await a.enviar(roup, 'PUT', `/pecas/${id}`, {
          nome: 'X'.repeat(5),
          categoria: 'cobertor',
          pesoGramas: 1300,
          versaoVista: 1,
        })
      ).json().codigo,
    ).toBe('versao-desatualizada');
    expect(
      (
        await a.enviar(roup, 'PUT', `/pecas/${id}`, {
          nome: 'Sem versão',
          categoria: 'cobertor',
          pesoGramas: 1300,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await a.enviar(roup, 'PUT', '/pecas/987654', {
          nome: 'Outra',
          categoria: 'outro',
          pesoGramas: 10,
          versaoVista: 1,
        })
      ).statusCode,
    ).toBe(404);
  });

  it('as cotas do setor e a situação com o estimado e a reposição', async () => {
    const g = await a.enviar(roup, 'PUT', '/cotas', {
      centroCusto: 9101,
      cotas: [
        { peca: 1, quantidade: 30 },
        { peca: 2, quantidade: 10 },
      ],
    });
    expect(g.json()).toMatchObject({ ok: true, alteradas: 2 });
    expect(
      (
        await a.enviar(roup, 'PUT', '/cotas', { centroCusto: 9104, cotas: [{ peca: 1, quantidade: 1 }] })
      ).json().codigo,
    ).toBe('setor-inativo');
    expect(
      (
        await a.enviar(roup, 'PUT', '/cotas', {
          centroCusto: 9101,
          cotas: [
            { peca: 1, quantidade: 1 },
            { peca: 1, quantidade: 2 },
          ],
        })
      ).json().codigo,
    ).toBe('peca-repetida');
    expect(
      (
        await a.enviar(roup, 'PUT', '/cotas', { centroCusto: 9101, cotas: [{ peca: 77, quantidade: 1 }] })
      ).json().codigo,
    ).toBe('peca-inexistente');
    await movimento({ tipo: 'inventario', centroCusto: 9101, itens: [{ peca: 1, quantidade: 12 }] });
    await movimento({ tipo: 'entrega', centroCusto: 9101, itens: [{ peca: 1, quantidade: 10 }] });
    const sit = (await a.get(roup, '/cotas/9101')).json();
    expect(sit.inventarioEm).toBe(HOJE);
    expect(sit.itens[0]).toMatchObject({ peca: 1, cota: 30, estimado: 22, reposicao: 8 });
    expect(sit.itens[1]).toMatchObject({ peca: 2, cota: 10, estimado: 0, reposicao: 10 });
  });

  it('regra 4: kg por setor e dia com as parcelas; os indicadores com as contas', async () => {
    const e = (await a.get(roup, `/estatistica?de=${HOJE}&ate=${HOJE}`)).json();
    const s9102 = e.porSetor.find((x: { centroCusto: number }) => x.centroCusto === 9102);
    expect(s9102).toMatchObject({ kg: 12.5, coletas: 1, dias: [{ data: HOJE, kg: 12.5 }] });
    expect(e.conta).toMatch(/kg coletados\.$/);
    expect((await a.get(roup, '/estatistica?de=2026-10-28&ate=2026-10-01')).statusCode).toBe(400);
    const i = (await a.get(roup, `/indicadores?de=${HOJE}&ate=${HOJE}`)).json();
    expect(i.pacientesDia).toBe(30);
    expect(i.kgPorPacienteDia.denominador).toBe(30);
    expect(i.kgPorPacienteDia.conta).toMatch(/pacientes-dia/);
    expect(i.indicePerda.denominador).toBe(12);
    expect(i.custoPorPacienteDia.valor).toBeNull();
  });

  it('a busca do fornecedor da lavanderia', async () => {
    expect((await a.get(roup, '/fornecedores?termo=lav')).json().itens).toEqual([
      { codigo: 7101, nome: 'Lavanderia Sintética' },
    ]);
    expect((await a.get(roup, '/fornecedores?termo=l')).json().itens).toEqual([]);
    expect((await a.get(consulta, '/fornecedores?termo=lav')).statusCode).toBe(403);
  });
});

describe('rouparia: as respostas cabem nos esquemas que a tela valida', () => {
  it('painel, lista, detalhe, gravação, cancelamento, cotas, estatística, indicadores e fornecedores', async () => {
    const painel = esquemaPainelRouparia.parse((await a.get(roup, '')).json());
    expect(painel.pecas.length).toBeGreaterThan(0);
    const g = await movimento({ tipo: 'coleta', centroCusto: 9101, pesoKg: 3.5 });
    expect(g.statusCode).toBe(201);
    const res = esquemaResultadoRouparia.parse(g.json());
    esquemaListaMovimentosRoupa.parse((await a.get(roup, `/movimentos?de=${HOJE}&ate=${HOJE}`)).json());
    const det = esquemaDetalheMovimentoRoupa.parse((await a.get(roup, `/movimentos/${g.json().id}`)).json());
    const c = await a.enviar(roup, 'POST', `/movimentos/${g.json().id}/cancelamento`, {
      versaoVista: det.movimento.versao,
      motivo: 'registro em duplicidade',
    });
    expect(c.statusCode, JSON.stringify(c.json())).toBeLessThan(300);
    esquemaResultadoRouparia.parse(c.json());
    expect(res).toBeTruthy();
    const cotas = await a.enviar(roup, 'PUT', '/cotas', {
      centroCusto: 9102,
      cotas: [{ peca: 1, quantidade: 4 }],
    });
    esquemaResultadoCotasRoupa.parse(cotas.json());
    esquemaSituacaoCotaSetor.parse((await a.get(roup, '/cotas/9102')).json());
    esquemaEstatisticaRouparia.parse((await a.get(roup, `/estatistica?de=${HOJE}&ate=${HOJE}`)).json());
    esquemaIndicadoresRouparia.parse((await a.get(roup, `/indicadores?de=${HOJE}&ate=${HOJE}`)).json());
    esquemaFornecedoresRouparia.parse((await a.get(roup, '/fornecedores?termo=lav')).json());
  });
});

describe('rouparia desligada (POL-3)', () => {
  it('a tela fica em consulta e a gravação recusa com o motivo', async () => {
    const b = await montar({ semRouparia: true });
    try {
      const s = await b.entrar('SINT.ROUPARIA');
      const p = (await b.get(s, '')).json();
      expect(p.gravacao.ligada).toBe(false);
      expect(p.gravacao.operacoes.registrar.pode).toBe(false);
      const k = b.novaChave();
      const r = await b.enviar(
        s,
        'POST',
        '/movimentos',
        { chave: k, tipo: 'coleta', data: HOJE, centroCusto: 9101, pesoKg: 1 },
        k,
      );
      expect(r.statusCode).toBe(403);
      expect(r.json().codigo).toBe('recurso-desligado');
    } finally {
      await b.fechar();
    }
  });
});
