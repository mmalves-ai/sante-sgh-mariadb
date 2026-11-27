// globalSetup do Playwright: aquecimento real do web e da API antes do 1º teste (decisão 59).
//
// Causa medida (rodadas com taskset 0-3): o webServer dá o ambiente por pronto quando /api/saude responde pelo
// proxy, mas o servidor de desenvolvimento do web só transforma cada módulo quando o navegador o pede, e o
// otimizador de dependências ainda está varrendo o projeto. O 1º teste de cada tela pagava a partida a frio dentro
// do próprio tempo: o 1º `goto('/entrar')` não mostrava o campo de login em 120 s e a 1ª visita a uma rota
// preguiçosa (agenda, auditoria da conta) não mostrava o título em 5 s, num spec diferente a cada rodada.
// Aqui, fora do tempo de qualquer teste: (1) a API responde; (2) todo módulo de src/ é pedido ao servidor do web
// (transformado e guardado; os imports estáticos seguem pela pré-transformação do Vite, e a reotimização de
// dependência que aparecer acontece agora, sem página aberta); (3) a página de entrada renderiza no Chrome.
import { readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { chromium, type FullConfig } from '@playwright/test';
import { ambienteDoNavegador } from './navegador.js';

const raiz = resolve(import.meta.dirname, '../../..');
const raizWeb = resolve(import.meta.dirname, '..');
const LIMITE_MS = 300_000;
const PARALELO = 4;

function modulos(pasta: string): string[] {
  const saida: string[] = [];
  for (const item of readdirSync(pasta, { withFileTypes: true })) {
    const caminho = join(pasta, item.name);
    if (item.isDirectory()) saida.push(...modulos(caminho));
    else if (/\.(vue|ts)$/.test(item.name) && !/\.(spec|test|d)\.ts$/.test(item.name)) saida.push(caminho);
  }
  return saida;
}

async function esperarApi(base: string, ate: number): Promise<void> {
  for (;;) {
    try {
      const resposta = await fetch(`${base}/api/saude`);
      if (resposta.ok) return;
    } catch {
      // A API ainda não escuta: tenta de novo.
    }
    if (Date.now() > ate) throw new Error('aquecimento: a API não respondeu /api/saude');
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function transformarTodos(base: string, ate: number): Promise<{ total: number; falhas: number }> {
  const fila = modulos(join(raizWeb, 'src')).map((c) => `/${relative(raizWeb, c).split('\\').join('/')}`);
  const total = fila.length;
  let falhas = 0;
  await Promise.all(
    Array.from({ length: PARALELO }, async () => {
      for (let caminho = fila.shift(); caminho; caminho = fila.shift()) {
        if (Date.now() > ate) throw new Error('aquecimento: os módulos do web não ficaram prontos');
        try {
          const resposta = await fetch(`${base}${caminho}`);
          await resposta.arrayBuffer();
          if (!resposta.ok) falhas += 1;
        } catch {
          falhas += 1;
        }
      }
    }),
  );
  return { total, falhas };
}

async function renderizarEntrada(base: string): Promise<void> {
  const navegador = await chromium.launch({
    channel: 'chrome',
    headless: true,
    env: ambienteDoNavegador(raiz),
  });
  try {
    const pagina = await navegador.newPage({ baseURL: base });
    await pagina.goto('/entrar');
    await pagina.getByTestId('campo-login').waitFor({ state: 'visible', timeout: LIMITE_MS });
  } finally {
    await navegador.close();
  }
}

export default async function aquecer(config: FullConfig): Promise<void> {
  const base = config.projects[0]?.use.baseURL;
  if (!base) throw new Error('aquecimento: baseURL ausente no playwright.config');
  const inicio = Date.now();
  const ate = inicio + LIMITE_MS;
  await esperarApi(base, ate);
  const api = Date.now();
  const { total, falhas } = await transformarTodos(base, ate);
  const web = Date.now();
  await renderizarEntrada(base);
  const fim = Date.now();
  const s = (ms: number): string => (ms / 1000).toFixed(1);
  console.log(
    `aquecimento: api ${s(api - inicio)} s; ${total} módulos do web em ${s(web - api)} s (${falhas} sem 200); ` +
      `entrada renderizada em ${s(fim - web)} s`,
  );
}
