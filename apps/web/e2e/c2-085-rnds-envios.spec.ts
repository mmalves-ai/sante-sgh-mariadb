// C2-085 (08-INTG linha 130): envios à RNDS por paciente, pelo caminho da tela. As rotas /api/integracoes/rnds exigem
// o banco próprio, e o E2E roda com a fonte sintética (sem núcleo); por isso as respostas destas rotas (e a busca do
// paciente) são simuladas pelo Playwright com massa SINTÉTICA. O que se prova é a tela: a identificação aparece só
// pelo tipo (nenhum número); o bloqueio aparece antes do pedido e o documento bloqueado não tem ação; o envio original
// vai com tipo, registro e operação (sem motivo) e com a chave de idempotência; a substituição com motivo curto trava
// o botão e mostra o erro na hora; as versões de cada envio aparecem com o retorno; o 503 (sem banco próprio) é dito.
// O efeito no banco (envio, versões, evento na fila na mesma transação) está nos contratos de efeito
// apps/api/src/modulos/integracao/rnds-envio-propria.int.spec.ts e do worker rnds-registro.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';

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

const PACIENTE = 7001;
const pacienteSintetico = {
  id: PACIENTE,
  prontuario: 99001,
  nome: 'PACIENTE SINTETICO RNDS',
  nomeSocial: null,
  nascimento: '1980-01-01',
  sexo: 'F',
  maeMascarada: null,
  cpfMascarado: null,
  telefoneMascarado: null,
  situacao: 'ativo',
  obito: false,
  homonimo: false,
};

const envio = (id: number, registro: number, tipo: string, extra: Record<string, unknown> = {}) => ({
  id,
  tipo,
  paciente: PACIENTE,
  registro,
  identificadorLocal: `SINT-${tipo}-${registro}`,
  identificadorNacional: null,
  versaoAtual: 1,
  situacao: 'pendente',
  situacaoVersao: 'pendente',
  tipoVersao: 'original',
  tentativas: 0,
  enviadoEm: null,
  aceitoEm: null,
  motivo: null,
  ...extra,
});

async function simularBusca(page: Page): Promise<void> {
  await page.route(
    (u) => u.pathname === '/api/cadastros/pacientes',
    (r) =>
      json(r, { tipo: 'nome', itens: [pacienteSintetico], sugestoes: [], truncado: false, duracaoMs: 1 }),
  );
}

async function escolherPaciente(page: Page): Promise<void> {
  await page.goto('/admin/integracoes/rnds');
  await expect(page.getByTestId('tela-rnds-envios')).toBeVisible();
  await page.getByTestId('rnds-termo').fill('SINTETICO');
  await page.getByTestId('rnds-buscar').click();
  await page.getByTestId(`rnds-paciente-${PACIENTE}`).click();
}

