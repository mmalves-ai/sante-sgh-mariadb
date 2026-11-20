// pnpm contas:inventario -- [--hospital=pc] [--gravar] [--relatorio]
// M59-F1 (ficha do M59, seção 4 e regra 5): inventário das contas do banco e dos seus privilégios, lido do
// catálogo de segurança da cópia em transação de leitura. Só nomes de conta técnica (cap-08 §8.10 e as do
// Sante SGH) e contagens; as demais contas entram somadas, sem nome (podem ser login de pessoa), e as
// contagens abaixo de 5 viram "<5". Com --gravar, escreve o retrato em tools/verificadores/dados/
// contas-banco.<hospital>.json (versionado; o relatório da F1 parte dele). Com --relatorio, escreve o relatório da F1
// em docs/marcos/M59/<hospital>/inventario-contas.md: destino, situação e motivo de cada conta (regras 1, 4, 5 e 12),
// com o passo, a autorização e o script de cada redução. Nunca grava no banco.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  contarLoginsNaoLegiveis,
  lerConfiguracaoNucleo,
  lerInventarioContasBanco,
  lerSessoesAtuais,
  NucleoLegado,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import {
  catalogarConta,
  faixaContagem,
  montarInventarioContas,
  nomesLegiveis,
  resumirInventario,
  type ContasSgh,
} from '@sgh/dominio-acesso';
import { lerArgumentos } from './argumentos.ts';
import { codigosDaCopia } from './permissoes-copia.ts';

const raiz = resolve(import.meta.dirname, '../../..');
const { opcoes, bandeiras } = lerArgumentos(process.argv.slice(2));
const hospital = opcoes['hospital'] ?? 'pc';

