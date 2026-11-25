// C2-124 (06-SUS linha 64): RAAS da atenção psicossocial e da atenção domiciliar pelo caminho da tela. As rotas
// /api/sus/raas exigem o banco próprio, e o E2E roda com a fonte sintética (sem núcleo); por isso as respostas são
// simuladas pelo Playwright com massa SINTÉTICA. O que se prova é a tela: a busca do paciente filtra o painel da
// competência, o registro novo trava na hora sem CID válido e com CNES da saúde da família faltando, a ação fora da
// competência trava sem ir ao servidor, a ação válida vai com a versão do registro, a conclusão exige o destino, a
// crítica e a remessa saem por competência e tipo, e o arquivo devolvido fica para baixar com o aviso de leiaute não
// conferido. O efeito no banco está no contrato de efeito (apps/api/src/modulos/sus/raas-propria.int.spec.ts).
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

const registro = {
  id: 41,
  numero: 'RAAS-SINT-1',
  tipo: 'atencao_psicossocial',
  competencia: '202601',
  paciente: 7,
  pacienteNome: 'Paciente Sintético',
  prontuario: '900001',
  dataAdmissao: '2026-01-05',
  dataConclusao: null,
  situacao: 'aberto',
  cidPrincipal: 'F200',
  continuacao: null,
  remessa: null,
  acoes: 1,
  criticasAbertas: 1,
  bloqueantes: 0,
  versao: 3,
};

