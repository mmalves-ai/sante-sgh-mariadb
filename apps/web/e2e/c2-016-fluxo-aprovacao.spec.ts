// F8 (07-FIN linha 65): o fluxo de aprovação configurável. As rotas de `/api/financeiro/fluxo-aprovacao` só existem no
// banco do cliente (na fonte sintética respondem 503), então este E2E simula as rotas com um estado em memória que
// segue a regra do servidor (a justificativa com 5 caracteres ou mais quando a resposta não aprova; o canal 'celular'
// só para o aprovador liberado). O que fica no banco (o fluxo inteiro com etapas e aprovadores, o agrupador com os
// membros, o pedido na etapa certa, a decisão com a etapa, a resposta e o canal, e o efeito no título, no pedido de
// compra e no contrato) é provado no contrato de efeito `aplicacao/fluxo-aprovacao.int.spec.ts`; aqui se prova a tela:
// a recusa do domínio na hora enquanto se monta o fluxo (etapa sem aprovador), gravar o fluxo com o corpo certo,
// encerrar, e a fila do aprovador num telefone (393x851): cartão com o valor e a etapa, a justificativa conferida
// enquanto se digita, decidir pelo celular e o bloqueio do aprovador não liberado; e os itens no menu. Axe em cada
// passo. Massa SINTÉTICA.
import { expect, type Page, type Route, test } from '@playwright/test';
import { escolher } from './combos.js';
import { itemDoMenu, semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';
// Quem gere o financeiro com o perfil de administrador do sistema (que dá financeiro.fluxoAprovacao.*).
const LOGIN = 'SINT.FIN.GESTOR';
const CONFIG = '/financeiro/aprovacao/fluxos';
const FILA = '/financeiro/aprovacoes';

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
const recusa = (rota: Route, codigo: string, detail: string) =>
  rota.fulfill({
    status: 409,
    contentType: 'application/problem+json',
    body: JSON.stringify({ type: `urn:sgh:erro:${codigo}`, title: detail, status: 409, detail, codigo }),
  });
const ok = (mensagem: string, extra: Record<string, unknown> = {}) => ({
  mensagem,
  repetida: false,
  ...extra,
});

test.describe('financeiro: fluxo de aprovação configurável @C2-016', () => {
  test.setTimeout(180_000);

  test('monta o fluxo com a recusa na hora, grava, encerra; fila no telefone decide pelo celular; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const corpos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    const respostas = [
      { id: 1, descricao: 'Aprovo', efeito: 'aprova', exigeJustificativa: false },
      { id: 2, descricao: 'Reprovo', efeito: 'reprova', exigeJustificativa: true },
      { id: 3, descricao: 'Devolvo para ajuste', efeito: 'devolve', exigeJustificativa: true },
    ];
    const fluxos: Record<string, unknown>[] = [];
    const pendencias = [
      {
        pedido: 501,
        tipo: 'titulo_pagar',
        documento: 9001,
        numero: 'TP-SINT-9001',
        descricao: 'SERVICO SINTETICO',
        valor: 12500,
        fluxo: 'FLUXO SINTETICO',
        etapa: 'Diretoria',
        nivel: 2,
        totalEtapas: 2,
        solicitante: 'USUARIO SINTETICO',
        solicitadoEm: '2026-11-20T10:30:00.000Z',
        celular: true,
        respostas,
      },
      {
        pedido: 502,
        tipo: 'pedido_compra',
        documento: 77,
        numero: '2026/77',
        descricao: 'Pedido de compra',
        valor: 800,
        fluxo: 'FLUXO SINTETICO COMPRAS',
        etapa: 'Gestor',
        nivel: 1,
        totalEtapas: 1,
        solicitante: 'COMPRADOR SINTETICO',
        solicitadoEm: '2026-11-21T08:00:00.000Z',
        celular: false,
        respostas,
      },
    ];

    await page.route('**/api/financeiro/fluxo-aprovacao/**', async (rota) => {
      const req = rota.request();
      const caminho = new URL(req.url()).pathname.replace('/api/financeiro/fluxo-aprovacao', '');
      if (req.method() === 'GET' && caminho === '/configuracao')
        return json(rota, {
          fluxos,
          agrupadores: [
            {
              id: 41,
              codigo: 'AG-SINT',
              descricao: 'AREA ASSISTENCIAL SINTETICA',
              criterio: 'centro_custo',
              aceitaVazio: false,
              ativo: true,
              fluxo: null,
              membros: [1, 2],
            },
          ],
          respostas: respostas.map((r, i) => ({ ...r, codigo: `R${i}`, fluxo: null, ordem: i, ativo: true })),
          apoios: {
            usuarios: [
              { id: 11, rotulo: 'GESTOR SINTETICO (SINT.G)' },
              { id: 12, rotulo: 'DIRETOR SINTETICO (SINT.D)' },
            ],
            papeis: [{ id: 21, rotulo: 'DIRETORIA SINTETICA' }],
            centrosCusto: [{ id: 1, rotulo: '1.01 · UTI SINTETICA' }],
          },
        });
      if (req.method() === 'GET' && caminho === '/pendencias') return json(rota, pendencias);
      if (req.method() === 'GET' && caminho.startsWith('/pedidos/'))
        return json(rota, {
          pedido: Number(caminho.split('/')[2]),
          tipo: 'titulo_pagar',
          documento: 9001,
          situacao: 'em_aprovacao',
          numero: 'TP-SINT-9001',
          valor: 12500,
          decisoes: [
            {
              nivel: 1,
              etapa: 'Gestor',
              resposta: 'Aprovo',
              decisao: 'aprovado',
              justificativa: '',
              canal: 'web',
              aprovador: 'GESTOR SINTETICO',
              em: '2026-11-20T11:00:00.000Z',
            },
          ],
        });
      const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
      corpos.push({ caminho, corpo });
      if (caminho === '/fluxos') {
        fluxos.push({
          id: 61,
          codigo: corpo['codigo'],
          descricao: corpo['descricao'],
          tipo: corpo['tipo'],
          estabelecimento: 1,
          centroCusto: corpo['centroCusto'],
          valorMinimo: corpo['valorMinimo'],
          valorMaximo: corpo['valorMaximo'],
          prioridade: corpo['prioridade'],
          vigenciaInicio: corpo['vigenciaInicio'],
          vigenciaFim: null,
          ativo: true,
          etapas: corpo['etapas'],
        });
        return json(rota, ok('Fluxo gravado.', { fluxo: 61 }));
      }
      if (caminho === '/fluxos/encerrar') {
        const f = fluxos.find((x) => x['id'] === corpo['fluxo']);
        if (f) f['ativo'] = false;
        return json(rota, ok('Fluxo encerrado.'));
      }
      if (caminho === '/decidir') {
        const p = pendencias.find((x) => x.pedido === corpo['pedido']);
        const r = respostas.find((x) => x.id === corpo['resposta']);
        if (!p || !r) return recusa(rota, 'pedido-inexistente', 'O pedido não existe.');
        if (corpo['canal'] === 'celular' && !p.celular)
          return recusa(rota, 'celular-nao-liberado', 'Aprovador não liberado para o celular.');
        if (r.efeito !== 'aprova' && String(corpo['justificativa'] ?? '').trim().length < 5)
          return recusa(rota, 'justificativa-obrigatoria', 'Justifique a decisão.');
        pendencias.splice(pendencias.indexOf(p), 1);
        return json(rota, ok('Decisão gravada: aprovado.'));
      }
      return json(rota, ok('Gravado.'));
    });

    await entrar(page, LOGIN);

    // ── Configuração: a recusa do domínio na hora; gravar o fluxo inteiro; encerrar ───────────────────────────────
    await page.goto(CONFIG);
    await expect(page.getByTestId('tela-fin-fluxos-aprovacao')).toBeVisible();
    await expect(page.getByTestId('fla-sem-fluxo')).toBeVisible();
    await semViolacaoAxe(page, `${CONFIG} (início)`);
    await page.getByTestId('fla-codigo').fill('FX-SINT');
    await page.getByTestId('fla-descricao').fill('FLUXO SINTETICO DE TITULOS');
    await escolher(page.getByTestId('fla-tipo'), { rotulo: /Título a pagar/ });
    await page.getByTestId('fla-vmin').fill('1000');
    await page.getByTestId('fla-etapa-nome-1').fill('Gestor');
    // Etapa sem aprovador: a regra do domínio recusa antes de gravar.
    await expect(page.getByTestId('fla-recusa')).toContainText('precisa de ao menos um aprovador');
    await expect(page.getByTestId('fla-gravar')).toBeDisabled();
    await escolher(page.getByTestId('fla-aprov-usuario-1-1'), { rotulo: /GESTOR SINTETICO/ });
    await page.getByTestId('fla-nova-etapa').click();
    await page.getByTestId('fla-etapa-nome-2').fill('Diretoria');
    await escolher(page.getByTestId('fla-etapa-quorum-2'), { rotulo: /Todos aprovam/ });
    await escolher(page.getByTestId('fla-aprov-papel-2-1'), { rotulo: /DIRETORIA SINTETICA/ });
    await page.getByTestId('fla-aprov-celular-2-1').check();
    await expect(page.getByTestId('fla-conferido')).toBeVisible();
    await semViolacaoAxe(page, `${CONFIG} (fluxo montado)`);
    await page.getByTestId('fla-gravar').click();
    await expect(page.getByTestId('fla-fluxo-FX-SINT')).toBeVisible();
    const gravado = corpos.find((c) => c.caminho === '/fluxos')!.corpo;
    expect(gravado).toMatchObject({ codigo: 'FX-SINT', tipo: 'titulo_pagar', valorMinimo: 1000 });
    const etapas = gravado['etapas'] as Record<string, unknown>[];
    expect(etapas).toHaveLength(2);
    expect(etapas[0]).toMatchObject({ sequencia: 1, nome: 'Gestor', regraQuorum: 'qualquer' });
    expect(etapas[1]).toMatchObject({ sequencia: 2, nome: 'Diretoria', regraQuorum: 'todos' });
    expect((etapas[0]!['aprovadores'] as unknown[])[0]).toMatchObject({ usuario: 11, papel: null });
    expect((etapas[1]!['aprovadores'] as unknown[])[0]).toMatchObject({
      usuario: null,
      papel: 21,
      aprovaPeloCelular: true,
    });
    page.once('dialog', (d) => void d.accept());
    await page.getByTestId('fla-encerrar-FX-SINT').click();
    await expect(page.getByTestId('fla-fluxo-FX-SINT')).toContainText('Encerrado');
    expect(corpos.find((c) => c.caminho === '/fluxos/encerrar')!.corpo).toEqual({ fluxo: 61 });

    // ── Fila do aprovador no telefone ───────────────────────────────────────────────────────────────────────────
    await page.setViewportSize({ width: 393, height: 851 });
    await page.goto(FILA);
    await expect(page.getByTestId('tela-fin-aprovacoes')).toBeVisible();
    const titulo = page.getByTestId('fap-pedido-501');
    await expect(titulo.getByTestId('fap-etapa')).toContainText('Etapa 2 de 2: Diretoria');
    await expect(titulo.getByTestId('fap-valor')).toContainText('12.500,00');
    // O aprovador não liberado para o celular naquela etapa não decide pelo telefone.
    await expect(page.getByTestId('fap-pedido-502').getByTestId('fap-celular-bloqueado')).toBeVisible();
    await expect(page.getByTestId('fap-resposta-502-aprova')).toHaveCount(0);
    await semViolacaoAxe(page, `${FILA} (telefone)`);
    // Reprovar pede justificativa: conferida enquanto se digita.
    await expect(page.getByTestId('fap-resposta-501-reprova')).toBeDisabled();
    await page.getByTestId('fap-justificativa-501').fill('abc');
    await expect(titulo.getByRole('status')).toContainText('ao menos 5');
    await expect(page.getByTestId('fap-resposta-501-reprova')).toBeDisabled();
    await page.getByTestId('fap-historico-501').click();
    await expect(page.getByTestId('fap-decisoes-501')).toContainText('Gestor · Aprovo · GESTOR SINTETICO');
    await page.getByTestId('fap-resposta-501-aprova').click();
    await expect(page.getByTestId('fap-pedido-501')).toHaveCount(0);
    expect(corpos.find((c) => c.caminho === '/decidir')!.corpo).toMatchObject({
      pedido: 501,
      resposta: 1,
      canal: 'celular',
    });
    await semViolacaoAxe(page, `${FILA} (decidido)`);

    // ── Menu ────────────────────────────────────────────────────────────────────────────────────────────────────
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/inicio');
    await (await itemDoMenu(page, 'Minhas aprovações')).click();
    await expect(page).toHaveURL(new RegExp(`${FILA}$`));
    await (await itemDoMenu(page, 'Fluxos de aprovação')).click();
    await expect(page).toHaveURL(new RegExp(`${CONFIG}$`));
    expect(externas).toEqual([]);
  });
});
