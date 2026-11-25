// E2E @C1-070 (09-AREA linha 66): homologação de fornecedores por questionário pontuado pelas rotas reais do módulo (o
// HomologacaoFornecedorController registrado no modulo.ts). O gestor de contratos abre a tela pelo menu (Suprimentos >
// Compras > Homologação de fornecedores). A porta grava só no banco próprio: na sessão sintética de dev/ci (logins
// SINT.*, sem o núcleo), GET /api/suprimentos/homologacao-fornecedor responde 503 e a tela mostra o erro sem inventar
// formulário nem ranking (primeiro teste). O segundo teste simula as rotas da homologação (page.route com respostas
// sintéticas, sem depender do banco) e percorre o ciclo pela tela conferindo o corpo de cada POST: o questionário novo
// com a validação na hora (nota mínima fora da faixa recusada antes de gravar), a busca do fornecedor filtrada pela
// categoria do questionário, a avaliação com a prévia da nota e das parcelas, o ranking com a marca de requalificar, a
// exceção bloqueada a quem avaliou e liberada para a avaliação de outra pessoa, o cancelamento com o mínimo de
// caracteres e o motivo exibido na lista e no detalhe. O efeito no
// MariaDB (questionário, perguntas, avaliação, respostas, exceção, cancelamento e trilha) está em
// apps/api/src/modulos/suprimentos/homologacao-fornecedor.int.spec.ts. Massa SINTÉTICA; nenhum dado de pessoa.
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

/** Abre a tela pelo menu e devolve o status da leitura do painel. */
async function abrirPeloMenu(page: Page): Promise<number> {
  const leitura = page.waitForResponse(
    (r) => r.url().endsWith('/api/suprimentos/homologacao-fornecedor') && r.request().method() === 'GET',
  );
  const menu = page.getByRole('navigation', { name: 'Menu principal' });
  await menu.getByRole('button', { name: /^Suprimentos/ }).click();
  const compras = menu.getByRole('button', { name: /^Compras/ });
  if ((await compras.getAttribute('aria-expanded')) !== 'true') await compras.click();
  await menu.getByRole('link', { name: 'Homologação de fornecedores' }).click();
  await expect(page).toHaveURL(/\/suprimentos\/homologacao-fornecedores$/);
  await expect(page.getByTestId('tela-homologacao-fornecedores')).toBeVisible();
  return (await leitura).status();
}

