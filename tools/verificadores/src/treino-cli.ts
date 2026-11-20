// pnpm copia:mascarar / pnpm treino:reiniciar (M37, regra 5): a casca de linha de comando de treino.ts. O destino é o
// container de treino do projeto (redesante-fb-treino-<cod>), com AMBIENTE=treino e o método de mascaramento registrado
// pelo dono (TREINO_METODO_MASCARAMENTO; DP-41). Sem isso, sai 3 ("bloqueado") com o motivo. A turma é recriada pelo
// executor (acesso.criarUsuarioIntegracao) no estabelecimento de treino configurado; o verificador lê só as colunas
// pessoais mascaradas, num arquivo temporário apagado no fim.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  ambienteEfetivo,
  caminhoArquivoAmbiente,
  dockerReal,
  lerCatalogoOperacoes,
  lerConfiguracaoNucleo,
  NucleoLegado,
  OPERACOES,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { estadoEm } from '@sgh/contratos';
import { lerArgumentos } from './argumentos.ts';
import { lerSinteticos, procurarDadoReal } from './treino-sem-dado-real.ts';
import {
  ErroTreino,
  lerColunasDaSaida,
  lerListaPessoais,
  mascarar,
  PASSOS_REINICIO,
  planoMascaramento,
  reiniciarTreino,
  SQL_COLUNAS,
} from './treino.ts';

const raiz = resolve(import.meta.dirname, '../../..');
const args = lerArgumentos(process.argv.slice(2));
const acao = args.posicionais[0];

async function principal(): Promise<number> {
  const { env } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
  const hospital = (args.opcoes['hospital'] ?? 'pc').trim();
  const container = args.opcoes['container'] ?? `redesante-fb-treino-${hospital}`;
  const banco = args.opcoes['banco'] ?? env['TREINO_BANCO'] ?? '/firebird/data/treino.fdb';
  const lista = lerListaPessoais(raiz);
  if (args.bandeiras.has('plano')) {
    for (const [i, p] of PASSOS_REINICIO.entries()) console.log(`${i + 1}. ${p}`);
    return 0;
  }
  if (acao === 'mascarar') {
    const r = mascarar({
      container,
      banco,
      ambiente: env['AMBIENTE'],
      metodo: env['TREINO_METODO_MASCARAMENTO'],
      lista,
      docker: dockerReal,
    });
    console.log(`[copia:mascarar] ${r.comandos} coluna(s) mascarada(s) de ${r.colunas} no banco de treino.`);
    return 0;
  }
  if (acao !== 'reiniciar') {
    console.error('Uso: treino-cli.ts mascarar|reiniciar [--hospital=<cod>] [--container=…] [--plano]');
    return 2;
  }
  const turma = (env['TREINO_TURMA'] ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  const passos = await reiniciarTreino({
    container,
    banco,
    retrato: env['TREINO_RETRATO'] ?? '/firebird/retrato/estavel.fbk',
    ambiente: env['AMBIENTE'],
    metodo: env['TREINO_METODO_MASCARAMENTO'],
    turma,
    lista,
    docker: dockerReal,
    async recriarTurma(logins) {
      const nucleo = new NucleoLegado({
        env,
        driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(env).bibliotecaCliente }),
        pastaHomologada: resolve(raiz, 'tools/schema-check/homologado'),
      });
      try {
        const cat = lerCatalogoOperacoes(resolve(raiz, 'docs/operacoes/catalogo'));
        const executor = nucleo.criarExecutor({
          catalogo: {
            estado: (op, h) => {
              const o = cat.operacoes.find((x) => x.nome === op);
              return o ? estadoEm(o, h) : null;
            },
          },
        });
        let n = 0;
        for (const login of logins) {
          await executor.executar(
            OPERACOES['acesso.criarUsuarioIntegracao']!,
            hospital,
            { nome: login, nomeCompleto: `TURMA DE TREINO ${login}` },
            {
              rede: nucleo.rede,
              hospital,
              traceId: 'treino-reiniciar',
              usuarioLegado: 'SGH.TREINO',
              idempotencyKey: `treino-${login}-${Date.now()}`,
            },
          );
          n++;
        }
        return n;
      } finally {
        await nucleo.encerrar();
      }
    },
    async verificar() {
      const r = dockerReal.executar(
        ['exec', '-i', container, 'isql', '-q', '-ch', 'WIN1252', banco],
        SQL_COLUNAS,
      );
      const colunas = planoMascaramento(lerColunasDaSaida(r.saida), lista).length;
      const pasta = mkdtempSync(join(tmpdir(), 'sgh-treino-'));
      try {
        const arquivo = join(pasta, 'amostra.txt');
        const amostra = dockerReal.executar(
          ['exec', '-i', container, 'isql', '-q', '-ch', 'WIN1252', banco],
          `SET LIST ON;\nSELECT FIRST 2000 CAST(CPF AS VARCHAR(20)) V FROM RICADPAC WHERE CPF IS NOT NULL;\nSELECT FIRST 2000 FONE V FROM RICADPAC WHERE FONE IS NOT NULL;\n`,
        );
        writeFileSync(arquivo, amostra.saida);
        const achados = procurarDadoReal(
          amostra.saida,
          'treino',
          lerSinteticos(resolve(raiz, 'tools/verificadores/dados/treino-sinteticos.txt')),
        );
        console.log(
          `[treino-sem-dado-real] ${colunas} coluna(s) pessoais mascaradas; ${achados.length} achado(s).`,
        );
        return achados.length;
      } finally {
        rmSync(pasta, { recursive: true, force: true });
      }
    },
  });
  for (const p of passos) console.log(`  ${p.passo}: ${p.detalhe} (${Math.round(p.ms / 1000)} s)`);
  console.log(
    `[treino:reiniciar] verde em ${Math.round(passos.reduce((t, p) => t + p.ms, 0) / 60_000)} min.`,
  );
  return 0;
}

principal().then(
  (c) => process.exit(c),
  (e: unknown) => {
    const bloqueado = e instanceof ErroTreino && e.bloqueado;
    console.error(
      `[treino] ${bloqueado ? 'bloqueado' : 'erro'}: ${e instanceof Error ? e.message : String(e)}`,
    );
    process.exit(bloqueado ? 3 : 1);
  },
);
