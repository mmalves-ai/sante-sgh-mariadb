// pnpm liberacao:ligar-tudo [-- --cliente=<cod>] [--hospital=<cod>] [--so-listar] [--reverter] [--referencia="<linha>"] [--incluir=<a,b>]
// M61 (ADR 0034; decisão do dono de 30/10/2026: liberação full na instalação). Liga, no estabelecimento inteiro, todas
// as chaves de liberação (os recursos e as operações do catálogo do produto), menos as listas de exceção versionadas em
// @sgh/contratos (liberacao-full.ts), e registra os pré-requisitos (a aprovação de setor dispensada em todo ambiente;
// contrato, certificado e credenciamento só em dev/ci). Grava pelo mesmo caminho da tela de chaves, sobre o banco
// próprio do cliente (liberacao-propria.ts: um lote por chave, ligada_antes e a trilha na mesma transação, pelo
// Executor), com as mesmas conferências; recusa vira pendência no relatório e não para as outras. Ator TERMINAL na
// trilha (sem senha: quem roda tem o terminal do servidor e o arquivo de ambiente). Nunca toca permissão por login.
//   --cliente=<cod>     o cliente (banco cliente_<cod>); padrão: CLIENTE_PADRAO do arquivo de ambiente
//   --hospital=<cod>    só este estabelecimento (padrão: todos os ativos do cliente)
//   --so-listar         o plano, sem gravar (leitura)
//   --reverter          desfaz os lotes com a marca LIBERACAO-FULL, do mais novo ao mais antigo, e devolve ao registro
//                       de antes (guardado na evidência da dispensa) os pré-requisitos que o comando dispensou
//   --referencia="..."  a linha de ESTADO.md › Autorizações (obrigatória fora de dev/ci)
//   --incluir=<a,b>     fora de dev/ci, liga também estas chaves da lista de decisão do dono em produção
// Fora de produção, só o banco de desenvolvimento em loopback. Saída só com chaves e contagens (nenhum login, nenhum
// dado de pessoa).
// Melhoria: os estabelecimentos vêm do banco do cliente (estabelecimento ativo), não de uma lista no arquivo de ambiente.
// Melhoria: o catálogo das operações é o do produto (o mesmo da tela de liberação), não um diretório de arquivos.
import { resolve } from 'node:path';
import { ambienteEfetivo, caminhoArquivoAmbiente, ehLoopback, NucleoProprio } from '@sgh/nucleo';
import { catalogoOperacoesProprio } from '../../../apps/api/src/modulos/config/catalogo-operacoes.ts';
import { codigoDeSaida, executarLiberacaoFull, relatorioEmTexto } from './liberacao-full.ts';
import { PortaLiberacaoPropria } from './liberacao-propria.ts';

const raiz = resolve(import.meta.dirname, '../../..');

export function argumentosLiberacao(argv: readonly string[]): {
  cliente?: string;
  hospital: string | null;
  soListar: boolean;
  reverter: boolean;
  referencia: string | null;
  incluir: string[];
} {
  const opcoes: Record<string, string> = {};
  const bandeiras = new Set<string>();
  for (const a of argv) {
    const m = /^--([a-z][a-z0-9-]*)(?:=(.*))?$/s.exec(a);
    if (!m?.[1]) throw new Error(`Argumento não reconhecido: ${a.slice(0, 40)}`);
    if (m[2] === undefined) bandeiras.add(m[1]);
    else opcoes[m[1]] = m[2];
  }
  for (const b of bandeiras)
    if (!['so-listar', 'reverter'].includes(b)) throw new Error(`Opção desconhecida: --${b}`);
  for (const k of Object.keys(opcoes))
    if (!['cliente', 'hospital', 'referencia', 'incluir'].includes(k)) throw new Error(`Opção desconhecida: --${k}`);
  const cliente = opcoes['cliente']?.trim();
  return {
    ...(cliente ? { cliente } : {}),
    hospital: opcoes['hospital']?.trim() || null,
    soListar: bandeiras.has('so-listar'),
    reverter: bandeiras.has('reverter'),
    referencia: opcoes['referencia']?.trim() || null,
    incluir: (opcoes['incluir'] ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  };
}

async function principal(): Promise<number> {
  const a = argumentosLiberacao(process.argv.slice(2));
  const { env } = ambienteEfetivo(process.env, caminhoArquivoAmbiente(process.env, raiz));
  const cliente = a.cliente ?? env['CLIENTE_PADRAO']?.trim() ?? '';
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(cliente))
    throw new Error('Informe o cliente: --cliente=<codigo> ou CLIENTE_PADRAO (o banco é cliente_<codigo>).');
  const ambiente = env['AMBIENTE']?.trim() ?? '';
  if (!ambiente) throw new Error('AMBIENTE não definido no arquivo de ambiente.');
  const nucleo = new NucleoProprio({ env });
  try {
    if (ambiente !== 'producao' && !ehLoopback(nucleo.configuracao.host))
      throw new Error('Fora de produção, só o banco de desenvolvimento em loopback.');
    const correlacao = `liberacao-full-${Date.now().toString(36)}`;
    const porta = new PortaLiberacaoPropria(nucleo, cliente, correlacao);
    const configurados = await porta.estabelecimentos();
    const hospitais = a.hospital ? [a.hospital] : configurados;
    for (const h of hospitais)
      if (!configurados.includes(h)) throw new Error(`Estabelecimento "${h}" não está ativo neste cliente.`);
    const catalogo = catalogoOperacoesProprio();
    const r = await executarLiberacaoFull(
      {
        ambiente,
        hospitais,
        operacoes: catalogo.operacoes().map((o) => o.nome),
        estadoEfetivo: (op, h) => catalogo.estado(op, h),
        referencia: a.referencia,
        incluir: a.incluir,
        soListar: a.soListar,
        agora: new Date(),
      },
      porta,
      a.reverter ? 'reverter' : 'ligar',
    );
    console.log(relatorioEmTexto(r, a.soListar));
    return codigoDeSaida(r);
  } finally {
    await nucleo.encerrar();
  }
}

if (import.meta.main) {
  principal().then(
    (rc) => process.exit(rc),
    (e: unknown) => {
      console.error(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      process.exit(1);
    },
  );
}
