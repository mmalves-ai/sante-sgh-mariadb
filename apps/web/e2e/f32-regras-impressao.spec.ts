// F3.2 (02-REC linha 35): regras de impressão da recepção, pelo caminho da tela. A manutenção exige o banco próprio, e
// o E2E roda com a fonte sintética (sem núcleo). Por isso as respostas de /api/atendimento/regras-impressao são
// simuladas pelo Playwright com massa SINTÉTICA; o que se prova é a tela: o modelo de ficha incluído com a
// conferência na hora (idade invertida trava o botão sem ir ao servidor), a regra por fonte pagadora e especialidade,
// a regra repetida recusada na hora pela regra do domínio, a inativação e a reativação num clique pela mesma linha, e
// a conferência "o que sai" calculada na tela (a regra mais específica manda nas cópias). O efeito no banco (modelo e
// regra com a trilha, fichas do atendimento real, emissão numerada e reimpressão) está no contrato de efeito
// (apps/api/src/modulos/atendimento/regras-impressao.int.spec.ts).
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

interface Modelo {
  id: number;
  versao: number;
  codigo: string;
  titulo: string;
  tipoDocumento: string;
  conteudo: string | null;
  copias: number;
  ordem: number | null;
  somenteRetorno: boolean;
  idadeMinima: number | null;
  idadeMaxima: number | null;
  ativo: boolean;
  regrasAtivas: number;
}
interface Regra {
  id: number;
  versao: number;
  modelo: number;
  estabelecimento: number | null;
  categoria: number | null;
  fontePagadora: number | null;
  especialidade: number | null;
  grupo: number | null;
  unidade: number | null;
  clinica: number | null;
  copias: number | null;
  selecionada: boolean;
  ativo: boolean;
}

