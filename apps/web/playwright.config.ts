import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';
import {
  ESTABELECIMENTO_FORA_E2E,
  ESTABELECIMENTO_REDE_E2E,
  FACHADA_TOKEN_E2E,
  PRODUTO_NOME_E2E,
} from './e2e/ambiente.js';
import { ambienteDoNavegador } from './e2e/navegador.js';

const raiz = resolve(import.meta.dirname, '../..');
// E2E_PORTAS=<web>:<api> (ex.: 5312:3312): sobe só api e web nessas portas (sem o worker), para rodar o E2E de
// um worktree com o dev do dono no ar nas portas padrão (3300/5300). Sem a variável, o comportamento de sempre.
const portas = /^(\d{4,5}):(\d{4,5})$/.exec(process.env['E2E_PORTAS'] ?? '');
const portaWeb = portas?.[1] ?? '5300';
const portaApi = portas?.[2] ?? '3300';
// M35: com E2E_PORTAS, as filas no Valkey com prefixo próprio (o worker do `pnpm dev` do dono não consome os jobs do
// E2E: antes, o e-mail do envio agendado e o alerta da quebra de vidro não chegavam ao Mailpit).
const filas = portas ? { FILAS_PREFIXO: `sgh-e2e${portaApi}` } : {};

// Google Chrome da VM (channel 'chrome'): nenhum navegador baixado (POL-4).
export default defineConfig({
  testDir: 'e2e',
  // A regressão visual do catálogo e a fumaça da instância instalada têm configuração própria
  // (playwright.catalogo.config.ts e playwright.instalado.config.ts).
  testIgnore: ['catalogo-visual.spec.ts', 'm60-3-instalado.spec.ts'],
  outputDir: 'test-results',
  reporter: [['list']],
  forbidOnly: true,
  globalTeardown: './e2e/encerrar.ts',
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${portaWeb}`,
    channel: 'chrome',
    headless: true,
    trace: 'off',
    // O relógio das estações é o do estabelecimento (as portas em memória e o servidor usam America/Sao_Paulo); sem
    // isso, o navegador mínimo roda em UTC e, das 21 h às 24 h, a data padrão das telas já é a do dia seguinte.
    timezoneId: 'America/Sao_Paulo',
    // Ambiente mínimo, HOME/XDG_* em .tmp/ e TMPDIR curto o bastante para o socket do Chrome.
    launchOptions: { env: ambienteDoNavegador(raiz) },
  },
  webServer: [
    {
      // Sobe api + web + worker pelo mesmo comando de desenvolvimento; pronto quando a API responde pelo proxy.
      command: portas
        ? `${raiz}/pnpm exec nx run-many -t serve -p api web --parallel=2 --outputStyle=stream`
        : `${raiz}/pnpm dev`,
      cwd: raiz,
      url: `http://127.0.0.1:${portaWeb}/api/saude`,
      reuseExistingServer: false,
      timeout: 240_000,
      // SIGTERM para o Nx encerrar api, web e worker (com SIGKILL os filhos do Nx ficariam órfãos).
      gracefulShutdown: { signal: 'SIGTERM', timeout: 15_000 },
      // No CI a saída da API e do worker vai para o log (diagnóstico); localmente, silêncio.
      stdout: process.env['CI'] ? 'pipe' : 'ignore',
      stderr: 'pipe',
      // ACESSO_SINTETICO_INDISPONIVEL: estabelecimento sintético fora do ar no seletor (E2E do "indisponível").
      // M06: Valkey e Mailpit do Compose (loopback) para a fila email do alerta da quebra de vidro.
      env: {
        PRODUTO_NOME: PRODUTO_NOME_E2E,
        // O E2E é autossuficiente (esteira sem .env): sem AMBIENTE a API não sobe, e sem REDE_PADRAO o loopback não
        // pertence a rede nenhuma (a sessão sintética fica sem estabelecimento). Valores sintéticos, só se faltarem.
        AMBIENTE: process.env['AMBIENTE'] ?? 'ci',
        REDE_PADRAO: process.env['REDE_PADRAO'] ?? 'rede-e2e',
        // Sem ESTABELECIMENTOS a fonte sintética não tem estabelecimento disponível: a tela de entrada mostra só
        // "Nenhum estabelecimento disponível" e todo spec que entra pelo formulário espera o campo até o timeout. Os
        // códigos sintéticos são os do .env.example (pc e hs); o entrar.spec entra direto em 'pc'.
        ESTABELECIMENTOS: process.env['ESTABELECIMENTOS'] ?? 'pc,hs',
        ACESSO_SINTETICO_INDISPONIVEL: ESTABELECIMENTO_FORA_E2E,
        // M06 (revisão): com a cópia em dev, a sessão sintética só com a marca explícita.
        SESSAO_SINTETICA: 'sim',
        // M11: o E2E é sempre sobre a fonte sintética (a porta do cadastro em memória), nunca a cópia.
        ACESSO_FONTE_DEV: 'sintetica',
        // M57 (etapa 1): o segundo estabelecimento SINTÉTICO da rede (só o MPI da Rede em memória o usa).
        REDE_SINTETICA_SEGUNDO: ESTABELECIMENTO_REDE_E2E,
        VALKEY_URL: process.env['VALKEY_URL'] ?? 'redis://127.0.0.1:63718',
        SMTP_URL: process.env['SMTP_URL'] ?? 'smtp://127.0.0.1:1325',
        // M16: a "gravação por fora" do E2E do painel de leitos (o outro sistema internando), só na fonte sintética.
        LEITOS_SINTETICOS_POR_FORA: resolve(raiz, '.tmp/e2e-leitos-por-fora.json'),
        // M19: a "chamada por fora" do E2E da recepção (outro terminal chama uma senha), só na fonte sintética.
        RECEPCAO_SINTETICA_POR_FORA: resolve(raiz, '.tmp/e2e-recepcao-por-fora.json'),
        // M39: a "marcação por fora" do E2E da onda 1 (o outro terminal ocupa o horário), só na fonte sintética.
        AGENDA_SINTETICA_POR_FORA: resolve(raiz, '.tmp/e2e-agenda-por-fora.json'),
        // M25: a "gravação por fora" do E2E da enfermagem (a prescrição suspensa entre a leitura e o registrar).
        ENFERMAGEM_SINTETICA_POR_FORA: resolve(raiz, '.tmp/e2e-enfermagem-por-fora.json'),
        // M44 (etapa 2): o relógio do NIR em memória avança pelo arquivo (a reserva expira, a alta prevista vence).
        NIR_SINTETICO_POR_FORA: resolve(raiz, '.tmp/e2e-nir-por-fora.json'),
        VIGIA_MUDANCAS_MS: '1000',
        // W1-01 (revisão, achado 6): a troca da própria senha pelo novo (porta em memória no E2E) e dois vínculos
        // sintéticos para a tela do RH.
        ACESSO_TROCA_SENHA_PELO_NOVO: 'sim',
        RH_SINTETICO_SEMEAR: 'sim',
        // W0-10 (11d2b): a vigia do valor crítico também na fonte sintética (escalonamento no prazo e a notificação do
        // crítico ao médico externo, que roda onde roda a vigia).
        SADT_VIGIA_CRITICOS: 'sintetica',
        WEB_PORTA: portaWeb,
        API_PORTA: portaApi,
        // M34: a base do link do "enviar agora" (nunca o Origin do pedido).
        WEB_ENDERECO: `http://127.0.0.1:${portaWeb}`,
        // M49 (etapa 3): o agente local A1/A3 das estações; no E2E, o teste responde por ele (page.route) com o agente
        // simulado da API (só dev/ci). Nenhum processo escuta nesta porta.
        ASSINATURA_AGENTE_LOCAL_URL: 'http://127.0.0.1:47999',
        // M58 (etapa 4): a chave principal SINTÉTICA da fachada da API de integração (o E2E faz as vezes do Squad).
        FACHADA_API_TOKEN: FACHADA_TOKEN_E2E,
        ...filas,
      },
    },
    // M34: com E2E_PORTAS (o dev do dono no ar), um worker deste worktree só com a fila nova do envio de relatório
    // (WORKER_SERVICOS=relatorio-envio: não disputa as filas nem o banco do worker do dono; sem ler os vencidos da
    // cópia). Ele entrega o e-mail com o link no Mailpit, como o worker completo faria.
    ...(portas
      ? [
          {
            command: `${raiz}/pnpm exec nx run worker:serve --outputStyle=stream`,
            cwd: raiz,
            wait: { stdout: /worker no ar/ },
            reuseExistingServer: false,
            timeout: 240_000,
            gracefulShutdown: { signal: 'SIGTERM' as const, timeout: 15_000 },
            stdout: 'pipe' as const,
            stderr: 'pipe' as const,
            env: {
              // M35: também o e-mail (o alerta da quebra de vidro), nas filas próprias do E2E.
              WORKER_SERVICOS: 'relatorio-envio,email',
              ...filas,
              RELATORIO_ENVIO_VENCIDOS: 'desligado',
              ACESSO_FONTE_DEV: 'sintetica',
              VALKEY_URL: process.env['VALKEY_URL'] ?? 'redis://127.0.0.1:63718',
              SMTP_URL: process.env['SMTP_URL'] ?? 'smtp://127.0.0.1:1325',
              WEB_ENDERECO: `http://127.0.0.1:${portaWeb}`,
            },
          },
        ]
      : []),
  ],
});
