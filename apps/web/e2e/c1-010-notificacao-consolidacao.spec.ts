// E2E @C1-010 (01-ADM L76, ficha F78-01): consolidação dos avisos, histórico de envio e de resposta, e "meus avisos"
// em `/administracao/alertas`. A notificação por regra só existe no banco do cliente (na fonte sintética a API responde
// 503 e o painel some), então este E2E simula `/api/administracao/notificacao-regras*` e
// `/api/acesso/notificacoes/meus-envios*` com um estado em memória que segue a regra do servidor. O que fica no banco
// é provado nos contratos de efeito `notificacao-regra-propria.int.spec.ts` e `notificacao-regra-escopo.int.spec.ts`;
// aqui se prova o fluxo da tela: a consolidação conferida enquanto se digita (a mesma regra do domínio), gravada com o
// limite por pessoa; consolidar agora por canal; o histórico com a medição por canal e o filtro; "Ciente" e
// "Resolver" na própria linha de "meus avisos". Dados sintéticos. Axe em cada passo.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

interface Envio {
  id: number;
  versao: number;
  usuario: string;
  canal: string;
  consolidacao: string | null;
  quantidadeAvisos: number;
  avisos: number[];
  situacao: string;
  tentativas: number;
  ocorridoEm: string | null;
  enviadoEm: string | null;
  entregueEm: string | null;
  lidoEm: string | null;
  erro: string | null;
}

