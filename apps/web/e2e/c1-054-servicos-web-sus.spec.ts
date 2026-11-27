// E2E @C1-054 (08-INTG linha 131): os serviços web do SUS. A supervisão do faturamento SUS abre Faturamento >
// Faturamento SUS > Serviços web do SUS pelo menu, vê o selo "Simulador" e o aviso do que pedir ao gestor do SUS para o
// envio real (decisão 53), busca o paciente pelo prontuário, escolhe a linha de cuidado do exame (o Registrar só liga
// com a linha), registra o rastreamento de câncer, envia (o simulador devolve o protocolo) e cancela com motivo um
// cadastro de prestador registrado pela busca do profissional. axe sem violação séria.
// Sessão real sobre a fonte sintética de dev (login, menu e permissão de verdade); o padrão do E2E roda sem banco do
// cliente, então as rotas /api/sus/servicos-web (porta própria, 503 sem banco) são respondidas no spec seguindo o
// contrato do controlador (servico-web.controller.ts) e do simulador (servico-web-enviador.ts). Nenhum dado de pessoa.
import { expect, type Page, type Route, test } from '@playwright/test';
import { itemDoMenu, semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher, esperarSemSelectNativo } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

interface EnvioFalso {
  id: number;
  servico: 'rastreamento_cancer' | 'cadastro_prestador';
  situacao: string;
  tentativas: number;
  protocolo: string | null;
  versao: number;
  pacienteNome: string | null;
  prontuario: string | null;
  exameNome: string | null;
  profissionalNome: string | null;
  retornos: {
    sequencia: number;
    recebidoEm: string;
    tipo: string;
    codigo: null;
    campo: null;
    mensagem: string;
  }[];
}

/** As rotas do serviço web do SUS em memória, pelo contrato do controlador (fonte sintética, sem pessoa real). */
async function servicoWebEmMemoria(page: Page): Promise<{ corpos: Record<string, unknown>[] }> {
  const envios: EnvioFalso[] = [];
  const corpos: Record<string, unknown>[] = [];
  const json = (route: Route, corpo: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });
  const lido = (e: EnvioFalso) => ({
    ...e,
    cnsInformado: null,
    cnsConfirmado: null,
    paciente: e.servico === 'rastreamento_cancer' ? 1 : null,
    exameItem: e.servico === 'rastreamento_cancer' ? 501 : null,
    profissional: e.servico === 'cadastro_prestador' ? 7 : null,
    criadoEm: '2026-11-27T10:00:00Z',
    enviadoEm: null,
    respondidoEm: null,
  });
  await page.route('**/api/sus/servicos-web**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const caminho = url.pathname.replace(/^\/api\/sus\/servicos-web/, '');
    if (req.method() === 'GET' && caminho === '/rastreamento')
      return json(route, {
        paciente: { id: 1, nome: 'PACIENTE SINTETICO RASTREAMENTO', temCns: true },
        exames: [
          {
            exameItem: 501,
            exame: 'Citopatológico do colo do útero',
            requisicao: 'REQ-SINT-1',
            solicitadoEm: '2026-11-20',
            situacao: 'liberado',
            envio: envios[0]?.id ?? null,
            envioSituacao: envios[0]?.situacao ?? null,
          },
        ],
      });
    if (req.method() === 'GET' && caminho === '/prestadores')
      return json(route, {
        itens: [{ id: 7, nome: 'PROFISSIONAL SINTETICO', temCns: true, cbo: '225125', ativo: true }],
      });
    if (req.method() === 'GET' && caminho === '') {
      const servico = url.searchParams.get('servico');
      return json(route, {
        itens: envios.filter((e) => !servico || e.servico === servico).map(lido),
        modo: 'simulador',
      });
    }
    const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
    corpos.push(corpo);
    if (req.method() === 'POST' && caminho === '') {
      const rastreio = corpo['servico'] === 'rastreamento_cancer';
      const e: EnvioFalso = {
        id: envios.length + 1,
        servico: rastreio ? 'rastreamento_cancer' : 'cadastro_prestador',
        situacao: 'pendente',
        tentativas: 0,
        protocolo: null,
        versao: 1,
        pacienteNome: rastreio ? 'PACIENTE SINTETICO RASTREAMENTO' : null,
        prontuario: rastreio ? '900001' : null,
        exameNome: rastreio ? 'Citopatológico do colo do útero' : null,
        profissionalNome: rastreio ? null : 'PROFISSIONAL SINTETICO',
        retornos: [],
      };
      envios.push(e);
      return json(route, { envio: e.id, servico: e.servico, situacao: 'pendente', repetida: false });
    }
    const m = /^\/(\d+)\/(envio|cancelamento)$/.exec(caminho);
    const e = m ? envios.find((x) => x.id === Number(m[1])) : undefined;
    if (!m || !e) return json(route, { title: 'Envio não encontrado', status: 404 }, 404);
    e.versao += 1;
    if (m[2] === 'envio') {
      e.situacao = 'aceito';
      e.tentativas += 1;
      e.protocolo = `SIM-RC-${String(e.id).padStart(12, '0')}`;
      e.retornos.push({
        sequencia: 1,
        recebidoEm: '2026-11-27T10:01:00Z',
        tipo: 'recibo',
        codigo: null,
        campo: null,
        mensagem: 'Recebido pelo simulador',
      });
      return json(route, {
        envio: e.id,
        situacao: e.situacao,
        protocolo: e.protocolo,
        retornos: 1,
        tentativas: e.tentativas,
        repetida: false,
        modo: 'simulador',
      });
    }
    const anterior = e.situacao;
    e.situacao = 'cancelado';
    return json(route, { envio: e.id, situacao: 'cancelado', anterior, repetida: false });
  });
  return { corpos };
}

