// E2E @F39-4 (04-HOT L126, ficha F3.9): guarda do prontuário pelo volume, pelo caminho da tela. O arquivista sai da
// movimentação pelo link da guarda, busca o paciente pelo prontuário, vê onde o volume está e movimenta pelo tipo da
// operação: a saída sem setor e sem previsão de retorno mostra o que falta na hora e não deixa enviar; preenchida, o
// pedido sai com o corpo certo e a visão do paciente mostra o volume emprestado. As rotas /api/same/guarda exigem o
// banco próprio e o E2E roda com a fonte sintética (sem núcleo): as respostas da API são simuladas pelo Playwright com
// massa SINTÉTICA. O efeito no banco está no contrato de efeito apps/api/src/modulos/adt/same-guarda-propria.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PACIENTE = 7401;
const VOLUME = 9101;
const PREVISAO = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);

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

const op = (codigo: string, descricao: string, tipo: string, sentido: string, extra = {}) => ({
  codigo,
  descricao,
  tipo,
  sentido,
  exigeDestino: false,
  exigePrevisaoRetorno: false,
  encerraGuarda: false,
  ...extra,
});

function volume(emprestado: boolean) {
  const registro = {
    id: 1,
    em: '2026-11-20T10:00:00.000Z',
    operacao: { codigo: 'registro', descricao: 'Registro no arquivo', tipo: 'registro', sentido: 'entrada' },
    setorOrigem: null,
    setorDestino: null,
    localDestino: 'Sala 1 > Armário 3',
    responsavel: null,
    previsaoRetorno: null,
    por: 'Arquivista sintético',
    excluido: false,
  };
  const saida = {
    ...registro,
    id: 2,
    em: '2026-11-24T10:00:00.000Z',
    operacao: { codigo: 'saida', descricao: 'Saída para o setor', tipo: 'saida', sentido: 'saida' },
    setorDestino: 'UTI adulto sintética',
    localDestino: null,
    responsavel: 'ENFERMAGEM UTI',
    previsaoRetorno: '2026-11-27T23:59:00.000Z',
  };
  return {
    id: VOLUME,
    numero: 1,
    matricula: 'V000009101',
    tipoDocumento: { id: 3, descricao: 'Prontuário em papel' },
    atendimento: null,
    situacao: emprestado ? 'emprestado' : 'arquivado',
    noLocal: !emprestado,
    local: { id: 21, caminho: 'Sala 1 > Armário 3' },
    posicao: { linha: 'B', coluna: '4' },
    ondeEsta: emprestado ? 'UTI adulto sintética' : 'Sala 1 > Armário 3',
    previsaoRetorno: emprestado ? saida.previsaoRetorno : null,
    retornoAtrasado: false,
    extraviadoEm: null,
    guardaDesde: '2026-11-20T10:00:00.000Z',
    prazoGuardaAnos: 20,
    versao: emprestado ? 2 : 1,
    movimentos: emprestado ? [saida, registro] : [registro],
  };
}