test.describe('administração: consolidação e histórico de notificação @C1-010 @fase8', () => {
  test.setTimeout(180_000);

  test('consolidação conferida na hora e gravada; consolidar por canal; histórico com medição; ciente e resolver; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const consolidacoes: Record<string, unknown>[] = [];
    const envios: Envio[] = [
      {
        id: 11,
        versao: 1,
        usuario: 'SINT.ADMIN',
        canal: 'CENTRAL',
        consolidacao: 'SINT.TURNO',
        quantidadeAvisos: 3,
        avisos: [101, 102, 103],
        situacao: 'entregue',
        tentativas: 1,
        ocorridoEm: '2026-11-25T08:00:00Z',
        enviadoEm: '2026-11-25T08:00:00Z',
        entregueEm: '2026-11-25T08:00:00Z',
        lidoEm: null,
        erro: null,
      },
      {
        id: 12,
        versao: 2,
        usuario: 'SINT.OUTRO',
        canal: 'EMAIL',
        consolidacao: 'SINT.TURNO',
        quantidadeAvisos: 1,
        avisos: [104],
        situacao: 'capturado',
        tentativas: 1,
        ocorridoEm: '2026-11-25T08:05:00Z',
        enviadoEm: '2026-11-25T08:05:00Z',
        entregueEm: null,
        lidoEm: null,
        erro: null,
      },
    ];
    const painel = () => ({
      regras: [],
      perfis: [],
      consolidacoes,
      cenarios: [{ codigo: 'SINT_INTERNACAO', descricao: 'Internação (sintético)' }],
      canais: [
        { codigo: 'CENTRAL', descricao: 'Central de avisos', tipo: 'central', externo: false },
        { codigo: 'EMAIL', descricao: 'E-mail', tipo: 'email', externo: true },
      ],
    });
    const historico = (canal: string | null) => {
      const es = envios.filter((e) => !canal || e.canal === canal);
      const canais = [...new Set(es.map((e) => e.canal))];
      return {
        envios: es,
        medicao: canais.map((c) => {
          const doCanal = es.filter((e) => e.canal === c);
          const lidos = doCanal.filter((e) => e.lidoEm !== null).length;
          return {
            canal: c,
            envios: doCanal.length,
            avisos: doCanal.reduce((s, e) => s + e.quantidadeAvisos, 0),
            lidos,
            falhas: 0,
            aguardando: 0,
            taxaLeituraPercentual: doCanal.length ? (100 * lidos) / doCanal.length : null,
            medianaMinutosAteLeitura: lidos ? 12 : null,
          };
        }),
      };
    };
    const pedidos: { url: string; corpo: Record<string, unknown>; chave: string }[] = [];
    const anotar = (rota: Route) => {
      const p = rota.request();
      pedidos.push({
        url: p.url(),
        corpo: (p.postDataJSON() ?? {}) as Record<string, unknown>,
        chave: p.headers()['idempotency-key'] ?? '',
      });
      return pedidos[pedidos.length - 1]!.corpo;
    };

    await page.route(/\/api\/administracao\/notificacao-regras$/, (rota) => json(rota, painel()));
    await page.route(/\/api\/administracao\/notificacao-regras\/envios(\?.*)?$/, (rota) =>
      json(rota, historico(new URL(rota.request().url()).searchParams.get('canal'))),
    );
    await page.route(/\/api\/administracao\/notificacao-regras\/consolidacoes$/, (rota) => {
      const c = anotar(rota);
      const nova = { ...c, id: consolidacoes.length + 1, versao: 1 };
      consolidacoes.push(nova);
      return json(rota, { resultado: { consolidacao: nova.id }, repetida: false });
    });
    await page.route(/\/api\/administracao\/notificacao-regras\/consolidar$/, (rota) => {
      anotar(rota);
      return json(rota, {
        resultado: { canal: 1, envios: 2, avisos: 5, aguardando: 1, retidos: 0 },
        repetida: false,
      });
    });
    await page.route(/\/api\/acesso\/notificacoes\/meus-envios$/, (rota) =>
      json(rota, { envios: envios.filter((e) => e.usuario === 'SINT.ADMIN') }),
    );
    await page.route(/\/api\/acesso\/notificacoes\/meus-envios\/\d+\/resposta$/, (rota) => {
      const c = anotar(rota);
      const id = Number(/meus-envios\/(\d+)\//.exec(rota.request().url())![1]);
      const e = envios.find((x) => x.id === id)!;
      Object.assign(e, { situacao: 'lido', lidoEm: '2026-11-25T08:12:00Z', versao: e.versao + 1 });
      return json(rota, {
        resultado: {
          situacao: 'lido',
          avisos: e.quantidadeAvisos,
          resolvidos: c['resolver'] ? e.quantidadeAvisos : 0,
        },
        repetida: false,
      });
    });

    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/alertas');
    await expect(page.getByTestId('consolidacoes')).toContainText('Nenhuma regra de consolidação');
    await expect(page.getByTestId('historico-envio')).toHaveCount(2);
    await expect(page.getByTestId('meu-envio')).toHaveCount(1);
    await semViolacaoAxe(page, '/administracao/alertas (consolidação, histórico e meus avisos)');

    // Consolidação nova: a pendência aparece enquanto se digita e o botão só libera sem ela.
    await page.getByTestId('consolidacao-nova').click();
    const pendencia = page.getByTestId('consolidacao-pendencia');
    const gravar = page.getByTestId('consolidacao-gravar');
    await expect(pendencia).toContainText('código');
    await expect(gravar).toBeDisabled();
    await page.getByTestId('consolidacao-codigo').fill('SINT.TURNO');
    await page.getByTestId('consolidacao-nome').fill('POR TURNO SINTETICO');
    await page.getByTestId('consolidacao-janela').fill('0');
    await expect(pendencia).toContainText('janela');
    await page.getByTestId('consolidacao-janela').fill('120');
    await page.getByTestId('consolidacao-com-limite').check();
    await page.getByTestId('consolidacao-limite').fill('4');
    await expect(pendencia).toContainText('período');
    await page.getByTestId('consolidacao-periodo').fill('60');
    await page.getByTestId('consolidacao-horario').fill('07:30');
    await page.getByTestId('consolidacao-campo-atendimento').check();
    await escolher(page.getByTestId('consolidacao-formato'), 'contagem');
    await expect(pendencia).toHaveCount(0);
    await semViolacaoAxe(page, '/administracao/alertas (consolidação preenchida)');
    await gravar.click();
    await expect(page.getByTestId('notificacao-aviso')).toContainText(
      'Consolidação POR TURNO SINTETICO gravada',
    );
    await expect(page.getByTestId('consolidacao-linha')).toHaveCount(1);
    await expect(page.getByTestId('consolidacao-linha')).toContainText('4 a cada 60 min');
    expect(pedidos[0]!.corpo).toEqual({
      codigo: 'SINT.TURNO',
      nome: 'POR TURNO SINTETICO',
      janelaMinutos: 120,
      campos: ['regra', 'paciente', 'atendimento'],
      limitePorUsuario: 4,
      periodoLimiteMinutos: 60,
      horarioResumo: '07:30',
      formato: 'contagem',
      ativo: true,
    });

    // Consolidar agora por canal.
    await escolher(page.getByTestId('consolidar-canal'), 'EMAIL');
    await page.getByTestId('consolidar-agora').click();
    await expect(page.getByTestId('notificacao-aviso')).toContainText('2 envio(s) com 5 aviso(s)');
    expect(pedidos[1]!.corpo).toEqual({ canal: 'EMAIL' });

    // Histórico: medição por canal e filtro num clique.
    await expect(page.getByTestId('historico-medicao')).toContainText('Central de avisos');
    await escolher(page.getByTestId('historico-canal'), 'EMAIL');
    await expect(page.getByTestId('historico-envio')).toHaveCount(1);
    await expect(page.getByTestId('historico-envio')).toContainText('Registrado (fora de produção)');

    // Meus avisos: resolver na própria linha (ciência e resolução dos avisos do envio).
    await page.getByTestId('meu-envio-resolver').click();
    await expect(page.getByTestId('notificacao-aviso')).toContainText('3 aviso(s), 3 resolvido(s)');
    await expect(page.getByTestId('meu-envio')).toHaveCount(0);
    await expect(page.getByTestId('meu-envio-respondido')).toHaveCount(1);
    expect(pedidos[2]!.corpo).toEqual({ versao: 1, resolver: true });
    expect(new Set(pedidos.map((p) => p.chave)).size).toBe(3);
    await semViolacaoAxe(page, '/administracao/alertas (aviso resolvido)');
    expect(externas).toEqual([]);
  });
});
