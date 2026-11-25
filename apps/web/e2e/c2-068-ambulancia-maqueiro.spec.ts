// C2-068 (04-INT linha 83): chamado de ambulância com trajeto e cobrança por quilômetro, e maqueiro do transporte
// interno. As rotas da ambulância são simuladas (page.route com respostas sintéticas) e o ciclo é exercitado pela tela:
//   - na visão do paciente (/internacao/:reg/ambulancia), o pedido valida na hora pela regra do domínio (categoria,
//     destino por estabelecimento, trajeto ou endereço, CEP com 8 números, previsão no passado) e o botão só se habilita
//     sem problema;
//   - na fila (/internacao/ambulancias), aprovar pede a ambulância e a equipe mínima da categoria (tipo B: condutor e
//     técnico de enfermagem), a saída pede o hodômetro, e a conclusão com o hodômetro final mostra a remoção lançada na
//     conta;
//   - o maqueiro é designado ao transporte interno à espera.
// Axe em cada passo. O que fica no banco é provado pelo contrato de efeito chamado-ambulancia-propria.int.spec.ts.
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

const local = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(
    d.getHours(),
  ).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

test.describe('internação: ambulância com cobrança e maqueiros @C2-068', () => {
  test.setTimeout(180_000);

  test('pedido pela internação, aprovar, saída, conclusão com cobrança e maqueiro; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    const corpos: { url: string; corpo: Record<string, unknown> }[] = [];
    const json = (rota: Route, corpo: unknown) =>
      rota.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpo) });
    const chamado = (id: number, extra: Record<string, unknown>) => ({
      id,
      versao: 1,
      numero: `AMB-SINT-${id}`,
      tipo: 'remocao_inter_hospitalar',
      situacao: 'solicitado',
      paciente: 1001,
      pacienteNome: 'Paciente sintético',
      atendimento: 2001,
      categoria: 1,
      categoriaNome: 'Suporte básico sintético',
      ambulancia: null,
      ambulanciaPlaca: null,
      rota: null,
      rotaNome: null,
      destino: 'Hospital sintético de referência',
      posicao: 'deitado',
      solicitado: new Date(Date.now() - 60 * 60_000).toISOString(),
      previsto: null,
      saida: null,
      fim: null,
      kmInicial: null,
      kmFinal: null,
      kmRodados: null,
      itemConta: null,
      motivoReprovacao: null,
      equipe: [],
      ...extra,
    });
    const itens: Record<string, unknown>[] = [];
    const mudar = (id: number, extra: Record<string, unknown>) => {
      const i = itens.findIndex((x) => x['id'] === id);
      itens[i] = { ...itens[i], ...extra, versao: Number(itens[i]!['versao']) + 1 };
    };
    const internos: Record<string, unknown>[] = [
      {
        id: 701,
        versao: 1,
        tipo: 'interno',
        prioridade: 'rotina',
        situacao: 'solicitado',
        previsto: null,
        solicitado: new Date(Date.now() - 20 * 60_000).toISOString(),
        paciente: 1002,
        pacienteNome: 'Paciente sintético 2',
        origem: 'Setor sintético A',
        destino: 'Imagem sintética',
        maqueiro: null,
        maqueiroNome: null,
      },
    ];

    await page.route(/\/api\/internacao\/ambulancias\/opcoes$/, (r) =>
      json(r, {
        categorias: [{ id: 1, nome: 'Suporte básico sintético', classificacao: 'B' }],
        ambulancias: [{ id: 5, nome: 'Veículo sintético 5', categoria: 1, quilometragem: 1000 }],
        rotas: [{ id: 3, nome: 'Trajeto sintético centro' }],
        destinos: [{ id: 9, nome: 'Hospital sintético de referência' }],
        motivosCancelamento: [{ id: 4, nome: 'Remoção desmarcada' }],
        motivosAtraso: [],
        profissionais: [
          { id: 31, nome: 'Condutor sintético', funcao: 'motorista', tipo: 'ambulancia' },
          { id: 32, nome: 'Técnico sintético', funcao: 'tecnico_enfermagem', tipo: 'ambos' },
          { id: 33, nome: 'Maqueiro sintético', funcao: 'maqueiro', tipo: 'interno' },
        ],
        funcoes: ['condutor', 'tecnico_enfermagem', 'enfermeiro', 'medico', 'outro'],
      }),
    );
    await page.route(/\/api\/internacao\/transportes\/internacao\/1$/, (r) =>
      json(r, {
        id: 1,
        numero: 'INT-SINT-1',
        paciente: 1001,
        prontuario: 'SINT-1',
        atendimento: 2001,
        situacao: 'ativa',
        setorAtual: 10,
        alta: null,
        tipoSugerido: 'transferencia_externa',
      }),
    );
    await page.route(/\/api\/internacao\/transportes(\?.*)?$/, (r) => json(r, { itens: [] }));
    await page.route(/\/api\/internacao\/ambulancias(\?.*)?$/, async (r) => {
      if (r.request().method() === 'POST') {
        corpos.push({ url: '/api/internacao/ambulancias', corpo: r.request().postDataJSON() });
        itens.unshift(chamado(801, {}));
        return json(r, { id: 801, numero: 'AMB-SINT-801' });
      }
      return json(r, { itens });
    });
    await page.route(/\/api\/internacao\/ambulancias\/\d+\/(aprovar|sair|concluir)$/, async (r) => {
      const url = new URL(r.request().url()).pathname;
      const corpo = r.request().postDataJSON() as Record<string, unknown>;
      corpos.push({ url, corpo });
      const [, id, acao] = /\/(\d+)\/(\w+)$/.exec(url)!;
      if (acao === 'aprovar') {
        mudar(Number(id), { situacao: 'aprovado', ambulancia: 5, ambulanciaPlaca: 'Veículo sintético 5' });
        return json(r, { id: Number(id), situacao: 'aprovado' });
      }
      if (acao === 'sair') {
        mudar(Number(id), {
          situacao: 'em_transito',
          kmInicial: corpo['kmInicial'],
          saida: new Date(Date.now() - 40 * 60_000).toISOString(),
        });
        return json(r, { id: Number(id), situacao: 'em_transito' });
      }
      mudar(Number(id), { situacao: 'concluido', kmFinal: corpo['kmFinal'], kmRodados: 42, itemConta: 9001 });
      return json(r, {
        id: Number(id),
        situacao: 'concluido',
        cobranca: { situacao: 'lancada', quantidade: 42 },
      });
    });
    await page.route(/\/api\/internacao\/maqueiros\/transportes(\/\d+)?$/, async (r) => {
      if (r.request().method() === 'POST') {
        corpos.push({ url: new URL(r.request().url()).pathname, corpo: r.request().postDataJSON() });
        internos[0] = { ...internos[0], maqueiro: 33, maqueiroNome: 'Maqueiro sintético' };
        return json(r, { id: 701 });
      }
      return json(r, { itens: internos });
    });

    await entrar(page, 'SINT.INTERNACAO');
    await page.goto('/internacao/1/ambulancia');
    await expect(page.getByTestId('tela-ambulancia')).toBeVisible();
    await expect(page.getByTestId('ambulancia-internacao')).toContainText('INT-SINT-1');
    await expect(page.getByTestId('ambulancia-vazio')).toBeVisible();
    await semViolacaoAxe(page, '/internacao/1/ambulancia (abertura)');

    // Validação na hora: categoria e destino; CEP e previsão no passado recusados.
    const pedir = page.getByTestId('ambulancia-pedir');
    const problemas = page.getByTestId('ambulancia-problemas');
    await expect(problemas).toContainText('Informe a categoria de ambulância.');
    await expect(problemas).toContainText('Informe o destino');
    await expect(pedir).toBeDisabled();
    await escolher(page.getByTestId('ambulancia-categoria'), '1');
    await page.getByTestId('ambulancia-logradouro').fill('Rua sintética');
    await page.getByTestId('ambulancia-cep').fill('123');
    await expect(problemas).toContainText('CEP com 8 números.');
    await page.getByTestId('ambulancia-cep').fill('');
    await page.getByTestId('ambulancia-logradouro').fill('');
    await escolher(page.getByTestId('ambulancia-destino-externo'), '9');
    await page.getByTestId('ambulancia-previsto').fill(local(new Date(Date.now() - 3 * 3_600_000)));
    await expect(problemas).toContainText('A previsão não pode estar no passado.');
    await page.getByTestId('ambulancia-previsto').fill(local(new Date(Date.now() + 2 * 3_600_000)));
    await escolher(page.getByTestId('ambulancia-posicao'), 'deitado');
    await expect(problemas).toHaveCount(0);
    await expect(pedir).toBeEnabled();
    await pedir.click();
    await expect(page.getByTestId('ambulancia-aviso')).toHaveText('Chamado AMB-SINT-801 registrado.');
    expect(corpos[0]).toMatchObject({
      url: '/api/internacao/ambulancias',
      corpo: {
        atendimento: 2001,
        tipo: 'remocao_inter_hospitalar',
        categoria: 1,
        destinoExterno: 9,
        posicao: 'deitado',
      },
    });
    // Com o chamado em aberto, um segundo pedido é recusado na hora.
    await expect(problemas).toContainText('Já há um chamado de ambulância em aberto para este atendimento.');
    await semViolacaoAxe(page, '/internacao/1/ambulancia (chamado pedido)');

    // Fila: aprovar pede a ambulância e a equipe mínima do tipo B.
    await page.getByTestId('ambulancia-ir-fila').click();
    await expect(page).toHaveURL(/\/internacao\/ambulancias$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ambulância e maqueiros');
    const aprovar = page.getByTestId('ambulancia-aprovar-801');
    await expect(aprovar).toBeDisabled();
    await escolher(page.getByTestId('ambulancia-veiculo'), '5');
    await escolher(page.getByTestId('ambulancia-condutor'), '31');
    await expect(aprovar).toBeDisabled();
    await escolher(page.getByTestId('ambulancia-membro'), '32');
    await expect(aprovar).toBeEnabled();
    await aprovar.click();
    await expect(page.getByTestId('ambulancia-801')).toContainText('Aprovado');
    expect(corpos.at(-1)).toMatchObject({
      url: '/api/internacao/ambulancias/801/aprovar',
      corpo: {
        ambulancia: 5,
        equipe: [
          { profissional: 31, funcao: 'condutor' },
          { profissional: 32, funcao: 'tecnico_enfermagem' },
        ],
        versao: 1,
      },
    });

    // Saída: o hodômetro abaixo do último do veículo é recusado.
    const sair = page.getByTestId('ambulancia-sair-801');
    await page.getByTestId('ambulancia-km-inicial').fill('900');
    await expect(sair).toBeDisabled();
    await page.getByTestId('ambulancia-km-inicial').fill('1000');
    await expect(sair).toBeEnabled();
    await sair.click();
    await expect(page.getByTestId('ambulancia-801')).toContainText('Em trânsito');

    // Conclusão: o hodômetro final menor que o da saída é recusado; a remoção entra na conta.
    const concluir = page.getByTestId('ambulancia-concluir-801');
    await page.getByTestId('ambulancia-km-final').fill('990');
    await expect(concluir).toBeDisabled();
    await page.getByTestId('ambulancia-km-final').fill('1042');
    await expect(concluir).toBeEnabled();
    await concluir.click();
    await expect(page.getByTestId('ambulancia-aviso')).toContainText('a remoção entrou na conta (42)');
    expect(corpos.at(-1)).toMatchObject({
      url: '/api/internacao/ambulancias/801/concluir',
      corpo: { kmFinal: 1042 },
    });
    await semViolacaoAxe(page, '/internacao/ambulancias (chamado concluído)');

    // Maqueiro do transporte interno.
    const designar = page.getByTestId('maqueiro-designar-701');
    await expect(designar).toBeDisabled();
    await escolher(page.getByTestId('maqueiro-escolha'), '33');
    await expect(designar).toBeEnabled();
    await designar.click();
    await expect(page.getByTestId('maqueiro-701')).toContainText('Maqueiro sintético');
    expect(corpos.at(-1)).toMatchObject({
      url: '/api/internacao/maqueiros/transportes/701',
      corpo: { maqueiro: 33, versao: 1 },
    });
    await semViolacaoAxe(page, '/internacao/ambulancias (maqueiro designado)');
    expect(externas).toEqual([]);
  });
});
