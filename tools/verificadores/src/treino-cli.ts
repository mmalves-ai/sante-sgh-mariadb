// pnpm copia:mascarar / pnpm treino:reiniciar (M37, regra 5): a casca de linha de comando de treino.ts. O destino é o
// container de treino do projeto (redesante-fb-treino-<cod>), com AMBIENTE=treino e o método de mascaramento registrado
// pelo dono (TREINO_METODO_MASCARAMENTO; DP-41). Sem isso, sai 3 ("bloqueado") com o motivo.
// O treino de verdade é o cliente de treino do banco próprio (`treino_<cod>`, ou --cliente=treino_…), carregado pelo
// conector a partir da imagem mascarada. Enquanto essa ponte não existir, o reinício SAI 3 (bloqueado) antes de qualquer
// passo, dizendo que imagem e banco próprio não se encontram; e nunca anuncia "verde" sem uma carga concluída do
// conector, a partir da imagem de treino, depois do reinício. A turma (treino-turma.ts) vai ao estabelecimento de treino
// (--estabelecimento=<código> ou TREINO_ESTABELECIMENTO) com a senha inicial do ambiente (TREINO_SENHA_INICIAL; nunca
// impressa, só o resumo argon2id é gravado). O verificador de dado real lê o banco próprio de treino (CPF e telefone),
// nunca a tabela de origem.
// Melhoria: a turma é recriada no banco próprio, por operação idempotente por login, com acesso ao estabelecimento,
//   credencial inicial e validade (treino-turma.ts).
// Melhoria: nenhuma leitura de tabela de origem aqui (regra 3: só o conector lê a origem); o "verde" exige a carga.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cifrarSenha } from '@sgh/dominio-acesso';
import { ambienteEfetivo, caminhoArquivoAmbiente, NucleoProprio } from '@sgh/nucleo';
import { lerArgumentos } from './argumentos.ts';
import { lerSinteticos, procurarDadoReal } from './treino-sem-dado-real.ts';
import {
  ErroTreino,
  lerListaPessoais,
  mascarar,
  PASSOS_REINICIO,
  reiniciarTreino,
  type ExecutorTreino,
} from './treino.ts';
import { CLIENTE_TREINO, recriarTurmaTreino } from './treino-turma.ts';