test.describe('@C1-054 Faturamento SUS: serviços web do SUS (rastreamento de câncer e cadastro de prestador)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('a supervisão do SUS registra e envia o rastreamento no simulador e cancela um cadastro de prestador', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const { corpos } = await servicoWebEmMemoria(page);
    await entrar(page, 'SINT.SUS.CONFIGURACAO');
    await (await itemDoMenu(page, 'Serviços web do SUS')).click();
    await expect(page).toHaveURL(/\/faturamento\/sus\/servicos-web/);
    const tela = page.getByTestId('tela-servicos-web-sus');
    await expect(tela).toBeVisible();
    await esperarSemSelectNativo(tela);

    // Simulador claro na tela e o aviso do que pedir ao gestor do SUS (decisão 53).
    await expect(page.getByTestId('servicos-web-sus-selo')).toHaveText('Simulador');
    await expect(page.getByTestId('servicos-web-sus-fornecedor')).toContainText(
      'passe a definição à equipe de desenvolvimento',
    );
    await expect(page.getByTestId('servicos-web-sus-fornecedor').getByRole('listitem').first()).toBeVisible();
    await expect(page.getByTestId('servicos-web-sus-sem-envios')).toBeVisible();

    // Rastreamento: prontuário -> exames; o Registrar só liga com a linha de cuidado.
    await page.getByTestId('servicos-web-sus-prontuario').fill('900001');
    await page.getByTestId('servicos-web-sus-buscar-exames').click();
    await expect(page.getByTestId('servicos-web-sus-paciente')).toContainText('PACIENTE SINTETICO');
    const registrar = page.getByTestId('servicos-web-sus-registrar-exame-501');
    await expect(registrar).toBeDisabled();
    await escolher(page.getByTestId('servicos-web-sus-linha-501'), { rotulo: 'Colo do útero' });
    await expect(registrar).toBeEnabled();
    await registrar.click();
    await expect(page.getByTestId('servicos-web-sus-aviso')).toHaveText('Envio registrado.');
    expect(corpos[0]).toEqual({ servico: 'rastreamento_cancer', exameItem: 501, linha: 'colo_utero' });
    await expect(page.getByTestId('servicos-web-sus-situacao-1')).toHaveText('Pendente');

    // Enviar: o simulador aceita e devolve o protocolo.
    await page.getByTestId('servicos-web-sus-enviar-1').click();
    await expect(page.getByTestId('servicos-web-sus-situacao-1')).toHaveText('Aceito');
    await expect(page.getByTestId('servicos-web-sus-protocolo-1')).toContainText('SIM-RC-');
    await expect(page.getByTestId('servicos-web-sus-enviar-1')).toHaveCount(0);

    // Cadastro de prestador: busca pelo nome, registra e cancela com motivo (nada apagado: a linha fica).
    await page.getByTestId('servicos-web-sus-termo').fill('PROF');
    await page.getByTestId('servicos-web-sus-buscar-prestador').click();
    await page.getByTestId('servicos-web-sus-registrar-prestador-7').click();
    await expect(page.getByTestId('servicos-web-sus-situacao-2')).toHaveText('Pendente');
    expect(corpos[2]).toEqual({ servico: 'cadastro_prestador', profissional: 7 });
    await page.getByTestId('servicos-web-sus-cancelar-2').click();
    await expect(page.getByTestId('servicos-web-sus-confirmar-cancelar')).toBeDisabled();
    await page.getByTestId('servicos-web-sus-motivo').fill('Registrado por engano');
    await page.getByTestId('servicos-web-sus-confirmar-cancelar').click();
    await expect(page.getByTestId('servicos-web-sus-situacao-2')).toHaveText('Cancelado');
    expect(corpos[3]).toEqual({ versao: 1, motivo: 'Registrado por engano' });

    await semViolacaoAxe(page, 'serviços web do SUS');
    expect(externas).toEqual([]);
  });
});