const copia = codigosDaCopia();
if (!copia || !copia.codigos.includes(hospital)) {
  console.error(`Sem cópia de dev configurada para "${hospital}" (AMBIENTE=dev, loopback).`);
  process.exit(1);
}
const env = copia.env;
const cod = hospital.toUpperCase();
const sgh: ContasSgh = {
  aplicacao: [env[`FB_${cod}_USUARIO`]].filter((x): x is string => Boolean(x?.trim())),
  scripts: env[`FB_${cod}_SCRIPTS_USUARIO`]?.trim() || null,
  leitura: env[`FB_${cod}_LEITURA_USUARIO`]?.trim() || null,
};
const legiveis = nomesLegiveis(sgh);
const nucleo = new NucleoLegado({
  env,
  driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(env).bibliotecaCliente }),
  pastaHomologada: resolve(raiz, 'tools/schema-check/homologado'),
  aviso: () => undefined,
});
let ok = true;
try {
  const ctx = { rede: nucleo.rede, hospital, traceId: 'contas-inventario' };
  const r = await nucleo.lerSomente(ctx, async (l) => ({
    contas: await lerInventarioContasBanco(l, legiveis),
    loginsForaDaLista: await contarLoginsNaoLegiveis(l, legiveis),
    sessoes: await lerSessoesAtuais(l, legiveis),
  }));
  const resumo = resumirInventario(r.contas);
  // A conta da aplicação aparece pela classe, não pelo nome do arquivo de ambiente.
  const rotulo = (nome: string | null) => {
    if (nome === null) return '(demais contas, somadas)';
    const c = catalogarConta(nome, sgh);
    return c.classe === 'aplicacao-sgh' || c.classe === 'scripts-sgh' || c.classe === 'leitura-sgh'
      ? `(${c.classe})`
      : nome;
  };
  const retrato = {
    formato: 1,
    estabelecimento: hospital,
    origem: 'cópia de dev (catálogo de segurança, leitura)',
    resumo,
    loginsForaDaLista: faixaContagem(r.loginsForaDaLista),
    contas: r.contas.map((c) => ({
      conta: rotulo(c.nome),
      tipo: c.tipo,
      classe: catalogarConta(c.nome, sgh).classe,
      quantidade: c.nome === null ? faixaContagem(c.quantidade) : c.quantidade,
      existeLogin: c.existeLogin,
      ativa: c.ativa,
      privilegios: c.privilegios,
      objetosComEscrita: c.objetosComEscrita,
      papeis: c.papeis,
    })),
  };
  for (const c of retrato.contas) {
    const p = c.privilegios;
    console.log(
      `${c.tipo.padEnd(7)} ${String(c.conta).padEnd(28)} ${String(c.classe).padEnd(18)} n=${String(c.quantidade).padStart(3)} ` +
        `S=${p.S} I=${p.I} U=${p.U} D=${p.D} X=${p.X} R=${p.R} M=${p.M} escrita=${c.objetosComEscrita}` +
        (c.existeLogin ? ` login=${c.ativa ? 'ativo' : 'inativo'}` : '') +
        (c.papeis.length ? ` papéis=${c.papeis.join(',')}` : ''),
    );
  }
  console.log(
    `resumo: ${JSON.stringify(resumo)}; logins fora da lista: ${String(retrato.loginsForaDaLista)}`,
  );
  if (bandeiras.has('gravar')) {
    const arq = resolve(raiz, `tools/verificadores/dados/contas-banco.${hospital}.json`);
    writeFileSync(arq, `${JSON.stringify(retrato, null, 2)}\n`);
    console.log(`retrato gravado: tools/verificadores/dados/contas-banco.${hospital}.json`);
  }
  if (bandeiras.has('relatorio')) {
    const inv = montarInventarioContas({
      hospital,
      em: new Date().toISOString(),
      contas: r.contas,
      loginsNaoLegiveis: r.loginsForaDaLista,
      usos: [],
      sgh,
      // pc: o registro do desligamento (docs/coexistencia/desligamento) não tem passo; a contingência fica aberta
      // (falha fechada, como o painel com o parâmetro ilegível).
      contexto: { desligado: false, contingenciaAtiva: true, decisoes: new Set(), janelaMinimaDias: 90 },
      avisos: ['uso das contas ainda não medido: a medição é feita no servidor do hospital, pela TI (DP-15)'],
    });
    const arq = resolve(raiz, `docs/marcos/M59/${hospital}/inventario-contas.md`);
    mkdirSync(dirname(arq), { recursive: true });
    writeFileSync(
      arq,
      relatorioMd(
        { ...inv, contas: inv.contas.map((c) => ({ ...c, nome: c.nome && rotulo(c.nome) })) },
        r.sessoes,
      ),
    );
    console.log(`relatório gravado: docs/marcos/M59/${hospital}/inventario-contas.md`);
  }
} catch (e) {
  ok = false;
  console.error(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
} finally {
  await nucleo.encerrar();
}
process.exit(ok ? 0 : 1);

function relatorioMd(
  inv: ReturnType<typeof montarInventarioContas>,
  sessoes: readonly { conta: string | null; sessoes: number }[],
): string {
  const dba = sessoes.filter((x) => x.conta?.toUpperCase() === 'SYSDBA').reduce((a, x) => a + x.sessoes, 0);
  const total = sessoes.reduce((a, x) => a + x.sessoes, 0);
  const r = inv.resumo;
  const linhas = inv.contas.map(
    (c) =>
      `| ${c.nome ?? '(demais contas, somadas, sem nome)'} | ${c.tipo} | ${String(c.quantidade)} | ${c.classe} | ` +
      `${c.destino} | ${c.situacao} | ${c.leitura} | ${c.escrita} | ${c.execucao} | ${c.motivo} |`,
  );
  return [
    `# M59 F1: inventário das contas do banco (${inv.hospital})`,
    '',
    `Gerado por \`./pnpm contas:inventario -- --hospital=${inv.hospital} --relatorio\` na cópia de dev (catálogo de`,
    'segurança, transação de leitura). Só contas técnicas do catálogo e as do Sante SGH; as demais entram somadas e sem',
    'nome; contagem abaixo de 5 vira "<5". Nada foi revogado: cada redução é um script de',
    '`infra/firebird/fase7/privilegios/<hospital>/`, aplicado pela TI do hospital com a autorização do dono por passo',
    '(ficha do M59, seções 6 e 12), e só depois do desligamento do hospital (regra 1) e com o uso medido (regra 5).',
    '',
    `Retrato: ${inv.em.slice(0, 10)}. Contexto: desligado=${inv.contexto.desligado ? 'sim' : 'não'}, contingência=` +
      `${inv.contexto.contingenciaAtiva ? 'aberta' : 'fechada'}, janela mínima de medição ${inv.contexto.janelaMinimaDias} dias.`,
    '',
    ...inv.contexto.avisos.map((a) => `- Aviso: ${a}`),
    `- Sessões no momento da leitura (MON$ATTACHMENTS, fora a desta leitura): ${String(faixaContagem(total))}; ` +
      `do administrador do servidor (auditoria do DBA, regra 4): ${String(faixaContagem(dba))}. A amostra contínua e o ` +
      'trace do servidor são da TI do hospital (DP-15).',
    '',
    '## Resumo',
    '',
    `- Contas com privilégio: ${r.contasComPrivilegio}; com escrita: ${r.contasComEscrita}; com escrita ampla: ${r.contasComEscritaAmpla};`,
    `  maior alcance de escrita: ${r.maiorAlcanceEscrita} objetos.`,
    `- Contas fora do catálogo (somadas): ${String(r.naoCatalogadas)}; logins sem privilégio: ${String(r.loginsSemPrivilegio)}.`,
    `- Papéis sem privilégio: ${r.papeisSemPrivilegio.join(', ') || 'nenhum'}.`,
    `- Por situação: ${Object.entries(r.porSituacao)
      .map(([k, v]) => `${k} ${String(v)}`)
      .join('; ')}.`,
    '',
    '## Contas',
    '',
    '| Conta | Tipo | Qtd. | Função | Destino | Situação | Leitura | Escrita | Execução | Motivo |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...linhas,
    '',
    '## Passos (regra 1, seção 12 da ficha)',
    '',
    '| Passo | Script | Autorização | Quem aplica |',
    '|---|---|---|---|',
    `| Papéis por módulo e conta da aplicação por módulo (regra 4) | \`infra/firebird/fase7/privilegios/${inv.hospital}/0001_papeis_por_modulo.aplicar.sql\` (volta: \`.recolher.sql\`) | dono, por passo (ESTADO.md › Autorizações) | TI do hospital |`,
    '| Revogação das contas sem uso medido (regra 5) | gerada por `gerarScriptsRevogacao` quando a medição de 90 dias existir | dono, por conta | TI do hospital, depois do desligamento |',
    '| Conta da Hal-AI vira cliente da API do Sante (regra 12) | nenhum até a decisão e o contrato verificado | dono | TI do hospital |',
    '',
  ].join('\n');
}