/** Docker real (o falso fica nos testes de treino.ts). */
const dockerReal: ExecutorTreino = {
  executar(argumentos, entrada) {
    const r = spawnSync('docker', [...argumentos], {
      input: entrada,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
    return { codigo: r.status ?? 1, saida: r.stdout ?? '', erro: r.stderr ?? '' };
  },
};

/** Situações de lote de carga que contam como carregado. */
const CARGA_CONCLUIDA = ['concluido', 'concluido_com_rejeicoes'];

/** A última carga concluída do conector, no cliente de treino, a partir da imagem de treino (null se nenhuma). */
async function ultimaCargaDaImagem(
  nucleo: NucleoProprio,
  cliente: string,
  imagem: string,
): Promise<number | null> {
  const l = await nucleo.lerSomente({ cliente, correlacao: 'treino-reiniciar' }, (x) =>
    x.uma<{ fim: Date | string | null } & Record<string, unknown>>(
      `SELECT MAX(fim_em) AS fim FROM lote_carga_legado
        WHERE situacao IN (?, ?) AND imagem_origem = ? AND excluido_em IS NULL`,
      [...CARGA_CONCLUIDA, imagem],
    ),
  );
  return l?.fim ? new Date(l.fim).getTime() : null;
}

const raiz = resolve(import.meta.dirname, '../../..');
const args = lerArgumentos(process.argv.slice(2));
const acao = args.posicionais[0];

async function principal(): Promise<number> {
  const { env } = ambienteEfetivo(process.env, caminhoArquivoAmbiente(process.env, raiz));
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
  const cliente = (args.opcoes['cliente'] ?? `treino_${hospital}`).trim();
  if (!CLIENTE_TREINO.test(cliente))
    throw new ErroTreino(`Recusado: ${cliente} não é cliente de treino (treino_<código>).`);
  const codigoEst = (args.opcoes['estabelecimento'] ?? env['TREINO_ESTABELECIMENTO'] ?? '').trim();
  const senha = env['TREINO_SENHA_INICIAL'] ?? '';
  if (!codigoEst || senha.length < 12)
    throw new ErroTreino(
      'Bloqueado: falta o estabelecimento de treino (--estabelecimento ou TREINO_ESTABELECIMENTO) ou a senha inicial da turma (TREINO_SENHA_INICIAL, 12+ caracteres, no cofre/ambiente de treino).',
      true,
    );
  const nucleo = new NucleoProprio();
  try {
    const est = await nucleo.lerSomente({ cliente, correlacao: 'treino-reiniciar' }, (l) =>
      l.uma<{ id: number } & Record<string, unknown>>(
        'SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
        [codigoEst],
      ),
    );
    if (!est)
      throw new ErroTreino(`Bloqueado: estabelecimento ${codigoEst} não existe no cliente ${cliente}.`, true);
    // A ponte imagem mascarada -> banco próprio é do conector. Sem carga dele a partir da imagem de treino, a turma
    // (banco próprio) e a massa mascarada (imagem) ficariam em mundos diferentes: bloqueado antes de qualquer passo.
    if ((await ultimaCargaDaImagem(nucleo, cliente, container)) === null)
      throw new ErroTreino(
        `Bloqueado: o cliente ${cliente} nunca foi carregado pelo conector a partir da imagem de treino ${container}. ` +
          'O reinício restauraria e mascararia a imagem, mas a turma e o treino rodam no banco próprio: os dois não se ' +
          'encontram. Carregue o cliente de treino pelo conector (pedido de redesenho registrado) antes de reiniciar.',
        true,
      );
    const inicio = Date.now();
    const resumo = await cifrarSenha(senha);
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
        const s = await recriarTurmaTreino(nucleo.criarExecutor(), cliente, {
          estabelecimento: Number(est.id),
          logins,
          resumoSenha: resumo,
        });
        return Number(s.resultado.criados) + Number(s.resultado.reativados);
      },
      async verificar() {
        // O banco próprio de treino: CPF e telefone das pessoas (o que o conector carregou da imagem mascarada).
        const amostra = await nucleo.lerSomente({ cliente, correlacao: 'treino-reiniciar' }, async (l) => {
          const cpfs = await l.consultar<{ v: string } & Record<string, unknown>>(
            'SELECT cpf AS v FROM pessoa_fisica WHERE cpf IS NOT NULL AND excluido_em IS NULL LIMIT 2000',
          );
          const fones = await l.consultar<{ v: string } & Record<string, unknown>>(
            "SELECT CONCAT(COALESCE(ddd, ''), numero) AS v FROM telefone_pessoa WHERE excluido_em IS NULL LIMIT 2000",
          );
          return [...cpfs, ...fones].map((x) => `V ${String(x.v)}`).join('\n');
        });
        const pasta = mkdtempSync(join(tmpdir(), 'sgh-treino-'));
        try {
          writeFileSync(join(pasta, 'amostra.txt'), amostra);
          const achados = procurarDadoReal(
            amostra,
            'treino',
            lerSinteticos(resolve(raiz, 'tools/verificadores/dados/treino-sinteticos.txt')),
          );
          console.log(`[treino-sem-dado-real] banco próprio ${cliente}: ${achados.length} achado(s).`);
          return achados.length;
        } finally {
          rmSync(pasta, { recursive: true, force: true });
        }
      },
    });
    for (const p of passos) console.log(`  ${p.passo}: ${p.detalhe} (${Math.round(p.ms / 1000)} s)`);
    const carga = await ultimaCargaDaImagem(nucleo, cliente, container);
    if (carga === null || carga < inicio)
      throw new ErroTreino(
        `Bloqueado: a imagem ${container} foi reiniciada e mascarada, mas o cliente ${cliente} ainda não foi recarregado ` +
          'pelo conector a partir dela; sem essa carga o treino não está verde.',
        true,
      );
    console.log(
      `[treino:reiniciar] verde em ${Math.round(passos.reduce((t, p) => t + p.ms, 0) / 60_000)} min.`,
    );
    return 0;
  } finally {
    await nucleo.encerrar();
  }
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
