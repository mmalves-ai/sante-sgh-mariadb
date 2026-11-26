// E2E @C1-110 (F8, 05-SADT linha 24): a busca ativa de resultados em /sadt/busca-ativa. A equipe vê a fila com o caso
// atrasado em destaque; "Procurar novos resultados" mostra antes os candidatos e só então abre os casos; o caso traz
// os exames, a equipe e o histórico; o contato feito sem orientação é travado na hora (regra do domínio) e, com a
// orientação, gravado com a versão do caso; o "sem contato" é recusado na hora com uma tentativa só; a conclusão com
// o paciente orientado é gravada. As rotas /api/sadt/busca-ativa exigem o banco próprio e o E2E roda com a fonte
// sintética (sem núcleo): as respostas são simuladas pelo Playwright com massa SINTÉTICA. O efeito no banco (caso por
// requisição, contato, desfecho, cancelamento que não apaga, trilha) está em
// apps/api/src/modulos/sadt/busca-ativa.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher, rotulosDoCombo } from './combos.js';

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

const ontem = new Date(Date.now() - 86_400_000).toISOString();
const amanha = new Date(Date.now() + 86_400_000).toISOString();

const casoNaFila = (p: Record<string, unknown>) => ({
  id: 91,
  numero: 'BA-000001',
  paciente: 61,
  pacienteNome: 'PACIENTE SINTETICO',
  prontuario: 'SINT-61',
  motivo: 'resultado_critico',
  situacao: 'aberto',
  desfecho: null,
  abertoEm: ontem,
  prazoEm: ontem,
  atrasado: true,
  setor: 'LABORATORIO SINTETICO',
  exames: 'POTASSIO SINTETICO',
  tentativas: 0,
  ultimoContatoEm: null,
  versao: 1,
  ...p,
});

const apoio = {
  canais: [{ id: 5, nome: 'TELEFONE SINTETICO' }],
  equipe: [{ id: 7, nome: 'ENFERMEIRA SINTETICA' }],
  resultadosContato: ['contato_realizado', 'sem_resposta', 'contato_invalido', 'recado', 'recusou'],
  desfechos: [
    'paciente_orientado',
    'paciente_retornou',
    'nova_coleta_realizada',
    'encaminhado',
    'sem_contato',
    'obito',
    'recusou',
  ],
};