test.describe('C2-085 envios à RNDS por paciente @C2-085', () => {
  test('identificação pelo tipo, bloqueio, envio original, substituição com motivo e versões', async ({
    page,
  }) => {
    const pedidos: { corpo: Record<string, unknown>; chave: string | null }[] = [];
    // Sumário 31 ainda sem envio; resultado 52 já aceito (pode substituir ou cancelar); resultado 53 bloqueado.
    let sumario: Record<string, unknown> | null = null;
    let resultado: Record<string, unknown> = envio(810, 52, 'resultado_exame', {
      situacao: 'aceito',
      situacaoVersao: 'aceito',
      identificadorNacional: 'SIM-RNDS-810',
      tentativas: 1,
      enviadoEm: '2026-11-20T10:00:00.000Z',
      aceitoEm: '2026-11-20T10:00:05.000Z',
    });
    const visao = () => ({
      paciente: PACIENTE,
      identificacao: 'cns',
      documentos: [
        {
          tipo: 'sumario_alta',
          registro: 31,
          descricao: 'Sumário de alta',
          data: '2026-11-18',
          situacaoRegistro: 'assinado',
          envio: sumario,
          bloqueio: null,
          acoes: sumario ? [] : ['original'],
        },
        {
          tipo: 'resultado_exame',
          registro: 52,
          descricao: 'Hemograma sintético',
          data: '2026-11-19',
          situacaoRegistro: 'liberado',
          envio: resultado,
          bloqueio: null,
          acoes: resultado['situacao'] === 'aceito' ? ['substituicao', 'cancelamento'] : [],
        },
        {
          tipo: 'resultado_exame',
          registro: 53,
          descricao: 'Glicemia sintética',
          data: '2026-11-19',
          situacaoRegistro: 'em_analise',
          envio: null,
          bloqueio: 'O resultado ainda não foi liberado.',
          acoes: [],
        },
      ],
    });
    await simularBusca(page);
    await page.route('**/api/integracoes/rnds/**', (r) => {
      const req = r.request();
      const c = new URL(req.url()).pathname.replace('/api/integracoes/rnds', '');
      if (req.method() === 'GET') {
        if (c === `/pacientes/${PACIENTE}`) return json(r, visao());
        if (c === '/envios') return json(r, { itens: [sumario, resultado].filter(Boolean) });
        if (c === '/envios/810/versoes')
          return json(r, {
            itens: [
              {
                numero: 1,
                tipo: 'original',
                situacao: 'aceito',
                ocorridoEm: '2026-11-20T10:00:00.000Z',
                respondidoEm: '2026-11-20T10:00:05.000Z',
                codigoRetorno: '201',
                mensagem: 'Recebido pelo simulador',
                identificadorNacional: 'SIM-RNDS-810',
                motivo: null,
              },
              ...(resultado['versaoAtual'] === 2
                ? [
                    {
                      numero: 2,
                      tipo: 'substituicao',
                      situacao: 'pendente',
                      ocorridoEm: null,
                      respondidoEm: null,
                      codigoRetorno: null,
                      mensagem: null,
                      identificadorNacional: null,
                      motivo: 'Valor de referência corrigido no laudo',
                    },
                  ]
                : []),
            ],
          });
        return json(r, { itens: [] });
      }
      const corpo = req.postDataJSON() as Record<string, unknown>;
      pedidos.push({ corpo, chave: req.headers()['idempotency-key'] ?? null });
      if (corpo['tipo'] === 'sumario_alta') {
        sumario = envio(809, 31, 'sumario_alta');
        return json(r, { id: 809, versao: 1, tipoVersao: 'original', mensagem: 4001 }, 201);
      }
      resultado = {
        ...resultado,
        versaoAtual: 2,
        situacao: 'pendente',
        situacaoVersao: 'pendente',
        tipoVersao: 'substituicao',
        motivo: corpo['motivo'],
      };
      return json(r, { id: 810, versao: 2, tipoVersao: 'substituicao', mensagem: 4002 }, 201);
    });

    await entrar(page, 'SINT.ADMIN');
    await escolherPaciente(page);

    // Só o tipo da identificação: nenhum número na tela.
    await expect(page.getByTestId('rnds-identificacao')).toContainText('Cartão Nacional de Saúde');
    await expect(page.getByTestId('tela-rnds-envios')).not.toContainText(/\d{15}/);

    // O bloqueio é dito antes do pedido e o documento bloqueado não tem ação.
    await expect(page.getByTestId('rnds-bloqueio-resultado_exame-53')).toContainText('não foi liberado');
    await expect(page.getByTestId('rnds-doc-resultado_exame-53').getByRole('button')).toHaveCount(0);

    // Envio original: sem motivo, com a chave de idempotência.
    await expect(page.getByTestId('rnds-envio-sumario_alta-31')).toContainText('Ainda não enviado');
    await page.getByTestId('rnds-acao-original-sumario_alta-31').click();
    await expect(page.getByTestId('rnds-aviso')).toContainText('versão 1');
    expect(pedidos[0]?.corpo).toEqual({
      tipo: 'sumario_alta',
      registro: 31,
      operacao: 'original',
      motivo: null,
    });
    expect(pedidos[0]?.chave).toBeTruthy();
    await expect(page.getByTestId('rnds-envio-sumario_alta-31')).toContainText('Pendente');

    // Substituição: o motivo curto trava o botão e mostra o erro na hora.
    await page.getByTestId('rnds-acao-substituicao-resultado_exame-52').click();
    await page.getByTestId('rnds-motivo').fill('curto');
    await expect(page.getByTestId('rnds-erro-motivo')).toBeVisible();
    await expect(page.getByTestId('rnds-confirmar')).toBeDisabled();
    await page.getByTestId('rnds-motivo').fill('Valor de referência corrigido no laudo');
    await page.getByTestId('rnds-confirmar').click();
    await expect(page.getByTestId('rnds-aviso')).toContainText('substituição');
    expect(pedidos[1]?.corpo).toEqual({
      tipo: 'resultado_exame',
      registro: 52,
      operacao: 'substituicao',
      motivo: 'Valor de referência corrigido no laudo',
    });
    expect(pedidos[1]?.chave).toBeTruthy();
    expect(pedidos[1]?.chave).not.toBe(pedidos[0]?.chave);

    // As versões do envio, com o retorno da rede e o motivo da substituição.
    await page.getByTestId('rnds-versoes-resultado_exame-52').click();
    await expect(page.getByTestId('rnds-versao-1')).toContainText('Recebido pelo simulador');
    await expect(page.getByTestId('rnds-versao-2')).toContainText('Valor de referência corrigido');
    await semViolacaoAxe(page, 'rnds-envios');
  });

  test('sem banco próprio, a tela diz que o recurso está indisponível', async ({ page }) => {
    await simularBusca(page);
    await page.route('**/api/integracoes/rnds/**', (r) =>
      json(
        r,
        {
          type: 'about:blank',
          title: 'Recurso sem banco próprio neste ambiente',
          status: 503,
          codigo: 'indisponivel',
        },
        503,
      ),
    );
    await entrar(page, 'SINT.ADMIN');
    await escolherPaciente(page);
    await expect(page.getByTestId('tela-rnds-envios')).toContainText('indisponível');
    await expect(page.getByTestId('rnds-documentos')).toHaveCount(0);
  });
});