test.describe('Guarda do prontuário pelo volume @F39-4 @fase3', () => {
  test.setTimeout(180_000);
  test('link da movimentação, busca pelo prontuário, saída validada na hora e enviada com o corpo certo; axe', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    let emprestado = false;
    await page.route('**/api/same/guarda/**', (rota) => {
      const req = rota.request();
      const caminho = new URL(req.url()).pathname.replace('/api/same/guarda/', '');
      if (req.method() === 'GET') {
        if (caminho === 'operacoes')
          return json(rota, {
            itens: [
              op('registro', 'Registro no arquivo', 'registro', 'entrada', { exigeDestino: true }),
              op('saida', 'Saída para o setor', 'saida', 'saida', {
                exigeDestino: true,
                exigePrevisaoRetorno: true,
              }),
              op('devolucao', 'Devolução ao arquivo', 'devolucao', 'entrada'),
              op('transferencia', 'Transferência de local', 'transferencia', 'neutro'),
            ],
          });
        if (caminho === 'apoio')
          return json(rota, {
            locais: [
              {
                id: 20,
                nivel: 'sala',
                codigo: 'S1',
                caminho: 'Sala 1',
                pai: null,
                capacidade: null,
                volumes: 0,
              },
              {
                id: 21,
                nivel: 'armario',
                codigo: 'A3',
                caminho: 'Sala 1 > Armário 3',
                pai: 20,
                capacidade: 2,
                volumes: 1,
              },
            ],
            setores: [{ id: 11, nome: 'UTI adulto sintética' }],
            tiposDocumento: [{ id: 3, descricao: 'Prontuário em papel' }],
          });
        if (caminho === 'deliberacoes') return json(rota, { itens: [] });
        if (caminho.startsWith('busca')) return json(rota, { paciente: PACIENTE, volume: null });
        if (caminho === `pacientes/${PACIENTE}/volumes`) return json(rota, { itens: [volume(emprestado)] });
        return rota.fallback();
      }
      pedidos.push({ caminho, corpo: (req.postDataJSON() ?? {}) as Record<string, unknown> });
      if (caminho === `volumes/${VOLUME}/movimentos`) {
        emprestado = true;
        return json(rota, { id: 2 }, 201);
      }
      return json(rota, { codigo: 'nao-simulado' }, 500);
    });

    await entrar(page, 'SINT.ARQUIVO');
    await page.goto('/same/movimentos');
    await page.getByTestId('same-ir-guarda').click();
    await expect(page).toHaveURL(/\/same\/guarda$/);
    await expect(page.getByTestId('same-guarda')).toBeVisible();

    await page.getByTestId('guarda-prontuario').locator('input').fill('123456');
    await page.getByTestId('guarda-buscar').click();
    const cartao = page.getByTestId('guarda-volume-1');
    await expect(cartao).toBeVisible();
    await expect(cartao.getByTestId('guarda-situacao')).toContainText('arquivado');
    await expect(cartao.getByTestId('guarda-onde')).toHaveText('Sala 1 > Armário 3');
    await semViolacaoAxe(page, '/same/guarda (visão do paciente)');

    // Saída: sem setor e sem previsão, a tela mostra o que falta e não deixa enviar.
    await escolher(cartao.getByTestId('guarda-operacao'), { rotulo: 'Saída para o setor' });
    await expect(cartao.getByTestId('guarda-setor-destino')).toBeVisible();
    await expect(page.getByTestId('guarda-falta')).toBeVisible();
    await expect(cartao.getByTestId('guarda-movimentar')).toBeDisabled();
    expect(pedidos).toHaveLength(0);

    await escolher(cartao.getByTestId('guarda-setor-destino'), { rotulo: 'UTI adulto sintética' });
    await cartao.getByTestId('guarda-previsao').fill(PREVISAO);
    await cartao.getByTestId('guarda-responsavel').locator('input').fill('ENFERMAGEM UTI');
    await expect(page.getByTestId('guarda-falta')).toHaveCount(0);
    await expect(cartao.getByTestId('guarda-movimentar')).toBeEnabled();
    await cartao.getByTestId('guarda-movimentar').click();

    await expect(page.getByTestId('guarda-aviso')).toBeVisible();
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]).toMatchObject({
      caminho: `volumes/${VOLUME}/movimentos`,
      corpo: {
        operacao: 'saida',
        setorDestino: 11,
        previsaoRetorno: PREVISAO,
        responsavel: 'ENFERMAGEM UTI',
        versao: 1,
      },
    });
    await expect(cartao.getByTestId('guarda-situacao')).toContainText('emprestado');
    await expect(cartao.getByTestId('guarda-onde')).toHaveText('UTI adulto sintética');
    await semViolacaoAxe(page, '/same/guarda (volume emprestado)');
  });
});
