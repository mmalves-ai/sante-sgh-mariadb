// F3.1 (02-CAD linha 4): incapacidade do paciente e comprovantes da representação, pelo caminho da tela (bloco da tela
// de contatos e responsáveis). A representação exige o banco próprio, e o E2E roda com a fonte sintética (sem núcleo).
// Por isso as respostas da API destas rotas são simuladas pelo Playwright com massa SINTÉTICA; o que se prova é a tela:
// a validação na hora (o pedido inválido não sai), o corpo de cada pedido, a lista que volta, o aviso da abertura do
// atendimento, o comprovante enviado ao escolher o arquivo e a acessibilidade. O efeito no banco (uma só condição
// vigente, levantamento sem apagar, arquivo com o paciente como dono, consentimento do menor e do incapaz, aviso na
// abertura) está no contrato de efeito (apps/api/src/modulos/cadastro/representacao-paciente.int.spec.ts).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PACIENTE = 7302;

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

interface Pedido {
  readonly caminho: string;
  readonly corpo: Record<string, unknown>;
}

async function simular(page: Page, pedidos: Pedido[]): Promise<void> {
  const tutor = {
    id: 61,
    nome: 'TUTOR SINTETICO',
    cpfFinal: '91',
    papel: 'tutor',
    parentesco: null,
    autorizarProcedimento: true,
    receberInformacao: true,
    retirarDocumento: true,
    contatoPrincipal: false,
    vigenciaInicio: '2026-01-01',
    vigenciaFim: null,
    vigente: true,
    temComprovante: false,
  };
  const responsaveis = {
    itens: [tutor],
    pendencias: [{ pendencia: 'comprovante-ausente', vinculo: 61 }] as unknown[],
  };
  const incapacidades = {
    incapaz: false,
    itens: [] as Record<string, unknown>[],
    alertas: [] as unknown[],
    documentos: ['sentenca_curatela', 'curatela_provisoria', 'laudo_medico'],
  };
  await page.route('**/api/cadastros/ficha-complementar/tipos', (r) =>
    json(r, { endereco: [], telefone: [], parentesco: [] }),
  );
  await page.route(`**/api/cadastros/pacientes/${PACIENTE}/**`, (rota) => {
    const req = rota.request();
    const caminho = new URL(req.url()).pathname.replace(`/api/cadastros/pacientes/${PACIENTE}/`, '');
    if (req.method() === 'GET') {
      if (caminho === 'contatos') return json(rota, { enderecos: [], telefones: [], emails: [] });
      if (caminho === 'responsaveis') return json(rota, responsaveis);
      if (caminho === 'incapacidades') return json(rota, incapacidades);
      return rota.fallback();
    }
    const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
    pedidos.push({ caminho, corpo });
    if (caminho === 'incapacidades') {
      incapacidades.incapaz = true;
      incapacidades.itens.unshift({
        id: 71,
        inicio: String(corpo['inicio']),
        fim: null,
        vigente: true,
        documentoTipo: String(corpo['documentoTipo']),
        documentoNumero: corpo['documentoNumero'] ?? null,
        documentoData: String(corpo['documentoData']),
        temComprovante: false,
        motivoEncerramento: null,
        observacao: null,
      });
      incapacidades.alertas = [
        {
          alerta: 'incapaz-sem-curador',
          mensagem: 'Paciente com incapacidade registrada e sem curador vigente no cadastro.',
        },
      ];
      responsaveis.pendencias.unshift({ pendencia: 'incapaz-sem-curador', vinculo: null });
      return json(rota, { id: 71 }, 201);
    }
    if (caminho === 'comprovantes-representacao') {
      if (corpo['alvo'] === 'incapacidade')
        incapacidades.itens[0] = { ...incapacidades.itens[0], temComprovante: true };
      else {
        responsaveis.itens[0] = { ...tutor, temComprovante: true };
        responsaveis.pendencias = responsaveis.pendencias.filter(
          (p) => (p as { pendencia: string }).pendencia !== 'comprovante-ausente',
        );
      }
      return json(rota, { arquivo: 81 }, 201);
    }
    if (caminho === 'incapacidades/71/encerrar') {
      incapacidades.incapaz = false;
      incapacidades.itens[0] = {
        ...incapacidades.itens[0],
        vigente: false,
        fim: String(corpo['fim']),
        motivoEncerramento: String(corpo['motivo']),
      };
      incapacidades.alertas = [];
      responsaveis.pendencias = responsaveis.pendencias.filter(
        (p) => (p as { pendencia: string }).pendencia !== 'incapaz-sem-curador',
      );
      return json(rota, { id: 71 });
    }
    return json(rota, { id: 1 });
  });
}

const PDF = {
  name: 'sentenca.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4\n% sintetico\n%%EOF\n'),
};

