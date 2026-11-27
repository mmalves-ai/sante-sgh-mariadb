// C2-123 (06-SUS linha 61): habilitações, serviços e regras por tipo de prestador do estabelecimento, pelo caminho da
// tela. As rotas /api/sus/estabelecimento exigem o banco próprio, e o E2E roda com a fonte sintética (sem núcleo); por
// isso as respostas destas rotas são simuladas pelo Playwright com massa SINTÉTICA. O que se prova é a tela: a rota abre
// a tela, a validação aparece na hora (código inválido e portaria sem número travam o botão sem ir ao servidor), a
// inclusão vai com a vigência por competência (primeiro e último dia), o encerramento na própria linha leva a versão
// lida e o último dia da competência, a conciliação com o cadastro nacional mostra a prévia antes de aplicar, e o
// serviço terceirizado pede o prestador. O efeito no banco está no contrato de efeito
// (apps/api/src/modulos/sus/estabelecimento-sus-propria.int.spec.ts).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
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

const op = (id: number, codigo: string, descricao: string) => ({ id, codigo, descricao });

test.describe('C2-123 habilitações e serviços SUS do estabelecimento @C2-123', () => {
  test('habilitação validada na hora, incluída por competência, encerrada, conciliada e serviço terceirizado', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    const cadastro = {
      habilitacoes: [] as Record<string, unknown>[],
      servicos: [] as Record<string, unknown>[],
      regrasPrestador: [],
      regrasServico: [],
    };
    await page.route('**/api/sus/estabelecimento**', (r) => {
      const req = r.request();
      const url = new URL(req.url());
      if (req.method() === 'GET') {
        if (url.pathname.endsWith('/opcoes'))
          return json(r, {
            tiposPrestador: [op(61, '99', 'Prestador sintético')],
            instrumentos: [],
            naturezas: [],
            servicos: [op(71, 'q98/q01', 'Serviço sintético: classificação sintética')],
            servicosSigtap: [],
            grupos: [],
            prestadores: [op(81, '9999999', 'Prestador externo sintético')],
            setores: [],
            locais: [],
          });
        return json(r, cadastro);
      }
      const corpo = req.postDataJSON() as Record<string, unknown>;
      pedidos.push({ caminho: url.pathname, corpo });
      if (url.pathname.endsWith('/habilitacoes')) {
        cadastro.habilitacoes.push({
          id: 901,
          codigo: corpo['codigo'],
          descricao: 'Habilitação sintética',
          numeroPortaria: corpo['numeroPortaria'],
          dataPortaria: corpo['dataPortaria'],
          leitosHabilitados: corpo['leitosHabilitados'],
          observacao: null,
          vigenciaInicio: corpo['vigenciaInicio'],
          vigenciaFim: corpo['vigenciaFim'],
          vigente: true,
          versao: 1,
        });
        return json(r, { id: 901 }, 201);
      }
      if (url.pathname.endsWith('/encerrar')) {
        Object.assign(cadastro.habilitacoes[0]!, { vigenciaFim: corpo['vigenciaFim'], versao: 2 });
        return json(r, { id: 901 });
      }
      if (url.pathname.endsWith('/conciliar'))
        return json(r, {
          incluir: [{ codigo: '9873', vigenciaInicio: '2026-05-01', vigenciaFim: null }],
          encerrar: [],
          conflitos: [],
          mantidas: 0,
          aplicada: corpo['aplicar'] === true,
        });
      if (url.pathname.endsWith('/servicos')) {
        cadastro.servicos.push({
          id: 911,
          servicoClassificacao: 71,
          codigo: 'q98/q01',
          descricao: 'Serviço sintético: classificação sintética',
          caracteristica: corpo['caracteristica'],
          prestadorExterno: corpo['prestadorExterno'],
          prestadorNome: 'Prestador externo sintético',
          vigenciaInicio: corpo['vigenciaInicio'],
          vigenciaFim: corpo['vigenciaFim'],
          vigente: true,
          versao: 1,
        });
        return json(r, { id: 911 }, 201);
      }
      return json(r, { id: 0 });
    });

    // O cadastro SUS do estabelecimento é do faturista com os cadastros do SUS (o administrador não lê a produção SUS).
    await entrar(page, 'SINT.FATURISTA.AIH');
    await page.goto('/faturamento/sus/cadastros/estabelecimento');
    await expect(page.getByTestId('tela-estabelecimento-sus')).toBeVisible();
    await expect(page.getByTestId('estab-sus-hab-vazio')).toBeVisible();

    // Validação na hora: código inválido e data de portaria sem número travam o botão.
    await page.getByTestId('estab-sus-hab-codigo').fill('AB');
    await page.getByTestId('estab-sus-hab-data-portaria').fill('2026-02-10');
    await expect(page.getByTestId('estab-sus-hab-problemas')).toContainText('1 a 6 dígitos');
    await expect(page.getByTestId('estab-sus-hab-problemas')).toContainText('número da portaria');
    await expect(page.getByTestId('estab-sus-hab-incluir')).toBeDisabled();
    await page.getByTestId('estab-sus-hab-codigo').fill('9872');
    await page.getByTestId('estab-sus-hab-portaria').fill('Portaria sintética 1');
    await page.getByTestId('estab-sus-hab-leitos').fill('10');
    await page.getByTestId('estab-sus-hab-inicio').fill('2026-03');
    await expect(page.getByTestId('estab-sus-hab-problemas')).toHaveCount(0);
    await page.getByTestId('estab-sus-hab-incluir').click();
    await expect(page.getByTestId('estab-sus-aviso')).toHaveText('Gravado.');
    expect(pedidos[0]).toEqual({
      caminho: '/api/sus/estabelecimento/habilitacoes',
      corpo: {
        codigo: '9872',
        numeroPortaria: 'Portaria sintética 1',
        dataPortaria: '2026-02-10',
        vigenciaInicio: '2026-03-01',
        vigenciaFim: null,
        leitosHabilitados: 10,
      },
    });
    await expect(page.getByTestId('estab-sus-hab-901')).toContainText('2026-03');

    // Encerrar na própria linha: último dia da competência e versão lida.
    await page.getByTestId('estab-sus-hab-encerrar').click();
    await page.getByTestId('estab-sus-encerrar-mes').fill('2026-06');
    await page.getByTestId('estab-sus-encerrar-confirmar').click();
    await expect(page.getByTestId('estab-sus-hab-901')).toContainText('2026-06');
    expect(pedidos[1]).toEqual({
      caminho: '/api/sus/estabelecimento/habilitacoes/901/encerrar',
      corpo: { vigenciaFim: '2026-06-30', versao: 1 },
    });

    // Conciliação: a prévia vem antes de aplicar.
    await page.getByTestId('estab-sus-cnes-competencia').fill('2026-05');
    await page.getByTestId('estab-sus-cnes-codigos').fill('9873, x');
    await page.getByTestId('estab-sus-cnes-previa').click();
    await expect(page.getByTestId('estab-sus-cnes-resumo')).toContainText('9873');
    expect(pedidos[2]).toEqual({
      caminho: '/api/sus/estabelecimento/habilitacoes/conciliar',
      corpo: {
        competencia: '202605',
        habilitacoes: [{ codigo: '9873' }],
        motivoExcecao: '',
        aplicar: false,
      },
    });
    // A lista digitada é exceção à lista oficial: aplicar pede o motivo.
    await expect(page.getByTestId('estab-sus-cnes-aplicar')).toBeDisabled();
    await page.getByTestId('estab-sus-cnes-motivo').fill('Portaria nova fora da base do mês');
    await page.getByTestId('estab-sus-cnes-aplicar').click();
    await expect(page.getByTestId('estab-sus-cnes-resumo')).toHaveText('Conciliação aplicada.');
    expect(pedidos[3]?.corpo['aplicar']).toBe(true);
    expect(pedidos[3]?.corpo['motivoExcecao']).toBe('Portaria nova fora da base do mês');
    await expect(page.getByTestId('estab-sus-cnes-onde-baixar')).toContainText('ftp.datasus.gov.br/cnes');

    // Serviço terceirizado pede o prestador.
    await page.getByTestId('estab-sus-aba-servicos').click();
    await escolher(page.getByTestId('estab-sus-serv-servico'), '71');
    await escolher(page.getByTestId('estab-sus-serv-caracteristica'), 'terceirizado');
    await expect(page.getByTestId('estab-sus-serv-problemas')).toContainText('pede o prestador');
    await expect(page.getByTestId('estab-sus-serv-incluir')).toBeDisabled();
    await escolher(page.getByTestId('estab-sus-serv-prestador'), '81');
    await page.getByTestId('estab-sus-serv-inicio').fill('2026-01');
    await page.getByTestId('estab-sus-serv-incluir').click();
    await expect(page.getByTestId('estab-sus-serv-911')).toContainText('Prestador externo sintético');
    expect(pedidos[4]).toEqual({
      caminho: '/api/sus/estabelecimento/servicos',
      corpo: {
        servicoClassificacao: 71,
        caracteristica: 'terceirizado',
        prestadorExterno: 81,
        vigenciaInicio: '2026-01-01',
        vigenciaFim: null,
      },
    });
    await semViolacaoAxe(page, 'habilitações e serviços SUS do estabelecimento');
  });
});