test.describe('Busca ativa de resultados @C1-110 @fase8', () => {
  test.setTimeout(180_000);
  test('fila com atraso, candidatos antes de abrir, contato validado na hora, conclusão; axe', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    let aberto = false;
    let contatos: Record<string, unknown>[] = [];
    let versao = 1;
    let situacao = 'aberto';
    await page.route('**/api/sadt/busca-ativa**', (rota) => {
      const req = rota.request();
      const caminho = new URL(req.url()).pathname.replace(/^\/api\/sadt\/busca-ativa\/?/, '');
      if (req.method() === 'GET') {
        if (caminho === 'apoio') return json(rota, apoio);
        if (caminho === '')
          return json(rota, {
            itens: [
              casoNaFila({
                id: 90,
                numero: 'BA-000000',
                motivo: 'resultado_alterado',
                atrasado: false,
                prazoEm: amanha,
              }),
              ...(aberto ? [casoNaFila({ situacao, versao, tentativas: contatos.length })] : []),
            ],
          });
        if (caminho === 'candidatos')
          return json(rota, {
            itens: aberto
              ? []
              : [{ requisicao: 301, paciente: 61, motivo: 'resultado_critico', prazoEm: ontem, exames: 1 }],
          });
        if (caminho === '91')
          return json(rota, {
            id: 91,
            numero: 'BA-000001',
            situacao,
            desfecho: situacao === 'concluido' ? 'paciente_orientado' : null,
            observacao: null,
            concluidoEm: situacao === 'concluido' ? new Date().toISOString() : null,
            concluidoPor: situacao === 'concluido' ? 'USUARIO SINTETICO' : null,
            versao,
            exames: [
              {
                id: 1,
                nome: 'POTASSIO SINTETICO',
                situacao: 'pendente',
                liberadoEm: ontem,
                critico: true,
                alterado: true,
              },
            ],
            contatos,
            equipe: [{ id: 7, nome: 'ENFERMEIRA SINTETICA' }],
          });
      }
      const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
      pedidos.push({ caminho, corpo });
      if (caminho === 'abrir') {
        aberto = true;
        return json(rota, { abertos: 1, exames: 1 });
      }
      if (caminho === '91/contatos') {
        versao += 1;
        situacao = 'em_contato';
        contatos = [
          {
            id: 11,
            contatadoEm: new Date().toISOString(),
            resultado: corpo['resultado'],
            orientacao: corpo['orientacao'],
            novaColetaEm: null,
            canal: 'TELEFONE SINTETICO',
            por: 'USUARIO SINTETICO',
          },
          ...contatos,
        ];
        return json(rota, { contato: 11, versao });
      }
      if (caminho === '91/concluir') {
        versao += 1;
        situacao = 'concluido';
        return json(rota, { versao });
      }
      return json(rota, { codigo: 'nao-simulado' }, 500);
    });

    // A busca ativa é rotina de quem comunica o resultado crítico (sadt.avisoCritico.comunicar) e lê resultados.
    await entrar(page, 'SINT.BIOMEDICO');
    await page.goto('/sadt/busca-ativa');
    await expect(page.getByTestId('busca-ativa')).toBeVisible();
    await expect(page.getByTestId('busca-ativa-fila')).toContainText('BA-000000');
    await semViolacaoAxe(page, '/sadt/busca-ativa');

    // Candidatos antes de abrir: nada é gravado até confirmar.
    await page.getByTestId('busca-ativa-procurar').click();
    await expect(page.getByTestId('busca-ativa-candidatos')).toContainText('Requisição 301');
    expect(pedidos).toHaveLength(0);
    await page.getByTestId('busca-ativa-abrir-casos').click();
    await expect(page.getByTestId('busca-ativa-mensagem')).toContainText('1 caso(s) aberto(s)');
    expect(pedidos[0]).toMatchObject({ caminho: 'abrir' });
    // O atrasado em destaque, à frente.
    await expect(
      page.getByTestId('busca-ativa-caso-BA-000001').getByTestId('busca-ativa-atrasado'),
    ).toBeVisible();

    // O caso: exames, equipe e histórico vazio.
    await page.getByTestId('busca-ativa-abrir-BA-000001').click();
    await expect(page.getByTestId('busca-ativa-exames')).toContainText('POTASSIO SINTETICO');
    await expect(page.getByTestId('busca-ativa-equipe')).toContainText('ENFERMEIRA SINTETICA');
    await expect(page.getByTestId('busca-ativa-historico')).toContainText('Nenhuma tentativa registrada.');
    const resultadosOferecidos = await rotulosDoCombo(page.getByTestId('busca-ativa-resultado'));
    expect(resultadosOferecidos).toContain('Contato feito');

    // Contato feito sem orientação: travado na hora, sem ir ao servidor.
    const registrar = page.getByTestId('busca-ativa-registrar-contato');
    await escolher(page.getByTestId('busca-ativa-canal'), { rotulo: 'TELEFONE SINTETICO' });
    await escolher(page.getByTestId('busca-ativa-resultado'), { rotulo: 'Contato feito' });
    await expect(page.getByTestId('busca-ativa-problemas-contato')).toContainText('orientação');
    await expect(registrar).toBeDisabled();
    await page
      .getByTestId('busca-ativa-orientacao')
      .fill('ORIENTACAO SINTETICA: procurar o pronto-socorro hoje.');
    await expect(registrar).toBeEnabled();
    await registrar.click();
    await expect(page.getByTestId('busca-ativa-mensagem')).toContainText('Tentativa de contato registrada.');
    const contato = pedidos.find((p) => p.caminho === '91/contatos');
    expect(contato?.corpo).toMatchObject({
      versao: 1,
      canal: 5,
      resultado: 'contato_realizado',
      orientacao: 'ORIENTACAO SINTETICA: procurar o pronto-socorro hoje.',
      novaColetaEm: null,
    });
    await expect(page.getByTestId('busca-ativa-historico')).toContainText('USUARIO SINTETICO');

    // "Sem contato" com uma tentativa feita: recusado na hora.
    const concluir = page.getByTestId('busca-ativa-concluir');
    await escolher(page.getByTestId('busca-ativa-desfecho'), { rotulo: 'Sem contato' });
    await expect(page.getByTestId('busca-ativa-problemas-conclusao')).toBeVisible();
    await expect(concluir).toBeDisabled();
    await escolher(page.getByTestId('busca-ativa-desfecho'), { rotulo: 'Paciente orientado' });
    await expect(concluir).toBeEnabled();
    await concluir.click();
    await expect(page.getByTestId('busca-ativa-mensagem')).toContainText('Caso concluído.');
    expect(pedidos.find((p) => p.caminho === '91/concluir')?.corpo).toMatchObject({
      versao: 2,
      desfecho: 'paciente_orientado',
      observacao: null,
    });
    await expect(page.getByTestId('busca-ativa-encerrado')).toContainText('Paciente orientado');
    await expect(page.getByTestId('busca-ativa-contato')).toHaveCount(0);
  });
});