test.describe('@C1-070 Homologação de fornecedores por questionário pontuado', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  test('pelo menu; sem o banco do cliente, a tela mostra o erro e não oferece gravação; axe', async ({
    page,
  }) => {
    vigiarExternas(page);
    await entrar(page, 'SINT.CONTRATOS');
    const status = await abrirPeloMenu(page);
    const tela = page.getByTestId('tela-homologacao-fornecedores');
    await expect(tela.getByTestId('homol-aba-avaliar')).toBeVisible();
    await expect(tela.getByTestId('homol-aba-ranking')).toBeVisible();
    if (status === 503) {
      await expect(tela.getByTestId('recusa-suprimentos').first()).toBeVisible();
      await expect(tela.getByTestId('homol-registrar')).toHaveCount(0);
      await expect(tela.getByTestId('homol-q-gravar')).toHaveCount(0);
      await expect(tela.getByTestId('homol-ranking-tabela')).toHaveCount(0);
    } else {
      expect(status).toBe(200);
      await expect(tela.getByTestId('homol-avaliar')).toBeVisible();
    }
    await semViolacaoAxe(page, '/suprimentos/homologacao-fornecedores');
  });

  test('ciclo pela tela com a API simulada: questionário, avaliação, ranking, exceção e cancelamento; axe', async ({
    page,
  }) => {
    vigiarExternas(page);
    const B = '/api/suprimentos/homologacao-fornecedor';
    const corpos: { url: string; corpo: Record<string, unknown> }[] = [];
    const json = (rota: Route, corpo: unknown) =>
      rota.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpo) });
    const USUARIO = 900;
    const ESCALA = [
      { ordem: 1, texto: 'Não atende', pontos: 0 },
      { ordem: 2, texto: 'Atende parcialmente', pontos: 5 },
      { ordem: 3, texto: 'Atende plenamente', pontos: 10 },
    ];
    const questionarios: Record<string, unknown>[] = [
      {
        id: 11,
        versao: 1,
        codigo: 'SINT-MED',
        descricao: 'Questionário sintético de medicamentos',
        categoria: 3,
        categoriaDescricao: 'Categoria sintética 3',
        notaMinima: 70,
        validadeMeses: 12,
        instrucoes: null,
        vigenciaInicio: '2026-01-01',
        vigenciaFim: null,
        vigente: true,
        perguntas: [
          {
            id: 101,
            sequencia: 1,
            identificador: 'AFE',
            texto: 'Autorização de funcionamento vigente?',
            peso: 3,
            tipoResposta: 'sim_nao',
            opcoes: [],
            obrigatoria: true,
            eliminatoria: true,
          },
          {
            id: 102,
            sequencia: 2,
            identificador: null,
            texto: 'Cumprimento de prazo de entrega',
            peso: 2,
            tipoResposta: 'escala',
            opcoes: ESCALA,
            obrigatoria: true,
            eliminatoria: false,
          },
        ],
      },
    ];
    const homologacao = (id: number, avaliador: number, extra: Record<string, unknown>) => ({
      id,
      versao: 1,
      fornecedor: 7000 + id,
      fornecedorNome: `Distribuidora sintética ${id}`,
      questionario: 11,
      questionarioDescricao: 'Questionário sintético de medicamentos',
      categoriaDescricao: 'Categoria sintética 3',
      insumoDescricao: null,
      situacao: 'reprovado',
      situacaoNaData: 'reprovado',
      requalificar: false,
      nota: 40,
      excecao: false,
      justificativa: null,
      faixa: 'Reprovado (sintético)',
      avaliadoEm: '2026-11-20 10:00:00',
      validoAte: null,
      avaliador,
      avaliadorLogin: avaliador === USUARIO ? 'sint.eu' : 'sint.outro',
      motivoCancelamento: null,
      ...extra,
    });
    const homologacoes: Record<string, unknown>[] = [
      homologacao(201, USUARIO, {}),
      homologacao(202, 901, {}),
      homologacao(203, 901, {
        situacao: 'homologado',
        situacaoNaData: 'vencido',
        requalificar: true,
        nota: 85,
        faixa: 'Ótimo (sintético)',
        validoAte: '2025-11-20',
      }),
    ];
    const mudar = (id: number, extra: Record<string, unknown>) => {
      const i = homologacoes.findIndex((x) => x['id'] === id);
      homologacoes[i] = { ...homologacoes[i], ...extra, versao: Number(homologacoes[i]!['versao']) + 1 };
    };
    const painel = () => ({
      hoje: '2026-11-25',
      usuario: USUARIO,
      questionarios,
      faixas: [
        {
          id: 1,
          codigo: 'OT',
          descricao: 'Ótimo (sintético)',
          notaInicial: 70,
          notaFinal: 100,
          resultado: 'aprovado',
        },
        {
          id: 2,
          codigo: 'RE',
          descricao: 'Reprovado (sintético)',
          notaInicial: 0,
          notaFinal: 69.99,
          resultado: 'reprovado',
        },
      ],
      categorias: [{ id: 3, codigo: 'SINT3', descricao: 'Categoria sintética 3' }],
      homologacoes,
      ranking: [
        {
          posicao: 1,
          id: 203,
          fornecedorNome: 'Distribuidora sintética 203',
          questionario: 11,
          nota: 85,
          excecao: false,
          situacaoNaData: 'vencido',
          requalificar: true,
          validoAte: '2025-11-20',
          questionarioDescricao: 'Questionário sintético de medicamentos',
        },
      ],
      pode: { editar: true, avaliar: true, excecao: true },
    });
    const buscas: URLSearchParams[] = [];

    await page.route(/\/api\/suprimentos\/homologacao-fornecedor$/, (r) => json(r, painel()));
    await page.route(/\/api\/suprimentos\/homologacao-fornecedor\/fornecedores\?.*$/, (r) => {
      buscas.push(new URL(r.request().url()).searchParams);
      return json(r, {
        itens: [
          { id: 7300, nome: 'Distribuidora sintética da categoria', documento: null, situacao: 'ativo' },
        ],
      });
    });
    await page.route(/\/api\/suprimentos\/homologacao-fornecedor\/questionarios$/, (r) => {
      corpos.push({ url: 'questionarios', corpo: r.request().postDataJSON() as Record<string, unknown> });
      return json(r, { ok: true, id: 12, mensagem: 'Questionário gravado.' });
    });
    await page.route(/\/api\/suprimentos\/homologacao-fornecedor\/avaliacoes$/, (r) => {
      corpos.push({ url: 'avaliacoes', corpo: r.request().postDataJSON() as Record<string, unknown> });
      return json(r, {
        ok: true,
        id: 204,
        nota: 80,
        situacao: 'homologado',
        faixa: 'Ótimo (sintético)',
        comRestricao: false,
        validoAte: '2027-11-25',
        motivos: [],
        parcelas: ['Nota = 100 × 4 ÷ 5 = 80'],
        mensagem: 'Fornecedor homologado com nota 80.',
      });
    });
    await page.route(/\/api\/suprimentos\/homologacao-fornecedor\/\d+\/(excecao|cancelamento)$/, (r) => {
      const url = new URL(r.request().url()).pathname;
      const corpo = r.request().postDataJSON() as Record<string, unknown>;
      corpos.push({ url: url.slice(B.length + 1), corpo });
      const [, id, acao] = /\/(\d+)\/(\w+)$/.exec(url)!;
      if (acao === 'excecao') {
        mudar(Number(id), {
          situacao: 'homologado',
          situacaoNaData: 'homologado',
          excecao: true,
          justificativa: corpo['justificativa'],
        });
        return json(r, { ok: true, id: Number(id), validoAte: '2027-11-20', mensagem: 'Exceção aprovada.' });
      }
      mudar(Number(id), {
        situacao: 'cancelado',
        situacaoNaData: 'cancelado',
        motivoCancelamento: corpo['motivo'],
      });
      return json(r, {
        ok: true,
        id: Number(id),
        mensagem: 'Homologação cancelada: fica no histórico com o motivo.',
      });
    });
    await page.route(/\/api\/suprimentos\/homologacao-fornecedor\/\d+$/, (r) => {
      const id = Number(/\/(\d+)$/.exec(new URL(r.request().url()).pathname)![1]);
      return json(r, {
        ...homologacoes.find((x) => x['id'] === id),
        respostas: [
          {
            sequencia: 1,
            pergunta: 'Autorização de funcionamento vigente?',
            resposta: 'Sim',
            atende: true,
            pontuacao: 10,
            peso: 3,
          },
          {
            sequencia: 2,
            pergunta: 'Cumprimento de prazo de entrega',
            resposta: 'Atende parcialmente',
            atende: null,
            pontuacao: 5,
            peso: 2,
          },
        ],
      });
    });

    await entrar(page, 'SINT.CONTRATOS');
    expect(await abrirPeloMenu(page)).toBe(200);
    const tela = page.getByTestId('tela-homologacao-fornecedores');

    // 1. O questionário novo: a nota mínima fora de 0 a 100 é recusada na hora; corrigida, grava com o corpo certo.
    await tela.getByTestId('homol-aba-questionarios').click();
    await tela.getByTestId('homol-q-codigo').fill('SINT-NOVO');
    await tela.getByTestId('homol-q-descricao').fill('Questionário sintético novo (teste C1-070)');
    await escolher(tela.getByTestId('homol-q-categoria'), { rotulo: 'Categoria sintética 3' });
    await tela.getByTestId('homol-q-minima').fill('120');
    await tela.getByTestId('homol-qp-texto-1').fill('Autorização de funcionamento vigente?');
    await escolher(tela.getByTestId('homol-qp-tipo-1'), 'sim_nao');
    await tela.getByTestId('homol-qp-peso-1').fill('3');
    await tela.getByTestId('homol-qp-eliminatoria-1').check();
    await expect(tela.getByTestId('homol-q-recusa-0')).toBeVisible();
    await expect(tela.getByTestId('homol-q-gravar')).toBeDisabled();
    await tela.getByTestId('homol-q-minima').fill('70');
    await expect(tela.getByTestId('homol-q-recusa-0')).toHaveCount(0);
    await tela.getByTestId('homol-q-gravar').click();
    await expect(tela.getByTestId('homol-mensagem')).toContainText('Questionário gravado');
    expect(corpos.at(-1)).toMatchObject({
      url: 'questionarios',
      corpo: {
        codigo: 'SINT-NOVO',
        categoria: 3,
        notaMinima: 70,
        perguntas: [
          {
            texto: 'Autorização de funcionamento vigente?',
            peso: 3,
            tipoResposta: 'sim_nao',
            eliminatoria: true,
          },
        ],
      },
    });

    // 2. A avaliação: a busca vai com o questionário (filtra pela categoria); a prévia calcula a nota na hora.
    await tela.getByTestId('homol-aba-avaliar').click();
    await escolher(tela.getByTestId('homol-questionario'), { rotulo: /^SINT-MED / });
    await expect(tela.getByTestId('homol-da-categoria')).toContainText('Categoria sintética 3');
    await tela.getByTestId('homol-termo').fill('DIST');
    await tela.getByTestId('homol-buscar').click();
    await expect.poll(() => buscas.length).toBe(1);
    expect([buscas[0]!.get('termo'), buscas[0]!.get('questionario')]).toEqual(['DIST', '11']);
    await expect(tela.getByTestId('homol-pendencias')).toBeVisible();
    await expect(tela.getByTestId('homol-registrar')).toBeDisabled();
    await tela.getByTestId('homol-resposta-1-1').check();
    await tela.getByTestId('homol-resposta-2-2').check();
    // (3 × 10/10 + 2 × 5/10) ÷ 5 × 100 = 80.
    await expect(tela.getByTestId('homol-nota')).toHaveText('80');
    await expect(tela.getByTestId('homol-parcelas')).toContainText('Nota = 100 × 4 ÷ 5 = 80');
    await expect(tela.getByTestId('homol-previsto')).toContainText('Homologado');
    await tela.getByTestId('homol-registrar').click();
    await expect(tela.getByTestId('homol-mensagem')).toContainText('homologado com nota 80');
    expect(corpos.at(-1)).toEqual({
      url: 'avaliacoes',
      corpo: {
        fornecedor: 7300,
        questionario: 11,
        insumo: null,
        respostas: [
          { pergunta: 101, opcao: 1, texto: null },
          { pergunta: 102, opcao: 2, texto: null },
        ],
      },
    });

    // 3. O ranking do questionário com a marca de requalificar (validade vencida).
    await tela.getByTestId('homol-aba-ranking').click();
    await escolher(tela.getByTestId('homol-ranking-questionario'), { rotulo: /^SINT-MED / });
    await expect(tela.getByTestId('homol-ranking-1')).toContainText('Distribuidora sintética 203');
    await expect(tela.getByTestId('homol-ranking-1')).toContainText('requalificar');

    // 4. A exceção: bloqueada a quem avaliou (aviso e confirmar desabilitado mesmo com a justificativa).
    await tela.getByTestId('homol-aba-avaliacoes').click();
    const justificativa = 'Único distribuidor sintético do item na região; plano de ação de 90 dias.';
    await tela.getByTestId('homol-excecao-201').click();
    await expect(tela.getByTestId('homol-proprio')).toBeVisible();
    await tela.getByTestId('homol-acao-texto').fill(justificativa);
    await expect(tela.getByTestId('homol-acao-confirmar')).toBeDisabled();
    // Liberada na avaliação de outra pessoa, só com a justificativa mínima.
    await tela.getByTestId('homol-excecao-202').click();
    await expect(tela.getByTestId('homol-proprio')).toHaveCount(0);
    await tela.getByTestId('homol-acao-texto').fill('curta');
    await expect(tela.getByTestId('homol-acao-confirmar')).toBeDisabled();
    await tela.getByTestId('homol-acao-texto').fill(justificativa);
    await expect(tela.getByTestId('homol-acao-confirmar')).toBeEnabled();
    await tela.getByTestId('homol-acao-confirmar').click();
    await expect(tela.getByTestId('homol-mensagem')).toContainText('Exceção aprovada');
    expect(corpos.at(-1)).toEqual({ url: '202/excecao', corpo: { justificativa, versao: 1 } });
    await expect(tela.getByTestId('homol-excecao-202')).toHaveCount(0);
    await expect(tela.getByTestId('homol-linha-202')).toContainText(justificativa);

    // 5. O cancelamento: o motivo curto não confirma; o motivo fica visível na lista e no detalhe.
    const motivo = 'Avaliação lançada no fornecedor errado';
    await tela.getByTestId('homol-cancelar-203').click();
    await tela.getByTestId('homol-acao-texto').fill('curto');
    await expect(tela.getByTestId('homol-acao-confirmar')).toBeDisabled();
    await tela.getByTestId('homol-acao-texto').fill(motivo);
    await tela.getByTestId('homol-acao-confirmar').click();
    await expect(tela.getByTestId('homol-mensagem')).toContainText('fica no histórico com o motivo');
    expect(corpos.at(-1)).toEqual({ url: '203/cancelamento', corpo: { motivo, versao: 1 } });
    await expect(tela.getByTestId('homol-motivo-203')).toContainText(motivo);
    await expect(tela.getByTestId('homol-cancelar-203')).toHaveCount(0);
    await tela.getByTestId('homol-abrir-203').click();
    await expect(tela.getByTestId('homol-detalhe-motivo')).toContainText(motivo);
    await expect(tela.getByTestId('homol-detalhe')).toContainText('Atende parcialmente');
    await semViolacaoAxe(page, '/suprimentos/homologacao-fornecedores (API simulada)');
  });
});
