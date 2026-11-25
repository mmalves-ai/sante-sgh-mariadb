// F8 (02-CAD linha 21): profissional provisório, pelo caminho da tela.
// O cadastro exige o banco próprio, e o E2E roda com a fonte sintética (sem núcleo). Por isso as respostas da API
// destas rotas são simuladas pelo Playwright com massa SINTÉTICA; o que se prova é a tela: o link da lista de
// profissionais leva à rota, o cadastro mínimo valida na hora (conselho, número, UF e motivo) antes de gravar, o vencido
// aparece com o alerta (sem trava), o registro é achado pelo número (nunca pelo id interno) e ligado, mostrando número,
// paciente e em nome de quem está; o registro já fechado aparece marcado e a regularização para o candidato da mesma
// inscrição só sai depois da confirmação explícita, que vai ao servidor. O efeito no banco (número normalizado, prazo, registro ligado, transferência do atendimento, cancelamento com
// motivo, prorrogação) está no contrato de efeito (apps/api/src/modulos/cadastro/profissional-provisorio.int.spec.ts).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const HOJE = '2041-03-10';

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

type Item = Record<string, unknown> & { id: number; versao: number };

test.describe('F8 profissional provisório @C1-047', () => {
  test('cadastra com validação na hora, acha e liga o atendimento e regulariza com confirmação', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    const itens: Item[] = [
      {
        id: 41,
        versao: 1,
        nome: 'PROFISSIONAL VENCIDO SINTETICO',
        cpfInformado: false,
        conselhoId: 1,
        conselhoSigla: 'CRM',
        numeroConselho: '770102',
        ufConselhoId: 31,
        ufSigla: 'MG',
        motivo: 'Plantão coberto antes do cadastro',
        dataInicio: '2041-02-20',
        prazo: '2041-03-05',
        situacao: 'provisorio',
        estadoPrazo: 'vencido',
        diasParaPrazo: -5,
        profissionalId: null,
        usos: 0,
        usosPendentes: 0,
      },
    ];
    const usos: Record<string, unknown>[] = [];
    const buscas: string[] = [];
    const ATENDIMENTO = {
      id: 5001,
      numero: 'AT-5001',
      prontuario: 77,
      paciente: 'PACIENTE SINTETICO',
      quando: '2041-03-09',
      profissional: 'SUBSTITUTO SINTETICO',
    };
    await page.route('**/api/cadastros/profissionais-provisorios**', (r) => {
      const req = r.request();
      const url = new URL(req.url());
      if (req.method() === 'GET') {
        if (url.pathname.endsWith('/registros')) {
          const busca = url.searchParams.get('busca') ?? '';
          buscas.push(busca);
          return json(r, busca === '' || 'AT-5001'.includes(busca) ? [ATENDIMENTO] : []);
        }
        if (/\/\d+$/.test(url.pathname))
          return json(r, {
            usos,
            candidatos: [{ id: 901, nome: 'PROFISSIONAL DEFINITIVO SINTETICO', por: 'inscricao' }],
          });
        return json(r, {
          hoje: HOJE,
          prazoSugerido: '2041-03-25',
          itens,
          resumo: { abertos: itens.length, vencidos: 1, venceLogo: 0 },
          conselhos: [{ id: 1, sigla: 'CRM', porUf: true }],
          ufs: [{ id: 31, sigla: 'MG' }],
        });
      }
      const corpo = req.postDataJSON() as Record<string, unknown>;
      pedidos.push({ caminho: url.pathname, corpo });
      if (url.pathname.endsWith('/usos')) {
        // O atendimento já teve alta: a regularização pede confirmação.
        usos.push({
          id: 1,
          sequencia: 1,
          tipo: corpo['tipo'],
          registroId: corpo['registroId'],
          regularizado: false,
          numero: ATENDIMENTO.numero,
          prontuario: ATENDIMENTO.prontuario,
          paciente: ATENDIMENTO.paciente,
          quando: ATENDIMENTO.quando,
          situacaoRegistro: 'encerrado',
          profissionalAtual: ATENDIMENTO.profissional,
          substituto: ATENDIMENTO.profissional,
          anterior: null,
          transferenciaConfirmada: false,
          pendencias: ['registro-fechado'],
        });
        itens[0]!['usos'] = 1;
        itens[0]!['usosPendentes'] = 1;
        return json(r, { id: 1 }, 201);
      }
      if (url.pathname.endsWith('/regularizar')) {
        Object.assign(usos[0]!, {
          regularizado: true,
          anterior: ATENDIMENTO.profissional,
          profissionalAtual: 'PROFISSIONAL DEFINITIVO SINTETICO',
          transferenciaConfirmada: true,
          pendencias: [],
        });
        Object.assign(itens[0]!, {
          situacao: 'regularizado',
          estadoPrazo: 'encerrado',
          usosPendentes: 0,
          versao: 2,
        });
        return json(r, { id: 41, usos: 1, transferidos: 1 });
      }
      itens.push({
        ...itens[0]!,
        ...corpo,
        id: 42,
        estadoPrazo: 'em_dia',
        diasParaPrazo: 15,
        situacao: 'provisorio',
      });
      return json(r, { id: 42 }, 201);
    });

    await entrar(page, 'SINT.ADMIN');
    await page.goto('/cadastros/profissionais');
    await page.getByTestId('link-provisorios').click();
    await expect(page).toHaveURL(/\/cadastros\/profissionais\/provisorios$/);
    await expect(page.getByTestId('tela-provisorios')).toBeVisible();
    // O vencido é alerta, sem trava.
    await expect(page.getByTestId('prov-estado-41')).toHaveText('Vencido há 5 dia(s)');
    await expect(page.getByTestId('prov-resumo')).toContainText('1 vencido(s)');

    // Validação na hora: sem conselho, número, UF e motivo nada vai ao servidor.
    await page.getByTestId('prov-nome').fill('Fulano');
    await page.getByTestId('prov-gravar').click();
    await expect(page.getByTestId('prov-problemas')).toContainText('Escreva o nome e o sobrenome.');
    await expect(page.getByTestId('prov-problemas')).toContainText('Escolha a UF da inscrição no conselho.');
    expect(pedidos).toHaveLength(0);
    await page.getByTestId('prov-nome').fill('Fulano Sintetico');
    await escolher(page.getByTestId('prov-conselho'), { rotulo: 'CRM' });
    await page.getByTestId('prov-numero').fill('660102');
    await escolher(page.getByTestId('prov-uf'), { rotulo: 'MG' });
    await page.getByTestId('prov-motivo').fill('Cobertura de plantão sem cadastro');
    await page.getByTestId('prov-gravar').click();
    await expect(page.getByTestId('prov-aviso')).toHaveText('Provisório gravado.');
    expect(pedidos[0]).toMatchObject({
      caminho: '/api/cadastros/profissionais-provisorios',
      corpo: {
        nome: 'Fulano Sintetico',
        conselhoId: 1,
        numeroConselho: '660102',
        ufConselhoId: 31,
        dataInicio: HOJE,
      },
    });

    // Acha o atendimento pelo número (busca na hora) e liga ao vencido.
    await page.getByTestId('prov-abrir-41').click();
    await escolher(page.getByTestId('prov-uso-tipo'), 'atendimento');
    await page.getByTestId('prov-uso-busca').fill('XX-0000');
    await expect(page.getByTestId('prov-uso-vazio')).toBeVisible();
    await page.getByTestId('prov-uso-busca').fill('AT-5001');
    await expect.poll(() => buscas.at(-1)).toBe('AT-5001');
    await escolher(page.getByTestId('prov-uso-registro'), '5001');
    await page.getByTestId('prov-uso-ligar').click();
    expect(pedidos.at(-1)).toMatchObject({
      caminho: '/api/cadastros/profissionais-provisorios/41/usos',
      corpo: { tipo: 'atendimento', registroId: 5001 },
    });
    await expect(page.getByTestId('prov-uso-1')).toContainText('Atendimento AT-5001 · PACIENTE SINTETICO');
    await expect(page.getByTestId('prov-uso-1')).toContainText('em nome de SUBSTITUTO SINTETICO');
    await expect(page.getByTestId('prov-uso-1')).toContainText('registro já fechado');

    // O registro fechado só passa com a confirmação explícita.
    await expect(page.getByTestId('prov-a-confirmar')).toContainText('AT-5001');
    await expect(page.getByTestId('prov-regularizar')).toBeDisabled();
    await page.getByTestId('prov-confirmar').check();
    await page.getByTestId('prov-regularizar').click();
    await expect(page.getByTestId('prov-aviso')).toContainText('1 registro(s) transferido(s)');
    expect(pedidos.at(-1)).toMatchObject({
      caminho: '/api/cadastros/profissionais-provisorios/41/regularizar',
      corpo: { versao: 1, profissional: 901, confirmar: true },
    });
    await expect(page.getByTestId('prov-uso-1')).toContainText('antes em nome de SUBSTITUTO SINTETICO');
    await semViolacaoAxe(page, 'profissionais provisórios');
  });
});
