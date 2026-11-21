// pnpm verificar / pnpm verificar:tudo (convencoes.md §13): portões em sequência e resumo final,
// com os marcadores PENDENTE listados para que nenhum seja lido como verde.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  logsDoNpmDoRepositorio,
  mudancas,
  pastasVigiadasComSubpastas,
  retratar,
} from './fora-do-repositorio.ts';
import { listarMarcadores, resumoMarcadores } from './pendentes.ts';

const raiz = resolve(import.meta.dirname, '../../..');
const tudo = process.argv.includes('--tudo');

// Base do `nx affected`: NX_BASE, ou `main` local, ou `origin/main` (clone); sem nenhuma, roda tudo.
function baseAfetados(): string | null {
  const candidatas = [process.env['NX_BASE'], 'main', 'origin/main'].filter((b): b is string => Boolean(b));
  for (const base of candidatas) {
    const r = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${base}^{commit}`], { cwd: raiz });
    if (r.status === 0) return base;
  }
  return null;
}
const base = tudo ? null : baseAfetados();

const portoes: { nome: string; comando: string; args: string[] }[] = [
  tudo
    ? {
        nome: 'nx run-many -t lint typecheck test build',
        comando: 'nx',
        args: ['run-many', '-t', 'lint', 'typecheck', 'test', 'build'],
      }
    : base
      ? {
          nome: `nx affected -t lint typecheck test (base ${base})`,
          comando: 'nx',
          args: ['affected', '-t', 'lint', 'typecheck', 'test', `--base=${base}`],
        }
      : {
          nome: 'nx run-many -t lint typecheck test (sem base git para affected)',
          comando: 'nx',
          args: ['run-many', '-t', 'lint', 'typecheck', 'test'],
        },
  { nome: 'prettier --check', comando: 'prettier', args: ['--check', '.', '--log-level', 'warn'] },
  { nome: 'verificadores:segredos', comando: 'node', args: ['tools/verificadores/src/segredos.ts'] },
  // M03, regra 1: assinaturas, perfis, domínios vistos e resultados sem dado pessoal (sempre, não só no affected).
  { nome: 'verificadores:sem-pessoal', comando: 'node', args: ['tools/verificadores/src/sem-pessoal.ts'] },
  // M37 (regra 5): a massa e o material do treino sem CPF, CNS nem telefone válidos fora da lista sintética.
  {
    nome: 'treino:sem-dado-real',
    comando: 'node',
    args: ['tools/verificadores/src/treino-sem-dado-real.ts'],
  },
  // M04: guardas do legado (SQL legado fora do adaptador, escrita fora do executor, DDL fora de SGH_,
  // trigger e FK proibidos, MAX+1, função em coluna indexada, generator e procedimento com efeito) e, desde
  // o M04, também as colunas de credencial de TBTISS, TBTISSWEBSERV e TBCONVEN (regra 8 do M09).
  { nome: 'guardas:legado', comando: 'node', args: ['tools/verificadores/src/guardas-legado.ts'] },
  // F4 L4: mapa declarativo do conector (tabela sem destino nem descarte justificado, ciclo não declarado,
  // tabela ou coluna de destino inexistente no DDL, regra ou de-para desconhecidos, mapa gerado desatualizado).
  { nome: 'conector:mapa', comando: 'python3', args: ['-I', 'conector/verificar_mapa.py'] },
  // F2.2 lote 02-07 (ADR 0003, itens 5 e 9): sem código de convivência com o sistema de origem (os módulos herdados,
  // as telas "só consulta" por etapa e a liberação por setor). Catraca sobre a linha de base em
  // tools/obra/sem-coexistencia.pendentes; o fechamento da F2.2 roda com --estrito.
  { nome: 'sem-coexistencia', comando: 'bash', args: ['tools/obra/sem-coexistencia.sh'] },
  // M60.2: o pacote de instalação (units, nginx, cliente do banco, modelo do arquivo de ambiente e o anexo de
  // variáveis) igual ao gerado, e o catálogo cobrindo toda variável lida pelo código de produção.
  {
    nome: 'instalacao:gerar --conferir',
    comando: 'node',
    args: [
      '--import',
      './tools/verificadores/src/caminhos-sgh.ts',
      'tools/instalacao/src/gerar.ts',
      '--conferir',
    ],
  },
  // M36 (regra 4 e regra 8): registro de conferência que sustenta cada `conferida` e a matriz do pentest no esquema.
  {
    nome: 'conferencia:verificar',
    comando: 'node',
    args: [
      '--import',
      './tools/verificadores/src/caminhos-sgh.ts',
      'tools/assinatura/src/cli/conferencia.ts',
    ],
  },
  {
    nome: 'pentest:verificar (estrutura)',
    comando: 'node',
    args: ['--import', './tools/verificadores/src/caminhos-sgh.ts', 'tools/assinatura/src/cli/pentest.ts'],
  },
  // M16 (regra 17): data mart sem coluna identificadora (esquema declarado e arquivos carregados).
  {
    nome: 'datamart:verificar',
    comando: 'node',
    args: ['--import', './tools/verificadores/src/caminhos-sgh.ts', 'tools/verificadores/src/datamart.ts'],
  },
  // Textos de produto (decisão do dono, 20/10/2026): i18n, templates .vue e menu sem citar o sistema antigo.
  {
    nome: 'textos-de-produto',
    comando: 'node',
    args: [
      '--import',
      './tools/verificadores/src/caminhos-sgh.ts',
      'tools/verificadores/src/textos-de-produto.ts',
    ],
  },
  // M60: o anexo do manual de implantação cita todos os scripts SGH_ do repositório com o hash atual.
  {
    nome: 'implantacao:listas --conferir',
    comando: 'node',
    args: [
      '--import',
      './tools/verificadores/src/caminhos-sgh.ts',
      'tools/implantacao/src/gerar-listas.ts',
      '--conferir',
    ],
  },
  // M60.3: o manual de implantação tem as 12 seções, cita os itens e as seções dos testes pós-implantação, as variáveis
  // obrigatórias e os anexos, e o PDF foi gerado das fontes atuais.
  {
    nome: 'implantacao:manual --conferir',
    comando: 'node',
    args: [
      '--import',
      './tools/verificadores/src/caminhos-sgh.ts',
      'tools/implantacao/src/gerar-manual.ts',
      '--conferir',
    ],
  },
  // Combos com busca (decisão do dono, 23/10/2026; ADR 0027): nada de <select> cru nem combo da base nas telas.
  { nome: 'combos', comando: 'node', args: ['tools/verificadores/src/combos.ts'] },
  // M59.5 (regras 9 e 10): suíte de conformidade SBIS, matriz requisito → funcionalidade → teste → resultado. No
  // verificar, só a estrutura (as linhas saem "sem execução"); no verificar:tudo (versão candidata), --executar roda os
  // unitários citados e a matriz em dist/sbis/ traz o resultado de fato.
  {
    nome: tudo ? 'sbis:verificar --executar' : 'sbis:verificar (estrutura)',
    comando: 'node',
    args: [
      '--import',
      './tools/verificadores/src/caminhos-sgh.ts',
      'tools/verificadores/src/sbis.ts',
      ...(tudo ? ['--executar'] : []),
    ],
  },
  // M06: catálogo × rotas × opções do legado e a prova dos 42 grupos (sobre o retrato versionado).
  {
    nome: 'permissoes:verificar (retrato)',
    comando: 'node',
    args: [
      '--import',
      './tools/verificadores/src/caminhos-sgh.ts',
      'tools/verificadores/src/permissoes.ts',
      '--retrato',
    ],
  },
  // M08 (regra 11): matriz de cobertura das 1.503 tabelas (retrato versionado das povoadas; sem cópia no CI).
  {
    nome: 'matriz:verificar (retrato)',
    comando: 'node',
    args: ['--import', './tools/verificadores/src/caminhos-sgh.ts', 'tools/matriz/src/cli/verificar.ts'],
  },
];

const vigiadas = pastasVigiadasComSubpastas();
const antes = retratar(vigiadas);

const resultados = portoes.map((p) => {
  console.log(`\n▶ ${p.nome}`);
  const r = spawnSync(p.comando, p.args, {
    cwd: raiz,
    stdio: 'inherit',
    env: { ...process.env, NX_LOAD_DOT_ENV_FILES: 'false' },
  });
  return { nome: p.nome, ok: r.status === 0 };
});

if (tudo) {
  const mudou = mudancas(antes, retratar(vigiadas));
  for (const p of mudou) console.error(`[POL-4] pasta fora do repositório mudou durante a execução: ${p}`);
  resultados.push({
    nome: `nada escrito fora do repositório (${vigiadas.length} pastas globais vigiadas por mtime)`,
    ok: mudou.length === 0,
  });
  const logs = logsDoNpmDoRepositorio(raiz);
  for (const f of logs)
    console.error(
      `[POL-4] log do npm com cwd neste repositório (execução fora do ./pnpm): ~/.npm/_logs/${f}`,
    );
  resultados.push({ nome: 'nenhum log do npm deste repositório em ~/.npm/_logs', ok: logs.length === 0 });
}

const pacote = JSON.parse(readFileSync(resolve(raiz, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};
console.log(`\n══ Resumo de pnpm ${tudo ? 'verificar:tudo' : 'verificar'} ══`);
for (const r of resultados) console.log(`  ${r.ok ? 'verde   ' : 'VERMELHO'}  ${r.nome}`);
console.log(resumoMarcadores(listarMarcadores(pacote.scripts)));
const ok = resultados.every((r) => r.ok);
console.log(
  ok ? 'Resultado: verde (portões reais); os PENDENTE acima não foram verificados.' : 'Resultado: VERMELHO',
);
process.exit(ok ? 0 : 1);
