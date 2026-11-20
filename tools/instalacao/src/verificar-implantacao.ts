// pnpm implantacao:verificar -- [--endereco=https://<domínio>] [--hospital=<código>] [--versao=<identificação>]
//                                [--relatorio=<arquivo.md>] [--ca=<certificado.pem> | --sem-ca] [--sem-http]
//                                [--ambiente=<sante.env>] [--json]
// No servidor instalado (como root, porque lê o sante.env 0600):
//   cd /opt/sante-sgh/atual && ./node/bin/node --import ./tools/verificadores/src/caminhos-sgh.ts \
//     tools/instalacao/src/verificar-implantacao.ts --relatorio=/var/log/sante-sgh/verificacao.md
// M60, etapa 3 (entrega 4): a fumaça pós-implantação, só leitura, com relatório. Os padrões vêm do servidor: o domínio
// e o certificado de /etc/sante-sgh/instalacao.env, o segredo das sondas e os estabelecimentos do sante.env, a versão
// esperada do manifesto da versão ativa. Saída: 0 sem falha (alerta não reprova), 1 com falha, 2 erro de uso.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { esquemaRelatorioVerificacao } from '@sgh/contratos';
import { itensDaVerificacao, piorSituacao, relatorioEmMarkdown, type UnidadeLida } from '@sgh/dominio-config';
import { caminhos, LAYOUT } from './artefatos.ts';
import { ARQUIVO_MANIFESTO } from './arvore.ts';
import { clienteHttpNode, coletar, lerArgumentos, lerArquivoEnv, montarPedido } from './verificacao.ts';

const raiz = resolve(import.meta.dirname, '../../..');

function systemctl(nome: string): Promise<string | null> {
  return new Promise((ok) => {
    execFile('systemctl', ['is-active', nome], { timeout: 10_000 }, (erro, saida) => {
      const e = erro as (NodeJS.ErrnoException & { code?: unknown }) | null;
      if (e && e.code === 'ENOENT') return ok(null);
      ok(String(saida ?? '').trim() || 'desconhecido');
    });
  });
}

async function lerUnidades(nomes: readonly string[]): Promise<UnidadeLida[] | null> {
  // Fora do servidor (sem a pasta /etc do produto) os serviços não são conferidos: o item sai em alerta.
  if (!existsSync(LAYOUT.etc)) return null;
  return Promise.all(nomes.map(async (nome) => ({ nome, estado: await systemctl(nome) })));
}

function identificacaoDoManifesto(): string | null {
  const p = join(raiz, ARQUIVO_MANIFESTO);
  if (!existsSync(p)) return null;
  try {
    const m = JSON.parse(readFileSync(p, 'utf8')) as { resumo?: { identificacao?: unknown } };
    return typeof m.resumo?.identificacao === 'string' ? m.resumo.identificacao : null;
  } catch {
    return null;
  }
}

async function principal(): Promise<number> {
  let args: ReturnType<typeof lerArgumentos>;
  let pedido: ReturnType<typeof montarPedido>;
  try {
    args = lerArgumentos(process.argv.slice(2));
    const arquivoAmbiente = args.opcoes['ambiente'] ?? caminhos().ambiente;
    const doArquivo = lerArquivoEnv(arquivoAmbiente);
    pedido = montarPedido({
      opcoes: args.opcoes,
      bandeiras: args.bandeiras,
      // O processo prevalece sobre o arquivo (na obra, o ambiente do E2E ou do ensaio).
      ambiente: { ...doArquivo, ...process.env },
      instalacao: lerArquivoEnv(join(LAYOUT.etc, 'instalacao.env')),
      identificacaoDoManifesto: identificacaoDoManifesto(),
      lerCa: (c) => readFileSync(c),
    });
  } catch (e) {
    console.error(e instanceof Error ? e.message : 'Argumentos inválidos.');
    return 2;
  }
  const inicio = Date.now();
  const coleta = await coletar(pedido, clienteHttpNode, lerUnidades);
  const itens = itensDaVerificacao(coleta);
  const relatorio = esquemaRelatorioVerificacao.parse({
    hospital: pedido.hospital,
    endereco: pedido.endereco,
    em: new Date(inicio).toISOString(),
    duracaoMs: Date.now() - inicio,
    versaoEsperada: pedido.versaoEsperada,
    itens,
    situacao: piorSituacao(itens),
  });
  const md = relatorioEmMarkdown(relatorio);
  if (args.opcoes['relatorio']) writeFileSync(args.opcoes['relatorio'], md, { mode: 0o640 });
  if (args.bandeiras.has('json')) console.log(JSON.stringify(relatorio, null, 1));
  else
    for (const i of relatorio.itens)
      console.log(
        `${i.situacao === 'ok' ? 'OK    ' : i.situacao === 'alerta' ? 'ALERTA' : 'FALHA '} ${i.titulo}: ${i.detalhe}`,
      );
  console.log(
    `Resultado: ${relatorio.situacao.toUpperCase()} (${itens.filter((i) => i.situacao === 'ok').length} de ${itens.length} OK)` +
      (args.opcoes['relatorio'] ? `; relatório em ${args.opcoes['relatorio']}` : ''),
  );
  return relatorio.situacao === 'falha' ? 1 : 0;
}

process.exitCode = await principal();