test.describe('Incapacidade do paciente e comprovantes da representação @F31 @F3.1-02', () => {
  test('incapacidade: validação na hora, registro, aviso da abertura, comprovante ao escolher o arquivo e levantamento; axe', async ({
    page,
  }) => {
    const pedidos: Pedido[] = [];
    await entrar(page, 'SINT.RECEPCAO');
    await simular(page, pedidos);
    await page.goto(`/cadastros/pacientes/${PACIENTE}/contatos`);
    const bloco = page.getByTestId('bloco-incapacidade');
    await expect(bloco).toContainText('Nenhuma incapacidade registrada');
    await expect(page.getByTestId('alerta-abertura')).toHaveCount(0);

    // Validação na hora: início futuro e documento judicial sem o número do processo não saem da tela.
    const form = page.getByTestId('form-incapacidade');
    const registrar = form.getByRole('button', { name: 'Registrar incapacidade' });
    await expect(registrar).toBeDisabled();
    await page.getByTestId('incapacidade-inicio').fill('2999-01-01');
    await expect(form.getByRole('alert')).toContainText('data futura');
    await page.getByTestId('incapacidade-inicio').fill('2025-02-10');
    await page.getByTestId('incapacidade-data-documento').fill('2025-02-10');
    await expect(form.getByRole('alert')).toContainText('número do processo');
    await expect(registrar).toBeDisabled();
    // O laudo médico não pede o número.
    await escolher(page.getByTestId('incapacidade-documento'), { rotulo: 'Laudo médico' });
    await expect(form.getByRole('alert')).toHaveCount(0);
    await expect(registrar).toBeEnabled();
    await escolher(page.getByTestId('incapacidade-documento'), { rotulo: 'Sentença de curatela' });
    await page.getByTestId('incapacidade-numero').fill('0000000-00.2025.0.00.0000');
    expect(pedidos).toHaveLength(0);
    await registrar.click();
    await expect(page.getByTestId('incapacidade-71')).toContainText('Sentença de curatela');
    await expect(page.getByTestId('incapacidade-71')).toContainText('vigente');
    expect(pedidos[0]).toMatchObject({
      caminho: 'incapacidades',
      corpo: {
        inicio: '2025-02-10',
        documentoTipo: 'sentenca_curatela',
        documentoNumero: '0000000-00.2025.0.00.0000',
        documentoData: '2025-02-10',
      },
    });
    // A pendência sai da condição e o aviso que a abertura do atendimento vai dar aparece aqui.
    await expect(page.getByTestId('alerta-abertura')).toContainText('sem curador');
    await expect(page.getByTestId('pendencia-responsavel').first()).toContainText('incapacidade registrada');
    await expect(form).toHaveCount(0);

    // Comprovante: arquivo que não é PDF nem imagem é recusado na hora; o válido é enviado ao ser escolhido.
    await page.getByTestId('anexo-incapacidade-71').setInputFiles({
      name: 'nota.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('texto sintetico'),
    });
    await expect(page.getByTestId('recusa-representacao')).toContainText('PDF, PNG ou JPEG');
    expect(pedidos).toHaveLength(1);
    await page.getByTestId('anexo-incapacidade-71').setInputFiles(PDF);
    await expect(page.getByTestId('incapacidade-71')).toContainText('comprovante anexado');
    expect(pedidos[1]).toMatchObject({
      caminho: 'comprovantes-representacao',
      corpo: { alvo: 'incapacidade', id: 71, nome: 'sentenca.pdf' },
    });
    expect(String(pedidos[1]?.corpo['conteudo'])).toMatch(/^data:application\/pdf;base64,/);
    // O termo do tutor, direto na linha do vínculo pendente.
    await expect(page.getByTestId('comprovante-pendente-61')).toContainText('TUTOR SINTETICO');
    await page.getByTestId('anexo-responsavel-61').setInputFiles({ ...PDF, name: 'termo-tutela.pdf' });
    await expect(page.getByTestId('comprovante-pendente-61')).toHaveCount(0);
    expect(pedidos[2]).toMatchObject({
      caminho: 'comprovantes-representacao',
      corpo: { alvo: 'responsavel', id: 61, nome: 'termo-tutela.pdf' },
    });

    // Levantamento: data anterior ao início é recusada na hora; o registro fica na lista, com data e motivo.
    const levantamento = page.getByTestId('form-levantamento');
    await page.getByTestId('levantamento-fim').fill('2025-01-01');
    await expect(levantamento.getByRole('alert')).toContainText('anterior ao início');
    await page.getByTestId('levantamento-fim').fill('2026-01-15');
    await page.getByTestId('levantamento-motivo').fill('Sentença de levantamento');
    await levantamento.getByRole('button', { name: 'Registrar levantamento' }).click();
    await expect(page.getByTestId('incapacidade-71')).toContainText('levantada em 2026-01-15');
    await expect(page.getByTestId('incapacidade-71')).toContainText('Sentença de levantamento');
    expect(pedidos[3]).toMatchObject({
      caminho: 'incapacidades/71/encerrar',
      corpo: { fim: '2026-01-15', motivo: 'Sentença de levantamento' },
    });
    await expect(page.getByTestId('alerta-abertura')).toHaveCount(0);
    await expect(page.getByTestId('form-incapacidade')).toBeVisible();
    await semViolacaoAxe(page, '/cadastros/pacientes/:id/contatos');
  });
});
