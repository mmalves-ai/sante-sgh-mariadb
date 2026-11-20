// pnpm liberacao:ligar-tudo [-- --hospital=<cod>] [--so-listar] [--reverter] [--referencia="<linha>"] [--incluir=<a,b>]
// M61 (ADR 0034; decisão do dono de 30/10/2026: liberação full na instalação). Liga, no estabelecimento inteiro, todas
// as chaves de liberação (os recursos e as operações do catálogo), menos as listas de exceção versionadas em
// @sgh/contratos (liberacao-full.ts), e registra os pré-requisitos (a aprovação de setor dispensada em todo ambiente;
// contrato, certificado e credenciamento só em dev/ci). Grava pelo caminho da tela de chaves (aplicarLoteLiberacao: um
// lote por chave, LIGADA_ANTES e a trilha na mesma transação), com as mesmas conferências; recusa vira pendência no
// relatório e não para as outras. Ator TERMINAL na trilha (sem senha: quem roda tem o terminal do servidor e o arquivo de
// ambiente). Nunca toca permissão por login (SGH_ACESSO_*, TBPERUSU, TBGRUUSU) nem o painel de migração.
//   --hospital=<cod>    só este estabelecimento (padrão: todos os de ESTABELECIMENTOS)
//   --so-listar         o plano, sem gravar (leitura)
//   --reverter          desfaz os lotes com a marca LIBERACAO-FULL, do mais novo ao mais antigo, e devolve ao registro
//                       de antes (guardado na evidência da dispensa) os pré-requisitos que o comando dispensou
//   --referencia="..."  a linha de ESTADO.md › Autorizações (obrigatória fora de dev/ci)
//   --incluir=<a,b>     fora de dev/ci, liga também estas chaves da lista de decisão do dono em produção
// Fora de produção, só a cópia do projeto em loopback e com a trava COMPARTILHADA da cópia, a da pasta das travas da
// obra: /home/mmalves/workspace/redesante/obra-sgh/travas/com-copia.sh --as-duas ./pnpm liberacao:ligar-tudo (nunca o
// modelo versionado em planejamento/obra, que travaria outro arquivo; a conferência da trava o recusa). Depois de cada
// restauração da cópia de dev, rode de novo. Saída só com chaves e contagens (nenhum login, nenhum dado de pessoa).
import { resolve } from 'node:path';
import {
  ATOR_TERMINAL_LIBERACAO,
  CHAVE_PRESCRICAO_ONDA2,
  DIAS_PRESCRICAO_EM_USO,
  EVENTOS_AUDITAVEIS,
  MARCA_LIBERACAO_FULL,
} from '@sgh/contratos';
import { motivoLigarRegraFarmacia } from '@sgh/dominio-config';
import {
  aplicarLoteLiberacao,
  ambienteEfetivo,
  caminhoArquivoAmbiente,
  contarLinhasLiberacao,
  exigirTravaDaCopia,
  fonteCatalogo,
  gravarPrerequisito,
  lerCatalogoOperacoes,
  lerChavesLiberacao,
  lerCodigos,
  lerConfiguracaoNucleo,
  lerEstabelecimentos,
  lerLotesComMarca,
  lerPrerequisitos,
  NucleoLegado,
  pastaResultadosDoCatalogo,
  PORTAS_OCUPADAS,
  prescricoesDoNovoPorUnidade,
  relogioEstoque,
  unidadesAtendidasPorLocal,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import {
  codigoDeSaida,
  executarLiberacaoFull,
  type PortaLiberacaoFull,
  relatorioEmTexto,
} from './liberacao-full.ts';

const raiz = resolve(import.meta.dirname, '../../..');

export function argumentosLiberacao(argv: readonly string[]): {
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
    if (!['hospital', 'referencia', 'incluir'].includes(k)) throw new Error(`Opção desconhecida: --${k}`);
  return {
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
  const { env } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
  const ambiente = env['AMBIENTE']?.trim() ?? '';
  if (!ambiente) throw new Error('AMBIENTE não definido no arquivo de ambiente.');
  const configurados = lerCodigos(env);
  const hospitais = a.hospital ? [a.hospital] : configurados;
  for (const h of hospitais)
    if (!configurados.includes(h)) throw new Error(`Estabelecimento "${h}" não está em ESTABELECIMENTOS.`);
  if (ambiente !== 'producao') {
    for (const e of lerEstabelecimentos(env).filter((x) => hospitais.includes(x.codigo)))
      if (!['127.0.0.1', 'localhost', '::1'].includes(e.host) || PORTAS_OCUPADAS.includes(e.porta))
        throw new Error(
          'Fora de produção, só a cópia do projeto em loopback (nunca o banco de outro projeto).',
        );
    if (!a.soListar) exigirTravaDaCopia();
  }
  const caminhoCatalogo = resolve(raiz, env['CATALOGO_OPERACOES'] ?? 'docs/operacoes/catalogo');
  const catalogo = lerCatalogoOperacoes(caminhoCatalogo);
  const efetivo = fonteCatalogo(catalogo, { pastaResultados: pastaResultadosDoCatalogo(caminhoCatalogo) });
  const nucleo = new NucleoLegado({
    env,
    driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(env).bibliotecaCliente }),
    pastaHomologada: resolve(raiz, env['SCHEMA_HOMOLOGADO_DIR'] ?? 'tools/schema-check/homologado'),
    aviso: (m) => console.warn(`[aviso] ${m}`),
  });
  const correlacao = `liberacao-full-${Date.now().toString(36)}`;
  const ctx = (hospital: string) => ({ rede: nucleo.rede, hospital, traceId: correlacao });
  const trilha = (hospital: string, evento: string, operacao: string) => ({
    rede: nucleo.rede,
    hospital,
    usuario: ATOR_TERMINAL_LIBERACAO,
    evento,
    recurso: 'config.liberacao',
    operacao,
    chaveNaturalAlvo: null,
    resultado: 'sucesso',
    estacao: ATOR_TERMINAL_LIBERACAO,
    correlacao,
  });
  const porta: PortaLiberacaoFull = {
    contarLinhas: (h) => nucleo.lerSomente(ctx(h), (l) => contarLinhasLiberacao(l, h)),
    chaves: (h) => nucleo.lerSomente(ctx(h), (l) => lerChavesLiberacao(l, h)),
    prerequisitos: (h) => nucleo.lerSomente(ctx(h), (l) => lerPrerequisitos(l, h)),
    lotesMarcados: (h) => nucleo.lerSomente(ctx(h), (l) => lerLotesComMarca(l, h, MARCA_LIBERACAO_FULL)),
    aplicarLotes: (h, pedidos, evento) =>
      nucleo.gravarSgh(ctx(h), async (e) => {
        const r: { lote: string; alteradas: number }[] = [];
        for (const p of pedidos)
          r.push(
            await aplicarLoteLiberacao(
              e,
              {
                hospital: h,
                tipo: p.tipo,
                chave: p.chave,
                planejar: p.planejar,
                justificativa: p.justificativa,
                autor: ATOR_TERMINAL_LIBERACAO,
                referenciaAutorizacao: p.referencia,
              },
              evento === 'alterada'
                ? trilha(h, EVENTOS_AUDITAVEIS.liberacaoAlterada.codigo, 'config.ligarTudo')
                : trilha(h, EVENTOS_AUDITAVEIS.liberacaoRevertida.codigo, 'config.reverterLigarTudo'),
            ),
          );
        return r;
      }),
    gravarPrerequisito: (h, p) =>
      nucleo.gravarSgh(ctx(h), (e) =>
        gravarPrerequisito(
          e,
          { hospital: h, ...p, autor: ATOR_TERMINAL_LIBERACAO },
          trilha(h, EVENTOS_AUDITAVEIS.prerequisitoRegistrado.codigo, 'config.registrarPrerequisito'),
        ),
      ),
    // M41, regra 1: a mesma leitura da API (unidades atendidas no mês e no anterior; prescrições do novo na janela).
    regraFarmacia: async (h, _tipo, chave) => {
      try {
        const { leitura, chaves } = await nucleo.lerSomente(ctx(h), async (l) => {
          const { hoje } = await relogioEstoque(l);
          const ano = Number(hoje.slice(0, 4));
          const mes = Number(hoje.slice(5, 7));
          const anterior = mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 };
          return {
            leitura: {
              atendidas: [
                ...(await unidadesAtendidasPorLocal(l, anterior)),
                ...(await unidadesAtendidasPorLocal(l, { ano, mes })),
              ],
              prescricoes: await prescricoesDoNovoPorUnidade(l, h, hoje, DIAS_PRESCRICAO_EM_USO),
            },
            chaves: (await lerChavesLiberacao(l, h)).filter(
              (c) => c.chave === CHAVE_PRESCRICAO_ONDA2 && c.tipo === 'recurso',
            ),
          };
        });
        return motivoLigarRegraFarmacia(chave, leitura, chaves);
      } catch {
        return motivoLigarRegraFarmacia(chave, null, []);
      }
    },
  };
  try {
    const r = await executarLiberacaoFull(
      {
        ambiente,
        hospitais,
        operacoes: catalogo.operacoes.map((o) => o.nome),
        estadoEfetivo: (op, h) => efetivo.estado(op, h),
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