test.describe('F3.2 regras de impressão da recepção @F3.2 @F3.2-05', () => {
  test('inclui o modelo e as regras, confere na hora o que sai, inativa e reativa', async ({ page }) => {
    const pedidos: Record<string, unknown>[] = [];
    const EST = 7;
    const modelos: Modelo[] = [
      {
        id: 901,
        versao: 1,
        codigo: 'FICHA',
        titulo: 'FICHA SINTETICA',
        tipoDocumento: 'ficha_ambulatorial',
        conteudo: 'Texto sintético.',
        copias: 1,
        ordem: 1,
        somenteRetorno: false,
        idadeMinima: null,
        idadeMaxima: null,
        ativo: true,
        regrasAtivas: 1,
      },
    ];
    const regras: Regra[] = [
      {
        id: 801,
        versao: 1,
        modelo: 901,
        estabelecimento: EST,
        categoria: null,
        fontePagadora: null,
        especialidade: null,
        grupo: null,
        unidade: null,
        clinica: null,
        copias: null,
        selecionada: true,
        ativo: true,
      },
    ];
    const opcoes = {
      categorias: [{ id: 11, nome: 'CONSULTA SINTETICA' }],
      fontes: [
        { id: 21, nome: 'CONVENIO SINTETICO A' },
        { id: 22, nome: 'CONVENIO SINTETICO B' },
      ],
      especialidades: [{ id: 31, nome: 'CARDIOLOGIA SINTETICA' }],
      grupos: [{ id: 41, nome: 'GRUPO SINTETICO' }],
      unidades: [{ id: 51, nome: 'AMBULATORIO SINTETICO' }],
    };
    let proximo = 902;
    await page.route('**/api/atendimento/regras-impressao**', (r) => {
      const req = r.request();
      if (req.method() === 'GET') {
        for (const m of modelos) m.regrasAtivas = regras.filter((x) => x.ativo && x.modelo === m.id).length;
        return json(r, { estabelecimento: EST, modelos, regras, opcoes });
      }
      const a = req.postDataJSON() as Record<string, unknown>;
      pedidos.push(a);
      if (a['acao'] === 'modelo') {
        const novo: Modelo = {
          id: proximo++,
          versao: 1,
          codigo: String(a['codigo']),
          titulo: String(a['titulo']),
          tipoDocumento: String(a['tipoDocumento']),
          conteudo: String(a['conteudo']),
          copias: Number(a['copias']),
          ordem: (a['ordem'] as number | null) ?? null,
          somenteRetorno: a['somenteRetorno'] === true,
          idadeMinima: (a['idadeMinima'] as number | null) ?? null,
          idadeMaxima: (a['idadeMaxima'] as number | null) ?? null,
          ativo: a['ativo'] === true,
          regrasAtivas: 0,
        };
        modelos.push(novo);
        return json(r, {
          ok: true,
          resultado: { alvo: 'modelo_ficha_impressa', id: novo.id, versao: 1, novo: true },
          repetida: false,
          mensagem: 'Modelo de ficha gravado.',
        });
      }
      const dados = {
        modelo: Number(a['modelo']),
        estabelecimento: a['todasUnidades'] === true ? null : EST,
        categoria: (a['categoria'] as number | null) ?? null,
        fontePagadora: (a['fontePagadora'] as number | null) ?? null,
        especialidade: (a['especialidade'] as number | null) ?? null,
        grupo: (a['grupo'] as number | null) ?? null,
        unidade: (a['unidade'] as number | null) ?? null,
        clinica: null,
        copias: (a['copias'] as number | null) ?? null,
        selecionada: a['selecionada'] === true,
        ativo: a['ativo'] === true,
      };
      const atual = regras.find((x) => x.id === a['id']);
      if (atual) Object.assign(atual, dados, { versao: atual.versao + 1 });
      else regras.push({ id: 800 + regras.length + 1, versao: 1, ...dados });
      return json(r, {
        ok: true,
        resultado: {
          alvo: 'regra_impressao_ficha',
          id: atual?.id ?? regras.at(-1)?.id,
          versao: 1,
          novo: !atual,
        },
        repetida: false,
        mensagem: 'Regra de impressão gravada.',
      });
    });

    await entrar(page, 'SINT.ADMIN');
    await page.goto('/recepcao/atendimento/regras-impressao');
    await expect(page.getByTestId('tela-regras-impressao')).toBeVisible();
    await expect(page.getByTestId('modelo-901')).toContainText('FICHA SINTETICA');
    await expect(page.getByTestId('regra-801')).toContainText('Todo atendimento');

    // Modelo novo: a idade invertida trava o botão na hora, sem ir ao servidor.
    const fm = page.getByTestId('form-modelo');
    await fm.getByLabel('Código').fill('GUIA');
    await fm.getByLabel('Título impresso').fill('GUIA SINTETICA');
    await fm.getByLabel('Texto do modelo').fill('Texto sintético da guia.');
    await escolher(fm.getByLabel('Tipo de documento'), 'guia_consulta');
    await escolher(fm.getByLabel('Cópias'), '2');
    await fm.getByLabel('Idade mínima (anos)').fill('30');
    await fm.getByLabel('Idade máxima (anos)').fill('10');
    await expect(page.getByTestId('aviso-modelo')).toContainText('idade máxima');
    await expect(page.getByTestId('gravar-modelo')).toBeDisabled();
    expect(pedidos).toHaveLength(0);
    await fm.getByLabel('Idade mínima (anos)').fill('');
    await fm.getByLabel('Idade máxima (anos)').fill('');
    await expect(page.getByTestId('aviso-modelo')).toHaveCount(0);
    await page.getByTestId('gravar-modelo').click();
    await expect(page.getByTestId('regras-impressao-mensagem')).toHaveText('Modelo de ficha gravado.');
    await expect(page.getByTestId('modelo-902')).toContainText('GUIA SINTETICA');
    expect(pedidos.at(-1)).toMatchObject({
      acao: 'modelo',
      codigo: 'GUIA',
      titulo: 'GUIA SINTETICA',
      tipoDocumento: 'guia_consulta',
      copias: 2,
      idadeMinima: null,
      idadeMaxima: null,
      ativo: true,
    });

    // Regra repetida (mesmo modelo, mesmo alcance): recusada na hora, sem ir ao servidor.
    const fr = page.getByTestId('form-regra');
    await escolher(fr.getByLabel('Modelo'), '901');
    await expect(page.getByTestId('aviso-regra')).toContainText('Já existe uma regra ativa');
    await expect(page.getByTestId('gravar-regra')).toBeDisabled();
    const antes = pedidos.length;

    // Regra da guia por fonte pagadora, com 3 cópias.
    await escolher(fr.getByLabel('Modelo'), '902');
    await expect(page.getByTestId('aviso-regra')).toHaveCount(0);
    await escolher(fr.getByLabel('Fonte pagadora'), '21');
    await escolher(fr.getByLabel('Cópias'), '3');
    await page.getByTestId('gravar-regra').click();
    await expect(page.getByTestId('regras-impressao-mensagem')).toHaveText('Regra de impressão gravada.');
    expect(pedidos).toHaveLength(antes + 1);
    expect(pedidos.at(-1)).toMatchObject({
      acao: 'regra',
      modelo: 902,
      todasUnidades: false,
      fontePagadora: 21,
      especialidade: null,
      copias: 3,
      selecionada: true,
      ativo: true,
    });
    await expect(page.getByTestId('regra-802')).toContainText('CONVENIO SINTETICO A');

    // Regra mais específica da mesma guia: fonte pagadora e especialidade, 4 cópias.
    await escolher(fr.getByLabel('Modelo'), '902');
    await escolher(fr.getByLabel('Fonte pagadora'), '21');
    await escolher(fr.getByLabel('Especialidade'), '31');
    await escolher(fr.getByLabel('Cópias'), '4');
    await page.getByTestId('gravar-regra').click();
    await expect(page.getByTestId('regra-803')).toContainText('CARDIOLOGIA SINTETICA');

    // Conferir o que sai: calculado na tela, sem servidor.
    const conferir = page.getByTestId('conferir-impressao');
    await expect(conferir.getByTestId('conferir-fichas')).toContainText('FICHA SINTETICA: 1 cópia(s)');
    await expect(conferir.getByTestId('conferir-fichas')).not.toContainText('GUIA SINTETICA');
    await escolher(conferir.getByLabel('Fonte pagadora'), '21');
    await expect(conferir.getByTestId('conferir-fichas')).toContainText('GUIA SINTETICA: 3 cópia(s)');
    await escolher(conferir.getByLabel('Especialidade'), '31');
    await expect(conferir.getByTestId('conferir-fichas')).toContainText('GUIA SINTETICA: 4 cópia(s)');
    await escolher(conferir.getByLabel('Fonte pagadora'), '22');
    await expect(conferir.getByTestId('conferir-fichas')).not.toContainText('GUIA SINTETICA');

    // Inativar num clique: a linha fica, a regra geral deixa de valer e a conferência muda na hora.
    await page.getByTestId('alternar-regra-801').click();
    await expect(page.getByTestId('regra-801')).toContainText('Inativa');
    expect(pedidos.at(-1)).toMatchObject({ acao: 'regra', id: 801, versao: 1, modelo: 901, ativo: false });
    await expect(conferir.getByTestId('conferir-nada')).toBeVisible();
    await page.getByTestId('alternar-regra-801').click();
    await expect(page.getByTestId('regra-801')).toContainText('Ativa');
    expect(pedidos.at(-1)).toMatchObject({ acao: 'regra', id: 801, ativo: true });
    await expect(conferir.getByTestId('conferir-fichas')).toContainText('FICHA SINTETICA');

    await semViolacaoAxe(page, 'regras de impressão');
  });
});