test.describe('C2-124 RAAS psicossocial e domiciliar @C2-124', () => {
  test('paciente, registro e ação validados na hora, conclusão, crítica e remessa', async ({ page }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    await page.route('**/api/sus/raas**', (r) => {
      const req = r.request();
      const url = new URL(req.url());
      if (req.method() === 'GET') {
        if (url.pathname.endsWith('/opcoes'))
          return json(r, { destinos: [{ id: 12, descricao: '01 · Alta sintética' }] });
        if (url.pathname.endsWith('/pacientes'))
          return json(r, { pacientes: [{ id: 7, nome: 'Paciente Sintético', prontuario: '900001' }] });
        if (url.pathname.endsWith('/registros/41'))
          return json(r, {
            ...registro,
            acoes: [
              {
                id: 61,
                sequencia: 1,
                procedimento: '0301080208',
                procedimentoDescricao: 'Ação sintética',
                cbo: '225133',
                profissional: null,
                dataInicio: '2026-01-06',
                dataFim: null,
                quantidade: 2,
                local: 'unidade',
                cid: null,
                versao: 1,
              },
            ],
            criticas: [
              {
                id: 91,
                regra: 'raas.cns',
                gravidade: 'aviso',
                descricao: 'CNS sintético',
                situacao: 'aberta',
              },
            ],
          });
        return json(r, {
          competencia: url.searchParams.get('competencia'),
          situacaoCompetencia: 'aberta',
          criticadaEm: null,
          conferidoContraOficial: false,
          registros: [registro],
          remessas: [],
        });
      }
      const corpo = req.postDataJSON() as Record<string, unknown>;
      pedidos.push({ caminho: url.pathname, corpo });
      if (url.pathname.endsWith('/criticar'))
        return json(r, { registros: 1, criticas: 1, bloqueantes: 0, corrigidas: 0 });
      if (url.pathname.endsWith('/remessas'))
        return json(
          r,
          {
            id: 5,
            numero: 'REM-SINT-1',
            nome: 'RAAS_SINT.TXT',
            hash: 'a'.repeat(64),
            registros: 1,
            conteudo: 'LINHA SINTETICA\r\n',
            substituidas: 0,
          },
          201,
        );
      return json(r, { id: 41, numero: 'RAAS-SINT-2', competencia: '202602' }, 201);
    });

    await entrar(page, 'SINT.ADMIN');
    await page.goto('/faturamento/sus/raas');
    await expect(page.getByTestId('tela-raas')).toBeVisible();
    await page.getByTestId('raas-competencia').fill('202601');
    await expect(page.getByTestId('raas-registro-41')).toContainText('Paciente Sintético');
    await expect(page.getByTestId('raas-leiaute-nao-conferido')).toBeVisible();

    // Visão por paciente: a busca escolhe o paciente e filtra o painel.
    await page.getByTestId('raas-busca-paciente').fill('9000');
    await page.getByTestId('raas-paciente-7').click();
    await expect(page.getByTestId('raas-paciente-escolhido')).toContainText('900001');

    // Registro novo: CID inválido e saúde da família sem CNES travam na hora.
    await page.getByTestId('raas-novo').click();
    await page.getByTestId('raas-registro-admissao').fill('2026-01-05');
    await page.getByTestId('raas-registro-cid').fill('X');
    await page.getByTestId('raas-registro-esf').check();
    await expect(page.getByTestId('raas-registro-problemas')).toContainText('CNES');
    await expect(page.getByTestId('raas-registro-gravar')).toBeDisabled();
    await page.getByTestId('raas-registro-cid').fill('F20.0');
    await page.getByTestId('raas-registro-cnes-esf').fill('1234567');
    await page.getByTestId('raas-registro-gravar').click();
    await expect
      .poll(() => pedidos.find((p) => p.caminho === '/api/sus/raas/registros')?.corpo)
      .toMatchObject({
        tipo: 'atencao_psicossocial',
        competencia: '202601',
        paciente: 7,
        cidPrincipal: 'F20.0',
        estrategiaSaudeFamilia: true,
        cnesSaudeFamilia: '1234567',
      });

    // Ação: fora da competência trava; dentro dela vai com a versão do registro.
    await expect(page.getByTestId('raas-detalhe')).toContainText('RAAS-SINT-1');
    await expect(page.getByTestId('raas-acao-61')).toContainText('0301080208');
    await page.getByTestId('raas-acao-procedimento').fill('0301080208');
    await page.getByTestId('raas-acao-cbo').fill('225133');
    await page.getByTestId('raas-acao-inicio').fill('2026-02-02');
    await expect(page.getByTestId('raas-acao-problemas')).toContainText('competência');
    await expect(page.getByTestId('raas-acao-lancar')).toBeDisabled();
    await page.getByTestId('raas-acao-inicio').fill('2026-01-10');
    await escolher(page.getByTestId('raas-acao-local'), 'domicilio');
    await page.getByTestId('raas-acao-lancar').click();
    await expect
      .poll(() => pedidos.find((p) => p.caminho.endsWith('/registros/41/acoes'))?.corpo)
      .toMatchObject({ procedimento: '0301080208', dataInicio: '2026-01-10', local: 'domicilio', versao: 3 });

    // Retirar marca a ação; nada é apagado.
    await page.getByTestId('raas-retirar-61').click();
    await expect
      .poll(() => pedidos.find((p) => p.caminho.endsWith('/acoes/61/retirar'))?.corpo)
      .toMatchObject({ versao: 1 });

    // Conclusão: antes da última ação lançada trava na hora; sem destino trava; com o destino, vai.
    await page.getByTestId('raas-conclusao-data').fill('2026-01-05');
    await expect(page.getByTestId('raas-conclusao-problemas')).toContainText('última ação');
    await page.getByTestId('raas-conclusao-data').fill('2026-01-28');
    await expect(page.getByTestId('raas-conclusao-problemas')).not.toContainText('última ação');
    await expect(page.getByTestId('raas-concluir')).toBeDisabled();
    await escolher(page.getByTestId('raas-conclusao-destino'), '12');
    await page.getByTestId('raas-concluir').click();
    await expect
      .poll(() => pedidos.find((p) => p.caminho.endsWith('/registros/41/concluir'))?.corpo)
      .toMatchObject({ dataConclusao: '2026-01-28', destino: 12, versao: 3 });

    // Crítica e remessa por competência e tipo.
    await escolher(page.getByTestId('raas-tipo'), 'atencao_psicossocial');
    await page.getByTestId('raas-criticar').click();
    await expect(page.getByTestId('raas-aviso')).toContainText('1 críticas');
    await page.getByTestId('raas-remessa-orgao').fill('SMS sintética');
    await page.getByTestId('raas-gerar').click();
    await expect
      .poll(() => pedidos.find((p) => p.caminho.endsWith('/remessas'))?.corpo)
      .toMatchObject({ competencia: '202601', tipo: 'atencao_psicossocial', indicadorDestino: 'M' });
    await expect(page.getByTestId('raas-baixar')).toHaveAttribute('download', 'RAAS_SINT.TXT');

    await semViolacaoAxe(page, 'RAAS psicossocial e domiciliar');
  });
});
